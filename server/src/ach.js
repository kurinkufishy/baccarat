// Achievements. The list is sent to clients as-is (they only draw it); unlocking happens only here on the server.
// tier: 1 bronze, 2 silver, 3 gold. secret: the description stays hidden until it's unlocked.
export const ACH = [
  { id: "bac1", tier: 1, name: "はじめの一歩", desc: "バカラで初めて勝負する" },
  { id: "bac100", tier: 2, name: "常連さん", desc: "バカラを100ゲーム遊ぶ" },
  { id: "bac1000", tier: 3, name: "バカラの住人", desc: "バカラを1,000ゲーム遊ぶ" },
  { id: "pair", tier: 1, name: "ペア的中", desc: "Pペア か Bペア を当てる" },
  { id: "tie", tier: 2, name: "引き分けの神", desc: "タイを当てる" },
  { id: "dpair", tier: 3, name: "ダブルペア", desc: "Pペア と Bペア を同時に当てる", secret: true },
  { id: "nat", tier: 1, name: "ナチュラル", desc: "2枚で9のナチュラルに賭けて勝つ" },
  { id: "streak5", tier: 2, name: "5連勝", desc: "バカラで5回続けて勝つ" },
  { id: "streak10", tier: 3, name: "10連勝", desc: "バカラで10回続けて勝つ" },
  { id: "lose10", tier: 2, name: "どん底", desc: "バカラで10回続けて負ける" },
  { id: "bj1", tier: 1, name: "ディーラーに挑戦", desc: "ブラックジャックで初めて勝負する" },
  { id: "bjbj", tier: 1, name: "ブラックジャック！", desc: "最初の2枚で21を出す" },
  { id: "bjdbl", tier: 1, name: "倍プッシュ", desc: "ダブルして勝つ" },
  { id: "bj100", tier: 2, name: "カードカウンター", desc: "ブラックジャックを100ゲーム遊ぶ" },
  { id: "bjstreak5", tier: 2, name: "ディーラー泣かせ", desc: "ブラックジャックで5回続けて勝つ" },
  { id: "bj5", tier: 3, name: "ファイブカード", desc: "5枚以上で21を作る", secret: true },
  { id: "win1m", tier: 1, name: "ミリオネア", desc: "1回のゲームで +1,000,000 勝つ" },
  { id: "win100m", tier: 2, name: "億り人", desc: "1回のゲームで +100,000,000 勝つ" },
  { id: "win10b", tier: 3, name: "伝説の一撃", desc: "1回のゲームで +10,000,000,000 勝つ" },
  { id: "lose100m", tier: 2, name: "大爆死", desc: "1回のゲームで 100,000,000 負ける" },
  { id: "allin", tier: 2, name: "オールイン", desc: "残高を全部賭けて勝つ" },
  { id: "broke", tier: 1, name: "すっからかん", desc: "残高を全部賭けて負ける", secret: true },
  { id: "rich1b", tier: 2, name: "10億長者", desc: "残高を 1,000,000,000 にする" },
  { id: "rich1t", tier: 3, name: "1兆長者", desc: "残高を 1,000,000,000,000 にする" },
  { id: "debt1b", tier: 2, name: "借金王", desc: "借金が 1,000,000,000 をこえる" },
  { id: "clean", tier: 1, name: "完済", desc: "借金を全部返す" },
  { id: "give", tier: 1, name: "太っ腹", desc: "友達にチップをあげる" },
  { id: "help", tier: 1, name: "救世主", desc: "友達の借金を肩代わりする" },
  { id: "chat", tier: 1, name: "おしゃべり", desc: "チャットで発言する" },
  { id: "rename", tier: 1, name: "改名", desc: "名前を変える" },
];
const IDS = new Set(ACH.map((a) => a.id));

/** Unlock one achievement. Returns true if it was new. */
export function unlock(p, id, now) {
  if (!IDS.has(id)) return false;
  p.ach = p.ach || {};
  if (p.ach[id]) return false;
  p.ach[id] = now;
  return true;
}

/** Achievements that follow from a player's totals. Safe to run any time; also catches up older players. */
export function checkTotals(p, now) {
  const st = p.st || {}, bj = p.bjst || {};
  const on = (cond, id) => { if (cond) unlock(p, id, now); };
  on(st.n >= 1, "bac1"); on(st.n >= 100, "bac100"); on(st.n >= 1000, "bac1000");
  on(bj.n >= 1, "bj1"); on(bj.n >= 100, "bj100");
  on(p.chips >= 1e9, "rich1b"); on(p.chips >= 1e12, "rich1t");
  on((p.dep || 0) >= 1e9, "debt1b");
}

/** One settled game. d = chips won (+) or lost (-); allIn = nothing was left off the table. */
export function checkResult(p, d, allIn, now) {
  if (d >= 1e6) unlock(p, "win1m", now);
  if (d >= 1e8) unlock(p, "win100m", now);
  if (d >= 1e10) unlock(p, "win10b", now);
  if (d <= -1e8) unlock(p, "lose100m", now);
  if (allIn && d > 0) unlock(p, "allin", now);
  if (allIn && d < 0) unlock(p, "broke", now);
}

/** Win/loss streak per game: positive = wins in a row, negative = losses. Pushes leave it alone. */
export function streak(p, key, d) {
  p.ax = p.ax || {};
  const s = p.ax[key] || 0;
  if (d > 0) p.ax[key] = s > 0 ? s + 1 : 1;
  else if (d < 0) p.ax[key] = s < 0 ? s - 1 : -1;
  return p.ax[key];
}

// Avatar frames. Unlocked by achievements; the same req data is sent to clients so they can show what's left.
// req: {count: n} n achievements, {gold: n} n gold-tier achievements, {ach: id} that one achievement.
export const FRAMES = [
  { id: "bronze", name: "ブロンズ", req: { count: 3 }, how: "実績を3個解除" },
  { id: "silver", name: "シルバー", req: { count: 8 }, how: "実績を8個解除" },
  { id: "sakura", name: "さくら", req: { ach: "give" }, how: "実績「太っ腹」を解除" },
  { id: "gold", name: "ゴールド", req: { gold: 1 }, how: "ゴールド実績を1個解除" },
  { id: "fire", name: "炎", req: { ach: "lose100m" }, how: "実績「大爆死」を解除" },
  { id: "neon", name: "ネオン", req: { count: 12 }, how: "実績を12個解除" },
  { id: "rainbow", name: "虹色", req: { count: 15 }, how: "実績を15個解除" },
  { id: "diamond", name: "ダイヤ", req: { ach: "rich1t" }, how: "実績「1兆長者」を解除" },
];
const TIER_OF = Object.fromEntries(ACH.map((a) => [a.id, a.tier]));
export function frameOk(p, f) {
  const got = Object.keys(p.ach || {}).filter((id) => TIER_OF[id]);
  if (f.req.count) return got.length >= f.req.count;
  if (f.req.gold) return got.filter((id) => TIER_OF[id] === 3).length >= f.req.gold;
  if (f.req.ach) return got.includes(f.req.ach);
  return false;
}
