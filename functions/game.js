// Pure game logic shared by the Cloud Functions and the tests. No Firebase imports here.
const crypto = require("node:crypto");

const START = 10000;          // chips every new player starts with
const BET_MS = 15000;         // betting window
const HOLD_MS = 4500;         // how long the result stays on screen after the deal animation
const IDLE_LIMIT = 3;         // rounds with no bets before the table pauses
const MAX_SPOT = 10_000_000;  // max chips on one spot
const MAX_DEPOSIT = 1_000_000;
const SPOTS = ["ppair", "player", "tie", "banker", "bpair"];
const RK = "A23456789TJQK";

const emptyBets = () => ({ ppair: 0, player: 0, tie: 0, banker: 0, bpair: 0 });
const sum = (b) => SPOTS.reduce((a, k) => a + (b && b[k] ? b[k] : 0), 0);
const cv = (c) => { const i = RK.indexOf(c[0]); return i >= 9 ? 0 : i + 1; };
const tot = (h) => h.reduce((a, c) => a + cv(c), 0) % 10;

/** 8-deck shoe as one string of 2-char cards, shuffled with a CSPRNG. */
function newShoe() {
  const a = [];
  for (let d = 0; d < 8; d++) for (const s of "SHDC") for (const r of RK) a.push(r + s);
  for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join("");
}

/** Deal one coup from the shoe string using the standard tableau. Returns the hands and the rest of the shoe. */
function dealCoup(shoe) {
  let s = shoe;
  const draw = () => { const c = s.slice(-2); s = s.slice(0, -2); return c; };
  const P = [draw()], B = [draw()];
  P.push(draw()); B.push(draw());
  let pT = tot(P), bT = tot(B);
  if (pT < 8 && bT < 8) {
    let p3 = null;
    if (pT <= 5) { p3 = draw(); P.push(p3); }
    let bDraw;
    if (p3 === null) bDraw = bT <= 5;
    else {
      const v = cv(p3);
      bDraw = bT <= 2 || (bT === 3 && v !== 8) || (bT === 4 && v >= 2 && v <= 7) ||
        (bT === 5 && v >= 4 && v <= 7) || (bT === 6 && (v === 6 || v === 7));
    }
    if (bDraw) B.push(draw());
  }
  pT = tot(P); bT = tot(B);
  const w = pT > bT ? "P" : bT > pT ? "B" : "T";
  return { P, B, shoe: s, res: { w, pt: pT, bt: bT, pp: P[0][0] === P[1][0], bp: B[0][0] === B[1][0] } };
}

/** Total returned to the player (stake included) for a bet set against a result. */
function payout(b, r) {
  let ret = 0;
  if (r.w === "P") ret += b.player * 2;
  if (r.w === "B") ret += b.banker + Math.floor(b.banker * 0.95);
  if (r.w === "T") ret += b.tie * 9 + b.player + b.banker;
  if (r.pp) ret += b.ppair * 12;
  if (r.bp) ret += b.bpair * 12;
  return ret;
}

/** Length of the client's deal animation; the server waits this long (plus HOLD_MS) before the next round. Keep in sync with web/app.js. */
function animMs(P, B) {
  const p = P.length, b = B.length;
  const nat = p === 2 && b === 2 && (tot(P) >= 8 || tot(B) >= 8);
  return 200 + 4 * 860 + 250 + 4 * 740 + (nat ? 700 : 0) + (p - 2 + b - 2) * 3300 + 400;
}

/** Validate a full desired bet set coming from a client. Throws a string reason on failure. */
function cleanBets(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw "invalid-bets";
  const out = emptyBets();
  for (const k of Object.keys(input)) if (!SPOTS.includes(k)) throw "invalid-spot";
  for (const k of SPOTS) {
    const v = input[k] ?? 0;
    if (!Number.isSafeInteger(v) || v < 0 || v > MAX_SPOT) throw "invalid-amount";
    out[k] = v;
  }
  return out;
}

function cleanName(n) {
  if (typeof n !== "string") throw "invalid-name";
  const s = n.normalize("NFKC").replace(/[\u0000-\u001f\u007f<>]/g, "").trim();
  if (s.length < 1 || [...s].length > 12) throw "invalid-name";
  return s;
}

module.exports = { START, BET_MS, HOLD_MS, IDLE_LIMIT, MAX_SPOT, MAX_DEPOSIT, SPOTS, emptyBets, sum, cv, tot, newShoe, dealCoup, payout, animMs, cleanBets, cleanName };
