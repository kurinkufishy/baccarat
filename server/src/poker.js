// Texas Hold'em helpers: deck, hand strength, and splitting pots at showdown. Table flow lives in core.js.
import { randomInt } from "./game.js";

export const PK = {
  SEATS: 6,
  STAKES: [[100, 200], [10_000, 20_000], [1_000_000, 2_000_000], [100_000_000, 200_000_000], [10_000_000_000, 20_000_000_000]],
  MIN_BB: 20, MAX_BB: 500,   // buy-in range in big blinds
  TURN_MS: 20000,
  START_MS: 3000,            // pause before a new hand
  SHOW_MS: 6500,             // showdown stays up this long
  WIN_MS: 3000,              // everyone else folded
};
const RK = "23456789TJQKA";
export const HAND_NAMES = ["ハイカード", "ワンペア", "ツーペア", "スリーカード", "ストレート", "フラッシュ", "フルハウス", "フォーカード", "ストレートフラッシュ"];

export function newDeck() {
  const a = [];
  for (const s of "SHDC") for (const r of RK) a.push(r + s);
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Score of exactly 5 cards: higher is better. */
function score5(cs) {
  const r = cs.map((c) => RK.indexOf(c[0])).sort((a, b) => b - a);
  const flush = cs.every((c) => c[1] === cs[0][1]);
  const uniq = [...new Set(r)];
  let straightHi = -1;
  if (uniq.length === 5) {
    if (r[0] - r[4] === 4) straightHi = r[0];
    else if (r[0] === 12 && r[1] === 3) straightHi = 3; // A-2-3-4-5
  }
  const cnt = {}; for (const x of r) cnt[x] = (cnt[x] || 0) + 1;
  const groups = Object.entries(cnt).map(([k, v]) => [v, +k]).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  let cat, tb;
  if (straightHi >= 0 && flush) { cat = 8; tb = [straightHi]; }
  else if (groups[0][0] === 4) { cat = 7; tb = [groups[0][1], groups[1][1]]; }
  else if (groups[0][0] === 3 && groups[1][0] === 2) { cat = 6; tb = [groups[0][1], groups[1][1]]; }
  else if (flush) { cat = 5; tb = r; }
  else if (straightHi >= 0) { cat = 4; tb = [straightHi]; }
  else if (groups[0][0] === 3) { cat = 3; tb = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2 && groups[1][0] === 2) { cat = 2; tb = groups.map((g) => g[1]); }
  else if (groups[0][0] === 2) { cat = 1; tb = groups.map((g) => g[1]); }
  else { cat = 0; tb = r; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (tb[i] ?? 0);
  return { s, cat };
}

/** Best 5 of up to 7 cards. Returns {s, cat, name, best}. */
export function best(cards) {
  let top = null;
  const n = cards.length;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    const five = cards.filter((_, i) => i !== a && i !== b);
    if (five.length !== 5) continue;
    const v = score5(five);
    if (!top || v.s > top.s) top = { ...v, best: five };
  }
  if (!top && n === 5) top = { ...score5(cards), best: cards };
  const royal = top.cat === 8 && top.best.some((c) => c[0] === "A") && top.best.some((c) => c[0] === "K");
  return { ...top, name: royal ? "ロイヤルストレートフラッシュ" : HAND_NAMES[top.cat], royal };
}

/**
 * Split everything put in this hand. contrib: {uid: chips put in}, live: uids still in, scores: {uid: score},
 * order: uids from the first seat left of the button (odd chips go to the earliest winner).
 * Returns {uid: chips won}.
 */
export function splitPots(contrib, live, scores, order) {
  const won = {};
  const levels = [...new Set(live.map((u) => contrib[u] || 0))].filter((v) => v > 0).sort((a, b) => a - b);
  let prev = 0;
  const all = Object.keys(contrib);
  levels.forEach((lv, li) => {
    let pot = 0;
    for (const u of all) pot += Math.max(0, Math.min(contrib[u] || 0, lv) - prev);
    if (li === levels.length - 1) for (const u of all) pot += Math.max(0, (contrib[u] || 0) - lv); // folded money above the top level
    const elig = live.filter((u) => (contrib[u] || 0) >= lv);
    const top = Math.max(...elig.map((u) => scores[u]));
    const winners = order.filter((u) => elig.includes(u) && scores[u] === top);
    const share = Math.floor(pot / winners.length);
    let rest = pot - share * winners.length;
    for (const u of winners) { won[u] = (won[u] || 0) + share + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
    prev = lv;
  });
  return won;
}
