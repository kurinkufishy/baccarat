const test = require("node:test");
const assert = require("node:assert");
const { db, authFor } = require("./fake-firebase");
let clock = 5_000_000;
Date.now = () => clock;
const fn = require("../index");
const B = require("../bjgame");
const { BJ } = B;

const call = (name, uid, data) => fn[name]({ auth: authFor(uid), data });
const T = () => structuredClone(db.docs.get("tables/bj"));
const chips = (uid) => db.docs.get("players/" + uid).chips;
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);
// Deal order from the END of the string: hand1 c1, hand2 c1, dealer up, hand1 c2, hand2 c2, hole, then draws.
const rig = (...cards) => db.docs.set("tables/bj/private/shoe", { cards: "2S".repeat(120) + [...cards].reverse().join(""), hole: null });

test("totals and dealer rule", () => {
  assert.deepStrictEqual(B.total(["AS", "6H"]), { total: 17, soft: true });
  assert.deepStrictEqual(B.total(["AS", "6H", "TD"]), { total: 17, soft: false });
  assert.strictEqual(B.total(["AS", "AH", "9D"]).total, 21);
  assert.ok(B.isBlackjack(["AS", "KD"]));
  assert.ok(!B.isBlackjack(["7S", "7D", "7H"]));
  let i = 0; const seq = ["5C", "9D"];
  assert.deepStrictEqual(B.dealerDraws(["AS", "6H"], () => seq[i++]), ["AS", "6H"], "stands on soft 17");
  i = 0;
  assert.deepStrictEqual(B.dealerDraws(["TS", "6H"], () => seq[i++]), ["TS", "6H", "5C"]);
});

test("settlement amounts", () => {
  const h = (cards, status, bet = 1000) => ({ cards, status, bet });
  assert.strictEqual(B.settle(h(["AS", "KD"], "bj"), ["TS", "9H"]).ret, 2500);
  assert.strictEqual(B.settle(h(["AS", "KD"], "bj"), ["AH", "QH"]).ret, 1000);
  assert.strictEqual(B.settle(h(["TS", "9D"], "stand"), ["AH", "QH"]).ret, 0);
  assert.strictEqual(B.settle(h(["TS", "9D"], "stand"), ["TH", "6H", "8C"]).ret, 2000);
  assert.strictEqual(B.settle(h(["TS", "9D", "5C"], "bust"), ["TH", "6H", "8C"]).ret, 0, "player bust loses even if dealer busts");
  assert.strictEqual(B.settle(h(["TS", "8D"], "stand"), ["TH", "8H"]).ret, 1000);
  assert.strictEqual(B.settle(h(["TS", "7D"], "stand"), ["TH", "8H"]).ret, 0);
});

test("a full shared round: bets, turns, hit, double, dealer, payouts", async () => {
  await call("join", "a", { name: "あ" }); await call("join", "b", { name: "い" });
  await call("bjTick", "a", {});
  assert.strictEqual(T().phase, "paused");
  await rejects(call("bjBet", "a", { amount: 50, round: 1 }), "invalid-argument");
  await rejects(call("bjBet", "a", { amount: 1.5, round: 1 }), "invalid-argument");
  await rejects(call("bjBet", "a", { amount: 999999, round: 1 }), "failed-precondition");
  await call("bjBet", "a", { amount: 1000, round: 1 });
  assert.strictEqual(T().phase, "betting");
  clock += 10; await call("bjBet", "b", { amount: 2000, round: 1 });
  assert.strictEqual(chips("a"), 9000); assert.strictEqual(chips("b"), 8000);
  await call("bjBet", "b", { amount: 3000, round: 1 });
  assert.strictEqual(chips("b"), 7000, "raising a bet holds the difference");

  // a: 5+6=11 then doubles into a 9 -> 20. b: T+2=12, hits 5 -> 17, stands. Dealer: T up, 6 hole -> 16, draws T -> bust.
  rig("5H", "TC", "TD", "6S", "2D", "6C", "9H", "5D", "TS");
  clock = T().closesAt;
  assert.strictEqual((await call("bjTick", "b", {})).did, "dealt");
  let t = T();
  assert.strictEqual(t.phase, "playing");
  assert.deepStrictEqual(t.dealer, ["TD"], "only the up card is public");
  assert.ok(!JSON.stringify(t).includes("6C"), "hole card is not on the public table");
  assert.strictEqual(t.turn, 0); assert.strictEqual(t.hands[0].uid, "a");

  await rejects(call("bjAct", "b", { action: "hit", round: 1, turn: 0 }), "permission-denied");
  await rejects(call("bjAct", "a", { action: "hit", round: 1, turn: 1 }), "failed-precondition");
  await call("bjAct", "a", { action: "double", round: 1, turn: 0 });
  t = T();
  assert.strictEqual(t.hands[0].bet, 2000); assert.strictEqual(t.hands[0].status, "stand");
  assert.strictEqual(chips("a"), 8000, "double holds another stake");
  assert.strictEqual(t.turn, 1);
  await call("bjAct", "b", { action: "hit", round: 1, turn: 1 });
  t = T();
  assert.strictEqual(B.total(t.hands[1].cards).total, 17);
  assert.strictEqual(t.turn, 1, "still b's turn after a safe hit");
  await call("bjAct", "b", { action: "stand", round: 1, turn: 1 });
  t = T();
  assert.strictEqual(t.phase, "result");
  assert.deepStrictEqual(t.dealer, ["TD", "6C", "TS"]);
  assert.strictEqual(t.hands[0].out, "win"); assert.strictEqual(t.hands[1].out, "win");
  assert.strictEqual(chips("a"), 8000 + 4000);
  assert.strictEqual(chips("b"), 7000 + 6000);
  assert.strictEqual(db.docs.get("players/a").bjLast.d, 2000);
  assert.strictEqual(db.docs.get("players/b").bjst.n, 1);
  // Nothing pays twice.
  await call("bjTick", "a", {});
  assert.strictEqual(chips("a"), 12000);
});

test("turn timer stands for you; dealer blackjack ends the hand at once", async () => {
  let t = T();
  clock = t.animUntil + BJ.HOLD_MS;
  assert.strictEqual((await call("bjTick", "a", {})).did, "advanced");
  assert.strictEqual(T().round, 2);
  await call("bjBet", "a", { amount: 1000, round: 2 });
  // a: 9+7=16. dealer: 9 up, 9 hole -> 18.
  rig("9H", "9D", "7C", "9S");
  clock = T().closesAt; await call("bjTick", "a", {});
  t = T();
  clock = t.turnEndsAt + BJ.ACT_GRACE_MS + 1;
  await rejects(call("bjAct", "a", { action: "hit", round: 2, turn: 0 }), "failed-precondition");
  assert.strictEqual((await call("bjTick", "b", {})).did, "timeout");
  t = T();
  assert.strictEqual(t.phase, "result"); assert.strictEqual(t.hands[0].out, "lose");
  assert.strictEqual(chips("a"), 11000);

  clock = t.animUntil + BJ.HOLD_MS; await call("bjTick", "a", {});
  await call("bjBet", "a", { amount: 1000, round: 3 }); await call("bjBet", "b", { amount: 1000, round: 3 });
  // a: T+9=19, b: A+K blackjack. dealer: A up, Q hole -> blackjack.
  rig("TH", "AH", "AD", "9C", "KS", "QD");
  clock = T().closesAt; await call("bjTick", "a", {});
  t = T();
  assert.strictEqual(t.phase, "result", "dealer peeked a blackjack");
  assert.strictEqual(t.hands[0].out, "lose"); assert.strictEqual(t.hands[1].out, "push");
  assert.strictEqual(chips("b"), 13000, "blackjack vs blackjack pushes");
});

test("no bets pauses; bets are capped per table", async () => {
  let t = T(); clock = t.animUntil + BJ.HOLD_MS; await call("bjTick", "a", {});
  clock = T().closesAt; assert.strictEqual((await call("bjTick", "a", {})).did, "paused");
  for (let i = 0; i < BJ.MAX_HANDS; i++) { await call("join", "p" + i, { name: "p" + i }); await call("bjBet", "p" + i, { amount: 100, round: T().round }); }
  await rejects(call("bjBet", "a", { amount: 100, round: T().round }), "failed-precondition");
  await call("bjBet", "p0", { amount: 0, round: T().round });
  assert.strictEqual(chips("p0"), 10000, "taking a bet back refunds it");
  await call("bjBet", "a", { amount: 100, round: T().round });
});
