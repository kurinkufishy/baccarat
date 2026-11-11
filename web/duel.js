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

/* ================= helpers ================= */
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
let players = {}, duels = [], busy = false, statsOpen = false, flashMsg = "", flashT = null;
let to = "", stake = 10000, game = "coin", side = "omote", shown = 0;
const live = () => gate === "in";
const myP = () => players[me];
const myFree = () => (myP() ? myP().chips : 0);
function flash(t) { flashMsg = t; renderPill(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderPill(); }, 2600); }
const nm = (u) => esc((players[u] || {}).name || "?");
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const die = (v) => `<span class="die ${v === 1 ? "one" : ""}">${[...Array(9)].map((_, i) => `<i class="${PIPS[v].includes(i) ? "p" : ""}"></i>`).join("")}</span>`;

/* ================= arena: replays the latest finished duel ================= */
function renderArena() {
  const x = duels.find((d) => d.status === "done");
  const el = $("arena");
  if (!x) { const h = '<div class="idle">まだ対戦はないよ。下から友達に申し込もう</div>'; if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; } return; }
  const key = "d" + x.id;
  if (el.dataset.k === key) return;
  el.dataset.k = key;
  const fresh = x.id !== shown && Date.now() - (x.doneAt || 0) < 15000; shown = x.id;
  const fw = x.winner === x.from;
  const mid = x.game === "coin"
    ? `<div class="coin ${fresh ? "flip" : ""} ${x.detail.side}"><span class="f o">表</span><span class="f u">裏</span></div><div class="cap">${nm(x.from)} は「${x.call === "omote" ? "表" : "裏"}」</div>`
    : `<div class="drow"><div class="dside ${fresh ? "roll" : ""}">${x.detail.from.map(die).join("")}<b class="num">${x.detail.from[0] + x.detail.from[1]}</b></div><span class="vs">VS</span><div class="dside ${fresh ? "roll" : ""}">${x.detail.to.map(die).join("")}<b class="num">${x.detail.to[0] + x.detail.to[1]}</b></div></div>`;
  el.innerHTML = `<div class="duelist ${fw ? "win" : "lose"}">${avatar(players[x.from] || {}, esc, undefined, "big")}<b>${nm(x.from)}</b></div>
    <div class="mid">${mid}<div class="stk num">${fmt(x.stake)} × 2</div><div class="winner ${fresh ? "pop" : ""}">${nm(x.winner)} の勝ち！</div></div>
    <div class="duelist ${fw ? "lose" : "win"}">${avatar(players[x.to] || {}, esc, undefined, "big")}<b>${nm(x.to)}</b></div>`;
}
function renderPill() {
  const el = $("pill"); const h = flashMsg ? `<div class="pill msg">${esc(flashMsg)}</div>` : "";
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderOffer() {
  const el = $("offer");
  if (!live()) { el.innerHTML = '<div class="empty">ログインすると対戦できるよ</div>'; return; }
  const others = Object.entries(players).filter(([u]) => u !== me).sort((a, b) => String(a[1].name).localeCompare(String(b[1].name), "ja"));
  if (!to || !players[to] || to === me) to = others.length ? others[0][0] : "";
  const h = `<div class="flab">相手</div><div class="opps">${others.map(([u, p]) => `<button class="opp ${u === to ? "on" : ""}" data-to="${esc(u)}">${avatar(p, esc)}<span>${esc(p.name)}</span></button>`).join("") || '<div class="empty small">ほかに誰もいないよ</div>'}</div>
    <div class="flab">ゲーム</div><div class="games2"><button class="lev ${game === "coin" ? "on" : ""}" data-g="coin">🪙 コイントス</button><button class="lev ${game === "dice" ? "on" : ""}" data-g="dice">🎲 ダイス</button></div>
    ${game === "coin" ? `<div class="games2"><button class="lev ${side === "omote" ? "on" : ""}" data-side="omote">表にかける</button><button class="lev ${side === "ura" ? "on" : ""}" data-side="ura">裏にかける</button></div>` : ""}
    <div class="flab">賭け金 <b class="num">${fmt(stake)}</b></div><div class="stakes">${[1000, 10000, 100000, 1000000, 100000000, 10000000000].map((v) => `<button class="lev ${v === stake ? "on" : ""}" data-st="${v}">${fmtK(v)}</button>`).join("")}</div>
    <button class="go" id="dlgo" style="padding:14px;width:100%" ${busy || !to || stake > myFree() ? "disabled" : ""}>${to ? `${esc(players[to].name)} に申し込む` : "相手を選んでね"}</button>
    ${stake > myFree() ? '<p class="small dn">残高が足りないよ</p>' : ""}`;
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderInbox() {
  const t = sNow(), pend = duels.filter((x) => x.status === "pending" && (x.to === me || x.from === me));
  const h = pend.length ? pend.map((x) => { const left = Math.max(0, Math.ceil((x.expAt - t) / 1000)), inc = x.to === me; return `<div class="trow ${inc ? "inc" : ""}">${avatar(players[inc ? x.from : x.to] || {}, esc)}<span class="n">${inc ? `${nm(x.from)} から` : `${nm(x.to)} へ`}<small>${x.game === "coin" ? "コイントス" : "ダイス"}・${fmt(x.stake)}・あと${left}秒</small></span><span class="tk">${inc ? `<button class="go sm" data-acc="${x.id}" ${busy || myFree() < x.stake ? "disabled" : ""}>受ける</button><button class="ib" data-dec="${x.id}">断る</button>` : `<button class="ib" data-dec="${x.id}">取り消す</button>`}</span></div>`; }).join("") : '<div class="empty small">届いてる対戦はないよ</div>';
  if ($("inbox").dataset.k !== h) { $("inbox").innerHTML = h; $("inbox").dataset.k = h; }
  const done = duels.filter((x) => x.status === "done").slice(0, 10);
  const hh = done.length ? done.map((x) => `<div class="hrow"><span class="hn2">${nm(x.from)} vs ${nm(x.to)}</span><span class="num od">${fmtK(x.stake)}</span><b>${nm(x.winner)}</b></div>`).join("") : '<div class="empty small">まだ対戦してないよ</div>';
  if ($("khist").dataset.k !== hh) { $("khist").innerHTML = hh; $("khist").dataset.k = hh; }
}
function renderMid() {
  const h = live() ? '<span class="note small">申し込むと賭け金を預ける。断られたら戻るよ</span>' : '<span class="note">ログインすると対戦できるよ</span>';
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() ? duels.filter((x) => x.status === "pending" && x.from === me).reduce((s, x) => s + x.stake, 0) : 0);
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>DUEL</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>DUEL</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>DUEL</h1><p>友達と1対1の一発勝負。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>DUEL</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
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
  if (on) { wallet.watch(); wallet.draw(); }
  renderGate(); renderMid(); renderArena(); renderOffer(); renderInbox(); renderPill(); renderStats();
}
async function doCall(name, data, ok) {
  if (busy) return;
  busy = true; render();
  try { const r = await call(name, data); if (ok) flash(typeof ok === "function" ? ok(r) : ok); } catch (e) { flash(errMsg(e)); }
  busy = false; render();
}
$("offer").addEventListener("click", (e) => {
  const o = e.target.closest("[data-to]"); if (o) { to = o.dataset.to; render(); return; }
  const g = e.target.closest("[data-g]"); if (g) { game = g.dataset.g; render(); return; }
  const sd = e.target.closest("[data-side]"); if (sd) { side = sd.dataset.side; render(); return; }
  const s = e.target.closest("[data-st]"); if (s) { stake = +s.dataset.st; render(); return; }
  if (e.target.closest("#dlgo")) doCall("duelOffer", { to, stake, game, call: side }, "申し込んだ！返事を待ってね");
});
$("inbox").addEventListener("click", (e) => {
  const a = e.target.closest("[data-acc]"); if (a) { doCall("duelAnswer", { duel: +a.dataset.acc, accept: true }, (r) => (r.winner === me ? "勝った！" : "負けた…")); return; }
  const d = e.target.closest("[data-dec]"); if (d) doCall("duelAnswer", { duel: +d.dataset.dec, accept: false }, "やめた");
});

/* ================= shared modules ================= */
setupGames("duel");
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
const duelw = setupDuelWatch({ call, errMsg, getMe: () => me, getPlayers: () => players, here: true });
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
  const p = myP() || {}, st = p.dlst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>プラス ${st.w}</span><span><i style="background:#ff7a84"></i>マイナス ${st.l}</span><span>${st.n}対戦</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">対戦の勝ち負けはタイルで見てね</div>'; return; }
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
    if (m.type === "duels") { const before = new Set(duels.filter((x) => x.status === "pending" && x.to === me).map((x) => x.id)); duels = m.v || []; if (duels.some((x) => x.status === "pending" && x.to === me && !before.has(x.id))) flash("対戦が届いたよ！"); duelw.set(m.v); }
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "chat") chat.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); duelw.set(st.duels, true); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset();
  players = st.players || {}; duels = st.duels || []; const d0 = duels.find((x) => x.status === "done"); shown = d0 ? d0.id : 0;
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

setInterval(() => { if (live()) renderInbox(); }, 1000);
render();
