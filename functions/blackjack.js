// Shared blackjack table. Same rules as the baccarat side: clients only read; the server shuffles, deals, times turns and settles.
const B = require("./bjgame");
const { BJ } = B;

module.exports = function blackjack({ db, onCall, FieldValue, fail, requireUser, PLAYERS }) {
  const TABLE = db.doc("tables/bj");
  const SHOE = db.doc("tables/bj/private/shoe");
  const BETS = db.collection("tables/bj/bets");
  const fresh = () => ({ round: 1, phase: "paused", closesAt: 0, hands: [], dealer: [], turn: -1, turnEndsAt: 0, seq: 0, animUntil: 0, shoeLeft: BJ.DECKS * 52, history: [] });
  const bettingOpen = (t, now) => t.phase === "paused" || (t.phase === "betting" && (!t.closesAt || now < t.closesAt));

  /** Read everything a state change might need, before any write. */
  async function load(tx) {
    const ts = await tx.get(TABLE);
    const t = ts.exists ? ts.data() : fresh();
    const ss = await tx.get(SHOE);
    const shoe = ss.exists ? ss.data() : { cards: "", hole: null };
    const ps = t.hands && t.hands.length ? await tx.getAll(...t.hands.map((h) => PLAYERS.doc(h.uid))) : [];
    const players = {}; ps.forEach((p) => { if (p.exists) players[p.id] = p.data(); });
    return { exists: ts.exists, t, shoe, players };
  }
  const drawer = (shoe) => () => { const c = shoe.cards.slice(-2); shoe.cards = shoe.cards.slice(0, -2); return c; };

  /** Dealer turn + settlement. Mutates t and adds the player changes to `out` ({fields, chips}). */
  function finish(t, shoe, players, now, out) {
    const draw = drawer(shoe);
    let cards = [t.dealer[0], shoe.hole];
    const live = t.hands.some((h) => h.status === "stand");
    if (live && !B.isBlackjack(cards)) cards = B.dealerDraws(cards, draw);
    const start = Math.max(now, t.animUntil || 0);
    t.dealer = cards; t.holeHidden = false;
    t.animUntil = start + BJ.CARD_MS * (cards.length - 1) + 400;
    t.phase = "result"; t.turn = -1; t.turnEndsAt = 0; t.seq++;
    shoe.hole = null;
    for (const h of t.hands) {
      const { ret, out: result } = B.settle(h, cards);
      h.out = result; h.d = ret - h.bet;
      const p = players[h.uid];
      if (!p) continue;
      const st = p.bjst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 };
      st.n++; st.wag += h.bet; st.prof += h.d; if (h.d > 0) st.w++; else if (h.d < 0) st.l++; else st.p++;
      out.chips[h.uid] = (out.chips[h.uid] || 0) + ret;
      out.fields[h.uid] = {
        bjLast: { round: t.round, d: h.d, ret, bet: h.bet },
        bjhist: [{ r: t.round, bet: h.bet, d: h.d, out: result }, ...(p.bjhist || [])].slice(0, 12),
        bjst: st, bjcurve: [...(p.bjcurve || []), st.prof].slice(-300),
      };
    }
    const dt = B.total(cards).total;
    t.history = [...(t.history || []), { r: t.round, d: dt > 21 ? "BUST" : B.isBlackjack(cards) ? "BJ" : dt }].slice(-30);
  }

  /** Move to the next hand still to act, or to the dealer. */
  function nextTurn(t, shoe, players, now, out) {
    for (let i = t.turn + 1; i < t.hands.length; i++) {
      if (t.hands[i].status === "playing") { t.turn = i; t.turnEndsAt = Math.max(now, t.animUntil || 0) + BJ.TURN_MS; return; }
    }
    finish(t, shoe, players, now, out);
  }
  const changes = () => ({ fields: {}, chips: {} });

  function write(tx, t, shoe, out) {
    t.shoeLeft = shoe.cards.length / 2;
    tx.set(TABLE, t);
    tx.set(SHOE, shoe);
    const uids = new Set([...Object.keys(out.fields), ...Object.keys(out.chips)]);
    for (const uid of uids) {
      const u = { ...(out.fields[uid] || {}) };
      if (out.chips[uid]) u.chips = FieldValue.increment(out.chips[uid]);
      tx.update(PLAYERS.doc(uid), u);
    }
  }

  async function step(tx, now) {
    const { exists, t, shoe, players } = await load(tx);
    if (!exists) { tx.set(TABLE, t); return "created"; }

    if (t.phase === "betting" && !t.closesAt) { tx.update(TABLE, { closesAt: now + BJ.BET_MS }); return "timer"; }

    if (t.phase === "betting" && now >= t.closesAt) {
      const bs = await tx.get(BETS.where("round", "==", t.round));
      const all = bs.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((b) => b.amount > 0).sort((a, b) => a.at - b.at);
      const bets = all.slice(0, BJ.MAX_HANDS), extra = all.slice(BJ.MAX_HANDS); // extra only if two bets raced for the last seat
      if (all.length) {
        const ps = await tx.getAll(...all.map((b) => PLAYERS.doc(b.uid)));
        ps.forEach((p) => { if (p.exists) players[p.id] = p.data(); });
      }
      // Reads are done; writes start here.
      bs.docs.forEach((d) => tx.delete(d.ref));
      extra.forEach((b) => { if (players[b.uid]) tx.update(PLAYERS.doc(b.uid), { chips: FieldValue.increment(b.amount) }); });
      if (!bets.length) { tx.update(TABLE, { phase: "paused", closesAt: 0 }); return "paused"; }
      if (shoe.cards.length / 2 < BJ.RESHUFFLE_BELOW) shoe.cards = B.newShoe();
      const draw = drawer(shoe);
      t.hands = bets.map((b) => ({ uid: b.uid, bet: b.amount, cards: [], doubled: false, status: "playing", out: null, d: null }));
      t.hands.forEach((h) => h.cards.push(draw()));
      const up = draw();
      t.hands.forEach((h) => h.cards.push(draw()));
      shoe.hole = draw();
      t.dealer = [up]; t.holeHidden = true;
      t.hands.forEach((h) => { if (B.isBlackjack(h.cards)) h.status = "bj"; });
      t.phase = "playing"; t.turn = -1; t.seq = (t.seq || 0) + 1;
      t.animUntil = now + BJ.CARD_MS * (t.hands.length * 2 + 2) + 400;
      t.dealtAt = now;
      // Dealer peeks under an ace or a ten.
      const out = changes();
      if (B.isBlackjack([up, shoe.hole])) finish(t, shoe, players, t.animUntil, out); else nextTurn(t, shoe, players, now, out);
      write(tx, t, shoe, out);
      return "dealt";
    }

    if (t.phase === "playing" && now > t.turnEndsAt + BJ.ACT_GRACE_MS) {
      t.hands[t.turn].status = "stand";
      t.seq++;
      const out = changes();
      nextTurn(t, shoe, players, now, out);
      write(tx, t, shoe, out);
      return "timeout";
    }

    if (t.phase === "result" && now >= (t.animUntil || 0) + BJ.HOLD_MS) {
      tx.set(TABLE, { ...t, round: t.round + 1, phase: "betting", closesAt: now + BJ.BET_MS, hands: [], dealer: [], turn: -1, turnEndsAt: 0, seq: t.seq + 1 });
      return "advanced";
    }
    return "none";
  }

  const bjTick = onCall(async (req) => {
    const uid = requireUser(req);
    if (!(await PLAYERS.doc(uid).get()).exists) fail("failed-precondition", "先に参加してね");
    const did = await db.runTransaction((tx) => step(tx, Date.now()));
    return { now: Date.now(), did };
  });

  /** Set my bet for the coming hand (0 takes it back). Chips are held while bet. */
  const bjBet = onCall(async (req) => {
    const uid = requireUser(req);
    let amount;
    try { amount = B.cleanBet(req.data && req.data.amount); }
    catch (e) { fail("invalid-argument", e === "too-small" ? `ベットは ${BJ.MIN_BET} から` : "ベット額がおかしいよ"); }
    const round = req.data && req.data.round;
    const now = Date.now();
    await db.runTransaction(async (tx) => {
      const ts = await tx.get(TABLE);
      const ps = await tx.get(PLAYERS.doc(uid));
      const betRef = BETS.doc(uid), bs = await tx.get(betRef);
      const others = await tx.get(BETS.where("round", "==", ts.exists ? ts.data().round : 1));
      const t = ts.exists ? ts.data() : fresh();
      if (!ps.exists) fail("failed-precondition", "先に参加してね");
      if (!bettingOpen(t, now)) fail("failed-precondition", "ベット締切。次のゲームを待ってね");
      if (round !== t.round) fail("failed-precondition", "ゲームが進んだので、もう一度置いてね");
      const cur = bs.exists && bs.data().round === t.round ? bs.data().amount : 0;
      if (amount > 0 && !cur && others.docs.filter((d) => d.id !== uid && d.data().amount > 0).length >= BJ.MAX_HANDS) fail("failed-precondition", `満席（${BJ.MAX_HANDS}人まで）。次のゲームを待ってね`);
      const delta = amount - cur;
      if (delta > ps.data().chips) fail("failed-precondition", "チップが足りない。残高の＋から入金できるよ");
      tx.update(PLAYERS.doc(uid), { chips: FieldValue.increment(-delta) });
      if (amount > 0) tx.set(betRef, { round: t.round, amount, at: cur ? bs.data().at : now });
      else if (bs.exists) tx.delete(betRef);
      const resume = t.phase === "paused" && amount > 0 ? { phase: "betting", closesAt: now + BJ.BET_MS } : null;
      if (!ts.exists) tx.set(TABLE, { ...t, ...(resume || {}) });
      else if (resume) tx.update(TABLE, resume);
    });
    return { now: Date.now() };
  });

  /** Hit, stand or double on my hand when it is my turn. */
  const bjAct = onCall(async (req) => {
    const uid = requireUser(req);
    const action = req.data && req.data.action;
    if (!["hit", "stand", "double"].includes(action)) fail("invalid-argument", "その操作はできないよ");
    const now = Date.now();
    const did = await db.runTransaction(async (tx) => {
      const { t, shoe, players } = await load(tx);
      if (t.phase !== "playing") fail("failed-precondition", "今は操作できないよ");
      if (req.data.round !== t.round || req.data.turn !== t.turn) fail("failed-precondition", "もう順番が進んでるよ");
      const h = t.hands[t.turn];
      if (!h || h.uid !== uid || h.status !== "playing") fail("permission-denied", "あなたの番じゃないよ");
      if (now > t.turnEndsAt + BJ.ACT_GRACE_MS) fail("failed-precondition", "時間切れでスタンドになったよ");
      const draw = drawer(shoe);
      const out = changes();
      let next = false;
      if (action === "stand") { h.status = "stand"; next = true; }
      else {
        if (action === "double") {
          if (h.cards.length !== 2 || h.doubled) fail("failed-precondition", "ダブルは最初の2枚のときだけ");
          const p = players[uid];
          if (!p || p.chips < h.bet) fail("failed-precondition", "ダブルするにはチップが足りない");
          out.chips[uid] = -h.bet;
          h.bet *= 2; h.doubled = true;
        }
        h.cards.push(draw());
        t.animUntil = Math.max(now, t.animUntil || 0) + BJ.CARD_MS;
        const v = B.total(h.cards).total;
        if (v > 21) { h.status = "bust"; next = true; }
        else if (v === 21 || action === "double") { h.status = "stand"; next = true; }
        else t.turnEndsAt = t.animUntil + BJ.TURN_MS;
      }
      t.seq++;
      if (next) nextTurn(t, shoe, players, now, out);
      write(tx, t, shoe, out);
      return action;
    });
    return { now: Date.now(), did };
  });

  return { bjTick, bjBet, bjAct };
};
