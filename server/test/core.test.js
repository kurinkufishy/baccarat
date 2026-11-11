// Same coverage as the old Cloud Functions tests, now against the Durable Object's core.
import test from "node:test";
import assert from "node:assert/strict";
import { Core, freshData } from "../src/core.js";
import * as G from "../src/game.js";
import * as B from "../src/bjgame.js";
const { BJ } = B;

let clock = 1_000_000;
const core = new Core(freshData());
core.step(0); // make the first race card now so it does not show up in later step() results
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
bj.step(0);
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

test("owner grants run once, as debt, by exact nickname", () => {
  const c = new Core(freshData());
  c.handle("u1", "", "join", { name: "taktak7633" }, 0);
  c.handle("u2", "", "join", { name: "other" }, 0);
  const g = [{ id: "g1", name: "taktak7633", amount: 10_000_000_000, asDebt: true }, { id: "g2", name: "nobody", amount: 5, asDebt: true }];
  const r = c.applyGrants(g, 123);
  assert.equal(r.g1, "ok:123"); assert.equal(r.g2, "not-found");
  assert.equal(c.d.players.u1.chips, 10_000_010_000); assert.equal(c.d.players.u1.dep, 10_000_000_000);
  c.applyGrants(g, 456);
  assert.equal(c.d.players.u1.chips, 10_000_010_000, "second run does nothing");
  c.handle("u3", "", "join", { name: "x" }, 0); c.d.players.u3.name = "taktak7633"; // old duplicates can still exist
  c.applyGrants([{ id: "g3", name: "taktak7633", amount: 1, asDebt: false }], 789);
  assert.equal(c.d.meta.grants.g3, "ambiguous");
});

test("rename costs 1M, names stay unique, re-seating keeps the name", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("a", "", "join", { name: "あき" }, 0);
  c.handle("b", "", "join", { name: "ぼぶ" }, 0);
  nc(() => c.handle("c", "", "join", { name: "ぼぶ" }, 0), /使われてる/);
  nc(() => c.handle("a", "", "rename", { name: "新" }, 0), /足りない/);
  c.d.players.a.chips = 1_500_000;
  nc(() => c.handle("a", "", "rename", { name: "ぼぶ" }, 0), /使われてる/);
  nc(() => c.handle("a", "", "rename", { name: "あき" }, 0), /同じ/);
  nc(() => c.handle("a", "", "rename", { name: "" }, 0), /1〜12/);
  assert.equal(c.d.players.a.chips, 1_500_000, "refusals cost nothing");
  c.handle("a", "", "rename", { name: "あきら" }, 0);
  assert.equal(c.d.players.a.name, "あきら"); assert.equal(c.d.players.a.chips, 500_000);
  c.handle("a", "", "leave", {}, 0);
  c.handle("a", "", "join", { name: "タダで変える" }, 0);
  assert.equal(c.d.players.a.name, "あきら", "join never renames an existing player");
  assert.equal(c.d.players.a.seated, true);
});

test("achievements unlock on the server", async () => {
  const A = await import("../src/ach.js");
  const c = new Core(freshData());
  c.handle("a", "", "join", { name: "あ" }, 0);
  c.handle("b", "", "join", { name: "い" }, 0);
  const a = () => c.d.players.a;
  // all-in tie win with both pairs on a rigged coup: P = 5S 5H, B = 4D 4C... both 0? use 7s and 2s: P 7S 7H (4), B 7D 7C (4) -> tie, both pairs
  c.d.bacShoe = "2S".repeat(60) + ["7S", "7D", "7H", "7C"].reverse().join("");
  c.handle("a", "", "setBets", { bets: { tie: 9000, ppair: 500, bpair: 500 }, round: 1 }, 100);
  c.step(100 + G.BET_MS + 1);
  const got = Object.keys(a().ach || {});
  for (const id of ["tie", "pair", "dpair", "allin", "win1m"].slice(0, 4)) assert.ok(got.includes(id), id + " in " + got);
  c.takeChanges();
  assert.ok(a().ach.bac1, "totals checked on commit");
  c.handle("a", "", "chat", { text: "やあ" }, 200_000);
  c.handle("a", "", "give", { amount: 1, to: "b" }, 200_000);
  assert.ok(a().ach.chat && a().ach.give);
  assert.equal(A.ACH.length, new Set(A.ACH.map((x) => x.id)).size, "ids unique");
  assert.ok(c.fullState().achDefs.length >= 20);
  const p = {}; for (let i = 0; i < 5; i++) A.streak(p, "b", 10); assert.equal(p.ax.b, 5); A.streak(p, "b", 0); assert.equal(p.ax.b, 5); A.streak(p, "b", -1); assert.equal(p.ax.b, -1);
});

test("frames need their achievements", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("a", "", "join", { name: "あ" }, 0);
  nc(() => c.handle("a", "", "setFrame", { frame: "rainbow" }, 0), /まだ/);
  nc(() => c.handle("a", "", "setFrame", { frame: "nope" }, 0), /ない/);
  nc(() => c.handle("a", "", "setFrame", { frame: { x: 1 } }, 0), /ない/);
  c.d.players.a.ach = { win10b: 1, chat: 1, give: 1 };
  c.handle("a", "", "setFrame", { frame: "gold" }, 0); assert.equal(c.d.players.a.frame, "gold");
  c.handle("a", "", "setFrame", { frame: "bronze" }, 0); assert.equal(c.d.players.a.frame, "bronze");
  nc(() => c.handle("a", "", "setFrame", { frame: "silver" }, 0), /8個/);
  c.handle("a", "", "setFrame", { frame: "" }, 0); assert.equal(c.d.players.a.frame, undefined);
  assert.ok(c.fullState().frameDefs.some((f) => f.id === "rainbow"));
  c.handle("a", "", "setBubble", { bubble: "mint" }, 0); assert.equal(c.d.players.a.bubble, "mint");
  nc(() => c.handle("a", "", "setBubble", { bubble: "rainbow" }, 0), /15個/);
  nc(() => c.handle("a", "", "setBubble", { bubble: "diamond" }, 0), /ない/);
  assert.ok(c.fullState().bubbleDefs.length >= 8);
});

test("more achievements: tie streak, counters, time of day, dressup", () => {
  const c = new Core(freshData());
  c.handle("a", "", "join", { name: "あ" }, 0);
  const a = () => c.d.players.a;
  let now = Date.UTC(2026, 10, 6, 16, 0); // 01:00 in Japan
  const tieCoup = () => { c.d.bacShoe = "2S".repeat(60) + ["7S", "7D", "7H", "7C"].reverse().join(""); };
  for (let i = 0; i < 2; i++) {
    tieCoup();
    c.handle("a", "", "setBets", { bets: { tie: 1000 }, round: c.d.bac.round }, now);
    c.step(now + G.BET_MS + 1); now += G.BET_MS + 1;
    c.step(now + 60_000); now += 60_000;
  }
  assert.ok(a().ach.tie2, "two ties in a row");
  assert.ok(a().ach.night, "played at 1am JST");
  assert.equal(a().ax.tie, 2);
  a().ach.chat = 1;
  for (let i = 0; i < 100; i++) c.handle("a", "", "chat", { text: "x" }, now + i * 1000);
  assert.ok(a().ach.chat100);
  c.handle("a", "", "setBubble", { bubble: "mint" }, now);
  assert.ok(a().ach.dressup);
});

test("FX: open, move, close, stop-out", async () => {
  const F = await import("../src/fxgame.js");
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("a", "", "join", { name: "あ" }, 0);
  const a = () => c.d.players.a;
  nc(() => c.handle("a", "", "fxOpen", { side: "buy", margin: 1000, lev: 10 }, 1000), /止まって/);
  c.fxTick(1000);
  nc(() => c.handle("a", "", "fxOpen", { side: "up", margin: 1000, lev: 10 }, 1500), /買いか売り/);
  nc(() => c.handle("a", "", "fxOpen", { side: "buy", margin: 1000, lev: 7 }, 1500), /レバレッジ/);
  nc(() => c.handle("a", "", "fxOpen", { side: "buy", margin: 50, lev: 10 }, 1500), /100/);
  nc(() => c.handle("a", "", "fxOpen", { side: "buy", margin: 20000, lev: 10 }, 1500), /足りない/);
  c.handle("a", "", "fxOpen", { side: "buy", margin: 1000, lev: 100 }, 1500);
  c.handle("a", "", "fxOpen", { side: "sell", margin: 1000, lev: 10 }, 1500);
  assert.equal(a().chips, 8000); assert.equal(a().fxPos.length, 2);
  // price up 1%: long x100 wins ~100% of margin (minus spread), short x10 loses ~10%
  c.d.fx.price = Math.round(c.d.fx.price * 1.01 * 1000) / 1000;
  const r = c.handle("a", "", "fxClose", { pos: "all" }, 2000);
  assert.ok(a().chips > 10_700 && a().chips < 10_950, "chips " + a().chips + " d " + r.d);
  assert.equal(a().fxPos.length, 0); assert.equal(a().fxst.n, 2);
  assert.ok(a().ach.fx1 && a().ach.fxlev);
  // stop-out: x100 long, price drops 2%
  c.handle("a", "", "fxOpen", { side: "buy", margin: 1000, lev: 100 }, 2500);
  const before = a().chips;
  c.d.fx.price = Math.round(c.d.fx.price * 0.98 * 1000) / 1000;
  const orig = F.nextPrice; // the tick moves price a little more; it's still far below the stop
  const t = c.fxTick(3000);
  assert.deepEqual(t.liq, ["a"]); assert.equal(a().chips, before); assert.ok(a().ach.fxliq);
  assert.equal(a().fxhist[0].liq, true);
  nc(() => c.handle("a", "", "fxClose", { pos: 99 }, 3500), /もうない/);
  // the market history keeps 1-minute candles
  for (let i = 0; i < 130; i++) c.fxTick(4000 + i * 1000);
  assert.ok(c.d.fx.candles.length >= 2 && c.d.fx.ticks.length <= F.FX.KEEP_TICKS);
  void orig;
});

test("FX price walk stays sane", async () => {
  const F = await import("../src/fxgame.js");
  let p = F.FX.START, lo = p, hi = p;
  for (let i = 0; i < 100_000; i++) { p = F.nextPrice(p); lo = Math.min(lo, p); hi = Math.max(hi, p); }
  assert.ok(lo > 100 && hi < 220, `range ${lo}..${hi}`);
});

test("horse racing: card, bets, race, payout", async () => {
  const R = await import("../src/race.js");
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("a", "", "join", { name: "あ" }, 0);
  c.handle("b", "", "join", { name: "い" }, 0);
  let now = 1_000_000;
  c.step(now);
  const r = () => c.d.rc;
  assert.equal(r().card.horses.length, 8);
  assert.ok(r().card.horses.every((h) => h.odds >= 1.1 && h.podds >= 1.1 && h.pop >= 1));
  const v = c.view("rc"); assert.equal(v.card.horses[0].s, undefined, "strengths stay on the server");
  nc(() => c.handle("a", "", "rcBets", { bets: { w9: 100 }, round: 1 }, now), /馬券/);
  nc(() => c.handle("a", "", "rcBets", { bets: { w1: 50 }, round: 1 }, now), /100/);
  nc(() => c.handle("a", "", "rcBets", { bets: { w1: 20000 }, round: 1 }, now), /足りない/);
  const all = Object.fromEntries(r().card.horses.map((h) => ["w" + h.n, 1000]));
  c.handle("a", "", "rcBets", { bets: all, round: 1 }, now);
  c.handle("b", "", "rcBets", { bets: { p1: 2000, p2: 2000, p3: 2000 }, round: 1 }, now);
  assert.equal(c.d.players.a.chips, 2000); assert.equal(r().phase, "betting");
  now += R.RC.BET_MS; c.step(now);
  assert.equal(r().phase, "racing"); assert.equal(r().script.pos.length, 8);
  nc(() => c.handle("a", "", "rcBets", { bets: {}, round: 1 }, now), /締切/);
  now = r().endAt; c.step(now);
  assert.equal(r().phase, "result");
  const w = r().card.horses[r().order[0]];
  assert.equal(c.d.players.a.chips, 2000 + Math.floor(1000 * w.odds), "exactly the winner's win ticket pays");
  const top3 = r().order.slice(0, 3);
  const bPaid = [0, 1, 2].filter((i) => top3.includes(i)).reduce((s, i) => s + Math.floor(2000 * r().card.horses[i].podds), 0);
  assert.equal(c.d.players.b.chips, 4000 + bPaid);
  assert.ok(c.d.players.a.ach.rc1 && c.d.players.a.ach.rcall);
  assert.equal(r().history.length, 1);
  now = r().holdUntil; c.step(now);
  assert.equal(r().round, 2); assert.equal(r().phase, "betting"); assert.equal(r().card.round, 2);
});

test("owner grant can set an exact balance", () => {
  const c = new Core(freshData());
  c.handle("u1", "", "join", { name: "taktak7633" }, 0);
  c.d.players.u1.dep = 5;
  const r = c.applyGrants([{ id: "s1", name: "taktak7633", setChips: 1_919_114_514_810 }, { id: "s2", name: "taktak7633", setChips: -1 }], 9);
  assert.equal(c.d.players.u1.chips, 1_919_114_514_810); assert.equal(c.d.players.u1.dep, 5);
  assert.equal(r.s1, "ok:9"); assert.equal(r.s2, "bad-amount");
});

test("owner grant can set the ranking net exactly, with a note", () => {
  const c = new Core(freshData());
  c.handle("u1", "", "join", { name: "taktak7633" }, 0);
  const p = c.d.players.u1;
  p.chips = 1_919_114_514_810; p.dep = 10_000_000_000;
  c.applyGrants([{ id: "n1", name: "Taktak7633", setNet: -10_000_000_000, note: "金なさすぎて売ったパソコン" }], 1);
  assert.equal(p.chips - (p.dep || 0) - G.START, -10_000_000_000);
  assert.equal(p.note, "金なさすぎて売ったパソコン");
  p.dep = 0; // not enough debt to get that low: debt goes up instead
  c.applyGrants([{ id: "n2", name: "taktak7633", setNet: -10_000_000_000 }], 2);
  assert.equal(p.chips, 0); assert.equal(p.chips - p.dep - G.START, -10_000_000_000);
});

test("admin operations", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("boss", "", "join", { name: "運営" }, 0);
  c.handle("u", "", "join", { name: "北村" }, 0);
  const p = c.d.players.u;
  c.admin("boss", { op: "add", uid: "u", amount: 5000, asDebt: true }, 1);
  assert.equal(p.chips, 15000); assert.equal(p.dep, 5000);
  c.admin("boss", { op: "add", uid: "u", amount: -100000 }, 2); assert.equal(p.chips, 0);
  c.admin("boss", { op: "setChips", uid: "u", amount: 777 }, 3); assert.equal(p.chips, 777);
  c.admin("boss", { op: "setDebt", uid: "u", amount: 0 }, 4); assert.equal(p.dep, 0);
  c.admin("boss", { op: "setNet", uid: "u", amount: -50 }, 5); assert.equal(p.chips - p.dep - G.START, -50);
  c.admin("boss", { op: "note", uid: "u", text: "  パソコン売った‮ " }, 6); assert.equal(p.note, "パソコン売った");
  c.admin("boss", { op: "note", uid: "u", text: "" }, 7); assert.equal(p.note, undefined);
  nc(() => c.admin("boss", { op: "rename", uid: "u", name: "運営" }, 8), /使われてる/);
  c.admin("boss", { op: "rename", uid: "u", name: "北村さん" }, 9); assert.equal(p.name, "北村さん");
  nc(() => c.admin("boss", { op: "add", uid: "nobody", amount: 1 }, 10), /いない/);
  nc(() => c.admin("boss", { op: "add", uid: "u", amount: 1.5 }, 10), /数字/);
  nc(() => c.admin("boss", { op: "wipe", uid: "u" }, 10), /ない/);
  const log = c.admin("boss", { op: "log" }, 11).log;
  assert.equal(log.length, 8); assert.equal(log[0].by, "運営"); assert.match(log[0].what, /北村さん/);
  assert.deepEqual(c.view("meta"), { imported: false }, "the admin log is not broadcast");
});

test("High/Low options and the bank", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("a", "", "join", { name: "あ" }, 0);
  const a = () => c.d.players.a;
  nc(() => c.handle("a", "", "hlOpen", { dir: "high", amount: 1000, dur: 30 }, 1000), /止まって/);
  c.fxTick(1000);
  nc(() => c.handle("a", "", "hlOpen", { dir: "up", amount: 1000, dur: 30 }, 1500), /HIGH/);
  nc(() => c.handle("a", "", "hlOpen", { dir: "high", amount: 1000, dur: 45 }, 1500), /時間/);
  c.handle("a", "", "hlOpen", { dir: "high", amount: 1000, dur: 30 }, 1500);
  c.handle("a", "", "hlOpen", { dir: "low", amount: 1000, dur: 30 }, 1500);
  assert.equal(a().chips, 8000); assert.ok(c.hlPending());
  const entry = a().hl[0].entry;
  c.d.fx.price = entry; // force a known move: whatever the next tick does, exactly one of high/low wins unless it's flat
  c.fxTick(20_000); assert.equal(a().hl.length, 2, "not due yet");
  c.fxTick(31_500);
  assert.equal(a().hl.length, 0); assert.ok(!c.hlPending());
  const last = c.d.fx.price;
  assert.equal(a().chips, last === entry ? 8000 : 8000 + 2000, "one side wins x2.0, a flat price loses both");
  assert.equal(a().hlst.n, 2); assert.ok(a().ach.hl1);
  // bank
  nc(() => c.handle("a", "", "bank", { op: "deposit", amount: 1e9 }, 0), /足りない/);
  c.handle("a", "", "bank", { op: "deposit", amount: 5000 }, 100);
  assert.equal(a().bank, 5000); assert.ok(a().ach.bank1);
  c.handle("a", "", "bank", { op: "withdraw", amount: 1 }, 86400100); // one day later: 1% interest added first
  assert.equal(a().bank, 5049);
  nc(() => c.handle("a", "", "bank", { op: "withdraw", amount: 999999 }, 86400000), /預金/);
});

test("virtual football: bet, play, payout", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  c.handle("a", "", "join", { name: "あ" }, 0);
  let now = 5_000_000; c.step(now);
  const s = () => c.d.sp;
  assert.ok(s().match && s().match.odds.h > 1);
  assert.equal(c.view("sp").match.lh, undefined, "goal rates stay on the server");
  nc(() => c.handle("a", "", "spBets", { bets: { x: 100 }, round: 1 }, now), /ベット/);
  c.handle("a", "", "spBets", { bets: { h: 1000, d: 1000, a: 1000, o: 1000, u: 1000, by: 1000, bn: 1000 }, round: 1 }, now);
  assert.equal(c.d.players.a.chips, 3000);
  now += 30000; c.step(now); assert.equal(s().phase, "playing");
  nc(() => c.handle("a", "", "spBets", { bets: {}, round: 1 }, now), /締切/);
  now = s().endAt; c.step(now); assert.equal(s().phase, "result");
  const o = s().match.odds, [h, a] = s().score;
  const expect = 3000 + Math.floor(1000 * o[h > a ? "h" : h === a ? "d" : "a"]) + Math.floor(1000 * o[h + a >= 3 ? "o" : "u"]) + Math.floor(1000 * o[h && a ? "by" : "bn"]);
  assert.equal(c.d.players.a.chips, expect);
  assert.equal(s().ev.filter((e) => e.k === "goal").length, h + a);
  assert.ok(c.d.players.a.ach.sp1);
  now = s().holdUntil; c.step(now); assert.equal(s().round, 2);
});

test("poker: hand strength and side pots", async () => {
  const P = await import("../src/poker.js");
  const b = (s) => P.best(s.split(" "));
  assert.equal(b("AS KS QS JS TS 2D 3C").name, "ロイヤルストレートフラッシュ");
  assert.equal(b("5S 4D 3H 2C AS KD 9C").name, "ストレート");
  assert.ok(b("AS AD AH KC KD 2S 3S").s > b("AS AD AH KC QD 2S 3S").s, "full house beats trips");
  assert.ok(b("2S 3S 4S 5S 7S 9D 9C").s > b("9S 9D 9H 8C 7D 2S 3C").s, "flush beats trips");
  assert.equal(b("KS KD 7H 7C 2D 2S AS").name, "ツーペア");
  assert.ok(b("KS KD 7H 7C 2D 2S AS").s > b("KS KD 7H 7C 2D 2S QS").s, "kicker counts");
  // a short all-in can only win what it covered
  const won = P.splitPots({ a: 100, b: 500, c: 500 }, ["a", "b", "c"], { a: 9, b: 5, c: 1 }, ["a", "b", "c"]);
  assert.deepEqual(won, { a: 300, b: 800 });
  const split = P.splitPots({ a: 101, b: 101, c: 50 }, ["a", "b"], { a: 3, b: 3 }, ["b", "a"]);
  assert.equal(split.a + split.b, 252); assert.equal(split.b, 126);
});

test("poker: a full hand between three players", () => {
  const c = new Core(freshData());
  const nc = (fn, re) => assert.throws(fn, (e) => e.constructor.name === "GameError" && (!re || re.test(e.message)));
  for (const u of ["a", "b", "x"]) { c.handle(u, "", "join", { name: u }, 0); c.d.players[u].chips = 1_000_000; }
  nc(() => c.handle("a", "", "pkSit", { seat: 0, buyin: 100000 }, 0), /レート/);
  c.handle("a", "", "pkSit", { seat: 0, buyin: 100000, stake: 0 }, 0);
  nc(() => c.handle("b", "", "pkSit", { seat: 0, buyin: 100000 }, 0), /埋まって/);
  nc(() => c.handle("b", "", "pkSit", { seat: 1, buyin: 1000 }, 0), /持ち込み/);
  c.handle("b", "", "pkSit", { seat: 1, buyin: 100000 }, 0);
  c.handle("x", "", "pkSit", { seat: 3, buyin: 40000 }, 0);
  const t = () => c.d.pk, h = () => c.d.pk.hand;
  let now = 3000; c.step(now);
  assert.ok(h(), "hand starts after the pause");
  assert.equal(c.view("pk").hand.shown && Object.keys(c.view("pk").hand.shown).length, 0, "nobody's cards are public");
  assert.equal(c.pkMine("a").cards.length, 2);
  // button seat 0 (a), sb b, bb x; a acts first
  assert.equal(h().toAct, "a");
  nc(() => c.handle("b", "", "pkAct", { act: "call" }, now), /番じゃない/);
  nc(() => c.handle("a", "", "pkAct", { act: "check" }, now), /チェックできない/);
  nc(() => c.handle("a", "", "pkAct", { act: "raise", amount: 300 }, now), /最低/);
  c.handle("a", "", "pkAct", { act: "raise", amount: 6000 }, now);
  c.handle("b", "", "pkAct", { act: "call" }, now);
  c.handle("x", "", "pkAct", { act: "allin" }, now);       // x shoves 40000
  c.handle("a", "", "pkAct", { act: "call" }, now);
  c.handle("b", "", "pkAct", { act: "fold" }, now);
  // a and x: x is all-in, so the board runs out and it goes to showdown
  assert.equal(h().phase, "showdown"); assert.equal(h().board.length, 5);
  const total = Object.values(t().stacks).reduce((s, v) => s + v, 0);
  assert.equal(total, 240000, "no chips created or lost");
  assert.ok(Object.keys(h().shown).length === 2);
  now = h().endsAt; c.step(now);
  assert.equal(h(), null);
  const chipsNow = ["a", "b", "x"].reduce((s, u) => s + c.d.players[u].chips + (t().stacks[u] || 0), 0);
  assert.equal(chipsNow, 3_000_000, "everyone's chips + stacks add up");
  assert.ok(c.d.players.a.ach.pk1 && c.d.players.a.pkst.n === 1);
  // timeouts fold and sit you out
  now += 3000; c.step(now);
  if (h()) { const u = h().toAct; now = h().turnEndsAt; c.step(now); assert.ok(t().away[u]); }
  c.handle("b", "", "pkLeave", {}, now);
  for (let i = 0; i < 60 && t().seats.includes("b"); i++) { now += 21000; c.step(now); }
  assert.equal(t().seats.indexOf("b"), -1, "left the table");
  const settled = !h() || h().phase === "showdown" || h().phase === "done";
  const sum = ["a", "b", "x"].reduce((s, u) => s + c.d.players[u].chips + (t().stacks[u] || 0) + (!settled && h().contrib[u] || 0), 0);
  assert.equal(sum, 3_000_000, "chips are only ever moved, never made");
});
