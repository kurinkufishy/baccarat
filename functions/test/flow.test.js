// Runs the real callables in index.js against an in-memory Firestore and a controllable clock.
const test = require("node:test");
const assert = require("node:assert");
const { db, authFor } = require("./fake-firebase");
let clock = 1_000_000;
Date.now = () => clock;
const fn = require("../index");
const G = require("../game");

const call = (name, uid, data, auth) => fn[name]({ auth: auth === undefined ? authFor(uid) : auth, data });
const player = (uid) => db.docs.get("players/" + uid);
const table = () => structuredClone(db.docs.get("tables/main"));
const rejects = (p, code) => assert.rejects(p, (e) => e.code === code);

test("auth is required and must be a verified Google account", async () => {
  await rejects(call("join", "x", { name: "x" }, null), "unauthenticated");
  await rejects(call("join", "x", { name: "x" }, authFor("x", { email_verified: false })), "permission-denied");
  await rejects(call("join", "x", { name: "x" }, authFor("x", { firebase: { sign_in_provider: "password" } })), "permission-denied");
});

test("joining gives starting chips; names are validated", async () => {
  await rejects(call("join", "a", { name: "" }), "invalid-argument");
  await call("join", "a", { name: "あきら" });
  await call("join", "b", { name: "ぼぶ" });
  assert.strictEqual(player("a").chips, G.START);
  assert.strictEqual(player("b").name, "ぼぶ");
});

test("cannot act before joining", async () => {
  await rejects(call("deposit", "zz", { amount: 10 }), "failed-precondition");
  await rejects(call("tick", "zz", {}), "failed-precondition");
  await call("tick", "a", {});
  await rejects(call("setBets", "zz", { bets: { player: 100 }, round: 1 }), "failed-precondition");
});

test("bets are validated and chips are held", async () => {
  const r = table().round;
  await rejects(call("setBets", "a", { bets: { player: -5 }, round: r }), "invalid-argument");
  await rejects(call("setBets", "a", { bets: { player: 0.5 }, round: r }), "invalid-argument");
  await rejects(call("setBets", "a", { bets: { cheat: 5 }, round: r }), "invalid-argument");
  await rejects(call("setBets", "a", { bets: { player: G.START + 1 }, round: r }), "failed-precondition");
  await rejects(call("setBets", "a", { bets: { player: 100 }, round: r + 5 }), "failed-precondition");
  assert.strictEqual(table().phase, "paused");
  await call("setBets", "a", { bets: { banker: 3000, ppair: 500 }, round: r });
  assert.strictEqual(player("a").chips, G.START - 3500);
  assert.strictEqual(table().phase, "betting", "a bet wakes a paused table");
  await call("setBets", "a", { bets: { banker: 1000 }, round: r });
  assert.strictEqual(player("a").chips, G.START - 1000, "lowering a bet returns chips");
  await call("setBets", "b", { bets: { player: 2000 }, round: r });
});

test("deal waits for the timer, then settles everyone exactly once", async () => {
  const t0 = table();
  assert.strictEqual((await call("tick", "a", {})).did, "none", "too early");
  clock = t0.closesAt - 1;
  await call("setBets", "a", { bets: { banker: 1000 }, round: t0.round }); // still open 1ms before close
  clock = t0.closesAt;
  await rejects(call("setBets", "a", { bets: { banker: 5000 }, round: t0.round }), "failed-precondition");
  const stakeA = G.sum(db.docs.get("tables/main/bets/a").bets);
  const betA = db.docs.get("tables/main/bets/a").bets, betB = db.docs.get("tables/main/bets/b").bets;
  const aHeld = player("a").chips, bHeld = player("b").chips;
  assert.strictEqual((await call("tick", "b", {})).did, "dealt");
  const t = table();
  assert.strictEqual(t.phase, "result");
  assert.ok(!("shoe" in t), "the shoe is never on the public table doc");
  assert.ok(db.docs.get("tables/main/private/shoe").cards.length > 0);
  assert.strictEqual(player("a").chips, aHeld + G.payout(betA, t.res));
  assert.strictEqual(player("b").chips, bHeld + G.payout(betB, t.res));
  assert.strictEqual(player("a").lastDelta, G.payout(betA, t.res) - stakeA);
  assert.ok(!db.docs.has("tables/main/bets/a"), "settled bets are removed");
  // A second tick right away must not deal or pay again.
  const aAfter = player("a").chips;
  assert.strictEqual((await call("tick", "a", {})).did, "none");
  assert.strictEqual(player("a").chips, aAfter);
});

test("table advances after the animation and hold, then pauses when idle", async () => {
  const t = table();
  clock = t.dealtAt + G.animMs(t.P, t.B) + G.HOLD_MS - 10;
  assert.strictEqual((await call("tick", "a", {})).did, "none");
  clock += 20;
  assert.strictEqual((await call("tick", "a", {})).did, "advanced");
  assert.strictEqual(table().round, t.round + 1);
  assert.strictEqual(table().phase, "betting");
  for (let i = 0; i < 3; i++) {
    clock = table().closesAt; await call("tick", "a", {});
    const r = table(); clock = r.dealtAt + G.animMs(r.P, r.B) + G.HOLD_MS; await call("tick", "a", {});
  }
  assert.strictEqual(table().phase, "paused", "three empty rounds pause the table");
});

test("dealNow needs your own bet; leaving refunds open bets", async () => {
  const r = table().round;
  await rejects(call("dealNow", "b", {}), "failed-precondition");
  await call("setBets", "b", { bets: { tie: 700 }, round: r });
  const held = player("b").chips;
  await call("leave", "b", {});
  assert.strictEqual(player("b").chips, held + 700);
  assert.strictEqual(player("b").seated, false);
  await rejects(call("setBets", "b", { bets: { tie: 100 }, round: r }), "failed-precondition");
  await call("setBets", "a", { bets: { player: 100 }, round: r });
  const res = await call("dealNow", "a", {});
  assert.strictEqual(res.did, "dealt");
});

test("deposits are bounded", async () => {
  await rejects(call("deposit", "a", { amount: 0 }), "invalid-argument");
  await rejects(call("deposit", "a", { amount: G.MAX_DEPOSIT + 1 }), "invalid-argument");
  await rejects(call("deposit", "a", { amount: "999" }), "invalid-argument");
  const c = player("a").chips;
  await call("deposit", "a", { amount: 25000 });
  assert.strictEqual(player("a").chips, c + 25000);
  assert.strictEqual(player("a").dep, 25000);
});

test("allow-list blocks strangers", async () => {
  db.docs.set("config/access", { emails: ["a@example.com"] });
  await rejects(call("join", "stranger", { name: "x" }), "permission-denied");
  await call("join", "a", { name: "あきら2" });
  db.docs.delete("config/access");
});

test("repay your own debt, or cover a friend's", async () => {
  const P = (u) => db.docs.get("players/" + u);
  await call("join", "c", { name: "し" });
  await call("deposit", "c", { amount: 30000 });
  const c0 = P("c").chips;
  await rejects(call("repay", "c", { amount: 0 }), "invalid-argument");
  await rejects(call("repay", "c", { amount: 30001 }), "failed-precondition");
  await call("repay", "c", { amount: 10000 });
  assert.strictEqual(P("c").dep, 20000);
  assert.strictEqual(P("c").chips, c0 - 10000);
  // a covers part of c's debt
  const a0 = P("a").chips;
  await rejects(call("repay", "a", { amount: 100, to: "nobody" }), "not-found");
  await rejects(call("repay", "a", { amount: 100, to: "../x" }), "invalid-argument");
  await call("repay", "a", { amount: 5000, to: "c" });
  assert.strictEqual(P("a").chips, a0 - 5000);
  assert.strictEqual(P("c").dep, 15000);
  assert.strictEqual(P("c").helps[0].from, "a");
  assert.strictEqual(P("c").helps[0].amount, 5000);
  await rejects(call("repay", "a", { amount: P("a").chips + 1, to: "c" }), "failed-precondition");
  // nobody can push someone's debt below zero
  await rejects(call("repay", "a", { amount: 15001, to: "c" }), "failed-precondition");
  db.docs.get("players/b").dep = 0;
  await rejects(call("repay", "a", { amount: 1, to: "b" }), "failed-precondition");
});
