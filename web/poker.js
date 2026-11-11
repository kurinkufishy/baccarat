import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { connect } from "./net.js";
import { setupWallet } from "./wallet.js";
import { setupChat } from "./chat.js";
import { setupDuelWatch } from "./duelwatch.js";
import { setupRename } from "./rename.js";
import { setupAch } from "./ach.js";
import { avatar } from "./avatar.js";
import { setupGames } from "./games.js";

/* ================= constants (keep in sync with server/src/poker.js) ================= */
const STAKES = [[100, 200], [10000, 20000], [1000000, 2000000], [100000000, 200000000], [10000000000, 20000000000]], MIN_BB = 20, MAX_BB = 500, TURN_MS = 20000;
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const fmtK = (n) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return s + (a >= 1e12 ? (+(a / 1e12).toFixed(1)) + "T" : a >= 1e9 ? (+(a / 1e9).toFixed(1)) + "B" : a >= 1e6 ? (+(a / 1e6).toFixed(1)) + "M" : a >= 1000 ? (+(a / 1000).toFixed(1)) + "K" : String(a)); };
const sgn = (n) => (n > 0 ? "+" : "") + fmt(n);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

/* ================= sign-in + server ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
let conn = null, online = false;
const sNow = () => Date.now() + (conn ? conn.offset() : 0);
const call = (name, data) => (conn ? conn.call(name, data) : Promise.reject(new Error("接続中…少し待ってね")));
const errMsg = (e) => (e && e.message ? e.message : "うまくいかなかった。もう一度試してね");

/* ================= state ================= */
let user = null, me = null, gate = "loading", gateErr = "", joining = false;
let players = {}, pk = null, mine = null, mineFor = 0, busy = false, statsOpen = false, flashMsg = "", flashT = null, raiseTo = 0, sitSeat = -1, sitStake = 0, sitAmt = 0;
const live = () => gate === "in";
const myP = () => players[me];
const myFree = () => (myP() ? myP().chips : 0);
const blinds = () => (pk && pk.stake !== null ? STAKES[pk.stake] : null);
const H = () => pk && pk.hand;
const mySeat = () => (pk ? pk.seats.indexOf(me) : -1);
function flash(t) { flashMsg = t; renderPill(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderPill(); }, 2600); }
const SU = { S: "♠", H: "♥", D: "♦", C: "♣" };
const card = (c, cls = "") => c ? `<span class="pc ${c[1] === "H" || c[1] === "D" ? "red" : ""} ${cls}"><b>${c[0] === "T" ? "10" : c[0]}</b><i>${SU[c[1]]}</i></span>` : `<span class="pc back ${cls}"></span>`;
const ACT = { fold: "フォールド", check: "チェック", call: "コール", bet: "ベット", raise: "レイズ", allin: "オールイン", sb: "SB", bb: "BB" };

/* ================= table ================= */
// Seats drawn around the oval; the view turns so your own seat is at the bottom.
const POS = [[50, 92], [10, 66], [10, 26], [50, 6], [90, 26], [90, 66]];
function renderTable() {
  const h = H(), b = blinds(), base = Math.max(0, mySeat());
  $("stakeTxt").textContent = b ? `ブラインド ${fmtK(b[0])}/${fmtK(b[1])}・最大6人` : "テキサスホールデム・最大6人・最初に座った人がレートを決める";
  $("roundtxt").textContent = h ? `#${h.id}` : "";
  const pot = h ? Object.values(h.contrib).reduce((a, v) => a + v, 0) : 0;
  $("board").innerHTML = h ? [0, 1, 2, 3, 4].map((i) => h.board[i] ? card(h.board[i], h.results && winBest(h).includes(h.board[i]) ? "hi" : "") : '<span class="pc slot"></span>').join("") : "";
  $("pot").textContent = h ? `ポット ${fmt(pot)}` : pk && pk.seats.filter(Boolean).length < 2 ? "あと1人座ると始まるよ" : pk && pk.nextHandAt ? "まもなく配ります" : "";
  const la = h && h.log.length ? h.log[h.log.length - 1] : null;
  $("lastact").textContent = h && h.results ? resultText(h) : la ? `${players[la.u]?.name || "?"}：${ACT[la.a] || la.a}${la.n ? " " + fmtK(la.n) : ""}` : "";
  let s = "";
  for (let k = 0; k < 6; k++) {
    const i = (base + k) % 6, u = pk ? pk.seats[i] : null, [x, y] = POS[k];
    if (!u) { s += `<button class="seat empty" style="left:${x}%;top:${y}%" data-seat="${i}" ${!live() || mySeat() >= 0 ? "disabled" : ""}>${mySeat() >= 0 ? "空席" : "座る"}</button>`; continue; }
    const p = players[u] || {}, inH = h && h.players.includes(u), folded = inH && h.folded[u], turn = h && h.toAct === u;
    const cards = !inH ? "" : u === me && mine && mine.id === h.id ? mine.cards.map((c) => card(c, "sm")).join("") : h.shown && h.shown[u] ? h.shown[u].map((c) => card(c, "sm")).join("") : folded ? "" : card(null, "sm") + card(null, "sm");
    const r = h && h.results ? h.results.find((z) => z.u === u) : null;
    const left = turn ? Math.max(0, (h.turnEndsAt - sNow()) / TURN_MS) : 0;
    s += `<div class="seat ${u === me ? "me" : ""} ${folded ? "folded" : ""} ${turn ? "turn" : ""} ${r && r.won ? "won" : ""}" style="left:${x}%;top:${y}%">
      <div class="cards">${cards}</div>
      <div class="plate">${avatar(p, esc)}<span class="nm">${esc(p.name)}</span><b class="num">${fmtK(pk.stacks[u] || 0)}</b>${pk.away[u] ? '<em class="tag">休憩中</em>' : inH && h.allin[u] && !h.results ? '<em class="tag all">ALL IN</em>' : ""}</div>
      ${turn ? `<div class="timer"><i style="width:${left * 100}%"></i></div>` : ""}
      ${h && h.button === i ? '<span class="dealer">D</span>' : ""}
      ${h && (h.bets[u] || 0) > 0 && !h.results ? `<span class="bet num">${fmtK(h.bets[u])}</span>` : ""}
      ${r && r.hand ? `<span class="hand">${esc(r.hand)}${r.won ? ` +${fmtK(r.won)}` : ""}</span>` : r && r.won ? `<span class="hand">+${fmtK(r.won)}</span>` : ""}
    </div>`;
  }
  if ($("seats").dataset.k !== s) { $("seats").innerHTML = s; $("seats").dataset.k = s; }
}
function winBest(h) { const w = (h.results || []).filter((r) => r.won > 0 && r.best); return w.length ? w[0].best : []; }
function resultText(h) {
  const w = h.results.filter((r) => r.won > 0);
  return w.map((r) => `${players[r.u]?.name || "?"} の勝ち${r.hand ? "（" + r.hand + "）" : ""}`).join("・");
}
function renderPill() {
  const el = $("pill");
  let h = "";
  if (flashMsg) h = `<div class="pill msg">${esc(flashMsg)}</div>`;
  else if (live() && H() && H().toAct === me) h = `<div class="pill msg hurry">あなたの番！</div>`;
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderActions() {
  const el = $("actions"), h = H(), b = blinds(), seat = mySeat();
  let html, note = "";
  if (!live()) html = '<div class="empty">ログインすると遊べるよ</div>';
  else if (seat < 0) html = `<div class="empty">空いてる席の「座る」を押してね${b ? `（ブラインド ${fmt(b[0])}/${fmt(b[1])}）` : "。最初に座った人がレートを決めるよ"}</div>`;
  else {
    const stack = pk.stacks[me] || 0, away = pk.away[me];
    const myTurn = h && h.toAct === me;
    if (myTurn) {
      const bet = h.bets[me] || 0, owe = h.curBet - bet, minTo = Math.min(bet + stack, h.curBet + Math.max(h.minRaise, b[1])), maxTo = bet + stack;
      const pot = Object.values(h.contrib).reduce((a, v) => a + v, 0);
      if (!raiseTo || raiseTo < minTo || raiseTo > maxTo) raiseTo = minTo;
      const presets = [["最小", minTo], ["½ポット", h.curBet + Math.floor((pot + owe) / 2)], ["ポット", h.curBet + pot + owe], ["オールイン", maxTo]].map(([l, v]) => [l, Math.max(minTo, Math.min(maxTo, v))]);
      note = owe > 0 ? `コールに ${fmt(Math.min(owe, stack))}` : "チェックできるよ";
      html = `<div class="abtns">
        <button class="pa fold" data-a="fold" ${busy ? "disabled" : ""}>フォールド</button>
        ${owe > 0 ? `<button class="pa call" data-a="call" ${busy ? "disabled" : ""}>コール ${fmtK(Math.min(owe, stack))}</button>` : `<button class="pa call" data-a="check" ${busy ? "disabled" : ""}>チェック</button>`}
        ${maxTo > h.curBet ? `<button class="pa raise" data-a="raise" ${busy ? "disabled" : ""}>${h.curBet ? "レイズ" : "ベット"} <span class="num" id="rto">${fmtK(raiseTo)}</span></button>` : ""}
      </div>
      ${maxTo > h.curBet ? `<div class="rrow"><input type="range" id="rslider" min="${minTo}" max="${maxTo}" step="${b[0]}" value="${raiseTo}"><div class="presets">${presets.map(([l, v]) => `<button class="ib" data-to="${v}">${l}</button>`).join("")}</div></div>` : ""}`;
    } else {
      const inH = h && h.players.includes(me) && !h.folded[me] && !h.results;
      html = `<div class="empty">${away ? "休憩中（自分の番で時間切れになった）" : inH ? `${players[h.toAct]?.name || "ほかの人"} の番…` : h ? "次のハンドを待ってね" : "まもなく配ります"}</div>`;
    }
    html += `<div class="seatbtns">${away ? '<button class="go" id="pkback">戻る</button>' : ""}<button class="ib" id="pktop" ${h && h.players.includes(me) && !h.folded[me] && !h.results ? "disabled" : ""}>チップを足す</button><button class="ib" id="pkleave">席を立つ</button><span class="mut small">テーブル ${fmt(stack)}</span></div>`;
  }
  $("actnote").textContent = note;
  // Rebuild only when the situation changes, so dragging the raise slider is never interrupted.
  const k = [live(), seat, h && h.id, h && h.toAct, h && h.curBet, h && h.minRaise, h && (h.bets[me] || 0), pk && pk.stacks[me], busy, pk && pk.away[me], h && h.results ? 1 : 0, h && h.folded[me], !!h].join("|");
  if (el.dataset.k !== k) { el.innerHTML = html; el.dataset.k = k; }
  else { const r = $("rto"); if (r) r.textContent = fmtK(raiseTo); const sl = $("rslider"); if (sl && document.activeElement !== sl) sl.value = raiseTo; }
  const plog = h ? h.log.map((x) => `<div class="ev"><span>${esc(players[x.u]?.name || "?")}</span><b>${ACT[x.a] || x.a}</b>${x.n ? `<span class="num">${fmt(x.n)}</span>` : ""}</div>`).reverse().join("") : '<div class="empty small">ハンドが始まると流れが出るよ</div>';
  if ($("plog").dataset.k !== plog) { $("plog").innerHTML = plog; $("plog").dataset.k = plog; }
}
function renderMid() {
  const h = live() ? '<span class="note small">ポーカーはテーブルに持ち込んだチップで遊ぶよ</span>' : '<span class="note">ログインすると遊べるよ</span>';
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() && pk ? pk.stacks[me] || 0 : 0);
}
function renderSit() {
  if ($("sitm").hidden) return;
  const emptyTable = !pk || pk.seats.every((s) => !s), st = emptyTable ? sitStake : pk.stake, [sb, bb] = STAKES[st];
  const lo = bb * MIN_BB, hi = Math.min(bb * MAX_BB, myFree());
  if (!sitAmt || sitAmt < lo || sitAmt > hi) sitAmt = Math.min(hi, bb * 100);
  $("sitbody").innerHTML = `
    ${emptyTable ? `<div class="flab">レート（ブラインド）</div><div class="stakes">${STAKES.map(([a, c], i) => `<button class="lev ${i === st ? "on" : ""}" data-st="${i}">${fmtK(a)}/${fmtK(c)}</button>`).join("")}</div>` : `<p class="small">このテーブルはブラインド ${fmt(sb)}/${fmt(bb)}</p>`}
    <div class="flab">持ち込むチップ（${fmtK(lo)}〜${fmtK(bb * MAX_BB)}）</div>
    ${hi < lo ? `<div class="empty">残高が足りないよ（最低 ${fmt(lo)}）。残高の＋から借りられる</div>` : `<input type="range" id="sitrange" min="${lo}" max="${hi}" step="${bb}" value="${sitAmt}"><div class="sitamt num" id="sitamt">${fmt(sitAmt)}</div>
    <div class="presets">${[[`${MIN_BB}BB`, lo], ["100BB", bb * 100], ["250BB", bb * 250], ["最大", hi]].filter(([, v]) => v >= lo && v <= hi).map(([l, v]) => `<button class="ib" data-amt="${v}">${l}</button>`).join("")}</div>
    <button class="go" id="sitgo" style="padding:14px;width:100%">${sitSeat + 1}番の席に座る</button>`}`;
}

/* ================= actions ================= */
async function act(a) {
  if (busy) return;
  busy = true; render();
  try { await call("pkAct", { act: a, amount: a === "raise" ? raiseTo : 0 }); raiseTo = 0; }
  catch (e) { flash(errMsg(e)); }
  busy = false; render();
}
async function simple(name, data, okMsg) {
  try { await call(name, data); if (okMsg) flash(okMsg); } catch (e) { flash(errMsg(e)); }
}
$("actions").addEventListener("click", (e) => {
  const b = e.target.closest("[data-a]"); if (b) { act(b.dataset.a); return; }
  const pr = e.target.closest("[data-to]"); if (pr) { raiseTo = +pr.dataset.to; const sl = $("rslider"); if (sl) sl.value = raiseTo; $("rto").textContent = fmtK(raiseTo); return; }
  if (e.target.closest("#pkback")) { simple("pkBack", {}, "戻りました"); return; }
  if (e.target.closest("#pkleave")) { if (confirm("席を立つ？（ハンド中ならフォールドになる）")) simple("pkLeave", {}, "席を立ちました"); return; }
  if (e.target.closest("#pktop")) {
    const [, bb] = blinds(), room = bb * MAX_BB - (pk.stacks[me] || 0), v = Math.min(room, myFree());
    if (v <= 0) { flash(room <= 0 ? "もう最大まで持ってるよ" : "残高が足りないよ"); return; }
    if (confirm(`${fmt(v)} をテーブルに足す？`)) simple("pkTopUp", { amount: v }, `${fmt(v)} 足しました`);
  }
});
$("actions").addEventListener("input", (e) => { if (e.target.id === "rslider") { raiseTo = +e.target.value; $("rto").textContent = fmtK(raiseTo); } });
$("seats").addEventListener("click", (e) => {
  const b = e.target.closest(".seat.empty"); if (!b || b.disabled) return;
  sitSeat = +b.dataset.seat; sitAmt = 0; $("sitm").hidden = false; renderSit();
});
$("sitbody").addEventListener("click", async (e) => {
  const s = e.target.closest("[data-st]"); if (s) { sitStake = +s.dataset.st; sitAmt = 0; renderSit(); return; }
  const a = e.target.closest("[data-amt]"); if (a) { sitAmt = +a.dataset.amt; renderSit(); return; }
  if (e.target.closest("#sitgo")) {
    try { await call("pkSit", { seat: sitSeat, buyin: sitAmt, stake: sitStake }); $("sitm").hidden = true; flash("座りました"); }
    catch (er) { flash(errMsg(er)); }
  }
});
$("sitbody").addEventListener("input", (e) => { if (e.target.id === "sitrange") { sitAmt = +e.target.value; $("sitamt").textContent = fmt(sitAmt); } });

/* ================= my cards (only I ever receive them) ================= */
function fetchMine() {
  const h = H();
  if (!h || !h.players.includes(me)) { mine = null; return; }
  if (mineFor === h.id && mine) return;
  mineFor = h.id;
  call("pkMine").then((v) => { mine = v; render(); }).catch(() => { mineFor = 0; });
}

function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>POKER</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>POKER</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>POKER</h1><p>友達同士でチップを取り合うポーカー。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>POKER</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
      <form class="join" id="gjoin"><input id="gname" placeholder="ニックネーム" maxlength="12" autocomplete="off" value="${esc((user && user.displayName || "").slice(0, 12))}"><button class="go" type="submit" ${joining ? "disabled" : ""}>参加</button></form>
      <p class="err">${esc(gateErr)}</p><button class="ib" id="gout" style="align-self:center">別のアカウントにする</button>`;
  if (box.dataset.k !== h) { box.innerHTML = h; box.dataset.k = h; }
  const a = $("acctbtn"); a.hidden = !user;
  if (user && a.dataset.k !== user.uid) { a.dataset.k = user.uid; a.innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : "アカウント"; a.setAttribute("aria-label", "アカウント"); }
}
function render() {
  const on = live();
  $("live").classList.toggle("on", on && online);
  $("livetxt").textContent = on ? (online ? "LIVE" : "再接続中…") : gate === "out" || gate === "join" ? "ログイン前" : "接続中";
  $("migbar").hidden = true;
  $("statsbtn").hidden = !on; chat.live(on); ach.update(on);
  $("bal").textContent = on && myP() ? fmt(myFree()) : "—";
  $("walletbtn").disabled = !(on && myP());
  const dbt = (myP() && myP().dep) || 0;
  $("debt").hidden = !(on && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (on) { wallet.watch(); wallet.draw(); fetchMine(); }
  renderGate(); renderMid(); renderTable(); renderActions(); renderPill(); renderStats(); renderSit();
}

/* ================= shared modules ================= */
setupGames("poker");
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
const duelw = setupDuelWatch({ call, errMsg, getMe: () => me, getPlayers: () => players, here: false });
const ach = setupAch({ call, errMsg, flash, esc, fmt, getMe: () => me, getPlayers: () => players, busy: () => false });
const rename = setupRename({ call, errMsg, flash, fmt, getMe: () => me, getPlayers: () => players, myFree });
document.querySelectorAll(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) o.hidden = true; }));
addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true)); });
$("rulesbtn").addEventListener("click", () => { $("rulesm").hidden = false; });
$("acctbtn").addEventListener("click", () => { $("acctmail").textContent = user?.email || ""; rename.reset(); $("acctm").hidden = false; });
$("signout").addEventListener("click", () => { $("acctm").hidden = true; signOut(auth); });

/* ================= stats ================= */
let statsKey = "";
$("statsbtn").addEventListener("click", () => { statsOpen = !statsOpen; statsKey = ""; render(); });
$("statsx").addEventListener("click", () => { statsOpen = false; render(); });
function renderStats() {
  $("statsp").hidden = !(statsOpen && live()); $("statsbtn").classList.toggle("on", statsOpen); $("statsbtn").setAttribute("aria-pressed", statsOpen);
  if (!statsOpen || !live()) return;
  const p = myP() || {}, st = p.pkst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.pkcurve || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>プラス ${st.w}</span><span><i style="background:#ff7a84"></i>マイナス ${st.l}</span><span>${st.n}ハンド</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">ハンドを遊ぶと利益のグラフが出るよ</div>'; return; }
  const W = 320, H = 120, lo = Math.min(0, ...curve), hi = Math.max(0, ...curve), Y = (v) => 6 + (1 - (v - lo) / (hi - lo || 1)) * (H - 12);
  const d = curve.map((v, i) => `${i ? "L" : "M"}${((i / (curve.length - 1)) * W).toFixed(1)},${Y(v).toFixed(1)}`).join("");
  $("chartbox").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" stroke="#3a414b" stroke-dasharray="3 3"/><path d="${d}" fill="none" stroke="${curve[curve.length - 1] >= 0 ? "#22d36b" : "#ff7a84"}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

/* ================= join / sign-in ================= */
async function doJoin(name) {
  if (joining) return; joining = true; gateErr = ""; render();
  try { await call("join", { name }); } catch (e) { gateErr = errMsg(e); }
  joining = false; render();
}
$("gatebox").addEventListener("submit", (e) => { e.preventDefault(); const n = $("gname").value.trim(); if (n) doJoin(n); });
$("gatebox").addEventListener("click", async (e) => {
  if (e.target.closest("#gout")) { signOut(auth); return; }
  if (!e.target.closest("#gsign")) return;
  gateErr = ""; const btn = e.target.closest("#gsign"); btn.disabled = true;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, provider); }
  catch (er) {
    if (er && (er.code === "auth/popup-blocked" || er.code === "auth/operation-not-supported-in-this-environment")) { await signInWithRedirect(auth, provider); return; }
    if (er && er.code !== "auth/popup-closed-by-user" && er.code !== "auth/cancelled-popup-request") gateErr = "ログインできなかった。もう一度試してね";
    btn.disabled = false; render();
  }
});

/* ================= realtime ================= */
function applyBatch(msgs) {
  for (const m of msgs) {
    if (m.type === "pk") { const prev = H() && H().id, prevTurn = H() && H().toAct; pk = m.v; if (H() && H().id !== prev) raiseTo = 0; if (H() && H().toAct === me && prevTurn !== me) { raiseTo = 0; flash("あなたの番！"); } }
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "chat") chat.set(m.v);
    else if (m.type === "duels") duelw.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); duelw.set(st.duels, true); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset();
  players = st.players || {}; pk = st.pk || null; mine = null; mineFor = 0;
  gate = players[me] ? "in" : "join";
  render();
}
if (!auth) { gate = "unconfigured"; render(); }
else onAuthStateChanged(auth, (u) => {
  user = u; me = u ? u.uid : null;
  if (conn) { conn.close(); conn = null; }
  players = {}; online = false;
  if (!u) { gate = "out"; render(); return; }
  gate = "loading"; render();
  conn = connect({ getToken: () => u.getIdToken(), onReady, onBatch: applyBatch, onStatus: (on, err) => { online = on; if (err && gate === "loading") gateErr = err; render(); } });
});

setInterval(() => { if (live()) { renderTable(); renderPill(); } }, 250);
render();
