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

/* ================= constants (keep in sync with server/src/core.js) ================= */
const STAKES = [100, 10000, 1000000, 100000000, 10000000000];
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
let players = {}, cc = null, busy = false, statsOpen = false, flashMsg = "", flashT = null, stake = 10000;
const live = () => gate === "in";
const myP = () => players[me];
const myFree = () => (myP() ? myP().chips : 0);
const mine = () => (cc && cc.players[me]) || null;
function flash(t) { flashMsg = t; renderPill(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderPill(); }, 2600); }
const handOf = (d) => { const s = [...d].sort((a, b) => a - b), [a, b, c] = s; if (a === b && b === c) return a === 1 ? "ピンゾロ" : `${a}のゾロ目`; if (a === 4 && b === 5 && c === 6) return "シゴロ"; if (a === 1 && b === 2 && c === 3) return "ヒフミ"; if (a === b) return `${c}の目`; if (b === c) return `${a}の目`; return "目なし"; };
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const die = (v, cls = "") => `<span class="die ${v === 1 ? "one" : ""} ${cls}">${[...Array(9)].map((_, i) => `<i class="${PIPS[v].includes(i) ? "p" : ""}"></i>`).join("")}</span>`;
const seen = {}; // uid -> number of rolls already animated

/* ================= table ================= */
const RING = [[50, 86], [17, 68], [17, 30], [50, 13], [83, 30], [83, 68]];
function renderTable() {
  const ids = cc ? Object.keys(cc.players) : [];
  $("roundtxt").textContent = cc ? `#${cc.round}` : "";
  const order = [...ids].sort((a, b) => (a === me ? -1 : b === me ? 1 : cc.players[a].at - cc.players[b].at));
  let s = "";
  order.forEach((u, k) => {
    const pl = cc.players[u], p = players[u] || {}, [x, y] = RING[k % 6], last = pl.rolls[pl.rolls.length - 1];
    const fresh = (seen[u] || 0) < pl.rolls.length;
    const won = cc.results && cc.results[u] > 0;
    s += `<div class="cseat ${u === me ? "me" : ""} ${won ? "won" : ""}" style="left:${x}%;top:${y}%">
      <div class="dice ${fresh ? "shake" : ""}">${last ? last.map((v) => die(v)).join("") : '<span class="wait">まだ振ってない</span>'}</div>
      <div class="plate">${avatar(p, esc)}<span class="nm">${esc(p.name)}</span>${pl.hand ? `<b class="chn">${esc(pl.hand.name)}</b>` : last ? `<b class="chn mut">${esc(handOf(last))}・あと${3 - pl.rolls.length}回</b>` : ""}</div>
      ${cc.results ? `<span class="res ${won ? "up" : "dn"} num">${won ? "+" + fmtK(cc.results[u] - cc.stake) : "-" + fmtK(cc.stake)}</span>` : ""}
    </div>`;
  });
  if ($("ring").dataset.k !== s) { $("ring").innerHTML = s; $("ring").dataset.k = s; setTimeout(() => { for (const u of ids) seen[u] = cc.players[u] ? cc.players[u].rolls.length : 0; }, 700); }
  // the bowl shows my latest roll big
  const m = mine(), last = m && m.rolls[m.rolls.length - 1];
  const bh = last ? last.map((v) => die(v, "big")).join("") : "";
  if ($("bdice").dataset.k !== bh) { $("bdice").innerHTML = bh; $("bdice").dataset.k = bh; $("bdice").classList.remove("roll"); void $("bdice").offsetWidth; $("bdice").classList.add("roll"); }
  $("bname").textContent = m && m.hand ? m.hand.name : last ? handOf(last) : cc && cc.phase === "open" ? (ids.length ? `${ids.length}人参加中・場代 ${fmt(cc.stake)}` : "参加者を待ってるよ") : "";
}
function renderPill() {
  const el = $("pill"); let h = "";
  if (flashMsg) h = `<div class="pill msg">${esc(flashMsg)}</div>`;
  else if (live() && cc) {
    const t = sNow(), n = Object.keys(cc.players).length;
    if (cc.phase === "open") h = n >= 2 && cc.closesAt ? `<div class="pill msg"><b class="num">${Math.max(0, Math.ceil((cc.closesAt - t) / 1000))}</b>秒で締切・${n}人</div>` : `<div class="pill msg">${n ? "あと1人そろうと始まるよ" : "参加すると勝負が始まるよ"}</div>`;
    else if (cc.phase === "rolling") h = `<div class="pill msg ${mine() && !mine().hand ? "hurry" : ""}">${mine() && !mine().hand ? "振って！" : "みんなが振ってる…"} <b class="num">${Math.max(0, Math.ceil((cc.rollEndsAt - t) / 1000))}</b></div>`;
    else if (cc.phase === "result") { const w = Object.entries(cc.results || {}).filter(([, v]) => v > 0).map(([u]) => players[u]?.name || "?"); h = `<div class="pill msg">${esc(w.join("・"))} の勝ち！</div>`; }
  }
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderPanel() {
  const el = $("ccpanel"), m = mine();
  let h, note = "";
  if (!live() || !cc) h = '<div class="empty">ログインすると参加できるよ</div>';
  else if (cc.phase === "open" && !m) {
    const first = !Object.keys(cc.players).length;
    h = first ? `<div class="flab">場代（全員が出す額）</div><div class="stakes">${STAKES.map((v) => `<button class="lev ${v === stake ? "on" : ""}" data-st="${v}">${fmtK(v)}</button>`).join("")}</div><button class="go" id="ccjoin" style="padding:14px;width:100%" ${busy || myFree() < stake ? "disabled" : ""}>場代 ${fmt(stake)} で参加</button>`
      : `<button class="go" id="ccjoin" style="padding:14px;width:100%" ${busy || myFree() < cc.stake || Object.keys(cc.players).length >= 6 ? "disabled" : ""}>場代 ${fmt(cc.stake)} で参加</button>`;
    if (myFree() < (first ? stake : cc.stake)) note = "残高が足りないよ";
  } else if (cc.phase === "open" && m) h = `<div class="empty">参加中！ほかの人を待ってるよ（ポット ${fmt(cc.stake * Object.keys(cc.players).length)}）</div><button class="ib" id="ccleave" style="justify-content:center">抜ける</button>`;
  else if (cc.phase === "rolling" && m && !m.hand) h = `<button class="rollbtn" id="ccroll" ${busy ? "disabled" : ""}>🎲 振る！<small>あと${3 - m.rolls.length}回まで</small></button>`;
  else if (cc.phase === "rolling") h = `<div class="empty">${m ? `あなたの役：${esc(m.hand.name)}。ほかの人を待ってるよ` : "この勝負には参加してないよ"}</div>`;
  else { const r = cc.results && m ? cc.results[me] : null; h = `<div class="done ${r > 0 ? "up" : r === null ? "" : "dn"}">${r === null ? "次の勝負を準備中…" : r > 0 ? `勝ち！ +${fmt(r - cc.stake)}` : `負け… -${fmt(cc.stake)}`}</div>`; }
  $("ccnote").textContent = note || (cc && cc.stake ? `場代 ${fmt(cc.stake)}・ポット ${fmt(cc.stake * Object.keys(cc.players).length)}` : "");
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
  const hh = cc && cc.history && cc.history.length ? [...cc.history].reverse().map((x) => `<div class="hrow"><span class="mut num">#${x.r}</span><span class="hn2">${esc(x.win.join("・"))}</span><b>${esc(x.hand)}</b><span class="num od">${fmtK(x.pot)}</span></div>`).join("") : '<div class="empty small">まだ勝負してないよ</div>';
  if ($("khist").dataset.k !== hh) { $("khist").innerHTML = hh; $("khist").dataset.k = hh; }
}
function renderMid() {
  const h = live() ? '<span class="note small">参加するとき場代が残高から出るよ</span>' : '<span class="note">ログインすると参加できるよ</span>';
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() && mine() ? cc.stake : 0);
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>CHINCHIRO</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>CHINCHIRO</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>CHINCHIRO</h1><p>友達とサイコロで総取り勝負。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>CHINCHIRO</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
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
  renderGate(); renderMid(); renderTable(); renderPanel(); renderPill(); renderStats();
}
async function doCall(name, data, ok) {
  if (busy) return;
  busy = true; render();
  try { await call(name, data); if (ok) flash(ok); } catch (e) { flash(errMsg(e)); }
  busy = false; render();
}
$("ccpanel").addEventListener("click", (e) => {
  const s = e.target.closest("[data-st]"); if (s) { stake = +s.dataset.st; render(); return; }
  if (e.target.closest("#ccjoin")) { doCall("ccJoin", { stake }, "参加した！"); return; }
  if (e.target.closest("#ccleave")) { doCall("ccLeave", {}, "抜けた"); return; }
  if (e.target.closest("#ccroll")) doCall("ccRoll", {});
});

/* ================= shared modules ================= */
setupGames("chinchiro");
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
const duelw = setupDuelWatch({ call, errMsg, getMe: () => me, getPlayers: () => players, here: false });
const ach = setupAch({ call, errMsg, flash, esc, fmt, getMe: () => me, getPlayers: () => players, busy: () => cc && cc.phase === "rolling" });
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
  const p = myP() || {}, st = p.ccst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.cccurve || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>プラス ${st.w}</span><span><i style="background:#ff7a84"></i>マイナス ${st.l}</span><span>${st.n}勝負</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">勝負すると利益のグラフが出るよ</div>'; return; }
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
    if (m.type === "cc") cc = m.v;
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "chat") chat.set(m.v);
    else if (m.type === "duels") duelw.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); duelw.set(st.duels, true); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset();
  players = st.players || {}; cc = st.cc || null; if (cc) for (const u of Object.keys(cc.players)) seen[u] = cc.players[u].rolls.length;
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

setInterval(() => { if (live()) renderPill(); }, 250);
render();
