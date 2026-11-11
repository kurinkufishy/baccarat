import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { connect } from "./net.js";
import { setupWallet } from "./wallet.js";
import { setupChat } from "./chat.js";
import { setupRename } from "./rename.js";
import { setupAch } from "./ach.js";
import { avatar } from "./avatar.js";
import { setupGames } from "./games.js";

/* ================= constants (keep in sync with server/src/crash.js) ================= */
const RATE = 0.07, MIN_BET = 100;
const CHIPS = [{ v: 100, c: "#3f7fbf", l: "100" }, { v: 1000, c: "#1f9d55", l: "1K" }, { v: 10000, c: "#2b2b33", l: "10K" }, { v: 100000, c: "#c98a12", l: "100K" }, { v: 1000000, c: "#0f8f8a", l: "1M" }, { v: 100000000, c: "#b0306a", l: "100M" }];
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
let players = {}, cr = null, crBets = {}, busy = false, statsOpen = false, flashMsg = "", flashT = null, amt = 1000, auto = 0;
const live = () => gate === "in";
const myP = () => players[me];
const myFree = () => (myP() ? myP().chips : 0);
const myBet = () => { const b = crBets[me]; return cr && b && b.round === cr.round ? b : null; };
const canBet = () => cr && (cr.phase === "paused" || (cr.phase === "betting" && sNow() < cr.closesAt - 300));
const flying = () => cr && cr.phase === "flying" && sNow() >= cr.startAt;
const multNow = () => (flying() ? Math.floor(Math.exp(RATE * (sNow() - cr.startAt) / 1000) * 100) / 100 : cr && cr.phase === "bust" ? cr.bust : 1);
function flash(t) { flashMsg = t; renderMult(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderMult(); }, 2400); }

/* ================= graph ================= */
function drawGraph() {
  const svg = $("graph"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H || !cr) return;
  const L = 48, R = 18, T = 70, B = 30, cw = W - L - R, ch = H - T - B;
  const t = cr.phase === "flying" ? Math.max(0, sNow() - cr.startAt) / 1000 : cr.phase === "bust" ? Math.log(Math.max(cr.bust, 1)) / RATE : 0;
  const m = Math.exp(RATE * t), tMax = Math.max(10, t * 1.15), mMax = Math.max(2, m * 1.15);
  const X = (s) => L + (s / tMax) * cw, Y = (v) => T + ch - ((v - 1) / (mMax - 1)) * ch;
  let h = "";
  const step = mMax > 50 ? 25 : mMax > 10 ? 5 : mMax > 4 ? 1 : 0.5;
  for (let v = 1; v <= mMax; v += step) h += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${L - 6}" y="${Y(v) + 4}" class="gt" text-anchor="end">${v.toFixed(step < 1 ? 1 : 0)}x</text>`;
  for (let s = 0; s <= tMax; s += tMax > 60 ? 20 : tMax > 25 ? 10 : 5) h += `<text x="${X(s)}" y="${H - 8}" class="gt" text-anchor="middle">${s}秒</text>`;
  if (cr.phase === "flying" || cr.phase === "bust") {
    let d = ""; const n = 60;
    for (let i = 0; i <= n; i++) { const s = (t * i) / n; d += `${i ? "L" : "M"}${X(s).toFixed(1)},${Y(Math.exp(RATE * s)).toFixed(1)}`; }
    const bust = cr.phase === "bust";
    h += `<path d="${d}L${X(t)},${T + ch}L${X(0)},${T + ch}Z" class="area ${bust ? "b" : ""}"/><path d="${d}" class="curve ${bust ? "b" : ""}"/>`;
    // where friends got off
    for (const [uid, b] of Object.entries(crBets)) if (b.round === cr.round && b.out) { const s = Math.log(b.out) / RATE; if (s <= t) h += `<circle cx="${X(s)}" cy="${Y(b.out)}" r="4" class="off"/><text x="${X(s)}" y="${Y(b.out) - 8}" class="offt" text-anchor="middle">${esc(players[uid]?.name || "")}</text>`; }
    h += bust ? `<text x="${X(t)}" y="${Y(m)}" class="boom" text-anchor="middle" dominant-baseline="middle">💥</text>` : `<text x="${X(t)}" y="${Y(m)}" class="rocket" text-anchor="middle" dominant-baseline="middle">🚀</text>`;
  }
  svg.innerHTML = h;
}

/* ================= panels ================= */
function renderMult() {
  const el = $("mult");
  if (!live() || !cr) { el.innerHTML = ""; return; }
  let h;
  if (flashMsg) h = `<div class="msg">${esc(flashMsg)}</div>`;
  else if (cr.phase === "paused") h = `<div class="sub">休憩中・賭けると飛ぶよ</div>`;
  else if (cr.phase === "betting") h = `<div class="sub">離陸まで</div><div class="big num">${Math.max(0, Math.ceil((cr.closesAt - sNow()) / 1000))}</div>`;
  else if (cr.phase === "flying" && sNow() < cr.startAt) h = `<div class="sub">まもなく離陸</div><div class="big num">1.00x</div>`;
  else if (cr.phase === "flying") h = `<div class="big num up">${multNow().toFixed(2)}x</div>`;
  else h = `<div class="big num dn">${cr.bust.toFixed(2)}x</div><div class="sub dn">で爆発！</div>`;
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderHist() {
  const h = cr ? (cr.history || []).slice(-14).reverse().map((x) => `<span class="hp ${x >= 10 ? "hi" : x >= 2 ? "mid" : "lo"} num">${x.toFixed(2)}x</span>`).join("") : "";
  if ($("hist").dataset.k !== h) { $("hist").innerHTML = h; $("hist").dataset.k = h; }
}
function renderPanel() {
  const el = $("crpanel"), b = myBet();
  let h, note = "";
  if (!live() || !cr) h = '<div class="empty">ログインすると乗れるよ</div>';
  else if (flying() && b && !b.out) { const m = multNow(); h = `<button class="cashout" id="cashout" ${busy ? "disabled" : ""}><span>降りる</span><b class="num">${fmt(Math.floor(b.amount * m))}</b><small class="num">${m.toFixed(2)}x</small></button>${b.auto ? `<p class="small mut">${b.auto.toFixed(2)}x で自動で降りる設定</p>` : ""}`; }
  else if (b && b.out) h = `<div class="done up">${b.out.toFixed(2)}x で降りた！ <b class="num">+${fmt(b.won - b.amount)}</b></div>`;
  else if (cr.phase === "bust" && b) h = `<div class="done dn">爆発… <b class="num">-${fmt(b.amount)}</b></div>`;
  else if (canBet()) {
    const a = Math.min(amt, myFree());
    note = b ? `乗ってる：${fmt(b.amount)}${b.auto ? `・${b.auto.toFixed(2)}xで自動` : ""}` : "";
    h = `<div class="ordinfo"><span class="mut">賭け金</span> <b class="num">${fmt(a)}</b></div>
      <div class="flab">自動で降りる倍率</div><div class="autos">${[0, 1.5, 2, 3, 5, 10, 100].map((x) => `<button class="lev ${x === auto ? "on" : ""}" data-auto="${x}">${x ? x + "x" : "なし"}</button>`).join("")}</div>
      <button class="go" id="crgo" style="padding:14px;width:100%" ${busy || a < MIN_BET ? "disabled" : ""}>${b ? "賭け直す" : "乗る"}（${fmtK(a)}）</button>${b ? '<button class="ib" id="crcancel" style="justify-content:center">取り消す</button>' : ""}`;
  } else h = `<div class="empty">${cr.phase === "flying" ? "このフライトには乗ってないよ。次を待ってね" : "次のフライトを準備中…"}</div>`;
  $("crnote").textContent = note;
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderRiders() {
  const list = Object.entries(crBets).filter(([, b]) => cr && b.round === cr.round).sort((a, b) => b[1].amount - a[1].amount);
  const h = list.length ? list.map(([uid, b]) => { const p = players[uid] || {}; return `<div class="trow">${avatar(p, esc)}<span class="n">${esc(p.name)}${uid === me ? '<span class="you">あなた</span>' : ""}</span><span class="tk"><span class="num">${fmtK(b.amount)}</span>${b.out ? `<span class="up num">${b.out.toFixed(2)}x +${fmtK(b.won - b.amount)}</span>` : cr.phase === "bust" ? '<span class="dn">爆発</span>' : b.auto ? `<span class="mut num">自動 ${b.auto}x</span>` : ""}</span></div>`; }).join("") : '<div class="empty small">まだ誰も乗ってないよ</div>';
  if ($("riders").dataset.k !== h) { $("riders").innerHTML = h; $("riders").dataset.k = h; }
}
function renderMid() {
  let h;
  if (!live()) h = '<span class="note">ログインすると乗れるよ</span>';
  else h = `<button class="cbtn" id="clr" aria-label="賭け金を0にする">×</button>` + CHIPS.map((c) => `<button class="chip" style="--cc:${c.c}" data-v="${c.v}">${c.l}</button>`).join("") + `<button class="chip allbet" data-v="all">ALL<br>IN</button>`;
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() ? (myBet() ? myBet().amount : Math.min(amt, myFree())) : 0);
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>CRASH</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>CRASH</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>CRASH</h1><p>みんなで乗って、爆発する前に降りるゲーム。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>CRASH</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
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
  $("roundtxt").textContent = on && cr ? `#${cr.round}` : "";
  $("statsbtn").hidden = !on; chat.live(on); ach.update(on);
  $("bal").textContent = on && myP() ? fmt(myFree()) : "—";
  $("walletbtn").disabled = !(on && myP());
  const dbt = (myP() && myP().dep) || 0;
  $("debt").hidden = !(on && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (on) { wallet.watch(); wallet.draw(); }
  renderGate(); renderMid(); renderPanel(); renderRiders(); renderMult(); renderHist(); renderStats();
}

/* ================= actions ================= */
async function doCall(name, data, ok) {
  if (busy) return;
  busy = true; render();
  try { const r = await call(name, data); if (ok) flash(ok(r)); } catch (e) { flash(errMsg(e)); }
  busy = false; render();
}
$("crpanel").addEventListener("click", (e) => {
  const a = e.target.closest("[data-auto]"); if (a) { auto = +a.dataset.auto; render(); return; }
  if (e.target.closest("#crgo")) { doCall("crBet", { amount: Math.min(amt, myFree() + myBetAmt()), auto }, () => "乗った！"); return; }
  if (e.target.closest("#crcancel")) { doCall("crCancel", {}, () => "取り消した"); return; }
  if (e.target.closest("#cashout")) { const a0 = myBetAmt(); doCall("crCash", {}, (r) => `${r.out.toFixed(2)}x で降りた！ +${fmt(r.won - a0)}`); }
});
const myBetAmt = () => (myBet() ? myBet().amount : 0);
$("mid").addEventListener("click", (e) => {
  if (e.target.closest("#clr")) { amt = 0; render(); return; }
  const c = e.target.closest(".chip"); if (!c) return;
  amt = c.dataset.v === "all" ? myFree() : Math.min(Math.min(amt, myFree()) + +c.dataset.v, myFree());
  render();
});
addEventListener("keydown", (e) => { if (e.code === "Space" && flying() && myBet() && !myBet().out && document.activeElement?.tagName !== "INPUT") { e.preventDefault(); doCall("crCash", {}, (r) => `${r.out.toFixed(2)}x で降りた！`); } });

/* ================= shared modules ================= */
setupGames("crash");
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
const ach = setupAch({ call, errMsg, flash, esc, fmt, getMe: () => me, getPlayers: () => players, busy: () => flying() });
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
  const p = myP() || {}, st = p.crst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.crcurve || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>プラス ${st.w}</span><span><i style="background:#ff7a84"></i>マイナス ${st.l}</span><span>${st.n}フライト</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">フライトに乗ると利益のグラフが出るよ</div>'; return; }
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
    if (m.type === "cr") cr = m.v;
    else if (m.type === "crBets") crBets = m.v || {};
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "chat") chat.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset();
  players = st.players || {}; cr = st.cr || null; crBets = st.crBets || {};
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

setInterval(() => { if (live()) { renderMult(); renderPanel(); } }, 100);
function frame() { requestAnimationFrame(frame); if (live()) drawGraph(); }
requestAnimationFrame(frame);
render();
