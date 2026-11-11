// Cloudflare Worker + one Durable Object ("Casino") that holds both tables and every player's chips.
// Clients connect over WebSocket, sign in with their Firebase ID token, send actions, and receive state pushes.
// Timers run on Durable Object alarms, so the tables move on by themselves.
import { DurableObject } from "cloudflare:workers";
import { Core, GameError } from "./core.js";
import { verifyIdToken } from "./auth.js";
import { readOldData } from "./firestore.js";
import { GRANTS } from "./grants.js";

const MAX_SOCKETS = 300, MAX_PER_USER = 6, MAX_MSG = 4096;
const RATE = { perSec: 12, burst: 30 };
const ACTIONS = new Set(["join", "setBets", "leave", "deposit", "repay", "give", "bjBet", "bjAct", "chat", "rename", "setFrame", "setBubble", "fxOpen", "fxClose", "rcBets", "hlOpen", "bank", "spBets", "pkSit", "pkTopUp", "pkLeave", "pkBack", "pkAct", "crBet", "crCancel", "crCash", "ccJoin", "ccLeave", "ccRoll"]);
const FX_WATCH_MS = 60_000; // a page counts as watching the FX market for this long after its last fxWatch

const csv = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
function originOk(req, env) {
  const o = req.headers.get("Origin") || "";
  const allowed = csv(env.ALLOWED_ORIGINS);
  if (allowed.includes(o)) return true;
  return env.ALLOW_LOCALHOST === "1" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health") return new Response("ok");
    if (url.pathname === "/grants" || url.pathname === "/status") return env.CASINO.get(env.CASINO.idFromName("main")).fetch(req);
    if (url.pathname !== "/ws") return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    if (!originOk(req, env)) return new Response("forbidden origin", { status: 403 });
    const stub = env.CASINO.get(env.CASINO.idFromName("main"));
    return stub.fetch(req);
  },
};

export class Casino extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.core = null;
    this.buckets = new Map(); // ws -> {t, n}; in memory only, resets after hibernation, which is fine
    this.fxTimer = null; this.fxTicks = 0;
    this.ready = ctx.blockConcurrencyWhile(() => this.load());
  }

  async load() {
    const all = await this.ctx.storage.list();
    const d = { players: {} };
    for (const [k, v] of all) {
      if (k.startsWith("p:")) d.players[k.slice(2)] = v;
      else d[k] = v;
    }
    const core = new Core(null, { allowedEmails: csv(this.env.ALLOWED_EMAILS) });
    for (const k of ["bac", "bacBets", "bacShoe", "bj", "bjBets", "bjShoe", "meta", "chat", "fx", "rc", "rcBets", "sp", "spBets", "pk", "pkDeck", "cr", "crBets", "crSecret", "cc"]) if (d[k] !== undefined) core.d[k] = d[k];
    core.d.players = d.players;
    this.core = core;
    core.applyGrants(GRANTS, Date.now());
    core.step(Date.now()); // e.g. make the first race card after a deploy
    if (core.changed.size) await this.commit();
    if (core.hlPending()) this.fxEnsure(); // High/Low options still running after a restart
  }

  /** Save whatever changed, push it to everyone, and set the next alarm. */
  async commit() {
    const ch = this.core.takeChanges();
    if (ch.size) {
      const entries = {};
      for (const k of ch) {
        if (k.startsWith("p:")) entries[k] = this.core.d.players[k.slice(2)];
        else entries[k] = this.core.d[k];
      }
      await this.ctx.storage.put(entries);
      const msgs = [];
      for (const k of ch) {
        if (k === "bacShoe" || k === "bjShoe" || k === "pkDeck" || k === "crSecret") continue; // never leaves the server
        if (k.startsWith("p:")) msgs.push({ type: "player", uid: k.slice(2), p: this.core.view(k) });
        else msgs.push({ type: k, v: this.core.view(k) });
      }
      if (msgs.length) this.broadcast({ type: "batch", msgs });
    }
    const due = this.core.nextDue();
    const cur = await this.ctx.storage.getAlarm();
    if (due === null) { if (cur !== null) await this.ctx.storage.deleteAlarm(); }
    else if (cur === null || cur !== due) await this.ctx.storage.setAlarm(Math.max(due, Date.now() + 50));
  }

  broadcast(obj) {
    obj.now = Date.now();
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a && a.uid) { try { ws.send(s); } catch { /* closing */ } }
    }
  }
  send(ws, obj) { obj.now = Date.now(); try { ws.send(JSON.stringify(obj)); } catch { /* closing */ } }

  async fetch(req) {
    await this.ready;
    const path = new URL(req.url).pathname;
    if (path === "/grants" || path === "/status") {
      this.core.applyGrants(GRANTS, Date.now());
      if (this.core.changed.size) await this.commit();
      return Response.json(path === "/grants" ? this.core.d.meta.grants || {} : { grants: this.core.d.meta.grants || {}, defined: GRANTS.map((g) => g.id), race: !!(this.core.d.rc && this.core.d.rc.card), at: Date.now() });
    }
    const socks = this.ctx.getWebSockets();
    if (socks.length >= MAX_SOCKETS) return new Response("table is full", { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ uid: null, email: "", at: Date.now() });
    return new Response(null, { status: 101, webSocket: client });
  }

  // TEST_JWKS is only for local `wrangler dev` runs with self-signed test tokens. Never set it in wrangler.toml.
  authOpts() { return this.env.TEST_JWKS ? { keyOverride: JSON.parse(this.env.TEST_JWKS) } : {}; }

  allow(ws) {
    const now = Date.now();
    let b = this.buckets.get(ws);
    if (!b) { b = { t: now, n: RATE.burst }; this.buckets.set(ws, b); }
    b.n = Math.min(RATE.burst, b.n + ((now - b.t) / 1000) * RATE.perSec); b.t = now;
    if (b.n < 1) return false;
    b.n -= 1; return true;
  }

  async webSocketMessage(ws, raw) {
    await this.ready;
    if (typeof raw !== "string" || raw.length > MAX_MSG) { ws.close(1009, "too big"); return; }
    let m; try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== "object" || typeof m.type !== "string") return;
    const id = Number.isSafeInteger(m.id) ? m.id : null;
    const reply = (ok, extra) => this.send(ws, { re: id, ok, ...extra });
    if (!this.allow(ws)) { reply(false, { error: "操作が速すぎるよ。少し待ってね" }); return; }
    const att = ws.deserializeAttachment() || {};

    if (m.type === "auth") {
      try {
        const u = await verifyIdToken(m.token, this.env.FIREBASE_PROJECT_ID, this.authOpts());
        const mine = this.ctx.getWebSockets().filter((s) => s !== ws && (s.deserializeAttachment() || {}).uid === u.uid);
        if (mine.length >= MAX_PER_USER) mine.sort((a, b) => a.deserializeAttachment().at - b.deserializeAttachment().at)[0].close(4000, "too many tabs");
        ws.serializeAttachment({ uid: u.uid, email: u.email, at: Date.now() });
        reply(true, { data: { uid: u.uid, state: this.core.fullState() } });
      } catch (e) { reply(false, { error: e instanceof Error && /[ぁ-んァ-ン]/.test(e.message) ? e.message : "ログインを確認できなかった。もう一度ログインしてね" }); }
      return;
    }
    if (!att.uid) { reply(false, { error: "ログインしてね" }); return; }
    if (m.type === "ping") { reply(true, {}); return; }
    if (m.type === "admin") {
      const admins = csv(this.env.ADMIN_UIDS), isAdmin = admins.includes(att.uid);
      if (m.op === "whoami") { reply(true, { data: { uid: att.uid, admin: isAdmin } }); return; }
      if (!isAdmin) { reply(false, { error: "このアカウントは運営じゃないよ" }); return; }
      try {
        this.core.step(Date.now());
        const data = this.core.admin(att.uid, m, Date.now());
        await this.commit();
        reply(true, { data });
      } catch (e) { if (e instanceof GameError) reply(false, { error: e.message }); else { console.error(e); reply(false, { error: "うまくいかなかった" }); await this.load(); } }
      return;
    }
    if (m.type === "pkMine") { reply(true, { data: this.core.pkMine(att.uid) }); return; }
    if (m.type === "fxWatch") {
      ws.serializeAttachment({ ...att, fxAt: Date.now() });
      this.fxEnsure();
      reply(true, { data: this.core.d.fx });
      return;
    }

    if (m.type === "import") {
      try {
        if (this.core.d.meta.imported) throw new GameError("引き継ぎはもう終わってるよ");
        const u = await verifyIdToken(m.token, this.env.FIREBASE_PROJECT_ID, this.authOpts());
        if (u.uid !== att.uid) throw new GameError("ログインし直してね");
        const old = await readOldData(this.env.FIREBASE_PROJECT_ID, m.token);
        const n = this.core.importPlayers(old.players, old.held);
        await this.commit();
        reply(true, { data: { count: n } });
      } catch (e) { reply(false, { error: e instanceof GameError || (e instanceof Error && /[ぁ-んァ-ン]/.test(e.message)) ? e.message : "引き継ぎに失敗した。もう一度試してね" }); }
      return;
    }

    if (!ACTIONS.has(m.type)) { reply(false, { error: "その操作はできないよ" }); return; }
    const now = Date.now();
    this.core.applyGrants(GRANTS, now); // catches a grant whose player joined after startup
    this.core.step(now); // settle anything already due before acting on it
    await this.commit();
    try {
      const data = this.core.handle(att.uid, att.email, m.type, m, now);
      await this.commit();
      reply(true, { data: data ?? null });
    } catch (e) {
      // Core runs every check before it changes anything, so a refused action leaves no partial state.
      if (e instanceof GameError) reply(false, { error: e.message });
      else { console.error(e); reply(false, { error: "うまくいかなかった。もう一度試してね" }); await this.load(); }
    }
  }

  /* The FX market ticks once a second, but only while some page is watching it (a plain timer, so it costs no requests). */
  fxEnsure() {
    if (this.fxTimer) return;
    this.fxTimer = setInterval(() => this.fxStep(), 1000);
    this.fxStep();
  }
  fxStep() {
    try {
      const now = Date.now();
      const watchers = this.ctx.getWebSockets().filter((s) => { const a = s.deserializeAttachment() || {}; return a.uid && a.fxAt && now - a.fxAt < FX_WATCH_MS; });
      if (!watchers.length && !this.core.hlPending()) { clearInterval(this.fxTimer); this.fxTimer = null; this.ctx.storage.put("fx", this.core.d.fx); return; }
      const r = this.core.fxTick(now);
      const s = JSON.stringify({ type: "batch", now, msgs: [{ type: "fxTick", t: r.t, p: r.p }] });
      for (const w of watchers) { try { w.send(s); } catch { /* closing */ } }
      if (++this.fxTicks % 15 === 0) this.ctx.storage.put("fx", this.core.d.fx);
      if (r.liq.length) this.commit().catch((e) => console.error(e));
    } catch (e) { console.error(e); }
  }

  async webSocketClose(ws, code) { this.buckets.delete(ws); try { ws.close(code, "bye"); } catch { /* already closed */ } }
  async webSocketError(ws) { this.buckets.delete(ws); }

  async alarm() {
    await this.ready;
    this.core.step(Date.now());
    await this.commit();
  }
}
