// All table logic in one place, independent of Cloudflare. The Durable Object feeds it messages and the clock,
// persists whatever it marks as changed, and broadcasts the public views. Everything here runs single-threaded,
// so each action is atomic without transactions.
import * as G from "./game.js";
import * as B from "./bjgame.js";
import * as A from "./ach.js";
import * as F from "./fxgame.js";
import * as R from "./race.js";
const { BJ } = B;

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

const COLORS = ["#ffc83d", "#7fb2ff", "#ff8592", "#5ff09a", "#d6a2ff", "#ffb870", "#7fe0e0", "#e8eef3"];
export const freshBac = () => ({ round: 1, phase: "paused", P: [], B: [], res: null, road: [], dealId: 0, closesAt: 0, dealtAt: 0, idle: 0, hadBets: false, shoeLeft: 416 });
export const freshBj = () => ({ round: 1, phase: "paused", closesAt: 0, hands: [], dealer: [], holeHidden: false, turn: -1, turnEndsAt: 0, seq: 0, animUntil: 0, shoeLeft: BJ.DECKS * 52, history: [] });
export const freshData = () => ({ players: {}, bac: freshBac(), bacBets: {}, bacShoe: "", bj: freshBj(), bjBets: {}, bjShoe: { cards: "", hole: null }, meta: { imported: false }, chat: [], fx: F.freshFx(), rc: freshRc(), rcBets: {} });
export const freshRc = () => ({ round: 1, phase: "paused", closesAt: 0, card: null, startAt: 0, endAt: 0, holdUntil: 0, unit: 0, script: null, res: null, history: [], idle: 0, hadBets: false });
const RENAME_COST = 1_000_000;
const CHAT_KEEP = 50, CHAT_MAX = 120, CHAT_GAP_MS = 400;
const freshStats = () => ({ n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 });
const isInt = (v) => Number.isSafeInteger(v);
const add = (p, n) => { p.chips = Math.min(p.chips + n, G.MAX_CHIPS); };

export class Core {
  /** @param {object} data persisted state  @param {{allowedEmails?: string[]}} opts */
  constructor(data, opts = {}) {
    this.d = data || freshData();
    this.allowed = (opts.allowedEmails || []).map((e) => e.toLowerCase());
    this.changed = new Set();
    this.lastChat = new Map(); // uid -> time of last message; memory only
  }
  mark(...keys) { keys.forEach((k) => this.changed.add(k)); }
  player(uid) { const p = this.d.players[uid]; if (!p) fail("先に参加してね"); return p; }
  takeChanges() {
    const c = this.changed;
    for (const k of c) if (k.startsWith("p:") && this.d.players[k.slice(2)]) A.checkTotals(this.d.players[k.slice(2)], Date.now());
    this.changed = new Set();
    return c;
  }

  /* ---------------- dispatch ---------------- */
  handle(uid, email, type, m, now) {
    switch (type) {
      case "join": return this.join(uid, email, m.name, now);
      case "setBets": return this.setBets(uid, m.bets, m.round, now);
      case "leave": return this.leave(uid, now);
      case "deposit": return this.deposit(uid, m.amount);
      case "repay": return this.repay(uid, m.amount, m.to, now);
      case "give": return this.give(uid, m.amount, m.to, now);
      case "bjBet": return this.bjBet(uid, m.amount, m.round, now);
      case "bjAct": return this.bjAct(uid, m.action, m.round, m.turn, now);
      case "chat": return this.chat(uid, m.text, now);
      case "rename": return this.rename(uid, m.name, now);
      case "setFrame": return this.setLook(uid, "frame", A.FRAMES, m.frame);
      case "rcBets": return this.rcSetBets(uid, m.bets, m.round, now);
      case "fxOpen": return this.fxOpen(uid, m.side, m.margin, m.lev, now);
      case "fxClose": return this.fxClose(uid, m.pos, now);
      case "setBubble": return this.setLook(uid, "bubble", A.BUBBLES, m.bubble);
      default: fail("その操作はできないよ");
    }
  }

  /* ---------------- players & wallet ---------------- */
  nameTaken(name, uid) { return Object.entries(this.d.players).some(([id, q]) => id !== uid && q.name === name); }
  join(uid, email, rawName, now) {
    if (this.allowed.length && !this.allowed.includes(String(email || "").toLowerCase())) fail("このテーブルには招待されたアカウントだけ参加できます");
    const p = this.d.players[uid];
    // Coming back keeps your name; changing it costs chips (rename).
    if (p) p.seated = true;
    else {
      let name;
      try { name = G.cleanName(rawName); } catch { fail("名前は1〜12文字で入れてね"); }
      if (this.nameTaken(name, uid)) fail("その名前はもう使われてるよ");
      this.d.players[uid] = {
        name, color: COLORS[Object.keys(this.d.players).length % COLORS.length], chips: G.START, dep: 0, seated: true, joinedAt: now,
        lastRound: 0, lastDelta: 0, lastRet: 0, lastBets: null, hist: [], st: freshStats(), curve: [],
      };
    }
    this.mark("p:" + uid);
  }
  deposit(uid, amount) {
    const p = this.player(uid);
    if (!isInt(amount) || amount < 1 || amount > G.MAX_DEPOSIT) fail(`借りられるのは1回 1〜${G.MAX_DEPOSIT.toLocaleString("ja-JP")} まで`);
    add(p, amount); p.dep = (p.dep || 0) + amount;
    this.mark("p:" + uid);
  }
  repay(uid, amount, to, now) {
    to = to || uid;
    if (!isInt(amount) || amount < 1) fail("返す額がおかしいよ");
    if (typeof to !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(to)) fail("相手がおかしいよ");
    const p = this.player(uid), q = this.d.players[to];
    if (!q) fail("相手が見つからないよ");
    const debt = q.dep || 0;
    if (debt <= 0) fail(to === uid ? "借金はないよ" : "その人に借金はないよ");
    if (amount > debt) fail(`借金（${debt.toLocaleString("ja-JP")}）より多くは返せないよ`);
    if (amount > p.chips) fail("チップが足りない");
    p.chips -= amount; q.dep = debt - amount;
    if (to !== uid) { q.helps = [{ from: uid, amount, at: now }, ...(q.helps || [])].slice(0, 5); A.unlock(p, "help", now); if (amount >= 1e8) A.unlock(p, "helpbig", now); }
    else if (q.dep === 0) A.unlock(p, "clean", now);
    this.mark("p:" + uid, "p:" + to);
  }

  /** Change my nickname for RENAME_COST chips. */
  rename(uid, rawName, now) {
    const p = this.player(uid);
    let name;
    try { name = G.cleanName(rawName); } catch { fail("名前は1〜12文字で入れてね"); }
    if (name === p.name) fail("今と同じ名前だよ");
    if (this.nameTaken(name, uid)) fail("その名前はもう使われてるよ");
    if (p.chips < RENAME_COST) fail(`チップが足りない（名前の変更は ${RENAME_COST.toLocaleString("ja-JP")}）`);
    p.chips -= RENAME_COST; p.name = name;
    A.unlock(p, "rename", now);
    this.mark("p:" + uid);
  }

  /** Put on an unlocked avatar frame or chat bubble ("" takes it off). field: "frame" | "bubble". */
  setLook(uid, field, list, id) {
    const p = this.player(uid);
    if (id === "" || id === null || id === undefined) { delete p[field]; this.mark("p:" + uid); return; }
    const f = list.find((x) => x.id === id);
    if (!f) fail("それはないよ");
    if (!A.frameOk(p, f)) fail(`まだ使えないよ（${f.how}）`);
    p[field] = id;
    A.unlock(p, "dressup", Date.now());
    this.mark("p:" + uid);
  }

  /** Hand some of my own chips to a friend. */
  give(uid, amount, to, now) {
    if (!isInt(amount) || amount < 1) fail("あげる額がおかしいよ");
    if (typeof to !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(to)) fail("相手がおかしいよ");
    if (to === uid) fail("自分にはあげられないよ");
    const p = this.player(uid), q = this.d.players[to];
    if (!q) fail("相手が見つからないよ");
    if (amount > p.chips) fail("チップが足りない（ベット中の分は使えないよ）");
    p.chips -= amount; add(q, amount);
    q.gifts = [{ from: uid, amount, at: now }, ...(q.gifts || [])].slice(0, 5);
    A.unlock(p, "give", now);
    if (amount >= 1e8) A.unlock(p, "givebig", now);
    this.mark("p:" + uid, "p:" + to);
  }

  /* ---------------- chat (one room for everyone) ---------------- */
  chat(uid, raw, now) {
    const p = this.player(uid);
    if (typeof raw !== "string") fail("メッセージがおかしいよ");
    const text = raw.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim();
    if (!text) fail("メッセージを入れてね");
    if ([...text].length > CHAT_MAX) fail(`メッセージは${CHAT_MAX}文字まで`);
    if (now - (this.lastChat.get(uid) || 0) < CHAT_GAP_MS) fail("ちょっと速すぎるよ");
    this.lastChat.set(uid, now);
    if (!Array.isArray(this.d.chat)) this.d.chat = [];
    const last = this.d.chat[this.d.chat.length - 1];
    this.d.chat.push({ id: (last ? last.id : 0) + 1, uid, name: p.name, color: p.color, text, at: now });
    if (this.d.chat.length > CHAT_KEEP) this.d.chat = this.d.chat.slice(-CHAT_KEEP);
    p.ax = p.ax || {}; p.ax.chat = (p.ax.chat || 0) + 1;
    A.unlock(p, "chat", now);
    if (p.ax.chat >= 100) A.unlock(p, "chat100", now);
    this.mark("p:" + uid);
    this.mark("chat");
  }

  /* ---------------- baccarat ---------------- */
  bacOpen(now) { const t = this.d.bac; return t.phase === "paused" || (t.phase === "betting" && (!t.closesAt || now < t.closesAt)); }
  setBets(uid, raw, round, now) {
    let want;
    try { want = G.cleanBets(raw); } catch { fail("ベット額がおかしいよ"); }
    const p = this.player(uid), t = this.d.bac;
    if (!p.seated) fail("先に着席してね");
    if (!this.bacOpen(now)) fail("ベット締切。次のゲームを待ってね");
    if (round !== t.round) fail("ゲームが進んだので、もう一度置いてね");
    const bd = this.d.bacBets[uid];
    const cur = bd && bd.round === t.round ? bd.bets : G.emptyBets();
    const delta = G.sum(want) - G.sum(cur);
    if (delta > p.chips) fail("チップが足りない。残高の＋から借りられるよ");
    p.chips -= delta;
    if (G.sum(want) > 0) this.d.bacBets[uid] = { round: t.round, bets: want, total: G.sum(want), at: now };
    else delete this.d.bacBets[uid];
    if (t.phase === "paused" && G.sum(want) > 0) { t.phase = "betting"; t.closesAt = now + G.BET_MS; t.idle = 0; this.mark("bac"); }
    this.mark("p:" + uid, "bacBets");
  }
  leave(uid, now) {
    const p = this.player(uid), t = this.d.bac, bd = this.d.bacBets[uid];
    if (bd && bd.round === t.round && this.bacOpen(now)) { p.chips += G.sum(bd.bets); delete this.d.bacBets[uid]; this.mark("bacBets"); }
    p.seated = false;
    this.mark("p:" + uid);
  }
  bacStep(now) {
    const t = this.d.bac;
    if (t.phase === "betting" && !t.closesAt) { t.closesAt = now + G.BET_MS; this.mark("bac"); return "timer"; }
    if (t.phase === "betting" && now >= t.closesAt) {
      let shoe = this.d.bacShoe || "";
      if (shoe.length < 80) shoe = G.newShoe();
      const coup = G.dealCoup(shoe), r = coup.res;
      let hadBets = false;
      for (const [uid, bd] of Object.entries(this.d.bacBets)) {
        delete this.d.bacBets[uid];
        if (bd.round !== t.round || G.sum(bd.bets) === 0) continue;
        const p = this.d.players[uid];
        if (!p) continue;
        hadBets = true;
        const b = bd.bets, stake = G.sum(b), ret = G.payout(b, r), d = ret - stake;
        const st = p.st || freshStats();
        st.n++; st.wag += stake; st.prof += d; if (d > 0) st.w++; else if (d < 0) st.l++; else st.p++;
        A.checkResult(p, d, p.chips === 0, now);
        if (r.pp && b.ppair > 0 || r.bp && b.bpair > 0) A.unlock(p, "pair", now);
        if (r.pp && r.bp && b.ppair > 0 && b.bpair > 0) A.unlock(p, "dpair", now);
        p.ax = p.ax || {};
        if (r.pp && b.ppair > 0 || r.bp && b.bpair > 0) { p.ax.pair = (p.ax.pair || 0) + 1; if (p.ax.pair >= 10) A.unlock(p, "pair10", now); }
        if (r.w === "T" && b.tie > 0) {
          A.unlock(p, "tie", now);
          p.ax.tie = (p.ax.tie || 0) + 1; if (p.ax.tie >= 5) A.unlock(p, "tie5", now);
          if (p.ax.tieRound === t.round - 1) A.unlock(p, "tie2", now);
          p.ax.tieRound = t.round;
          if (b.tie >= 1e8) A.unlock(p, "bigtie", now);
        }
        if (d > 0 && t.round % 1000 === 777) A.unlock(p, "lucky777", now);
        const winCards = r.w === "P" ? coup.P : r.w === "B" ? coup.B : null, winBet = r.w === "P" ? b.player : r.w === "B" ? b.banker : 0;
        if (winCards && winCards.length === 2 && G.tot(winCards) === 9 && winBet > 0) A.unlock(p, "nat", now);
        const sk = A.streak(p, "b", d);
        if (sk >= 5) A.unlock(p, "streak5", now);
        if (sk >= 10) A.unlock(p, "streak10", now);
        if (sk <= -10) A.unlock(p, "lose10", now);
        Object.assign(p, {
          chips: Math.min(p.chips + ret, G.MAX_CHIPS), lastRound: t.round, lastDelta: d, lastRet: ret, lastBets: b, st,
          hist: [{ r: t.round, stake, d, w: r.w }, ...(p.hist || [])].slice(0, 12),
          curve: [...(p.curve || []), st.prof].slice(-300),
        });
        this.mark("p:" + uid);
      }
      this.d.bacShoe = coup.shoe;
      Object.assign(t, {
        phase: "result", P: coup.P, B: coup.B, res: r, dealId: (t.dealId || 0) + 1, dealtAt: now, hadBets, shoeLeft: coup.shoe.length / 2,
        road: [...(t.road || []), { r: t.round, w: r.w, pp: r.pp, bp: r.bp }].slice(-120),
      });
      this.mark("bac", "bacBets", "bacShoe");
      return "dealt";
    }
    if (t.phase === "result" && now >= (t.dealtAt || 0) + G.animMs(t.P || [], t.B || []) + G.HOLD_MS) {
      const idle = t.hadBets ? 0 : (t.idle || 0) + 1, paused = idle >= G.IDLE_LIMIT;
      Object.assign(t, { round: (t.round || 1) + 1, P: [], B: [], res: null, idle, phase: paused ? "paused" : "betting", closesAt: paused ? 0 : now + G.BET_MS });
      this.mark("bac");
      return "advanced";
    }
    return null;
  }
  bacDue() {
    const t = this.d.bac;
    if (t.phase === "betting") return t.closesAt || 0;
    if (t.phase === "result") return (t.dealtAt || 0) + G.animMs(t.P || [], t.B || []) + G.HOLD_MS;
    return null;
  }

  /* ---------------- blackjack ---------------- */
  bjOpen(now) { const t = this.d.bj; return t.phase === "paused" || (t.phase === "betting" && (!t.closesAt || now < t.closesAt)); }
  bjDraw() { const s = this.d.bjShoe, c = s.cards.slice(-2); s.cards = s.cards.slice(0, -2); return c; }
  bjBet(uid, raw, round, now) {
    let amount;
    try { amount = B.cleanBet(raw); } catch (e) { fail(e === "too-small" ? `ベットは ${BJ.MIN_BET} から` : "ベット額がおかしいよ"); }
    const p = this.player(uid), t = this.d.bj;
    if (!this.bjOpen(now)) fail("ベット締切。次のゲームを待ってね");
    if (round !== t.round) fail("ゲームが進んだので、もう一度置いてね");
    const bd = this.d.bjBets[uid];
    const cur = bd && bd.round === t.round ? bd.amount : 0;
    const others = Object.entries(this.d.bjBets).filter(([id, b]) => id !== uid && b.round === t.round && b.amount > 0).length;
    if (amount > 0 && !cur && others >= BJ.MAX_HANDS) fail(`満席（${BJ.MAX_HANDS}人まで）。次のゲームを待ってね`);
    const delta = amount - cur;
    if (delta > p.chips) fail("チップが足りない。残高の＋から借りられるよ");
    p.chips -= delta;
    if (amount > 0) this.d.bjBets[uid] = { round: t.round, amount, at: cur ? bd.at : now };
    else delete this.d.bjBets[uid];
    if (t.phase === "paused" && amount > 0) { t.phase = "betting"; t.closesAt = now + BJ.BET_MS; this.mark("bj"); }
    this.mark("p:" + uid, "bjBets");
  }
  bjFinish(now) {
    const t = this.d.bj, s = this.d.bjShoe;
    let cards = [t.dealer[0], s.hole];
    if (t.hands.some((h) => h.status === "stand") && !B.isBlackjack(cards)) cards = B.dealerDraws(cards, () => this.bjDraw());
    const start = Math.max(now, t.animUntil || 0);
    Object.assign(t, { dealer: cards, holeHidden: false, animUntil: start + BJ.CARD_MS * (cards.length - 1) + 400, phase: "result", turn: -1, turnEndsAt: 0, seq: t.seq + 1 });
    s.hole = null;
    const dt = B.total(cards).total;
    for (const h of t.hands) {
      const { ret, out } = B.settle(h, cards);
      h.out = out; h.d = ret - h.bet;
      const p = this.d.players[h.uid];
      if (!p) continue;
      const st = p.bjst || freshStats();
      st.n++; st.wag += h.bet; st.prof += h.d; if (h.d > 0) st.w++; else if (h.d < 0) st.l++; else st.p++;
      A.checkResult(p, h.d, p.chips === 0, now);
      if (h.status === "bj") A.unlock(p, "bjbj", now);
      if (h.doubled && h.d > 0) A.unlock(p, "bjdbl", now);
      if (h.cards.length >= 5 && B.total(h.cards).total === 21) A.unlock(p, "bj5", now);
      const js = A.streak(p, "j", h.d);
      if (js >= 5) A.unlock(p, "bjstreak5", now);
      if (js >= 10) A.unlock(p, "bjstreak10", now);
      const pt = B.total(h.cards).total, dbj = B.isBlackjack(cards);
      if (h.cards.length >= 3 && pt === 21) A.unlock(p, "bj21", now);
      if (dt > 21 && h.d > 0) A.unlock(p, "dbust", now);
      if (h.status === "bj" && dbj) A.unlock(p, "bjpush", now);
      if (h.doubled && h.d < 0) A.unlock(p, "dblfail", now);
      if (h.status === "bust") { p.ax.bust = (p.ax.bust || 0) + 1; if (p.ax.bust >= 20) A.unlock(p, "bust20", now); }
      Object.assign(p, {
        chips: Math.min(p.chips + ret, G.MAX_CHIPS), bjLast: { round: t.round, d: h.d, ret, bet: h.bet }, bjst: st,
        bjhist: [{ r: t.round, bet: h.bet, d: h.d, out }, ...(p.bjhist || [])].slice(0, 12),
        bjcurve: [...(p.bjcurve || []), st.prof].slice(-300),
      });
      this.mark("p:" + h.uid);
    }
    t.history = [...(t.history || []), { r: t.round, d: dt > 21 ? "BUST" : B.isBlackjack(cards) ? "BJ" : dt }].slice(-30);
  }
  bjNext(now) {
    const t = this.d.bj;
    for (let i = t.turn + 1; i < t.hands.length; i++) {
      if (t.hands[i].status === "playing") { t.turn = i; t.turnEndsAt = Math.max(now, t.animUntil || 0) + BJ.TURN_MS; return; }
    }
    this.bjFinish(now);
  }
  bjAct(uid, action, round, turn, now) {
    if (!["hit", "stand", "double"].includes(action)) fail("その操作はできないよ");
    const t = this.d.bj;
    if (t.phase !== "playing") fail("今は操作できないよ");
    if (round !== t.round || turn !== t.turn) fail("もう順番が進んでるよ");
    const h = t.hands[t.turn];
    if (!h || h.uid !== uid || h.status !== "playing") fail("あなたの番じゃないよ");
    if (now > t.turnEndsAt + BJ.ACT_GRACE_MS) fail("時間切れでスタンドになったよ");
    let next = false;
    if (action === "stand") { h.status = "stand"; next = true; }
    else {
      if (action === "double") {
        if (h.cards.length !== 2 || h.doubled) fail("ダブルは最初の2枚のときだけ");
        const p = this.player(uid);
        if (p.chips < h.bet) fail("ダブルするにはチップが足りない");
        p.chips -= h.bet; h.bet *= 2; h.doubled = true;
        this.mark("p:" + uid);
      }
      h.cards.push(this.bjDraw());
      t.animUntil = Math.max(now, t.animUntil || 0) + BJ.CARD_MS;
      const v = B.total(h.cards).total;
      if (v > 21) { h.status = "bust"; next = true; }
      else if (v === 21 || action === "double") { h.status = "stand"; next = true; }
      else t.turnEndsAt = t.animUntil + BJ.TURN_MS;
    }
    t.seq++;
    if (next) this.bjNext(now);
    t.shoeLeft = this.d.bjShoe.cards.length / 2;
    this.mark("bj", "bjShoe");
    return action;
  }
  bjStep(now) {
    const t = this.d.bj;
    if (t.phase === "betting" && !t.closesAt) { t.closesAt = now + BJ.BET_MS; this.mark("bj"); return "timer"; }
    if (t.phase === "betting" && now >= t.closesAt) {
      const all = Object.entries(this.d.bjBets).map(([uid, b]) => ({ uid, ...b })).filter((b) => b.round === t.round && b.amount > 0 && this.d.players[b.uid]).sort((a, b) => a.at - b.at);
      const bets = all.slice(0, BJ.MAX_HANDS);
      for (const b of all.slice(BJ.MAX_HANDS)) { this.d.players[b.uid].chips += b.amount; this.mark("p:" + b.uid); }
      this.d.bjBets = {};
      this.mark("bjBets");
      if (!bets.length) { t.phase = "paused"; t.closesAt = 0; this.mark("bj"); return "paused"; }
      const s = this.d.bjShoe;
      if (s.cards.length / 2 < BJ.RESHUFFLE_BELOW) s.cards = B.newShoe();
      t.hands = bets.map((b) => ({ uid: b.uid, bet: b.amount, cards: [], doubled: false, status: "playing", out: null, d: null }));
      t.hands.forEach((h) => h.cards.push(this.bjDraw()));
      const up = this.bjDraw();
      t.hands.forEach((h) => h.cards.push(this.bjDraw()));
      s.hole = this.bjDraw();
      t.hands.forEach((h) => { if (B.isBlackjack(h.cards)) h.status = "bj"; });
      Object.assign(t, { dealer: [up], holeHidden: true, phase: "playing", turn: -1, seq: (t.seq || 0) + 1, dealtAt: now, animUntil: now + BJ.CARD_MS * (t.hands.length * 2 + 2) + 400 });
      if (B.isBlackjack([up, s.hole])) this.bjFinish(t.animUntil); else this.bjNext(now);
      t.shoeLeft = s.cards.length / 2;
      this.mark("bj", "bjShoe");
      return "dealt";
    }
    if (t.phase === "playing" && now > t.turnEndsAt + BJ.ACT_GRACE_MS) {
      t.hands[t.turn].status = "stand"; t.seq++;
      this.bjNext(now);
      t.shoeLeft = this.d.bjShoe.cards.length / 2;
      this.mark("bj", "bjShoe");
      return "timeout";
    }
    if (t.phase === "result" && now >= (t.animUntil || 0) + BJ.HOLD_MS) {
      Object.assign(t, { round: t.round + 1, phase: "betting", closesAt: now + BJ.BET_MS, hands: [], dealer: [], turn: -1, turnEndsAt: 0, seq: t.seq + 1 });
      this.mark("bj");
      return "advanced";
    }
    return null;
  }
  bjDue() {
    const t = this.d.bj;
    if (t.phase === "betting") return t.closesAt || 0;
    if (t.phase === "playing") return t.turnEndsAt + BJ.ACT_GRACE_MS + 1;
    if (t.phase === "result") return (t.animUntil || 0) + BJ.HOLD_MS;
    return null;
  }

  /* ---------------- clock ---------------- */
  /** Run every transition that is due. Returns the list of things that happened. */
  step(now) {
    const did = [];
    for (let i = 0; i < 6; i++) {
      const a = this.bacStep(now), b = this.bjStep(now), c = this.rcStep(now);
      if (a) did.push("bac:" + a);
      if (b) did.push("bj:" + b);
      if (c) did.push("rc:" + c);
      if (!a && !b && !c) break;
    }
    return did;
  }
  nextDue() {
    const ts = [this.bacDue(), this.bjDue(), this.rcDue()].filter((x) => x !== null);
    return ts.length ? Math.min(...ts) : null;
  }

  /* ---------------- migration from Firestore ---------------- */
  /** players: {uid: firestore player doc}, held: {uid: chips still held in open Firestore bets}. */
  importPlayers(players, held) {
    if (this.d.meta.imported) fail("引き継ぎはもう終わってるよ");
    for (const [uid, src] of Object.entries(players)) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) continue;
      const cur = this.d.players[uid];
      const num = (v) => (isInt(v) ? v : 0);
      const p = {
        name: typeof src.name === "string" ? src.name.slice(0, 12) : "?", color: typeof src.color === "string" ? src.color : COLORS[0],
        chips: Math.max(0, num(src.chips)) + Math.max(0, num(held[uid] || 0)), dep: Math.max(0, num(src.dep)), seated: !!src.seated,
        joinedAt: num(src.joinedAt), lastRound: 0, lastDelta: 0, lastRet: 0, lastBets: null,
        hist: [], st: src.st || freshStats(), curve: Array.isArray(src.curve) ? src.curve.slice(-300) : [],
        bjst: src.bjst || freshStats(), bjcurve: Array.isArray(src.bjcurve) ? src.bjcurve.slice(-300) : [], bjhist: [],
      };
      // Someone who already joined the new table keeps what they did here on top of their old balance.
      if (cur) { p.chips += cur.chips - G.START; p.dep += cur.dep || 0; p.seated = cur.seated; }
      this.d.players[uid] = p;
      this.mark("p:" + uid);
    }
    this.d.meta.imported = true;
    this.mark("meta");
    return Object.keys(players).length;
  }

  /* ---------------- owner grants (see grants.js) ---------------- */
  applyGrants(list, now) {
    const meta = this.d.meta, done = (meta.grants = meta.grants || {});
    let changed = false;
    for (const g of list) {
      if (done[g.id] && done[g.id].startsWith("ok")) continue;
      const setTo = g.setChips;
      if (setTo !== undefined ? !isInt(setTo) || setTo < 0 || setTo > G.MAX_CHIPS : !isInt(g.amount) || g.amount < 1) { done[g.id] = "bad-amount"; changed = true; continue; }
      let hits = Object.entries(this.d.players).filter(([, p]) => p.name === g.name);
      if (!hits.length) hits = Object.entries(this.d.players).filter(([, p]) => String(p.name).toLowerCase() === String(g.name).toLowerCase());
      if (hits.length !== 1) { const why = hits.length ? "ambiguous" : "not-found"; if (done[g.id] !== why) { done[g.id] = why; changed = true; } continue; }
      const [uid, p] = hits[0];
      if (setTo !== undefined) p.chips = setTo; // set the balance to an exact number (debt untouched)
      else { add(p, g.amount); if (g.asDebt) p.dep = (p.dep || 0) + g.amount; }
      done[g.id] = "ok:" + now;
      this.mark("p:" + uid);
      changed = true;
    }
    if (changed) this.mark("meta");
    return done;
  }

  /* ---------------- horse racing ---------------- */
  rcOpen(now) { const r = this.d.rc; return !!r.card && (r.phase === "paused" || (r.phase === "betting" && now < r.closesAt)); }
  rcSetBets(uid, raw, round, now) {
    let want;
    try { want = R.cleanBets(raw); } catch (e) { fail(e === "too-small" ? `1点 ${R.RC.MIN_BET} から` : "馬券がおかしいよ"); }
    const p = this.player(uid), r = this.d.rc;
    if (!this.rcOpen(now)) fail("締切。次のレースを待ってね");
    if (round !== r.round) fail("レースが進んだので、もう一度買ってね");
    const cur = this.d.rcBets[uid] && this.d.rcBets[uid].round === r.round ? this.d.rcBets[uid].bets : {};
    const delta = R.sumBets(want) - R.sumBets(cur);
    if (delta > p.chips) fail("チップが足りない。残高の＋から借りられるよ");
    p.chips -= delta;
    if (R.sumBets(want) > 0) this.d.rcBets[uid] = { round: r.round, bets: want, total: R.sumBets(want), at: now };
    else delete this.d.rcBets[uid];
    if (r.phase === "paused" && R.sumBets(want) > 0) { r.phase = "betting"; r.closesAt = now + R.RC.BET_MS; r.idle = 0; this.mark("rc"); }
    this.mark("p:" + uid, "rcBets");
  }
  rcStep(now) {
    const r = this.d.rc || (this.d.rc = freshRc());
    if (!r.card) { r.card = R.newRace(r.round, now); this.mark("rc"); return "card"; }
    if (r.phase === "betting" && now >= r.closesAt) {
      const sim = R.simulate(r.card.horses);
      const unit = R.RC.WIN_MS / sim.fin[sim.order[0]];
      const startAt = now + 2500;
      Object.assign(r, {
        phase: "racing", startAt, unit,
        endAt: startAt + Math.ceil(Math.max(...sim.fin) * unit) + 1200,
        script: { pos: sim.pos.map((a) => a.map((x) => Math.round(x * 10000) / 10000)), fin: sim.fin.map((x) => Math.round(x * 1000) / 1000) },
        order: sim.order, hadBets: Object.values(this.d.rcBets).some((b) => b.round === r.round && b.total > 0),
      });
      this.mark("rc");
      return "start";
    }
    if (r.phase === "racing" && now >= r.endAt) {
      const order = r.order, horses = r.card.horses;
      for (const [uid, bd] of Object.entries(this.d.rcBets)) {
        delete this.d.rcBets[uid];
        const p = this.d.players[uid];
        if (!p || bd.round !== r.round || !bd.total) continue;
        const ret = R.payout(bd.bets, horses, order), d = ret - bd.total;
        const st = p.rcst || freshStats();
        st.n++; st.wag += bd.total; st.prof += d; if (d > 0) st.w++; else if (d < 0) st.l++; else st.p++;
        Object.assign(p, {
          chips: Math.min(p.chips + ret, G.MAX_CHIPS), rcst: st, rcLast: { round: r.round, d, ret, stake: bd.total },
          rccurve: [...(p.rccurve || []), st.prof].slice(-300),
          rchist: [{ r: r.round, stake: bd.total, d, win: order[0] + 1 }, ...(p.rchist || [])].slice(0, 12),
        });
        A.checkResult(p, d, false, now);
        A.unlock(p, "rc1", now);
        if (st.n >= 100) A.unlock(p, "rc100", now);
        const w = horses[order[0]];
        if (bd.bets["w" + w.n] && w.pop === 1) A.unlock(p, "rcfav", now);
        if (bd.bets["w" + w.n] && w.odds >= 20) A.unlock(p, "rclong", now);
        if (horses.every((h) => bd.bets["w" + h.n])) A.unlock(p, "rcall", now);
        this.mark("p:" + uid);
      }
      r.res = { order: order.map((i) => i + 1) };
      r.history = [...(r.history || []), { r: r.round, top: order.slice(0, 3).map((i) => i + 1), name: horses[order[0]].name, odds: horses[order[0]].odds }].slice(-20);
      Object.assign(r, { phase: "result", holdUntil: now + R.RC.HOLD_MS });
      this.mark("rc", "rcBets");
      return "finish";
    }
    if (r.phase === "result" && now >= r.holdUntil) {
      const idle = r.hadBets ? 0 : (r.idle || 0) + 1, paused = idle >= R.RC.IDLE_LIMIT;
      const round = (r.round || 1) + 1;
      Object.assign(r, { round, card: R.newRace(round, now), script: null, order: null, res: null, startAt: 0, endAt: 0, idle, phase: paused ? "paused" : "betting", closesAt: paused ? 0 : now + R.RC.BET_MS });
      this.mark("rc");
      return "next";
    }
    return null;
  }
  rcDue() {
    const r = this.d.rc;
    if (!r || !r.card) return 0;
    if (r.phase === "betting") return r.closesAt;
    if (r.phase === "racing") return r.endAt;
    if (r.phase === "result") return r.holdUntil;
    return null;
  }

  /* ---------------- FX ---------------- */
  /** Move the market one tick and stop out anyone whose position has lost its whole margin. */
  fxTick(now) {
    const fx = this.d.fx || (this.d.fx = F.freshFx());
    const p = F.nextPrice(fx.price);
    F.record(fx, now, p);
    const liq = [];
    for (const [uid, pl] of Object.entries(this.d.players)) {
      if (!pl.fxPos || !pl.fxPos.length) continue;
      for (const pos of [...pl.fxPos]) if (F.pnl(pos, p) <= -pos.margin) { this.fxSettle(uid, pl, pos, now, true); liq.push(uid); }
    }
    return { t: now, p, liq };
  }
  fxOpen(uid, side, margin, lev, now) {
    const p = this.player(uid), fx = this.d.fx;
    const s = side === "buy" ? 1 : side === "sell" ? -1 : 0;
    if (!s) fail("買いか売りを選んでね");
    if (!F.FX.LEVS.includes(lev)) fail("レバレッジがおかしいよ");
    if (!isInt(margin) || margin < F.FX.MIN_MARGIN || margin > F.FX.MAX_MARGIN) fail(`証拠金は ${F.FX.MIN_MARGIN} から`);
    if (margin > p.chips) fail("チップが足りない。残高の＋から借りられるよ");
    if ((p.fxPos || []).length >= F.FX.MAX_POS) fail(`ポジションは${F.FX.MAX_POS}個まで。どれか決済してね`);
    if (!fx || !fx.lastAt || now - fx.lastAt > F.FX.STALE_MS) fail("相場が止まってる。少し待ってからもう一度");
    p.fxSeq = (p.fxSeq || 0) + 1;
    p.chips -= margin;
    p.fxPos = [...(p.fxPos || []), { id: p.fxSeq, side: s, margin, lev, entry: s > 0 ? F.ask(fx.price) : F.bid(fx.price), at: now }];
    this.mark("p:" + uid);
    return { id: p.fxSeq };
  }
  fxClose(uid, id, now) {
    const p = this.player(uid), list = p.fxPos || [];
    const targets = id === "all" ? [...list] : list.filter((x) => x.id === id);
    if (!targets.length) fail("そのポジションはもうないよ");
    let total = 0;
    for (const pos of targets) total += this.fxSettle(uid, p, pos, now, false);
    return { d: total };
  }
  fxSettle(uid, p, pos, now, liq) {
    const price = this.d.fx.price, d = liq ? -pos.margin : F.pnl(pos, price);
    p.fxPos = (p.fxPos || []).filter((x) => x.id !== pos.id);
    p.chips = Math.min(p.chips + pos.margin + d, G.MAX_CHIPS);
    const st = p.fxst || freshStats();
    st.n++; st.wag += pos.margin; st.prof += d; if (d > 0) st.w++; else if (d < 0) st.l++; else st.p++;
    p.fxst = st;
    p.fxcurve = [...(p.fxcurve || []), st.prof].slice(-300);
    p.fxhist = [{ side: pos.side, lev: pos.lev, margin: pos.margin, entry: pos.entry, exit: price, d, liq, at: now }, ...(p.fxhist || [])].slice(0, 12);
    A.checkResult(p, d, false, now);
    A.unlock(p, "fx1", now);
    if (st.n >= 100) A.unlock(p, "fx100", now);
    if (liq) A.unlock(p, "fxliq", now);
    if (d > 0 && pos.lev === 100) A.unlock(p, "fxlev", now);
    if (d >= pos.margin * 10) A.unlock(p, "fx10x", now);
    if (d > 0 && pos.side < 0) { p.ax = p.ax || {}; p.ax.fxs = (p.ax.fxs || 0) + 1; if (p.ax.fxs >= 10) A.unlock(p, "fxshort", now); }
    this.mark("p:" + uid);
    return d;
  }

  /* ---------------- views sent to clients ---------------- */
  view(key) {
    const d = this.d;
    if (key === "bac") return d.bac;
    if (key === "bacBets") return d.bacBets;
    if (key === "bj") return d.bj; // the hole card lives in bjShoe, never here
    if (key === "bjBets") return d.bjBets;
    if (key === "rc") { const r = d.rc; return { ...r, card: r.card && { round: r.card.round, horses: r.card.horses.map(({ s, e, ...h }) => h) } }; }
    if (key === "rcBets") return d.rcBets;
    if (key === "meta") return { imported: !!d.meta.imported };
    if (key === "chat") return d.chat || [];
    if (key.startsWith("p:")) return d.players[key.slice(2)] || null;
    return undefined;
  }
  fullState() {
    return { bac: this.d.bac, bacBets: this.d.bacBets, bj: this.d.bj, bjBets: this.d.bjBets, players: this.d.players, rc: this.view("rc"), rcBets: this.d.rcBets, meta: this.view("meta"), chat: this.view("chat"), achDefs: A.ACH, frameDefs: A.FRAMES, bubbleDefs: A.BUBBLES };
  }
}
