// Virtual football. Two made-up teams per match; odds come straight from a Poisson goal model, and the match itself
// is played minute by minute with crypto randomness after betting closes, then sent to clients as a script.
import { randomInt } from "./game.js";

export const SP = {
  BET_MS: 30000,
  PLAY_MS: 45000,      // 90 minutes shown in 45 seconds
  HOLD_MS: 9000,
  IDLE_LIMIT: 2,
  MIN_BET: 100,
  MAX_BET: 100_000_000_000_000,
  MARGIN: 0.93,        // odds pay back about 93%
  BASE: 1.35,          // average goals per team per match
};
export const TEAMS = [
  { name: "クリクンFC", c1: "#1f6fe0", c2: "#ffffff" }, { name: "バンカーズ大阪", c1: "#d7263d", c2: "#1d1d1f" },
  { name: "ロスカット東京", c1: "#111827", c2: "#f2c14e" }, { name: "ナチュラル福岡", c1: "#2e9e5b", c2: "#ffffff" },
  { name: "オールイン名古屋", c1: "#f28c28", c2: "#1d1d1f" }, { name: "レバレッジ横浜", c1: "#6d28d9", c2: "#ffffff" },
  { name: "テンバガー札幌", c1: "#e11d74", c2: "#ffffff" }, { name: "スプレッド神戸", c1: "#0ea5a4", c2: "#0b1220" },
  { name: "ペアハンターズ", c1: "#fde047", c2: "#1d1d1f" }, { name: "ダブルダウン京都", c1: "#7f1d1d", c2: "#fcd34d" },
  { name: "ハイロー仙台", c1: "#22c55e", c2: "#052e16" }, { name: "フクショウ広島", c1: "#9333ea", c2: "#fde68a" },
  { name: "シャクキン千葉", c1: "#64748b", c2: "#ffffff" }, { name: "ディーラー鹿島", c1: "#b91c1c", c2: "#ffffff" },
  { name: "ギャラクシー湘南", c1: "#1e3a8a", c2: "#93c5fd" }, { name: "ミラクル那覇", c1: "#06b6d4", c2: "#ffffff" },
];

const rand01 = () => (randomInt(0x40000000) + 0.5) / 0x40000000;
const pois = (l, k) => { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; };
const odds = (p) => Math.min(50, Math.max(1.01, Math.floor((SP.MARGIN / Math.max(p, 0.001)) * 100) / 100));

/** Markets: h/d/a = result (1X2), o/u = over/under 2.5 goals, by/bn = both teams score yes/no. */
export const KEYS = ["h", "d", "a", "o", "u", "by", "bn"];

export function newMatch(round, now) {
  const i = randomInt(TEAMS.length);
  let j = randomInt(TEAMS.length - 1); if (j >= i) j++;
  const strength = () => 0.75 + 0.5 * rand01(); // 0.75..1.25
  const home = { ...TEAMS[i], att: strength(), def: strength() }, away = { ...TEAMS[j], att: strength(), def: strength() };
  const lh = SP.BASE * home.att / away.def * 1.1, la = SP.BASE * away.att / home.def;
  let ph = 0, pd = 0, pa = 0, po = 0, pby = 0;
  for (let x = 0; x <= 12; x++) for (let y = 0; y <= 12; y++) {
    const q = pois(lh, x) * pois(la, y);
    if (x > y) ph += q; else if (x === y) pd += q; else pa += q;
    if (x + y >= 3) po += q;
    if (x > 0 && y > 0) pby += q;
  }
  const o = { h: odds(ph), d: odds(pd), a: odds(pa), o: odds(po), u: odds(1 - po), by: odds(pby), bn: odds(1 - pby) };
  return { round, home: { name: home.name, c1: home.c1, c2: home.c2 }, away: { name: away.name, c1: away.c1, c2: away.c2 }, lh, la, odds: o, createdAt: now };
}

/** Play the 90 minutes. Returns goal and chance events: [{m, s: 0 home | 1 away, k: "goal" | "chance"}]. */
export function play(match, u = rand01) {
  const ev = [];
  for (let m = 1; m <= 90; m++) {
    for (const [s, l] of [[0, match.lh], [1, match.la]]) {
      const r = u();
      if (r < l / 90) ev.push({ m, s, k: "goal" });
      else if (r < (l / 90) * 4) ev.push({ m, s, k: "chance" });
    }
  }
  const score = [ev.filter((e) => e.k === "goal" && e.s === 0).length, ev.filter((e) => e.k === "goal" && e.s === 1).length];
  return { ev, score };
}

export function cleanBets(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw "invalid";
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!KEYS.includes(k)) throw "invalid-key";
    if (!Number.isSafeInteger(v) || v < 0 || v > SP.MAX_BET) throw "invalid-amount";
    if (v > 0 && v < SP.MIN_BET) throw "too-small";
    if (v > 0) out[k] = v;
  }
  return out;
}
export const sumBets = (b) => Object.values(b || {}).reduce((a, v) => a + v, 0);

/** Which bets won for a final score. */
export function winners(score) {
  const [h, a] = score, w = new Set();
  w.add(h > a ? "h" : h === a ? "d" : "a");
  w.add(h + a >= 3 ? "o" : "u");
  w.add(h > 0 && a > 0 ? "by" : "bn");
  return w;
}
export function payout(bets, odds, score) {
  const w = winners(score);
  let ret = 0;
  for (const [k, v] of Object.entries(bets)) if (w.has(k)) ret += Math.floor(v * odds[k]);
  return ret;
}
