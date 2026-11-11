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
  { id: "pair10", tier: 2, name: "ペアハンター", desc: "ペアを合計10回当てる" },
  { id: "tie5", tier: 3, name: "タイマスター", desc: "タイを合計5回当てる" },
  { id: "tie2", tier: 3, name: "奇跡", desc: "2ゲーム続けてタイを当てる", secret: true },
  { id: "bigtie", tier: 3, name: "大穴的中", desc: "タイに 100,000,000 以上賭けて当てる" },
  { id: "lucky777", tier: 2, name: "ラッキー777", desc: "ゲーム番号の下3桁が777のゲームで勝つ", secret: true },
  { id: "bj1", tier: 1, name: "ディーラーに挑戦", desc: "ブラックジャックで初めて勝負する" },
  { id: "bjbj", tier: 1, name: "ブラックジャック！", desc: "最初の2枚で21を出す" },
  { id: "bjdbl", tier: 1, name: "倍プッシュ", desc: "ダブルして勝つ" },
  { id: "bj100", tier: 2, name: "カードカウンター", desc: "ブラックジャックを100ゲーム遊ぶ" },
  { id: "bjstreak5", tier: 2, name: "ディーラー泣かせ", desc: "ブラックジャックで5回続けて勝つ" },
  { id: "bj5", tier: 3, name: "ファイブカード", desc: "5枚以上で21を作る", secret: true },
  { id: "bj21", tier: 1, name: "ぴったり21", desc: "3枚以上で21を作る" },
  { id: "dbust", tier: 1, name: "自滅待ち", desc: "ディーラーがバーストして勝つ" },
  { id: "bjpush", tier: 2, name: "相打ち", desc: "ブラックジャック同士で引き分ける", secret: true },
  { id: "dblfail", tier: 1, name: "倍プッシュ失敗", desc: "ダブルして負ける", secret: true },
  { id: "bust20", tier: 1, name: "突撃隊長", desc: "バーストを合計20回する" },
  { id: "bjstreak10", tier: 3, name: "ディーラー殺し", desc: "ブラックジャックで10回続けて勝つ" },
  { id: "bj500", tier: 3, name: "ブラックジャックの主", desc: "ブラックジャックを500ゲーム遊ぶ" },
  { id: "both", tier: 1, name: "二刀流", desc: "バカラとブラックジャックの両方で勝負する" },
  { id: "rc1", tier: 1, name: "はじめての馬券", desc: "競馬で初めて馬券を買う" },
  { id: "rcfav", tier: 1, name: "鉄板", desc: "1番人気の単勝を当てる" },
  { id: "rcall", tier: 1, name: "全頭買い", desc: "8頭すべての単勝を買う", secret: true },
  { id: "rc100", tier: 2, name: "競馬通", desc: "競馬で100レース賭ける" },
  { id: "rclong", tier: 3, name: "大穴", desc: "単勝20倍以上の馬を当てる" },
  { id: "fx1", tier: 1, name: "はじめてのFX", desc: "FXで初めて決済する" },
  { id: "fxlev", tier: 1, name: "ハイレバ", desc: "レバレッジ100倍で勝つ" },
  { id: "fxliq", tier: 1, name: "強制ロスカット", desc: "ロスカットされる", secret: true },
  { id: "fx100", tier: 2, name: "トレーダー", desc: "FXで100回決済する" },
  { id: "fxshort", tier: 2, name: "空売りの達人", desc: "売りで合計10回勝つ" },
  { id: "sp1", tier: 1, name: "キックオフ", desc: "スポーツベットで初めて賭ける" },
  { id: "spdraw", tier: 1, name: "引き分け職人", desc: "引き分けを当てる" },
  { id: "spupset", tier: 2, name: "番狂わせ", desc: "オッズ5倍以上のチームの勝ちを当てる" },
  { id: "sp100", tier: 2, name: "サポーター", desc: "スポーツベットで100試合賭ける" },
  { id: "spgoals", tier: 3, name: "ゴールラッシュ", desc: "7点以上入った試合でオーバーを当てる", secret: true },
  { id: "hl1", tier: 1, name: "ハイロー入門", desc: "ハイローで初めて勝負する" },
  { id: "hlstreak5", tier: 2, name: "未来が見える", desc: "ハイローで5回続けて当てる" },
  { id: "hl100", tier: 2, name: "ハイロー中毒", desc: "ハイローを100回する" },
  { id: "bank1", tier: 1, name: "はじめての貯金", desc: "銀行にチップを預ける" },
  { id: "bank1t", tier: 3, name: "大口預金者", desc: "預金を 1,000,000,000,000 にする" },
  { id: "fx10x", tier: 3, name: "テンバガー", desc: "1回のトレードで証拠金の10倍以上もうける" },
  { id: "win1m", tier: 1, name: "ミリオネア", desc: "1回のゲームで +1,000,000 勝つ" },
  { id: "win100m", tier: 2, name: "億り人", desc: "1回のゲームで +100,000,000 勝つ" },
  { id: "win1b", tier: 2, name: "10億の男", desc: "1回のゲームで +1,000,000,000 勝つ" },
  { id: "win10b", tier: 3, name: "伝説の一撃", desc: "1回のゲームで +10,000,000,000 勝つ" },
  { id: "lose100m", tier: 2, name: "大爆死", desc: "1回のゲームで 100,000,000 負ける" },
  { id: "lose1b", tier: 3, name: "破産寸前", desc: "1回のゲームで 1,000,000,000 負ける" },
  { id: "wager1b", tier: 2, name: "VIP", desc: "賭けた額の合計が 1,000,000,000 をこえる" },
  { id: "wager1t", tier: 3, name: "ハイローラー", desc: "賭けた額の合計が 1,000,000,000,000 をこえる" },
  { id: "allin", tier: 2, name: "オールイン", desc: "残高を全部賭けて勝つ" },
  { id: "broke", tier: 1, name: "すっからかん", desc: "残高を全部賭けて負ける", secret: true },
  { id: "rich1b", tier: 2, name: "10億長者", desc: "残高を 1,000,000,000 にする" },
  { id: "rich10b", tier: 2, name: "100億長者", desc: "残高を 10,000,000,000 にする" },
  { id: "rich1t", tier: 3, name: "1兆長者", desc: "残高を 1,000,000,000,000 にする" },
  { id: "debt1b", tier: 2, name: "借金王", desc: "借金が 1,000,000,000 をこえる" },
  { id: "debt100b", tier: 3, name: "借金帝王", desc: "借金が 100,000,000,000 をこえる" },
  { id: "clean", tier: 1, name: "完済", desc: "借金を全部返す" },
  { id: "give", tier: 1, name: "太っ腹", desc: "友達にチップをあげる" },
  { id: "givebig", tier: 2, name: "大富豪の施し", desc: "1回で 100,000,000 以上あげる" },
  { id: "help", tier: 1, name: "救世主", desc: "友達の借金を肩代わりする" },
  { id: "helpbig", tier: 2, name: "スポンサー", desc: "1回で 100,000,000 以上肩代わりする" },
  { id: "chat", tier: 1, name: "おしゃべり", desc: "チャットで発言する" },
  { id: "chat100", tier: 2, name: "おしゃべり大王", desc: "チャットで100回発言する" },
  { id: "dressup", tier: 1, name: "おしゃれさん", desc: "フレームか吹き出しを変える" },
  { id: "night", tier: 1, name: "夜ふかし", desc: "夜中の0〜4時に勝負する", secret: true },
  { id: "morning", tier: 1, name: "早起き", desc: "朝の5〜7時に勝負する", secret: true },
  { id: "collector", tier: 3, name: "コレクター", desc: "実績を30個解除する" },
  { id: "rename", tier: 1, name: "改名", desc: "名前を変える" },
];
// Progress shown on locked achievements: [what to count, goal]. The client reads these numbers off the player.
// "st.n" = a field path, "-ax.b" = negated (losing streak), "wag" = all chips ever bet, "achn" = achievements unlocked.
const PROG = {
  bac100: ["st.n", 100], bac1000: ["st.n", 1000], bj100: ["bjst.n", 100], bj500: ["bjst.n", 500],
  fx100: ["fxst.n", 100], sp100: ["spst.n", 100], hl100: ["hlst.n", 100], hlstreak5: ["ax.h", 5], bank1t: ["bank", 1e12], rc100: ["rcst.n", 100], pair10: ["ax.pair", 10], tie5: ["ax.tie", 5], bust20: ["ax.bust", 20],
  chat100: ["ax.chat", 100], fxshort: ["ax.fxs", 10], streak5: ["ax.b", 5], streak10: ["ax.b", 10], lose10: ["-ax.b", 10],
  bjstreak5: ["ax.j", 5], bjstreak10: ["ax.j", 10], rich1b: ["chips", 1e9], rich10b: ["chips", 1e10], rich1t: ["chips", 1e12],
  debt1b: ["dep", 1e9], debt100b: ["dep", 1e11], wager1b: ["wag", 1e9], wager1t: ["wag", 1e12], collector: ["achn", 30],
};
for (const a of ACH) if (PROG[a.id]) a.prog = { k: PROG[a.id][0], goal: PROG[a.id][1] };
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
  on((p.dep || 0) >= 1e9, "debt1b"); on((p.dep || 0) >= 1e11, "debt100b");
  on(p.chips >= 1e10, "rich10b");
  on(st.n >= 1 && bj.n >= 1, "both"); on(bj.n >= 500, "bj500");
  const wag = (st.wag || 0) + (bj.wag || 0) + ((p.fxst && p.fxst.wag) || 0) + ((p.rcst && p.rcst.wag) || 0) + ((p.hlst && p.hlst.wag) || 0) + ((p.spst && p.spst.wag) || 0);
  on(wag >= 1e9, "wager1b"); on(wag >= 1e12, "wager1t");
  on(Object.keys(p.ach || {}).filter((id) => id !== "collector" && IDS.has(id)).length >= 30, "collector");
}

/** One settled game. d = chips won (+) or lost (-); allIn = nothing was left off the table. */
export function checkResult(p, d, allIn, now) {
  if (d >= 1e6) unlock(p, "win1m", now);
  if (d >= 1e8) unlock(p, "win100m", now);
  if (d >= 1e9) unlock(p, "win1b", now);
  if (d >= 1e10) unlock(p, "win10b", now);
  if (d <= -1e9) unlock(p, "lose1b", now);
  const h = new Date(now + 9 * 3600e3).getUTCHours(); // Japan time
  if (h < 4) unlock(p, "night", now);
  if (h >= 5 && h < 7) unlock(p, "morning", now);
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
  { id: "moon", name: "月夜", req: { ach: "night" }, how: "ひみつ実績「夜ふかし」を解除" },
  { id: "heart", name: "ハート", req: { ach: "givebig" }, how: "実績「大富豪の施し」を解除" },
  { id: "lightning", name: "稲妻", req: { ach: "streak10" }, how: "実績「10連勝」を解除" },
  { id: "emerald", name: "エメラルド", req: { count: 20 }, how: "実績を20個解除" },
  { id: "blackgold", name: "漆黒", req: { ach: "lose1b" }, how: "実績「破産寸前」を解除" },
  { id: "galaxy", name: "銀河", req: { count: 25 }, how: "実績を25個解除" },
  { id: "hologram", name: "ホログラム", req: { ach: "wager1t" }, how: "実績「ハイローラー」を解除" },
  { id: "crown", name: "王冠", req: { count: 35 }, how: "実績を35個解除" },
  { id: "bull", name: "ブル", req: { ach: "fxlev" }, how: "実績「ハイレバ」を解除" },
  { id: "bear", name: "ベア", req: { ach: "fxshort" }, how: "実績「空売りの達人」を解除" },
  { id: "candle", name: "ローソク足", req: { ach: "fx100" }, how: "実績「トレーダー」を解除" },
  { id: "turf", name: "ターフ", req: { ach: "rc1" }, how: "実績「はじめての馬券」を解除" },
  { id: "jockey", name: "勝負服", req: { ach: "rcfav" }, how: "実績「鉄板」を解除" },
  { id: "horseshoe", name: "蹄鉄", req: { ach: "rclong" }, how: "実績「大穴」を解除" },
];
const TIER_OF = Object.fromEntries(ACH.map((a) => [a.id, a.tier]));
export function frameOk(p, f) {
  const got = Object.keys(p.ach || {}).filter((id) => TIER_OF[id]);
  if (f.req.count) return got.length >= f.req.count;
  if (f.req.gold) return got.filter((id) => TIER_OF[id] === 3).length >= f.req.gold;
  if (f.req.ach) return got.includes(f.req.ach);
  return false;
}

// Chat bubble skins, unlocked the same way as frames.
export const BUBBLES = [
  { id: "mint", name: "ミント", req: { ach: "chat" }, how: "実績「おしゃべり」を解除" },
  { id: "night", name: "夜空", req: { count: 3 }, how: "実績を3個解除" },
  { id: "love", name: "ハート", req: { ach: "help" }, how: "実績「救世主」を解除" },
  { id: "casino", name: "カジノ", req: { ach: "bac100" }, how: "実績「常連さん」を解除" },
  { id: "gold", name: "ゴールド", req: { gold: 1 }, how: "ゴールド実績を1個解除" },
  { id: "fire", name: "炎", req: { ach: "lose10" }, how: "実績「どん底」を解除" },
  { id: "neon", name: "ネオン", req: { count: 10 }, how: "実績を10個解除" },
  { id: "rainbow", name: "虹色", req: { count: 15 }, how: "実績を15個解除" },
  { id: "hacker", name: "ハッカー", req: { ach: "chat100" }, how: "実績「おしゃべり大王」を解除" },
  { id: "ice", name: "氷", req: { ach: "bjstreak10" }, how: "実績「ディーラー殺し」を解除" },
  { id: "galaxy", name: "銀河", req: { count: 25 }, how: "実績を25個解除" },
  { id: "ticker", name: "株価ボード", req: { ach: "fx1" }, how: "実績「はじめてのFX」を解除" },
  { id: "bullmarket", name: "爆上げ", req: { ach: "fx10x" }, how: "実績「テンバガー」を解除" },
  { id: "turf", name: "ターフ", req: { ach: "rc1" }, how: "実績「はじめての馬券」を解除" },
  { id: "jockey", name: "勝負服", req: { ach: "rc100" }, how: "実績「競馬通」を解除" },
];
