const test = require("node:test");
const assert = require("node:assert");
const G = require("../game");

// dealCoup draws from the END of the shoe string, in the order P1, B1, P2, B2, P3, B3.
const shoeOf = (...cards) => "XX".repeat(10) + cards.reverse().join("");

test("natural stops the coup", () => {
  const c = G.dealCoup(shoeOf("8S", "2H", "KD", "3C", "5S", "5D"));
  assert.deepStrictEqual(c.P, ["8S", "KD"]);
  assert.deepStrictEqual(c.B, ["2H", "3C"]);
  assert.strictEqual(c.res.w, "P");
});

test("player draws on 0-5, banker 3 does not draw when player third is 8", () => {
  const c = G.dealCoup(shoeOf("2S", "KH", "3D", "3C", "8S", "9D"));
  assert.strictEqual(c.P.length, 3);
  assert.strictEqual(c.B.length, 2);
  assert.strictEqual(c.res.pt, 3); // 2+3+8 = 13
  assert.strictEqual(c.res.bt, 3);
  assert.strictEqual(c.res.w, "T");
});

test("banker 6 draws on player third 6 or 7", () => {
  const c = G.dealCoup(shoeOf("AS", "4H", "4D", "2C", "6S", "QD"));
  assert.strictEqual(c.B.length, 3);
  const c2 = G.dealCoup(shoeOf("AS", "4H", "4D", "2C", "5S", "QD"));
  assert.strictEqual(c2.B.length, 2);
});

test("player stands on 6, banker draws on 0-5", () => {
  const c = G.dealCoup(shoeOf("6S", "AH", "KD", "4C", "9S", "9D"));
  assert.strictEqual(c.P.length, 2);
  assert.deepStrictEqual(c.B, ["AH", "4C", "9S"]);
});

test("pairs", () => {
  const c = G.dealCoup(shoeOf("7S", "QH", "7D", "QC", "AS", "AD"));
  assert.ok(c.res.pp && c.res.bp);
});

test("payouts", () => {
  const b = { ppair: 100, player: 1000, tie: 100, banker: 2000, bpair: 0 };
  assert.strictEqual(G.payout(b, { w: "P", pp: false, bp: false }), 2000);
  assert.strictEqual(G.payout(b, { w: "B", pp: false, bp: false }), 2000 + 1900);
  assert.strictEqual(G.payout(b, { w: "T", pp: true, bp: false }), 900 + 1000 + 2000 + 1200);
});

test("bet validation rejects bad input", () => {
  assert.throws(() => G.cleanBets({ player: -1 }));
  assert.throws(() => G.cleanBets({ player: 1.5 }));
  assert.throws(() => G.cleanBets({ hacker: 10 }));
  assert.throws(() => G.cleanBets({ player: "100" }));
  assert.throws(() => G.cleanBets([1, 2]));
  assert.deepStrictEqual(G.cleanBets({ banker: 500 }), { ppair: 0, player: 0, tie: 0, banker: 500, bpair: 0 });
});

test("names", () => {
  assert.strictEqual(G.cleanName("  くり  "), "くり");
  assert.throws(() => G.cleanName(""));
  assert.throws(() => G.cleanName("あ".repeat(13)));
  assert.strictEqual(G.cleanName("<b>x</b>"), "bx/b");
});

test("shoe has 416 unique-position cards", () => {
  const s = G.newShoe();
  assert.strictEqual(s.length, 832);
  const counts = {};
  for (let i = 0; i < s.length; i += 2) counts[s.slice(i, i + 2)] = (counts[s.slice(i, i + 2)] || 0) + 1;
  assert.strictEqual(Object.keys(counts).length, 52);
  assert.ok(Object.values(counts).every((n) => n === 8));
});
