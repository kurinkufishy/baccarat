import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { connect } from "./net.js";
import { setupWallet } from "./wallet.js";

/* ================= constants (keep in sync with functions/bjgame.js) ================= */
const START = 10000, BET_MS = 15000, TURN_MS = 15000, CARD_MS = 600, GRACE_MS = 1000, HOLD_MS = 5000;
const MIN_BET = 100, MAX_BET = 100000000000000, MAX_DEPOSIT = 1000000, MAX_HANDS = 6;
const CHIPS = [{ v: 100, c: "#3f7fbf", l: "100" }, { v: 500, c: "#8e44ad", l: "500" }, { v: 1000, c: "#1f9d55", l: "1K" }, { v: 5000, c: "#d63447", l: "5K" }, { v: 10000, c: "#2b2b33", l: "10K" }, { v: 50000, c: "#c98a12", l: "50K" }, { v: 1000000, c: "#0f8f8a", l: "1M" }];
const RK = "A23456789TJQK", SU = { S: "♠", H: "♥", D: "♦", C: "♣" };
const fresh = () => ({ round: 1, phase: "paused", closesAt: 0, hands: [], dealer: [], turn: -1, turnEndsAt: 0, seq: 0, animUntil: 0, history: [] });
const rv = (c) => { const i = RK.indexOf(c[0]); return i === 0 ? 1 : i >= 9 ? 10 : i + 1; };
function total(cards) { let t = 0, a = 0; for (const c of cards) { const v = rv(c); t += v; if (v === 1) a++; } let soft = false; if (a && t + 10 <= 21) { t += 10; soft = true; } return { total: t, soft }; }
const isBJ = (cards) => cards.length === 2 && total(cards).total === 21;
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const fmtK = (n) => n >= 1e12 ? (+(n / 1e12).toFixed(1)) + "T" : n >= 1e9 ? (+(n / 1e9).toFixed(1)) + "B" : n >= 1e6 ? (+(n / 1e6).toFixed(1)) + "M" : n >= 1000 ? (+(n / 1000).toFixed(1)) + "K" : String(n);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 40) : ms));
const chipColor = (v) => { let c = CHIPS[0].c; for (const x of CHIPS) if (v >= x.v) c = x.c; return c; };

/* ================= sign-in (Firebase Auth) + game server (Cloudflare) ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
let conn = null, online = false, importAvail = false, importing = false;
const sNow = () => Date.now() + (conn ? conn.offset() : 0);
const call = (name, data) => (conn ? conn.call(name, data) : Promise.reject(new Error("接続中…少し待ってね")));
const errMsg = (e) => (e && e.message ? e.message : "うまくいかなかった。もう一度試してね");

/* ================= state ================= */
let user = null, me = null, gate = "loading", gateErr = "", joining = false;
let t = fresh(), players = {}, bets = {}, firstState = true;
let want = null, ackWant = null, sending = false, lastBase = 0;
let chipSel = 1000, acting = false, actedSeq = -1, statsOpen = false;
let animating = 0, bannerMsg = "";

const serverBet = () => { const b = bets[me]; return b && b.round === t.round ? b.amount : 0; };
const myBet = () => (want ?? ackWant ?? serverBet());
const settledHidden = (p) => !!(p && p.bjLast && p.bjLast.round === t.round && t.phase === "result" && animating);
function myFree() {
  const p = players[me]; if (!p) return 0;
  let c = p.chips;
  if (settledHidden(p)) c -= p.bjLast.ret || 0;
  if (t.phase === "betting" || t.phase === "paused") c -= myBet() - serverBet();
  return c;
}
function bettingOpen() { return t.phase === "paused" || (t.phase === "betting" && (!t.closesAt || sNow() < t.closesAt - 400)); }

/** Seat order: bettors by time during betting, hands once dealt. */
function seats() {
  if (t.hands && t.hands.length) return t.hands.map((h) => ({ uid: h.uid, bet: h.bet, hand: h }));
  const list = Object.entries(bets).filter(([, b]) => b.round === t.round && b.amount > 0).map(([uid, b]) => ({ uid, bet: b.amount, at: b.at }));
  const mine = list.find((s) => s.uid === me);
  if (mine) mine.bet = myBet();
  else if (myBet() > 0) list.push({ uid: me, bet: myBet(), at: Infinity });
  return list.filter((s) => s.bet > 0).sort((a, b) => a.at - b.at).slice(0, MAX_HANDS);
}

/* ================= betting ================= */
function queueBet(amount) { want = amount; render(); if (!sending) pump(); }
async function pump() {
  sending = true;
  while (want !== null) {
    const w = want;
    try { await call("bjBet", { amount: w, round: t.round }); if (want === w) { ackWant = w; want = null; } }
    catch (e) { want = null; ackWant = null; flash(errMsg(e)); }
  }
  sending = false; render();
}
function addChip(v) {
  if (!players[me]) return;
  if (!bettingOpen()) { flash("ベット締切。次のゲームを待ってね"); return; }
  const cur = myBet(), free = myFree();
  if (free <= 0) { flash("チップが足りない。残高の＋から借りられるよ"); return; }
  const add = Math.min(v === "all" ? free : v, free, MAX_BET - cur);
  if (add <= 0) { flash("これ以上は置けないよ"); return; }
  const next = cur + add;
  if (next < MIN_BET) { flash(`ベットは ${MIN_BET} から`); return; }
  lastBase = next; queueBet(next);
}
function clearBet() { if (bettingOpen() && myBet()) queueBet(0); }
function repeatOrDouble() {
  if (!bettingOpen()) return;
  const cur = myBet(), free = myFree();
  if (cur) { if (cur > free) { flash("チップが足りなくて2倍にできない"); return; } lastBase = Math.min(cur * 2, MAX_BET); queueBet(lastBase); }
  else { const last = lastBase || players[me]?.bjhist?.[0]?.bet || 0; if (!last) return; if (last > free) { flash("チップが足りなくて同じベットにできない"); return; } queueBet(last); }
}
async function act(action) {
  if (acting) return;
  acting = true; actedSeq = t.seq; render();
  try { await call("bjAct", { action, round: t.round, turn: t.turn }); }
  catch (e) { flash(errMsg(e)); actedSeq = -1; }
  acting = false; render();
}

/* ================= stage geometry ================= */
let G = null;
const hands = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, tw = { L: null, R: null };
function layout() {
  const s = $("stage"), W = s.clientWidth, H = s.clientHeight; if (!W || !H) return;
  const narrow = W < 640;
  const cw = narrow ? Math.min(W * .088, H * .1) : Math.min(W * .05, H * .115), ch = cw * 1.42;
  const xs = [.1, .265, .42, .58, .735, .9];
  const ys = narrow ? [.61, .65, .67, .67, .65, .61] : [.56, .63, .67, .67, .63, .56];
  G = {
    W, H, cw, ch, narrow,
    seat: xs.map((x, i) => ({ x: W * x, y: H * ys[i] })),
    dealer: { x: W * .5 - cw * .3, y: H * (narrow ? .21 : .25) },
    shoe: { x: W * (narrow ? .1 : .075), y: H * .2 },
    sh: { L: { x: W * (narrow ? .3 : .36), y: -H * .12 }, R: { x: W * (narrow ? .7 : .64), y: -H * .12 } },
    rest: { L: { x: W * .43, y: H * .1 }, R: { x: W * .57, y: H * .1 } },
  };
  $("stage").style.setProperty("--cw", cw + "px");
  $("cards").style.setProperty("--cw", cw + "px");
  $("armsvg").setAttribute("viewBox", `0 0 ${W} ${H}`);
  const b = $("backsvg"); b.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const g = "#d9b56b", fsz = narrow ? cw * .42 : cw * .52;
  const sx = G.shoe.x, sy = G.shoe.y, sw = cw * 1.25, shh = cw * .95;
  const arcY = H * (narrow ? .38 : .45);
  b.innerHTML = `<defs>
      <path id="arc1" d="M${W * .2} ${arcY} Q${W * .5} ${arcY - H * .1} ${W * .8} ${arcY}"/>
      <path id="arc2" d="M${W * .24} ${arcY + H * .045} Q${W * .5} ${arcY - H * .055} ${W * .76} ${arcY + H * .045}"/>
      <radialGradient id="rimg" cx="50%" cy="0%" r="100%"><stop offset="0" stop-color="#5b2a1c"/><stop offset="1" stop-color="#2a110b"/></radialGradient>
    </defs>
    <ellipse cx="${W / 2}" cy="${-H * .03}" rx="${W * .33}" ry="${H * .12}" fill="url(#rimg)"/>
    <ellipse cx="${W / 2}" cy="${-H * .03}" rx="${W * .33}" ry="${H * .12}" fill="none" stroke="${g}" stroke-opacity=".55" stroke-width="2"/>
    <text font-family="Cinzel,serif" font-weight="700" font-size="${fsz}" fill="${g}" fill-opacity=".85" letter-spacing="${fsz * .1}"><textPath href="#arc1" startOffset="50%" text-anchor="middle">BLACKJACK PAYS 3 TO 2</textPath></text>
    <text font-family="Rubik,sans-serif" font-weight="600" font-size="${Math.max(9, cw * .17)}" fill="${g}" fill-opacity=".6" letter-spacing="2"><textPath href="#arc2" startOffset="50%" text-anchor="middle">DEALER STANDS ON ALL 17s</textPath></text>
    <path d="M${W * .03} ${H * .5} Q${W * .5} ${H * 1.02} ${W * .97} ${H * .5}" fill="none" stroke="${g}" stroke-opacity=".22" stroke-width="2"/>
    <g transform="translate(${sx} ${sy}) rotate(-14)">
      <rect x="${-sw / 2 + 4}" y="${-shh / 2 + 6}" width="${sw}" height="${shh}" rx="5" fill="#000" opacity=".3"/>
      <rect x="${-sw / 2}" y="${-shh / 2}" width="${sw}" height="${shh}" rx="5" fill="#e9edf2" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>
      <rect x="${-sw / 2 + cw * .12}" y="${-shh / 2 + cw * .12}" width="${sw - cw * .24}" height="${shh - cw * .3}" rx="3" fill="#2f56b0" stroke="#fff" stroke-opacity=".5"/>
      <rect x="${sw / 2 - cw * .32}" y="${shh / 2 - cw * .28}" width="${cw * .5}" height="${cw * .4}" rx="3" fill="#2f56b0" stroke="#fff" stroke-width="1.5" transform="rotate(10 ${sw / 2} ${shh / 2})"/>
    </g>`;
  if (!animating) { hands.L = { ...G.rest.L }; hands.R = { ...G.rest.R }; }
  drawArms();
}
function drawArms() {
  if (!G) return; let h = "";
  for (const k of ["L", "R"]) {
    const S = G.sh[k], P = hands[k], dir = k === "L" ? -1 : 1;
    const C = { x: (S.x + P.x) / 2 + dir * G.W * .012, y: (S.y + P.y) / 2 + G.H * .02 };
    const a = Math.atan2(P.y - C.y, P.x - C.x), ca = Math.cos(a), sa = Math.sin(a);
    const hl = G.cw * .8, hw = G.cw * .52, sw = G.cw * .56;
    const W1 = { x: P.x - ca * hl * .42, y: P.y - sa * hl * .42 }, W0 = { x: W1.x - ca * G.cw * .14, y: W1.y - sa * G.cw * .14 };
    const th = -dir;
    h += `<path d="M${S.x} ${S.y} Q${C.x} ${C.y} ${W0.x} ${W0.y}" stroke="#15161b" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`
      + `<path d="M${S.x} ${S.y} Q${C.x} ${C.y} ${W0.x} ${W0.y}" stroke="#2a2c33" stroke-width="${sw * .3}" fill="none" stroke-linecap="round" opacity=".6"/>`
      + `<line x1="${W0.x}" y1="${W0.y}" x2="${W1.x + ca * 2}" y2="${W1.y + sa * 2}" stroke="#f3f3f1" stroke-width="${sw * .94}"/>`
      + `<g transform="translate(${P.x} ${P.y}) rotate(${a * 180 / Math.PI})">`
      + `<rect x="${-hl * .45}" y="${-hw / 2}" width="${hl * .95}" height="${hw}" rx="${hw * .46}" fill="#e8bb97"/>`
      + `<ellipse cx="${-hl * .05}" cy="${th * hw * .5}" rx="${hl * .26}" ry="${hw * .17}" fill="#dcaa84" transform="rotate(${th * 18} ${-hl * .05} ${th * hw * .5})"/>`
      + `<path d="M${hl * .1} ${-hw * .2} H${hl * .4} M${hl * .1} 0 H${hl * .44} M${hl * .1} ${hw * .2} H${hl * .38}" stroke="#c48d68" stroke-width="${Math.max(1, G.cw * .018)}" stroke-linecap="round"/>`
      + `</g>`;
  }
  $("armg").innerHTML = h;
}
function moveHand(k, x, y, ms) {
  return new Promise((res) => {
    const from = { ...hands[k] }, t0 = performance.now(), id = {}; tw[k] = id;
    if (reduced() || ms <= 0) { hands[k] = { x, y }; drawArms(); return res(); }
    const step = (now) => {
      if (tw[k] !== id) return res();
      let q = Math.min(1, (now - t0) / ms); q = q < .5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
      hands[k] = { x: from.x + (x - from.x) * q, y: from.y + (y - from.y) * q }; drawArms();
      if (q < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
const rest = (k, ms = 300) => moveHand(k, G.rest[k].x, G.rest[k].y, ms);

/* ================= cards on the table ================= */
// Keys: "h{seat}c{n}" for players, "d{n}" for the dealer. The dealer's second card is face down until revealed.
function posOf(key) {
  if (key[0] === "d") { const n = +key.slice(1); return { x: G.dealer.x + n * G.cw * .62, y: G.dealer.y }; }
  const [, s, n] = key.match(/h(\d+)c(\d+)/).map(Number);
  const p = G.seat[s];
  return { x: p.x - G.cw * .42 + n * G.cw * .3, y: p.y - n * G.cw * .14 };
}
function wanted() {
  const out = [];
  const hs = t.hands || [];
  if (!hs.length) return out;
  const push = (key, card, up) => out.push({ key, card, up });
  hs.forEach((h, i) => push(`h${i}c0`, h.cards[0], true));
  push("d0", t.dealer[0], true);
  hs.forEach((h, i) => push(`h${i}c1`, h.cards[1], true));
  push("d1", t.holeHidden ? null : t.dealer[1], !t.holeHidden);
  hs.forEach((h, i) => h.cards.slice(2).forEach((c, j) => push(`h${i}c${j + 2}`, c, true)));
  (t.dealer || []).slice(2).forEach((c, j) => push(`d${j + 2}`, c, true));
  return out;
}
const els = {};
function faceHTML(c) {
  if (!c) return `<div class="f front"></div>`;
  const red = c[1] === "H" || c[1] === "D", r = c[0] === "T" ? "10" : c[0], s = SU[c[1]];
  return `<div class="f front ${red ? "red" : ""}"><span class="ix"><b>${r}</b><i>${s}</i></span><span class="pip">${s}</span><span class="ix bt"><b>${r}</b><i>${s}</i></span></div>`;
}
function makeEl(w) {
  const el = document.createElement("div");
  el.className = "tc" + (w.up ? " up" : "");
  el.dataset.card = w.card || "";
  el.innerHTML = `<div class="in"><div class="f back"></div>${faceHTML(w.card)}</div>`;
  $("cards").appendChild(el); els[w.key] = el; placeEl(w.key);
  return el;
}
function placeEl(key) {
  const el = els[key], p = posOf(key);
  el.style.width = G.cw + "px"; el.style.height = G.ch + "px";
  el.style.left = (p.x - G.cw / 2) + "px"; el.style.top = (p.y - G.ch / 2) + "px";
  el.style.zIndex = String(10 + (+key.replace(/\D+/g, "") || 0));
}
let queue = Promise.resolve();
function sync(instant) {
  if (!G) return;
  const ws = wanted();
  if (!ws.length) {
    const old = Object.keys(els);
    if (old.length) {
      animating++;
      const nodes = old.map((k) => { const e = els[k]; delete els[k]; return e; });
      queue = queue.then(async () => {
        if (!instant && !reduced()) nodes.forEach((e) => e.animate([{ opacity: 1 }, { opacity: 0, transform: "translate(40px,-30px)" }], { duration: 350, fill: "forwards" }));
        await wait(instant ? 0 : 360); nodes.forEach((e) => e.remove()); animating--; render();
      });
    }
    return;
  }
  const tasks = [];
  for (const w of ws) {
    const el = els[w.key];
    if (!el) {
      if (instant) { makeEl(w); continue; }
      const ne = makeEl({ ...w, up: false }); ne.style.visibility = "hidden"; ne.dataset.pending = "1";
      tasks.push(() => dealAnim(w.key, w));
    } else if (w.up && !el.classList.contains("up") && !el.dataset.pending && !el.dataset.flipping) {
      el.dataset.card = w.card; el.querySelector(".front").outerHTML = faceHTML(w.card);
      if (instant) { el.classList.add("up"); continue; }
      el.dataset.flipping = "1";
      tasks.push(() => flipAnim(w.key));
    }
  }
  if (!tasks.length) return;
  animating++;
  queue = queue.then(async () => {
    for (const f of tasks) await f();
    rest("L"); rest("R");
    animating--; render();
  });
  render();
}
async function dealAnim(key, w) {
  const el = els[key]; if (!el) return;
  const p = posOf(key), sh = G.shoe;
  const k = p.x < G.W / 2 ? "L" : "R";
  bannerMsg = key[0] === "d" && +key.slice(1) >= 2 ? "ディーラー" : ""; renderPill(true);
  el.style.visibility = "";
  if (reduced()) { if (w.up) el.classList.add("up"); delete el.dataset.pending; render(); return; }
  const a = el.animate([{ transform: `translate(${sh.x - p.x}px,${sh.y - p.y}px) rotate(-14deg) scale(.8)` }, { transform: "none" }], { duration: 380, easing: "cubic-bezier(.3,.7,.3,1)" });
  moveHand(k, p.x, p.y + G.ch * .2, 380);
  await a.finished.catch(() => {});
  if (w.up) {
    const f = el.querySelector(".in").animate([{ transform: "rotateY(0)" }, { transform: "rotateY(180deg)" }], { duration: 160, fill: "forwards" });
    await f.finished.catch(() => {}); el.classList.add("up"); f.cancel();
  }
  delete el.dataset.pending; render();
  await wait(CARD_MS - 560);
}
async function flipAnim(key) {
  const el = els[key]; if (!el) return;
  const p = posOf(key);
  bannerMsg = "ディーラー"; renderPill(true);
  await moveHand("R", p.x, p.y + G.ch * .3, 200);
  const f = el.querySelector(".in").animate([{ transform: "rotateY(0)" }, { transform: "rotateY(180deg)" }], { duration: 340, fill: "forwards" });
  await f.finished.catch(() => {}); el.classList.add("up"); f.cancel();
  delete el.dataset.flipping; render();
  await wait(60);
}
/** Cards actually face up on screen for a seat (or the dealer). */
function visibleCards(prefix) {
  return Object.keys(els).filter((k) => k.startsWith(prefix) && (prefix !== "d" || k[0] === "d")).sort((a, b) => +a.replace(/\D+/g, "").slice(-2) - +b.replace(/\D+/g, "").slice(-2))
    .map((k) => els[k]).filter((e) => e.classList.contains("up") && !e.dataset.pending && e.dataset.card).map((e) => e.dataset.card);
}

/* ================= rendering ================= */
let flashT = null, flashMsg = "", pillKey = "";
function flash(m) { flashMsg = m; renderPill(true); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderPill(true); }, 2400); }
const nameOf = (uid) => (players[uid] && players[uid].name) || "?";
function renderPill(force) {
  const now = sNow(); let key = "", html = "", frac = null;
  const ring = (s) => `<span class="ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" class="rbg"/><circle cx="18" cy="18" r="15.5" class="rfg" id="rfg"/></svg><b class="num">${s}</b></span>`;
  if (flashMsg) { key = "f" + flashMsg; html = `<div class="pill msg">${esc(flashMsg)}</div>`; }
  else if (animating && bannerMsg) { key = "a" + bannerMsg; html = `<div class="pill msg">${esc(bannerMsg)}</div>`; }
  else if (gate !== "in") key = "o";
  else if (t.phase === "paused") { key = "p"; html = '<div class="pill msg">休憩中 · チップを置くと始まるよ</div>'; }
  else if (t.phase === "betting") {
    const left = t.closesAt ? t.closesAt - now : BET_MS;
    if (left > 0) { const s = Math.ceil(left / 1000); key = "b" + s; frac = left / BET_MS; html = `<div class="pill bet">${ring(s)}ベットしてください</div>`; }
    else { key = "c"; html = '<div class="pill msg">ベット締切</div>'; }
  } else if (t.phase === "playing" && !animating && t.turn >= 0) {
    const h = t.hands[t.turn], left = t.turnEndsAt - now, s = Math.max(0, Math.ceil(left / 1000));
    const who = h.uid === me ? "あなたの番" : `${esc(nameOf(h.uid))} の番`;
    key = "t" + t.turn + "|" + s + who; frac = Math.max(0, Math.min(1, left / TURN_MS));
    html = `<div class="pill bet">${ring(s)}${who}</div>`;
  } else if (t.phase === "result" && !animating) {
    const d = total(t.dealer).total, txt = isBJ(t.dealer) ? "ディーラー ブラックジャック" : d > 21 ? "ディーラー バースト" : `ディーラー ${d}`;
    const mine = (t.hands || []).find((h) => h.uid === me);
    const extra = mine ? ` <span class="me num">${mine.d >= 0 ? "+" : ""}${fmt(mine.d)}</span>` : "";
    key = "r" + t.round + extra;
    html = `<div class="pill res ${d > 21 ? "T" : "B"}" style="--c:${d > 21 ? "#1f8c47" : "#2b3440"}">${txt}${extra}</div>`;
  } else key = "x";
  if (force || key !== pillKey) { $("pill").innerHTML = html; pillKey = key; }
  const r = $("rfg"); if (r && frac !== null) { r.style.strokeDashoffset = String(97.4 * (1 - frac)); r.classList.toggle("low", frac < .34); }
  const tb = $("turnbar"); if (tb) { const f = myTurnFrac(); tb.style.transform = `scaleX(${f})`; tb.classList.toggle("low", f < .34); }
}
function myTurnFrac() { return t.phase === "playing" && t.turn >= 0 ? Math.max(0, Math.min(1, (t.turnEndsAt - sNow()) / TURN_MS)) : 0; }
const isMyTurn = () => t.phase === "playing" && !animating && t.turn >= 0 && t.hands[t.turn] && t.hands[t.turn].uid === me && t.hands[t.turn].status === "playing";

let seatsKey = "", badgeKey = "";
function renderSeats() {
  if (!G) return;
  const ss = seats();
  let h = "";
  for (let i = 0; i < MAX_HANDS; i++) {
    const s = ss[i], p = G.seat[i];
    const top = p.y + G.ch * .62;
    if (!s) { h += `<div class="seat empty" style="left:${p.x}px;top:${top}px;--sw:${G.W * (G.narrow ? .17 : .14)}px"><div class="ring"></div></div>`; continue; }
    const turn = t.phase === "playing" && !animating && t.turn === i;
    const bet = s.hand ? s.hand.bet : s.bet;
    h += `<div class="seat ${turn ? "turn" : ""}" style="left:${p.x}px;top:${top}px;--sw:${G.W * (G.narrow ? .17 : .14)}px">
      <div class="ring"><span class="bchip num" style="--cc:${chipColor(bet)}">${fmtK(bet)}</span></div>
      <span class="nm">${esc(nameOf(s.uid))}${s.uid === me ? '<span class="you">あなた</span>' : ""}</span>
      ${s.hand && s.hand.doubled ? '<span class="amt">ダブル</span>' : ""}</div>`;
  }
  const k = h + G.W;
  if (k !== seatsKey) { $("seats").innerHTML = h; seatsKey = k; }
  // Totals and outcomes above each hand, from the cards actually showing.
  let b = "";
  (t.hands || []).forEach((hd, i) => {
    const vis = visibleCards(`h${i}c`); if (!vis.length) return;
    const n = vis.length, p = posOf(`h${i}c${n - 1}`);
    const tt = total(vis), done = t.phase === "result" && !animating;
    let cls = "", txt = String(tt.total);
    if (tt.total > 21) { cls = "bust"; txt = "BUST"; }
    else if (n === 2 && tt.total === 21) { cls = "bj"; txt = "BJ"; }
    else if (tt.soft) cls = "soft";
    if (done && hd.out) {
      const m = { win: ["win", "勝ち"], bj: ["bj", "BJ"], push: ["push", "引き分け"], lose: ["lose", tt.total > 21 ? "BUST" : "負け"] }[hd.out];
      cls = m[0]; txt = `${m[1]} ${hd.d > 0 ? "+" + fmtK(hd.d) : hd.d < 0 ? "−" + fmtK(-hd.d) : ""}`.trim();
    }
    b += `<span class="badge ${cls}" style="left:${Math.max(36, Math.min(G.W - 36, p.x))}px;top:${p.y - G.ch / 2 - 4}px">${txt}</span>`;
  });
  if (b !== badgeKey) { document.querySelectorAll("#stage .badge").forEach((e) => e.remove()); $("stage").insertAdjacentHTML("beforeend", b); badgeKey = b; }
  const dv = visibleCards("d"), dt = $("dtotal");
  if (dv.length) {
    const tt = total(dv); dt.hidden = false;
    dt.textContent = dv.length === 2 && tt.total === 21 ? "BLACKJACK" : tt.total > 21 ? `BUST ${tt.total}` : String(tt.total) + (tt.soft && tt.total < 21 ? " soft" : "");
    dt.style.left = (G.dealer.x + G.cw * .31 * (Math.max(2, Object.keys(els).filter((k) => k[0] === "d").length) - 1)) + "px";
    dt.style.top = (G.dealer.y + G.ch * .58) + "px";
  } else dt.hidden = true;
}
let midKey = "";
function renderMid() {
  let h;
  if (gate !== "in") h = '<span class="note">ログインすると参加できるよ</span>';
  else if (isMyTurn()) {
    const hd = t.hands[t.turn], canDbl = hd.cards.length === 2 && !hd.doubled && myFree() >= hd.bet;
    const dis = acting || actedSeq === t.seq ? "disabled" : "";
    h = `<div class="act" style="flex-direction:column;align-items:stretch;gap:6px"><div class="act">
      <button class="abtn hit" data-act="hit" ${dis}>ヒット<small>もう1枚</small></button>
      <button class="abtn stand" data-act="stand" ${dis}>スタンド<small>止める</small></button>
      <button class="abtn dbl" data-act="double" ${dis || (canDbl ? "" : "disabled")}>ダブル<small>${canDbl ? "+" + fmtK(hd.bet) + "で1枚" : "最初の2枚だけ"}</small></button>
      </div><span class="turnbar" id="turnbar"></span></div>`;
  } else if (t.phase === "playing" || (t.phase === "result" && animating)) {
    const inHand = (t.hands || []).some((x) => x.uid === me);
    h = `<span class="note">${inHand ? "自分の番を待ってね" : "このゲームは見学中。次のベットを待ってね"}</span>`;
  } else {
    const open = bettingOpen(), cur = myBet();
    const full = !cur && seats().length >= MAX_HANDS;
    h = `<button class="cbtn" id="clr" aria-label="ベットを取り消す" ${!open || !cur ? "disabled" : ""}>×</button>`
      + CHIPS.map((c) => `<button class="chip" style="--cc:${c.c}" data-v="${c.v}" ${!open || full ? "disabled" : ""} aria-label="${c.l}を足す">${c.l}</button>`).join("")
      + `<button class="chip allbet" data-v="all" ${!open || full ? "disabled" : ""} aria-label="ALL BET 残高を全部賭ける">ALL<br>BET</button>`
      + `<button class="cbtn wide" id="rep" ${!open || (!cur && !(lastBase || players[me]?.bjhist?.[0]?.bet)) ? "disabled" : ""}>${cur ? "2倍" : "リピート"}</button>`
      + (full ? '<span class="note">満席（6人まで）</span>' : "");
  }
  if (h !== midKey) { $("mid").innerHTML = h; midKey = h; }
}
function renderLists() {
  const hs = t.history || [];
  $("hist").innerHTML = hs.length ? hs.slice(-20).map((x) => `<span class="${x.d === "BUST" ? "bust" : x.d === "BJ" ? "bj" : x.d >= 20 ? "hi" : ""}">${x.d === "BUST" ? "BUST" : x.d}</span>`).join("") : '<span class="mut" style="background:none">まだ記録がありません</span>';
  const rows = Object.entries(players).map(([uid, p]) => ({ uid, p, prof: (p.bjst && p.bjst.prof) || 0, n: (p.bjst && p.bjst.n) || 0 }))
    .filter((x) => x.n > 0 || x.uid === me).sort((a, b) => b.prof - a.prof).slice(0, 12);
  $("mcount").textContent = `ブラックジャック収支`;
  $("mlist").innerHTML = rows.length ? rows.map(({ uid, p, prof, n }, i) => {
    const hidden = settledHidden(p) && p.bjLast;
    const pr = hidden ? prof - p.bjLast.d : prof;
    return `<div class="row"><span class="dot" style="background:${esc(p.color)}">${esc((p.name || "?")[0])}</span><span class="n">${i + 1}. ${esc(p.name)}${uid === me ? '<span class="you">あなた</span>' : ""}</span><span class="v num ${pr > 0 ? "pos" : pr < 0 ? "neg" : "mut"}">${pr >= 0 ? "+" : ""}${fmt(pr)}（${n}回）</span></div>`;
  }).join("") : '<div class="empty">まだ誰も遊んでいません</div>';
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>BLACKJACK</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>BLACKJACK</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>BLACKJACK</h1><p>バカラと同じチップで遊べるブラックジャック。<br>Googleアカウントでログインしてね。</p>
      <button class="gbtn" id="gsign"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Googleでログイン</button>
      <p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>BLACKJACK</h1><p>テーブルで使うニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
      <form class="join" id="gjoin"><input id="gname" placeholder="ニックネーム" maxlength="12" autocomplete="off" value="${esc((user && user.displayName || "").slice(0, 12))}"><button class="go" type="submit" ${joining ? "disabled" : ""}>参加</button></form>
      ${importAvail ? `<div class="mig"><p>前のサーバーで遊んでた人は、先に<b>前のチップと借金を引き継いで</b>ね。</p><button class="gbtn" id="gimport" ${importing ? "disabled" : ""}>${importing ? "引き継ぎ中…" : "前のデータを引き継ぐ"}</button></div>` : ""}
      <p class="err">${esc(gateErr)}</p><button class="ib" id="gout" style="align-self:center">別のアカウントにする</button>`;
  if (box.dataset.k !== h) { box.innerHTML = h; box.dataset.k = h; }
  const a = $("acctbtn"); a.hidden = !user;
  if (user && a.dataset.k !== user.uid) { a.dataset.k = user.uid; a.innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : "アカウント"; a.setAttribute("aria-label", "アカウント"); }
}
function render() {
  const live = gate === "in";
  $("live").classList.toggle("on", live);
  $("live").classList.toggle("on", live && online);
  $("livetxt").textContent = live ? (online ? "LIVE" : "再接続中…") : gate === "out" || gate === "join" ? "ログイン前" : "接続中";
  const mb = $("migbar");
  mb.hidden = !(live && importAvail);
  if (!mb.hidden) { const k = importing ? "1" : "0"; if (mb.dataset.k !== k) { mb.dataset.k = k; mb.innerHTML = `<span>前のサーバーのチップと借金がまだ引き継がれてないよ。前に遊んでた人なら押してね。</span><button class="go" id="mimport" ${importing ? "disabled" : ""}>${importing ? "引き継ぎ中…" : "引き継ぐ"}</button>`; } }
  $("roundtxt").textContent = live ? `#${t.round}` : "";
  $("statsbtn").hidden = !live;
  $("bal").textContent = live && players[me] ? fmt(myFree()) : "—";
  const mine = (t.hands || []).find((h) => h.uid === me);
  $("mytotal").textContent = fmt(live ? (mine ? mine.bet : myBet()) : 0);
  $("walletbtn").disabled = !(live && players[me]);
  const dbt = (players[me] && players[me].dep) || 0;
  $("debt").hidden = !(live && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (live) { wallet.watch(); wallet.draw(); }
  renderGate(); renderSeats(); renderMid(); renderLists(); renderPill(); renderStats();
}

/* ================= wallet ================= */
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
document.querySelectorAll(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) o.hidden = true; }));
addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true)); });
$("rulesbtn").addEventListener("click", () => { $("rulesm").hidden = false; });
$("acctbtn").addEventListener("click", () => { $("acctmail").textContent = user?.email || ""; $("acctm").hidden = false; });
$("signout").addEventListener("click", () => { $("acctm").hidden = true; signOut(auth); });

/* ================= stats ================= */
let statsKey = "";
$("statsbtn").addEventListener("click", () => { statsOpen = !statsOpen; statsKey = ""; render(); });
$("statsx").addEventListener("click", () => { statsOpen = false; render(); });
function renderStats() {
  $("statsp").hidden = !(statsOpen && gate === "in"); $("statsbtn").classList.toggle("on", statsOpen); $("statsbtn").setAttribute("aria-pressed", statsOpen);
  if (!statsOpen || gate !== "in") return;
  const p = players[me] || {}, hidden = settledHidden(p);
  let st = p.bjst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.bjcurve || [];
  if (hidden && p.bjLast) { const d = p.bjLast.d; st = { n: st.n - 1, w: st.w - (d > 0), l: st.l - (d < 0), p: st.p - (d === 0), wag: st.wag - p.bjLast.bet, prof: st.prof - d }; curve = curve.slice(0, -1); }
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = (st.prof > 0 ? "+" : "") + fmt(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round(st.w / dec * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${st.w / st.n * 100}%"></i><em style="width:${st.p / st.n * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>勝ち ${st.w}</span><span><i style="background:var(--muted)"></i>引き分け ${st.p}</span><span><i style="background:var(--bk)"></i>負け ${st.l}</span>`;
  const box = $("chartbox");
  if (!curve.length) { box.innerHTML = '<div class="empty">ブラックジャックで遊ぶと、ここに利益の推移が出るよ</div>'; return; }
  const pts = [0, ...curve], W = 320, H = 160, pl = 4, pr = 4, pt = 10, pb = 10;
  let mx = Math.max(0, ...pts), mn = Math.min(0, ...pts); if (mx === mn) { mx += 1; mn -= 1; }
  const X = (i) => pl + (W - pl - pr) * i / (pts.length - 1 || 1), Y = (v) => pt + (H - pt - pb) * (mx - v) / (mx - mn);
  const z = Y(0), zr = Math.min(1, Math.max(0, z / H));
  const line = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(pts.length - 1).toFixed(1)} ${z.toFixed(1)} L${X(0).toFixed(1)} ${z.toFixed(1)} Z`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="ブラックジャックの累計利益。最新 ${fmt(pts[pts.length - 1])}">
    <defs><linearGradient id="pg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}"><stop offset="${zr}" stop-color="#22d36b"/><stop offset="${zr}" stop-color="#ff4d5e"/></linearGradient></defs>
    <path d="${area}" fill="url(#pg)" fill-opacity=".16"/>
    <line x1="0" x2="${W}" y1="${z}" y2="${z}" stroke="#9aa3ae" stroke-opacity=".45" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
    <path d="${line}" fill="none" stroke="url(#pg)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <line id="cx" x1="0" x2="0" y1="0" y2="${H}" stroke="#f1f3f5" stroke-opacity=".35" vector-effect="non-scaling-stroke" visibility="hidden"/>
  </svg><div class="tip num" id="ctip" hidden></div>`;
  const svg = box.querySelector("svg"), tip = $("ctip"), cx = svg.querySelector("#cx");
  const move = (ev) => {
    const r = svg.getBoundingClientRect(), px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((px / r.width * W - pl) / (W - pl - pr) * (pts.length - 1))));
    const x = X(i); cx.setAttribute("x1", x); cx.setAttribute("x2", x); cx.setAttribute("visibility", "visible");
    tip.hidden = false; tip.style.left = (8 + x / W * r.width) + "px"; tip.style.top = (8 + Y(pts[i]) / H * r.height) + "px";
    tip.textContent = i ? `${i}回目　${pts[i] > 0 ? "+" : ""}${fmt(pts[i])}` : "スタート　0";
  };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerleave", () => { tip.hidden = true; cx.setAttribute("visibility", "hidden"); });
  svg.addEventListener("touchmove", move, { passive: true });
}

/* ================= events ================= */
$("mid").addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (c) { addChip(c.dataset.v === "all" ? "all" : +c.dataset.v); return; }
  const a = e.target.closest("[data-act]"); if (a) { act(a.dataset.act); return; }
  if (e.target.closest("#clr")) clearBet();
  if (e.target.closest("#rep")) repeatOrDouble();
});
addEventListener("keydown", (e) => {
  if (!isMyTurn() || e.target.closest("input")) return;
  const k = e.key.toLowerCase();
  if (k === "h") act("hit"); else if (k === "s") act("stand"); else if (k === "d") act("double");
});
async function doJoin(name) {
  if (joining) return; joining = true; gateErr = ""; render();
  try { await call("join", { name }); } catch (e) { gateErr = errMsg(e); }
  joining = false; render();
}
$("gatebox").addEventListener("submit", (e) => { e.preventDefault(); const n = $("gname").value.trim(); if (n) doJoin(n); });
$("gatebox").addEventListener("click", async (e) => {
  if (e.target.closest("#gout")) { signOut(auth); return; }
  if (e.target.closest("#gimport")) { doImport(); return; }
  if (!e.target.closest("#gsign")) return;
  gateErr = ""; const btn = e.target.closest("#gsign"); btn.disabled = true;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, provider); }
  catch (er) {
    if (er && (er.code === "auth/popup-blocked" || er.code === "auth/operation-not-supported-in-this-environment")) { await signInWithRedirect(auth, provider); return; }
    if (er && er.code !== "auth/popup-closed-by-user" && er.code !== "auth/cancelled-popup-request") gateErr = "ログインできなかった。もう一度試してね";
    btn.disabled = false; render();
  }
});

/* ================= realtime ================= */
function setTable(v) {
  const prevRound = t.round;
  t = v || fresh();
  if (prevRound !== t.round) { want = null; ackWant = null; }
  const instant = firstState || document.visibilityState !== "visible";
  firstState = false;
  sync(instant);
}
function applyBatch(msgs) {
  for (const m of msgs) {
    if (m.type === "bj") setTable(m.v);
    else if (m.type === "bjBets") { bets = m.v || {}; if (ackWant !== null && ackWant === serverBet()) ackWant = null; }
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "meta") importAvail = !(m.v && m.v.imported);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; players = st.players || {}; bets = st.bjBets || {}; importAvail = !(st.meta && st.meta.imported);
  Object.keys(els).forEach((k) => { els[k].remove(); delete els[k]; });
  firstState = true; setTable(st.bj);
  gate = players[me] ? "in" : "join";
  render();
}
async function doImport() {
  if (importing || !user) return;
  importing = true; render();
  try { const r = await call("import", { token: await user.getIdToken() }); flash(`${r.count}人分のチップと借金を引き継いだよ`); }
  catch (e) { flash(errMsg(e)); gateErr = errMsg(e); }
  importing = false; render();
}

if (!auth) { gate = "unconfigured"; render(); }
else onAuthStateChanged(auth, (u) => {
  user = u; me = u ? u.uid : null;
  if (conn) { conn.close(); conn = null; }
  players = {}; bets = {}; t = fresh(); want = null; ackWant = null; online = false;
  Object.keys(els).forEach((k) => { els[k].remove(); delete els[k]; });
  if (!u) { gate = "out"; render(); return; }
  gate = "loading"; render();
  conn = connect({ getToken: () => u.getIdToken(), onReady, onBatch: applyBatch, onStatus: (on, err) => { online = on; if (err && gate === "loading") gateErr = err; render(); } });
});

/* ================= clock: the server moves the table on by itself; this only redraws the timer ================= */
setInterval(renderPill, 250);

/* ================= boot ================= */
new ResizeObserver(() => { if (animating) return; layout(); Object.keys(els).forEach(placeEl); seatsKey = ""; badgeKey = ""; render(); }).observe($("stage"));
layout(); render();

$("migbar").addEventListener("click", (e) => { if (e.target.closest("#mimport")) doImport(); });
