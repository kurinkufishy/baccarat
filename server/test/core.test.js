// Same coverage as the old Cloud Functions tests, now against the Durable Object's core.
import test from "node:test";
import assert from "node:assert/strict";
import { Core, freshData } from "../src/core.js";
import * as G from "../src/game.js";
import * as B from "../src/bjgame.js";
const { BJ } = B;

let clock = 1_000_000;
const core = new Core(freshData());
const act = (type, uid, m = {}) => core.handle(uid, uid + "@example.com", type, m, clock);
const no = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
const P = (u) => core.d.players[u];

test("join gives starting chips; names are validated", () => {
  no(() => act("join", "a", { name: "" }));
  no(() => act("join", "a", { name: "あ".repeat(13) }));
  act("join", "a", { name: "あきら" }); act("join", "b", { name: "ぼぶ" });
  assert.equal(P("a").chips, G.START);
  assert.equal(P("b").name, "ぼぶ");
});

test("cannot act before joining; unknown actions refused", () => {
  no(() => act("deposit", "zz", { amount: 10 }));
  no(() => act("setBets", "zz", { bets: { player: 100 }, round: 1 }));
  no(() => act("cheat", "a", {}));
});

test("baccarat bets are validated and chips are held", () => {
  const r = core.d.bac.round;
  no(() => act("setBets", "a", { bets: { player: -5 }, round: r }));
  no(() => act("setBets", "a", { bets: { player: 0.5 }, round: r }));
  no(() => act("setBets", "a", { bets: { cheat: 5 }, round: r }));
  no(() => act("setBets", "a", { bets: { player: G.START + 1 }, round: r }));
  no(() => act("setBets", "a", { bets: { player: 100 }, round: r + 5 }));
  assert.equal(core.d.bac.phase, "paused");
  act("setBets", "a", { bets: { banker: 3000, ppair: 500 }, round: r });
  assert.equal(P("a").chips, G.START - 3500);
  assert.equal(core.d.bac.phase, "betting");
  act("setBets", "a", { bets: { banker: 1000 }, round: r });
  assert.equal(P("a").chips, G.START - 1000);
  act("setBets", "b", { bets: { player: 2000 }, round: r });
});

test("deal waits for the timer, then settles everyone exactly once", () => {
  const t0 = structuredClone(core.d.bac);
  assert.deepEqual(core.step(clock), []);
  clock = t0.closesAt - 1;
  act("setBets", "a", { bets: { banker: 1000 }, round: t0.round });
  clock = t0.closesAt;
  no(() => act("setBets", "a", { bets: { banker: 5000 }, round: t0.round }), /締切/);
  const betA = core.d.bacBets.a.bets, betB = core.d.bacBets.b.bets;
  const aHeld = P("a").chips, bHeld = P("b").chips;
  assert.deepEqual(core.step(clock), ["bac:dealt"]);
  const t = core.d.bac;
  assert.equal(t.phase, "result");
  assert.ok(!JSON.stringify(core.view("bac")).includes(core.d.bacShoe.slice(0, 20)), "the shoe never appears in the public view");
  assert.equal(P("a").chips, aHeld + G.payout(betA, t.res));
  assert.equal(P("b").chips, bHeld + G.payout(betB, t.res));
  assert.deepEqual(core.d.bacBets, {});
  const aAfter = P("a").chips;
  assert.deepEqual(core.step(clock), []);
  assert.equal(P("a").chips, aAfter);
});

test("baccarat advances after the animation, then pauses when idle", () => {
  const t = structuredClone(core.d.bac);
  clock = t.dealtAt + G.animMs(t.P, t.B) + G.HOLD_MS - 10;
  assert.deepEqual(core.step(clock), []);
  assert.equal(core.nextDue(), t.dealtAt + G.animMs(t.P, t.B) + G.HOLD_MS);
  clock += 20;
  assert.deepEqual(core.step(clock), ["bac:advanced"]);
  assert.equal(core.d.bac.round, t.round + 1);
  for (let i = 0; i < 3; i++) {
    clock = core.d.bac.closesAt; core.step(clock);
    const r = core.d.bac; clock = r.dealtAt + G.animMs(r.P, r.B) + G.HOLD_MS; core.step(clock);
  }
  assert.equal(core.d.bac.phase, "paused");
});

test("leaving refunds open baccarat bets", () => {
  const r = core.d.bac.round;
  act("setBets", "b", { bets: { tie: 700 }, round: r });
  const held = P("b").chips;
  act("leave", "b");
  assert.equal(P("b").chips, held + 700);
  no(() => act("setBets", "b", { bets: { tie: 100 }, round: core.d.bac.round }), /着席/);
  act("join", "b", { name: "ぼぶ" });
});

test("borrowing is bounded; repaying and covering a friend's debt", () => {
  no(() => act("deposit", "a", { amount: 0 }));
  no(() => act("deposit", "a", { amount: G.MAX_DEPOSIT + 1 }));
  no(() => act("deposit", "a", { amount: "999" }));
  act("join", "c", { name: "し" });
  act("deposit", "c", { amount: 30000 });
  const c0 = P("c").chips;
  no(() => act("repay", "c", { amount: 30001 }));
  act("repay", "c", { amount: 10000 });
  assert.equal(P("c").dep, 20000); assert.equal(P("c").chips, c0 - 10000);
  const a0 = P("a").chips;
  no(() => act("repay", "a", { amount: 100, to: "nobody" }));
  no(() => act("repay", "a", { amount: 100, to: "../x" }));
  act("repay", "a", { amount: 5000, to: "c" });
  assert.equal(P("a").chips, a0 - 5000); assert.equal(P("c").dep, 15000);
  assert.equal(P("c").helps[0].from, "a");
  no(() => act("repay", "a", { amount: 15001, to: "c" }));
  no(() => act("repay", "a", { amount: 1, to: "b" }), /借金はない/);
});

test("allow-list blocks strangers", () => {
  const c2 = new Core(freshData(), { allowedEmails: ["friend@example.com"] });
  assert.throws(() => c2.handle("x", "stranger@example.com", "join", { name: "x" }, 0));
  c2.handle("y", "Friend@Example.com", "join", { name: "y" }, 0);
});

/* ---------------- blackjack ---------------- */
const bj = new Core(freshData());
let now = 5_000_000;
const ba = (type, uid, m = {}) => bj.handle(uid, "", type, m, now);
const T = () => structuredClone(bj.d.bj);
const chips = (u) => bj.d.players[u].chips;
const rig = (...cards) => { bj.d.bjShoe = { cards: "2S".repeat(120) + [...cards].reverse().join(""), hole: null }; };
const nob = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));

test("blackjack totals, dealer rule and payouts", () => {
  assert.deepEqual(B.total(["AS", "6H"]), { total: 17, soft: true });
  assert.equal(B.total(["AS", "AH", "9D"]).total, 21);
  let i = 0; const seq = ["5C", "9D"];
  assert.deepEqual(B.dealerDraws(["AS", "6H"], () => seq[i++]), ["AS", "6H"]);
  const h = (cards, status, bet = 1000) => ({ cards, status, bet });
  assert.equal(B.settle(h(["AS", "KD"], "bj"), ["TS", "9H"]).ret, 2500);
  assert.equal(B.settle(h(["TS", "9D", "5C"], "bust"), ["TH", "6H", "8C"]).ret, 0);
  assert.equal(B.settle(h(["TS", "8D"], "stand"), ["TH", "8H"]).ret, 1000);
});

test("a full shared blackjack round", () => {
  ba("join", "a", { name: "あ" }); ba("join", "b", { name: "い" });
  nob(() => ba("bjBet", "a", { amount: 50, round: 1 }));
  nob(() => ba("bjBet", "a", { amount: 999999, round: 1 }));
  ba("bjBet", "a", { amount: 1000, round: 1 });
  assert.equal(T().phase, "betting");
  now += 10; ba("bjBet", "b", { amount: 3000, round: 1 });
  assert.equal(chips("a"), 9000); assert.equal(chips("b"), 7000);
  rig("5H", "TC", "TD", "6S", "2D", "6C", "9H", "5D", "TS");
  now = T().closesAt;
  assert.deepEqual(bj.step(now), ["bj:dealt"]);
  let t = T();
  assert.deepEqual(t.dealer, ["TD"]);
  assert.ok(!JSON.stringify(bj.view("bj")).includes("6C"), "hole card is not in the public view");
  nob(() => ba("bjAct", "b", { action: "hit", round: 1, turn: 0 }), /番じゃない/);
  ba("bjAct", "a", { action: "double", round: 1, turn: 0 });
  assert.equal(chips("a"), 8000);
  ba("bjAct", "b", { action: "hit", round: 1, turn: 1 });
  assert.equal(T().turn, 1);
  ba("bjAct", "b", { action: "stand", round: 1, turn: 1 });
  t = T();
  assert.equal(t.phase, "result");
  assert.deepEqual(t.dealer, ["TD", "6C", "TS"]);
  assert.equal(chips("a"), 12000); assert.equal(chips("b"), 13000);
  assert.deepEqual(bj.step(now), []);
});

test("blackjack turn timer, dealer peek, pause and seat cap", () => {
  now = T().animUntil + BJ.HOLD_MS;
  assert.deepEqual(bj.step(now), ["bj:advanced"]);
  ba("bjBet", "a", { amount: 1000, round: 2 });
  rig("9H", "9D", "7C", "9S");
  now = T().closesAt; bj.step(now);
  now = T().turnEndsAt + BJ.ACT_GRACE_MS + 1;
  nob(() => ba("bjAct", "a", { action: "hit", round: 2, turn: 0 }), /時間切れ/);
  assert.deepEqual(bj.step(now), ["bj:timeout"]);
  assert.equal(T().hands[0].out, "lose");
  now = T().animUntil + BJ.HOLD_MS; bj.step(now);
  ba("bjBet", "a", { amount: 1000, round: 3 }); ba("bjBet", "b", { amount: 1000, round: 3 });
  rig("TH", "AH", "AD", "9C", "KS", "QD");
  now = T().closesAt; bj.step(now);
  assert.equal(T().phase, "result");
  assert.equal(T().hands[1].out, "push");
  now = T().animUntil + BJ.HOLD_MS; bj.step(now);
  now = T().closesAt; assert.deepEqual(bj.step(now), ["bj:paused"]);
  assert.equal(bj.nextDue(), null);
  for (let i = 0; i < BJ.MAX_HANDS; i++) { ba("join", "p" + i, { name: "p" + i }); ba("bjBet", "p" + i, { amount: 100, round: T().round }); }
  nob(() => ba("bjBet", "a", { amount: 100, round: T().round }), /満席/);
  ba("bjBet", "p0", { amount: 0, round: T().round });
  assert.equal(chips("p0"), 10000);
});

test("changes are tracked for saving and the shoe is never a public view", () => {
  const c = new Core(freshData());
  c.handle("a", "", "join", { name: "a" }, 0);
  assert.deepEqual([...c.takeChanges()], ["p:a"]);
  c.handle("a", "", "setBets", { bets: { player: 100 }, round: 1 }, 0);
  c.step(G.BET_MS);
  const ch = c.takeChanges();
  assert.ok(ch.has("bacShoe") && ch.has("bac") && ch.has("p:a"));
  assert.equal(c.view("bacShoe"), undefined);
  assert.equal(c.view("bjShoe"), undefined);
});

test("importing old data once, with held bets returned", () => {
  const c = new Core(freshData());
  c.handle("new1", "", "join", { name: "new" }, 0);
  c.handle("old1", "", "join", { name: "x" }, 0);
  c.handle("old1", "", "deposit", { amount: 500 }, 0);
  const n = c.importPlayers({ old1: { name: "くり", chips: 42000, dep: 10000, st: { n: 3, w: 2, l: 1, p: 0, wag: 3000, prof: 900 } }, old2: { name: "たけし", chips: 7000 }, "bad/../id": { chips: 1e9 } }, { old2: 3000 });
  assert.equal(n, 3);
  assert.equal(c.d.players.old1.chips, 42000 + 500, "what they did on the new table is kept on top");
  assert.equal(c.d.players.old1.dep, 10500);
  assert.equal(c.d.players.old2.chips, 10000, "chips held in unsettled bets come back");
  assert.ok(!c.d.players["bad/../id"]);
  assert.equal(c.d.players.new1.chips, 10000);
  assert.throws(() => c.importPlayers({}, {}), /もう終わって/);
});

test("giving chips to a friend from your own balance", () => {
  const c = new Core(freshData());
  const g = (uid, m) => c.handle(uid, "", "give", m, 7);
  c.handle("a", "", "join", { name: "a" }, 0); c.handle("b", "", "join", { name: "b" }, 0);
  assert.throws(() => g("a", { amount: 0, to: "b" }));
  assert.throws(() => g("a", { amount: 1.5, to: "b" }));
  assert.throws(() => g("a", { amount: "100", to: "b" }));
  assert.throws(() => g("a", { amount: 100, to: "a" }), /自分/);
  assert.throws(() => g("a", { amount: 100, to: "nobody" }), /見つから/);
  assert.throws(() => g("a", { amount: 100, to: "../b" }));
  assert.throws(() => g("a", { amount: 10001, to: "b" }), /足りない/);
  c.handle("a", "", "setBets", { bets: { player: 4000 }, round: 1 }, 0);
  assert.throws(() => g("a", { amount: 6001, to: "b" }), /足りない/, "chips held in a bet can't be given");
  g("a", { amount: 6000, to: "b" });
  assert.equal(c.d.players.a.chips, 0);
  assert.equal(c.d.players.b.chips, 16000);
  assert.deepEqual(c.d.players.b.gifts[0], { from: "a", amount: 6000, at: 7 });
  assert.equal(c.d.players.a.dep, 0, "giving is not borrowing");
});

test("no practical bet cap; balances stay exact", () => {
  const c = new Core(freshData());
  c.handle("a", "", "join", { name: "a" }, 0);
  c.d.players.a.chips = 50_000_000_000;
  c.handle("a", "", "setBets", { bets: { banker: 50_000_000_000 }, round: 1 }, 0);
  assert.equal(c.d.players.a.chips, 0, "ALL BET of 50 billion is accepted");
  assert.throws(() => c.handle("a", "", "setBets", { bets: { banker: G.MAX_SPOT + 1 }, round: 1 }, 0));
  c.d.players.a.chips = G.MAX_CHIPS - 5;
  c.handle("a", "", "deposit", { amount: 1000 }, 0);
  assert.equal(c.d.players.a.chips, G.MAX_CHIPS);
  assert.ok(Number.isSafeInteger(G.MAX_SPOT * 12) && Number.isSafeInteger(G.MAX_CHIPS + G.MAX_SPOT * 12));
});

test("global chat", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  nc(() => c.handle("x", "", "chat", { text: "hi" }, 0), /参加/);
  c.handle("a", "", "join", { name: "あ" }, 0);
  c.handle("a", "", "chat", { text: "  やあ\n<b>みんな</b>‮  " }, 1000);
  assert.deepEqual(c.d.chat.map((m) => [m.id, m.uid, m.name, m.text]), [[1, "a", "あ", "やあ <b>みんな</b>"]]);
  nc(() => c.handle("a", "", "chat", { text: "速い" }, 1200), /速すぎ/);
  nc(() => c.handle("a", "", "chat", { text: "   " }, 5000), /入れて/);
  nc(() => c.handle("a", "", "chat", { text: "あ".repeat(121) }, 5000), /120/);
  nc(() => c.handle("a", "", "chat", { text: 5 }, 5000));
  for (let i = 0; i < 60; i++) c.handle("a", "", "chat", { text: "m" + i }, 10_000 + i * 1000);
  assert.equal(c.d.chat.length, 50);
  assert.equal(c.d.chat.at(-1).id, 61);
  assert.equal(c.fullState().chat.length, 50);
  assert.ok(c.takeChanges().has("chat"));
});
