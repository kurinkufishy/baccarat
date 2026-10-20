// Server-authoritative baccarat table. Clients can only read Firestore; every change goes through these callables.
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const G = require("./game");

setGlobalOptions({ region: "asia-northeast1", maxInstances: 5, memory: "256MiB", timeoutSeconds: 30 });
initializeApp();
const db = getFirestore();

const TABLE = db.doc("tables/main");
const SHOE = db.doc("tables/main/private/shoe");
const BETS = db.collection("tables/main/bets");
const PLAYERS = db.collection("players");
const COLORS = ["#ffc83d", "#7fb2ff", "#ff8592", "#5ff09a", "#d6a2ff", "#ffb870", "#7fe0e0", "#e8eef3"];

const fresh = () => ({ round: 1, phase: "paused", P: [], B: [], res: null, road: [], dealId: 0, closesAt: 0, dealtAt: 0, idle: 0, hadBets: false, shoeLeft: 416 });
const fail = (code, msg) => { throw new HttpsError(code, msg); };

function requireUser(req) {
  if (!req.auth) fail("unauthenticated", "ログインしてね");
  const t = req.auth.token || {};
  if (!t.firebase || t.firebase.sign_in_provider !== "google.com") fail("permission-denied", "Googleアカウントでログインしてね");
  if (t.email_verified !== true) fail("permission-denied", "メールが確認済みのGoogleアカウントでログインしてね");
  return req.auth.uid;
}
async function requirePlayer(tx, uid) {
  const snap = await tx.get(PLAYERS.doc(uid));
  if (!snap.exists) fail("failed-precondition", "先に着席してね");
  return snap.data();
}
const bettingOpen = (t, now) => t.phase === "paused" || (t.phase === "betting" && (!t.closesAt || now < t.closesAt));

/** Advance the table if it is due. Must be called inside a transaction; does all reads before any write. */
async function step(tx, now) {
  const ts = await tx.get(TABLE);
  const t = ts.exists ? ts.data() : fresh();
  if (!ts.exists) { tx.set(TABLE, t); return "created"; }

  if (t.phase === "betting" && !t.closesAt) { tx.update(TABLE, { closesAt: now + G.BET_MS }); return "timer"; }

  if (t.phase === "betting" && now >= t.closesAt) {
    const shoeSnap = await tx.get(SHOE);
    const betSnap = await tx.get(BETS.where("round", "==", t.round));
    const betDocs = betSnap.docs.filter((d) => G.sum(d.data().bets) > 0);
    const playerSnaps = betDocs.length ? await tx.getAll(...betDocs.map((d) => PLAYERS.doc(d.id))) : [];

    let shoe = shoeSnap.exists ? shoeSnap.data().cards || "" : "";
    if (shoe.length < 80) shoe = G.newShoe();
    const coup = G.dealCoup(shoe);
    const r = coup.res;

    betDocs.forEach((bd, i) => {
      const ps = playerSnaps[i];
      tx.delete(bd.ref);
      if (!ps.exists) return;
      const p = ps.data(), b = bd.data().bets, stake = G.sum(b), ret = G.payout(b, r), d = ret - stake;
      const st = p.st || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 };
      st.n++; st.wag += stake; st.prof += d; if (d > 0) st.w++; else if (d < 0) st.l++; else st.p++;
      tx.update(ps.ref, {
        chips: FieldValue.increment(ret),
        lastRound: t.round, lastDelta: d, lastRet: ret, lastBets: b,
        hist: [{ r: t.round, stake, d, w: r.w }, ...(p.hist || [])].slice(0, 12),
        st, curve: [...(p.curve || []), st.prof].slice(-300),
      });
    });
    // Bets that summed to zero are just cleaned up.
    betSnap.docs.filter((d) => G.sum(d.data().bets) === 0).forEach((d) => tx.delete(d.ref));

    tx.set(SHOE, { cards: coup.shoe });
    tx.update(TABLE, {
      phase: "result", P: coup.P, B: coup.B, res: r, dealId: (t.dealId || 0) + 1, dealtAt: now,
      hadBets: betDocs.length > 0, shoeLeft: coup.shoe.length / 2,
      road: [...(t.road || []), { r: t.round, w: r.w, pp: r.pp, bp: r.bp }].slice(-120),
    });
    return "dealt";
  }

  if (t.phase === "result" && now >= (t.dealtAt || 0) + G.animMs(t.P || [], t.B || []) + G.HOLD_MS) {
    const idle = t.hadBets ? 0 : (t.idle || 0) + 1;
    const paused = idle >= G.IDLE_LIMIT;
    tx.update(TABLE, { round: (t.round || 1) + 1, P: [], B: [], res: null, idle, phase: paused ? "paused" : "betting", closesAt: paused ? 0 : now + G.BET_MS });
    return "advanced";
  }
  return "none";
}

/** Anyone at the table pokes this when their clock says something is due. The server decides with its own clock. */
exports.tick = onCall(async (req) => {
  const uid = requireUser(req);
  if (!(await PLAYERS.doc(uid).get()).exists) fail("failed-precondition", "先に着席してね");
  const now = Date.now();
  const did = await db.runTransaction((tx) => step(tx, now));
  return { now: Date.now(), did };
});

exports.join = onCall(async (req) => {
  const uid = requireUser(req);
  let name;
  try { name = G.cleanName(req.data && req.data.name); } catch { fail("invalid-argument", "名前は1〜12文字で入れてね"); }
  const email = (req.auth.token.email || "").toLowerCase();
  const access = await db.doc("config/access").get();
  const allow = access.exists ? (access.data().emails || []).map((e) => String(e).toLowerCase()) : [];
  if (allow.length && !allow.includes(email)) fail("permission-denied", "このテーブルには招待されたアカウントだけ参加できます");
  const count = (await PLAYERS.count().get()).data().count;
  await db.runTransaction(async (tx) => {
    const ref = PLAYERS.doc(uid), s = await tx.get(ref);
    if (s.exists) tx.update(ref, { name, seated: true });
    else tx.set(ref, {
      name, color: COLORS[count % COLORS.length], chips: G.START, dep: 0, seated: true, joinedAt: Date.now(),
      lastRound: 0, lastDelta: 0, lastRet: 0, lastBets: null, hist: [], st: { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve: [],
    });
  });
  return { now: Date.now() };
});

/** Replace my bets for the current round with the given full set. Chips are held while bet. */
exports.setBets = onCall(async (req) => {
  const uid = requireUser(req);
  let want;
  try { want = G.cleanBets(req.data && req.data.bets); } catch { fail("invalid-argument", "ベット額がおかしいよ"); }
  const round = req.data && req.data.round;
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const ts = await tx.get(TABLE);
    const p = await requirePlayer(tx, uid);
    const betRef = BETS.doc(uid), bs = await tx.get(betRef);
    const t = ts.exists ? ts.data() : fresh();
    if (!p.seated) fail("failed-precondition", "先に着席してね");
    if (!bettingOpen(t, now)) fail("failed-precondition", "ベット締切。次のゲームを待ってね");
    if (round !== t.round) fail("failed-precondition", "ゲームが進んだので、もう一度置いてね");
    const cur = bs.exists && bs.data().round === t.round ? bs.data().bets : G.emptyBets();
    const delta = G.sum(want) - G.sum(cur);
    if (delta > p.chips) fail("failed-precondition", "チップが足りない。残高の＋から入金できるよ");
    tx.update(PLAYERS.doc(uid), { chips: FieldValue.increment(-delta) });
    if (G.sum(want) > 0) tx.set(betRef, { round: t.round, bets: want, total: G.sum(want), at: now });
    else if (bs.exists) tx.delete(betRef);
    const resume = t.phase === "paused" && G.sum(want) > 0 ? { phase: "betting", closesAt: now + G.BET_MS, idle: 0 } : null;
    if (!ts.exists) tx.set(TABLE, { ...t, ...(resume || {}) });
    else if (resume) tx.update(TABLE, resume);
  });
  return { now: Date.now() };
});

/** Close betting now. Only someone with chips on the table can do it. */
exports.dealNow = onCall(async (req) => {
  const uid = requireUser(req);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const ts = await tx.get(TABLE), bs = await tx.get(BETS.doc(uid));
    if (!ts.exists) fail("failed-precondition", "まだゲームが始まっていません");
    const t = ts.data();
    if (t.phase !== "betting") fail("failed-precondition", "今は配れません");
    if (!bs.exists || bs.data().round !== t.round || G.sum(bs.data().bets) === 0) fail("failed-precondition", "ベットしてから押してね");
    tx.update(TABLE, { closesAt: now });
  });
  const did = await db.runTransaction((tx) => step(tx, Date.now()));
  return { now: Date.now(), did };
});

exports.deposit = onCall(async (req) => {
  const uid = requireUser(req);
  const amount = req.data && req.data.amount;
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > G.MAX_DEPOSIT) fail("invalid-argument", `入金は1〜${G.MAX_DEPOSIT.toLocaleString("ja-JP")}まで`);
  await db.runTransaction(async (tx) => {
    await requirePlayer(tx, uid);
    tx.update(PLAYERS.doc(uid), { chips: FieldValue.increment(amount), dep: FieldValue.increment(amount) });
  });
  return { now: Date.now() };
});

/** Stand up. Bets still open are returned; bets already dealt settle normally. */
exports.leave = onCall(async (req) => {
  const uid = requireUser(req);
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const ts = await tx.get(TABLE);
    await requirePlayer(tx, uid);
    const betRef = BETS.doc(uid), bs = await tx.get(betRef);
    const t = ts.exists ? ts.data() : fresh();
    if (bs.exists && bs.data().round === t.round && bettingOpen(t, now)) {
      tx.update(PLAYERS.doc(uid), { chips: FieldValue.increment(G.sum(bs.data().bets)) });
      tx.delete(betRef);
    }
    tx.update(PLAYERS.doc(uid), { seated: false });
  });
  return { now: Date.now() };
});

// Blackjack table: shares the same players (and chips) as baccarat.
Object.assign(exports, require("./blackjack")({ db, onCall, FieldValue, fail, requireUser, PLAYERS }));
