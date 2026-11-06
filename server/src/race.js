// Horse racing. Each race has 8 made-up horses. Odds come from a quick simulation of the same race model;
// the real race is then run once with crypto randomness when betting closes, and its positions are sent to
// clients as a script so everyone sees the same race.
import { randomInt } from "./game.js";

export const RC = {
  HORSES: 8,
  BET_MS: 30000,
  WIN_MS: 17000,      // the winner crosses the line about this long after the start
  HOLD_MS: 9000,      // result stays up before the next race
  IDLE_LIMIT: 2,      // races with no bets before the track pauses
  MIN_BET: 100,
  MAX_BET: 100_000_000_000_000,
  SEG: 30,            // the race is simulated in 30 legs
  PAYBACK: 0.9,       // fixed odds pay back about 90% on average (a real track keeps 20-30%)
  SIMS: 3000,
};
export const FRAME_COLORS = ["#f4f4f4", "#1d1d1f", "#d7263d", "#2a62d6", "#f2c14e", "#2e9e5b", "#f28c28", "#f06aa8"];
const NAMES = [
  "クリクンフィッシュ", "バンカーマスター", "ロスカットボーイ", "タイノカミサマ", "ナチュラルナイン", "オールインドリーム",
  "シャクキンオウ", "カタガワリ", "ダブルダウン", "ヒットオアスタンド", "ゴールドフレーム", "ニジイロノハネ",
  "レバレッジヒャク", "テンバガー", "スプレッドキング", "ヨルフカシ", "ハヤオキサン", "コレクターズアイ",
  "ミントノフキダシ", "ハッカーズドリーム", "サクラフブキ", "イナズマステップ", "ギンガテイオウ", "ホログラムキッド",
  "ダイヤモンドラン", "カジノロワイヤル", "ラッキーセブン", "ペアハンター", "ディーラーナカセ", "ブラックジャッカー",
  "オクリビト", "ハサンスンゼン", "スポンサーサマ", "ゴーゴーバンカー", "プレイヤーワン", "ミラクルタイ",
  "フクショウボーイ", "タンショウクイーン", "アナウマハンター", "テッパンホンメイ",
];

const rand01 = () => (randomInt(0x40000000) + 0.5) / 0x40000000;
const gaussWith = (u) => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
const mathU = () => Math.random() || 0.5;

/** Run the race model once. h: [{s, e}], u: uniform random source. Returns per-horse positions per leg and finish times. */
export function simulate(h, u = rand01) {
  const n = h.length, pos = h.map(() => [0]), fin = new Array(n).fill(0);
  const cond = h.map(() => 1 + 0.025 * gaussWith(u)); // today's form
  for (let j = 0; j < RC.SEG + 12 && fin.some((f) => !f); j++) {
    const late = j >= RC.SEG / 2;
    for (let i = 0; i < n; i++) {
      const prev = pos[i][pos[i].length - 1];
      const style = late ? 2 - h[i].e : h[i].e;
      const v = (h[i].s * cond[i] * style * (1 + 0.07 * gaussWith(u))) / RC.SEG;
      const next = prev + Math.max(v, 0.2 / RC.SEG);
      if (!fin[i] && next >= 1) fin[i] = j + (1 - prev) / (next - prev);
      pos[i].push(next);
    }
  }
  for (let i = 0; i < n; i++) if (!fin[i]) fin[i] = pos[i].length + 1; // never happens in practice
  const order = [...fin.keys()].sort((a, b) => fin[a] - fin[b]);
  return { pos, fin, order };
}

/** A fresh race card: horses, strengths, and odds from many quick simulations. */
export function newRace(round, now) {
  const pool = [...NAMES], horses = [];
  for (let i = 0; i < RC.HORSES; i++) {
    const name = pool.splice(randomInt(pool.length), 1)[0];
    horses.push({ n: i + 1, name, s: 0.975 + 0.05 * rand01(), e: 0.93 + 0.14 * rand01() });
  }
  const win = new Array(RC.HORSES).fill(0), top3 = new Array(RC.HORSES).fill(0);
  for (let k = 0; k < RC.SIMS; k++) {
    const { order } = simulate(horses, mathU);
    win[order[0]]++; for (let q = 0; q < 3; q++) top3[order[q]]++;
  }
  const odds = (c) => Math.min(999.9, Math.max(1.1, Math.floor((RC.PAYBACK / Math.max(c / RC.SIMS, 0.0005)) * 10) / 10));
  horses.forEach((x, i) => { x.odds = odds(win[i]); x.podds = Math.min(99.9, odds(top3[i])); });
  const byOdds = [...horses].sort((a, b) => a.odds - b.odds);
  byOdds.forEach((x, i) => { x.pop = i + 1; });
  return { round, horses, createdAt: now };
}

/** Bets look like {"w3": 1000, "p5": 500}: w = win (単勝), p = place (複勝, top 3). */
export function cleanBets(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw "invalid";
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!/^[wp][1-8]$/.test(k)) throw "invalid-key";
    if (!Number.isSafeInteger(v) || v < 0 || v > RC.MAX_BET) throw "invalid-amount";
    if (v > 0 && v < RC.MIN_BET) throw "too-small";
    if (v > 0) out[k] = v;
  }
  return out;
}
export const sumBets = (b) => Object.values(b || {}).reduce((a, v) => a + v, 0);

/** Chips returned for a set of bets given the finishing order (0-based horse indexes). */
export function payout(bets, horses, order) {
  let ret = 0;
  for (const [k, v] of Object.entries(bets)) {
    const i = +k.slice(1) - 1, place = order.indexOf(i);
    if (k[0] === "w" && place === 0) ret += Math.floor(v * horses[i].odds);
    if (k[0] === "p" && place >= 0 && place < 3) ret += Math.floor(v * horses[i].podds);
  }
  return ret;
}
