// All table logic in one place, independent of Cloudflare. The Durable Object feeds it messages and the clock,
// persists whatever it marks as changed, and broadcasts the public views. Everything here runs single-threaded,
// so each action is atomic without transactions.
import * as G from "./game.js";
import * as B from "./bjgame.js";
const { BJ } = B;

export class GameError extends Error {}
const fail = (msg) => { throw new GameError(msg); };

const COLORS = ["#ffc83d", "#7fb2ff", "#ff8592", "#5ff09a", "#d6a2ff", "#ffb870", "#7fe0e0", "#e8eef3"];
export const freshBac = () => ({ round: 1, phase: "paused", P: [], B: [], res: null, road: [], dealId: 0, closesAt: 0, dealtAt: 0, idle: 0, hadBets: false, shoeLeft: 416 });
export const freshBj = () => ({ round: 1, phase: "paused", closesAt: 0, hands: [], dealer: [], holeHidden: false, turn: -1, turnEndsAt: 0, seq: 0, animUntil: 0, shoeLeft: BJ.DECKS * 52, history: [] });
export const freshData = () => ({ players: {}, bac: freshBac(), bacBets: {}, bacShoe: "", bj: freshBj(), bjBets: {}, bjShoe: { cards: "", hole: null }, meta: { imported: false } });
const freshStats = () => ({ n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 });
const isInt = (v) => Number.isSafeInteger(v);

export class Core {
  /** @param {object} data persisted state  @param {{allowedEmails?: string[]}} opts */
  constructor(data, opts = {}) {
    this.d = data || freshData();
    this.allowed = (opts.allowedEmails || []).map((e) => e.toLowerCase());
    this.changed = new Set();
  }
  mark(...keys) { keys.forEach((k) => this.changed.add(k)); }
  player(uid) { const p = this.d.players[uid]; if (!p) fail("先に参加してね"); return p; }
  takeChanges() { const c = this.changed; this.changed = new Set(); return c; }

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
      default: fail("その操作はできないよ");
    }
  }

  /* ---------------- players & wallet ---------------- */
  join(uid, email, rawName, now) {
    let name;
    try { name = G.cleanName(rawName); } catch { fail("名前は1〜12文字で入れてね"); }
    if (this.allowed.length && !this.allowed.includes(String(email || "").toLowerCase())) fail("このテーブルには招待されたアカウントだけ参加できます");
    const p = this.d.players[uid];
    if (p) { p.name = name; p.seated = true; }
    else {
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
    p.chips += amount; p.dep = (p.dep || 0) + amount;
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
    if (to !== uid) q.helps = [{ from: uid, amount, at: now }, ...(q.helps || [])].slice(0, 5);
    this.mark("p:" + uid, "p:" + to);
  }

  /** Hand some of my own chips to a friend. */
  give(uid, amount, to, now) {
    if (!isInt(amount) || amount < 1) fail("あげる額がおかしいよ");
    if (typeof to !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(to)) fail("相手がおかしいよ");
    if (to === uid) fail("自分にはあげられないよ");
    const p = this.player(uid), q = this.d.players[to];
    if (!q) fail("相手が見つからないよ");
    if (amount > p.chips) fail("チップが足りない（ベット中の分は使えないよ）");
    p.chips -= amount; q.chips += amount;
    q.gifts = [{ from: uid, amount, at: now }, ...(q.gifts || [])].slice(0, 5);
    this.mark("p:" + uid, "p:" + to);
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
        Object.assign(p, {
          chips: p.chips + ret, lastRound: t.round, lastDelta: d, lastRet: ret, lastBets: b, st,
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
    for (const h of t.hands) {
      const { ret, out } = B.settle(h, cards);
      h.out = out; h.d = ret - h.bet;
      const p = this.d.players[h.uid];
      if (!p) continue;
      const st = p.bjst || freshStats();
      st.n++; st.wag += h.bet; st.prof += h.d; if (h.d > 0) st.w++; else if (h.d < 0) st.l++; else st.p++;
      Object.assign(p, {
        chips: p.chips + ret, bjLast: { round: t.round, d: h.d, ret, bet: h.bet }, bjst: st,
        bjhist: [{ r: t.round, bet: h.bet, d: h.d, out }, ...(p.bjhist || [])].slice(0, 12),
        bjcurve: [...(p.bjcurve || []), st.prof].slice(-300),
      });
      this.mark("p:" + h.uid);
    }
    const dt = B.total(cards).total;
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
      const a = this.bacStep(now), b = this.bjStep(now);
      if (a) did.push("bac:" + a);
      if (b) did.push("bj:" + b);
      if (!a && !b) break;
    }
    return did;
  }
  nextDue() {
    const ts = [this.bacDue(), this.bjDue()].filter((x) => x !== null);
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

  /* ---------------- views sent to clients ---------------- */
  view(key) {
    const d = this.d;
    if (key === "bac") return d.bac;
    if (key === "bacBets") return d.bacBets;
    if (key === "bj") return d.bj; // the hole card lives in bjShoe, never here
    if (key === "bjBets") return d.bjBets;
    if (key === "meta") return { imported: !!d.meta.imported };
    if (key.startsWith("p:")) return d.players[key.slice(2)] || null;
    return undefined;
  }
  fullState() {
    return { bac: this.d.bac, bacBets: this.d.bacBets, bj: this.d.bj, bjBets: this.d.bjBets, players: this.d.players, meta: this.view("meta") };
  }
}
