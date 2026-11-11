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

/* ================= constants (keep in sync with server/src/race.js) ================= */
const MIN_BET = 100, FRAME_COLORS = ["#f4f4f4", "#1d1d1f", "#d7263d", "#2a62d6", "#f2c14e", "#2e9e5b", "#f28c28", "#f06aa8"];
const COATS = ["#7b4a2a", "#3b2a20", "#a0663a", "#5a3a24", "#8d8a86", "#6b3f22", "#2b211b", "#b07a4c"];
const CHIPS = [{ v: 100, c: "#3f7fbf", l: "100" }, { v: 1000, c: "#1f9d55", l: "1K" }, { v: 10000, c: "#2b2b33", l: "10K" }, { v: 100000, c: "#c98a12", l: "100K" }, { v: 1000000, c: "#0f8f8a", l: "1M" }, { v: 100000000, c: "#b0306a", l: "100M" }];
const DIST = 2000, VIEW = 0.32; // race is 2000m; the camera shows about a third of it
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const fmtK = (n) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return s + (a >= 1e12 ? (+(a / 1e12).toFixed(1)) + "T" : a >= 1e9 ? (+(a / 1e9).toFixed(1)) + "B" : a >= 1e6 ? (+(a / 1e6).toFixed(1)) + "M" : a >= 1000 ? (+(a / 1000).toFixed(1)) + "K" : String(a)); };
const sgn = (n) => (n > 0 ? "+" : "") + fmt(n);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const sum = (b) => Object.values(b || {}).reduce((a, v) => a + v, 0);
const numInk = (i) => (i === 0 || i === 4 ? "#1d1d1f" : "#fff");

/* ================= sign-in + server ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
let conn = null, online = false;
const sNow = () => Date.now() + (conn ? conn.offset() : 0);
const call = (name, data) => (conn ? conn.call(name, data) : Promise.reject(new Error("接続中…少し待ってね")));
const errMsg = (e) => (e && e.message ? e.message : "うまくいかなかった。もう一度試してね");

/* ================= state ================= */
let user = null, me = null, gate = "loading", gateErr = "", joining = false;
let players = {}, rc = null, rcBets = {}, want = null, sending = false, chip = 1000, statsOpen = false, flashMsg = "", flashT = null;
const live = () => gate === "in";
const myP = () => players[me];
const serverBets = () => { const b = rcBets[me]; return rc && b && b.round === rc.round ? b.bets : {}; };
const myBets = () => want || serverBets();
const myFree = () => (myP() ? myP().chips - (sum(myBets()) - sum(serverBets())) : 0);
const open = () => rc && rc.card && (rc.phase === "paused" || (rc.phase === "betting" && sNow() < rc.closesAt - 300));
function flash(t) { flashMsg = t; renderPill(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderPill(); }, 2600); }

/* ================= horses ================= */
function horseSVG(i) {
  const silk = FRAME_COLORS[i], coat = COATS[i], ink = numInk(i);
  return `<svg viewBox="0 0 64 44" class="hsvg">
    <g class="legs back"><path class="lg l1" d="M17 27 l-3 13" /><path class="lg l2" d="M22 27 l2 13" /></g>
    <path d="M6 22 q-5 4 -4 11 q4 -5 7 -7z" fill="${coat}" opacity=".9"/>
    <ellipse cx="26" cy="23" rx="17" ry="8" fill="${coat}"/>
    <path d="M38 19 q6 -9 12 -11 l3 2 q-5 3 -8 12z" fill="${coat}"/>
    <path d="M48 8 q7 -2 11 2 q1 3 -2 4 l-9 -1z" fill="${coat}"/><circle cx="54" cy="9.5" r=".9" fill="#111"/>
    <g class="legs front"><path class="lg l3" d="M34 27 l3 13" /><path class="lg l4" d="M39 26 l-1 14" /></g>
    <rect x="20" y="17" width="12" height="9" rx="2" fill="#fff"/><text x="26" y="24.5" text-anchor="middle" font-size="8" font-weight="900" fill="#111">${i + 1}</text>
    <path d="M27 16 q-1 -6 4 -9 l5 3 q-2 4 -3 7z" fill="${silk}" stroke="rgba(0,0,0,.35)" stroke-width=".6"/>
    <circle cx="35" cy="5" r="3.2" fill="${silk}" stroke="rgba(0,0,0,.35)" stroke-width=".6"/><path d="M33 3.5 h5" stroke="${ink}" stroke-width="1"/>
  </svg>`;
}
let lanesKey = "";
function buildLanes() {
  const hs = rc && rc.card ? rc.card.horses : [];
  const key = hs.map((h) => h.n + h.name).join();
  if (key === lanesKey) return;
  lanesKey = key;
  $("lanes").innerHTML = hs.map((h, i) => `<div class="lane"><div class="horse" id="hz${i}" style="--c:${FRAME_COLORS[i]}">${horseSVG(i)}<span class="hn">${esc(h.name)}</span></div></div>`).join("");
}

/* ================= race animation ================= */
function racePos(i, t) {
  // Position (0..1+) of horse i at time t, from the server's script.
  const s = rc.script; if (!s) return 0;
  const leg = Math.max(0, (t - rc.startAt) / rc.unit), a = s.pos[i], k = Math.floor(leg);
  if (k >= a.length - 1) return a[a.length - 1] + (leg - (a.length - 1)) * 0.02;
  return a[k] + (a[k + 1] - a[k]) * (leg - k);
}
const REST = -0.1; // camera rest spot: start line about a third in, clear of the chat panel
let camL = REST;
function frame() {
  requestAnimationFrame(frame);
  if (!rc || !rc.card) return;
  const W = $("track").clientWidth, n = rc.card.horses.length, t = sNow();
  const racing = rc.phase === "racing" && t >= rc.startAt;
  const ps = [];
  for (let i = 0; i < n; i++) ps.push(rc.phase === "racing" || rc.phase === "result" ? racePos(i, rc.phase === "result" ? Math.max(t, rc.endAt) : t) : 0);
  const lead = Math.max(...ps);
  const target = rc.phase === "racing" || rc.phase === "result" ? Math.min(Math.max(lead - VIEW * 0.72, REST), 1.08 - VIEW) : REST;
  camL += (target - camL) * 0.15;
  const X = (d) => ((d - camL) / VIEW) * W;
  $("turf").style.backgroundPositionX = `${-camL * (W / VIEW)}px`;
  let poles = "";
  for (let d = 0; d <= 1.0001; d += 0.05) {
    const x = X(d); if (x < -40 || x > W + 40) continue;
    const left = Math.round((1 - d) * DIST);
    poles += d >= 0.999 ? `<div class="pole goal" style="left:${x}px"><span>GOAL</span></div>` : `<div class="pole" style="left:${x}px"><span>${d === 0 ? "START" : left + "m"}</span></div>`;
  }
  if ($("poles").dataset.k !== poles) { $("poles").innerHTML = poles; $("poles").dataset.k = poles; }
  for (let i = 0; i < n; i++) {
    const el = $("hz" + i); if (!el) continue;
    el.style.transform = `translateX(${X(ps[i]) - 54}px)`;
    el.classList.toggle("run", racing && ps[i] < 1.06);
  }
}

/* ================= panels ================= */
function renderPill() {
  const el = $("pill");
  if (!live() || !rc || !rc.card) { el.innerHTML = ""; return; }
  const t = sNow(), hs = rc.card.horses;
  let h;
  if (flashMsg) h = `<div class="pill msg">${esc(flashMsg)}</div>`;
  else if (rc.phase === "paused") h = `<div class="pill msg">休憩中・馬券を買うとレースが始まるよ</div>`;
  else if (rc.phase === "betting") { const s = Math.max(0, Math.ceil((rc.closesAt - t) / 1000)); h = `<div class="pill msg ${s <= 5 ? "hurry" : ""}"><b class="num">${s}</b>秒で締切</div>`; }
  else if (rc.phase === "racing" && t < rc.startAt) h = `<div class="pill msg">ゲートイン… <b class="num">${Math.ceil((rc.startAt - t) / 1000)}</b></div>`;
  else if (rc.phase === "racing") {
    const ps = hs.map((_, i) => racePos(i, t)), li = ps.indexOf(Math.max(...ps)), left = Math.max(0, Math.round((1 - ps[li]) * DIST / 10) * 10);
    h = `<div class="pill msg">${left > 0 ? `先頭は <span class="nb" style="--c:${FRAME_COLORS[li]};--i:${numInk(li)}">${li + 1}</span> ${esc(hs[li].name)}　残り${left}m${left <= 400 ? "！" : ""}` : `<span class="nb" style="--c:${FRAME_COLORS[li]};--i:${numInk(li)}">${li + 1}</span> ${esc(hs[li].name)} ゴール！`}</div>`;
  } else h = "";
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderPodium() {
  const el = $("podium");
  const show = live() && rc && rc.phase === "result" && rc.res;
  el.hidden = !show;
  if (!show) return;
  const hs = rc.card.horses, me1 = myP()?.rcLast && myP().rcLast.round === rc.round ? myP().rcLast : null;
  const h = `<div class="pod">${rc.res.order.slice(0, 3).map((n, k) => { const x = hs[n - 1]; return `<div class="pr p${k + 1}"><span class="rank">${k + 1}着</span><span class="nb" style="--c:${FRAME_COLORS[n - 1]};--i:${numInk(n - 1)}">${n}</span><b>${esc(x.name)}</b><span class="od num">${k === 0 ? "単" + x.odds + " / " : ""}複${x.podds}</span></div>`; }).join("")}</div>
    ${me1 ? `<div class="mine ${me1.d >= 0 ? "up" : "dn"}">あなた: 払い戻し ${fmt(me1.ret)}（${sgn(me1.d)}）</div>` : ""}`;
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderCard() {
  if (!rc || !rc.card) { $("ktable").innerHTML = '<div class="empty">出走表を準備中…</div>'; return; }
  const b = myBets(), can = live() && open() && !sending, done = rc.phase === "result" && rc.res;
  $("cardnote").textContent = `第${rc.round}レース・2000m`;
  const rows = rc.card.horses.map((x, i) => {
    const w = b["w" + x.n] || 0, p = b["p" + x.n] || 0, place = done ? rc.res.order.indexOf(x.n) : -1;
    return `<div class="krow ${place === 0 ? "won" : place > 0 && place < 3 ? "placed" : ""}">
      <span class="nb" style="--c:${FRAME_COLORS[i]};--i:${numInk(i)}">${x.n}</span>
      <span class="kn"><b>${esc(x.name)}</b><small>${x.pop}番人気${place >= 0 && place < 3 ? `・<em>${place + 1}着</em>` : ""}</small></span>
      <button class="kb ${w ? "has" : ""}" data-k="w${x.n}" ${can ? "" : "disabled"}><small>単勝</small><b class="num">${x.odds.toFixed(1)}</b>${w ? `<i class="num">${fmtK(w)}</i>` : ""}</button>
      <button class="kb ${p ? "has" : ""}" data-k="p${x.n}" ${can ? "" : "disabled"}><small>複勝</small><b class="num">${x.podds.toFixed(1)}</b>${p ? `<i class="num">${fmtK(p)}</i>` : ""}</button>
    </div>`;
  }).join("");
  if ($("ktable").dataset.k !== rows) { $("ktable").innerHTML = rows; $("ktable").dataset.k = rows; }
}
function renderSide() {
  const hs = rc && rc.card ? rc.card.horses : [];
  const t = Object.entries(rcBets).filter(([, b]) => rc && b.round === rc.round && b.total > 0).map(([uid, b]) => [uid, uid === me ? { ...b, bets: myBets() } : b]);
  const label = (k) => `<span class="nb sm" style="--c:${FRAME_COLORS[+k.slice(1) - 1]};--i:${numInk(+k.slice(1) - 1)}">${k.slice(1)}</span>${k[0] === "w" ? "単" : "複"}`;
  const h = t.length ? t.map(([uid, b]) => { const p = players[uid] || {}; return `<div class="trow">${avatar(p, esc)}<span class="n">${esc(p.name)}${uid === me ? '<span class="you">あなた</span>' : ""}</span><span class="tk">${Object.entries(b.bets).map(([k, v]) => `<span>${label(k)} ${fmtK(v)}</span>`).join("")}</span></div>`; }).join("")
    : `<div class="empty small">${rc && rc.phase === "racing" ? "このレースは誰も買ってないよ" : "まだ誰も買ってないよ"}</div>`;
  if ($("tickets").dataset.k !== h) { $("tickets").innerHTML = h; $("tickets").dataset.k = h; }
  const hist = (rc && rc.history) || [];
  const hh = hist.length ? hist.slice(-10).reverse().map((x) => `<div class="hrow"><span class="mut num">R${x.r}</span>${x.top.map((n) => `<span class="nb sm" style="--c:${FRAME_COLORS[n - 1]};--i:${numInk(n - 1)}">${n}</span>`).join("")}<span class="hn2">${esc(x.name)}</span><span class="num od">単${x.odds}</span></div>`).join("") : '<div class="empty small">まだレースしてないよ</div>';
  if ($("khist").dataset.k !== hh) { $("khist").innerHTML = hh; $("khist").dataset.k = hh; }
  void hs;
}
function renderMid() {
  let h;
  if (!live()) h = '<span class="note">ログインすると馬券を買えるよ</span>';
  else h = `<button class="cbtn" id="clr" aria-label="馬券を全部取り消す" ${open() && sum(myBets()) && !sending ? "" : "disabled"}>×</button>`
    + CHIPS.map((c) => `<button class="chip ${c.v === chip ? "on" : ""}" style="--cc:${c.c}" data-v="${c.v}" aria-pressed="${c.v === chip}">${c.l}</button>`).join("")
    + '<span class="note small">チップを選んで出走表のマスを押す</span>';
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() ? sum(myBets()) : 0);
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>KEIBA</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>KEIBA</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>KEIBA</h1><p>バカラと同じチップで遊べる競馬。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>KEIBA</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
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
  $("roundtxt").textContent = on && rc ? `R${rc.round}` : "";
  $("statsbtn").hidden = !on; chat.live(on); ach.update(on);
  $("bal").textContent = on && myP() ? fmt(myFree()) : "—";
  $("walletbtn").disabled = !(on && myP());
  const dbt = (myP() && myP().dep) || 0;
  $("debt").hidden = !(on && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (on) { wallet.watch(); wallet.draw(); }
  buildLanes(); renderGate(); renderMid(); renderCard(); renderSide(); renderPill(); renderPodium(); renderStats();
}

/* ================= betting ================= */
async function sendBets(next) {
  if (sending) return;
  const prev = want; want = next; sending = true; render();
  try { await call("rcBets", { bets: next, round: rc.round }); want = null; }
  catch (e) { want = prev; flash(errMsg(e)); }
  sending = false; render();
}
$("ktable").addEventListener("click", (e) => {
  const b = e.target.closest(".kb"); if (!b || b.disabled || !open()) return;
  if (chip > myFree()) { flash("チップが足りない。残高の＋から借りられるよ"); return; }
  const next = { ...myBets() }; next[b.dataset.k] = (next[b.dataset.k] || 0) + chip;
  sendBets(next);
});
$("mid").addEventListener("click", (e) => {
  if (e.target.closest("#clr")) { sendBets({}); return; }
  const c = e.target.closest(".chip"); if (c) { chip = +c.dataset.v; render(); }
});

/* ================= shared modules ================= */
setupGames("keiba");
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
const duelw = setupDuelWatch({ call, errMsg, getMe: () => me, getPlayers: () => players, here: false });
const ach = setupAch({ call, errMsg, flash, esc, fmt, getMe: () => me, getPlayers: () => players, busy: () => rc && rc.phase === "racing" });
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
  const p = myP() || {}, st = p.rcst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.rccurve || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>プラス ${st.w}</span><span><i style="background:#ff7a84"></i>マイナス ${st.l}</span><span>${st.n}レース</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">レースに賭けると利益のグラフが出るよ</div>'; return; }
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
    if (m.type === "rc") { const prev = rc && rc.round; rc = m.v; if (prev !== rc.round) { want = null; camL = REST; } }
    else if (m.type === "rcBets") rcBets = m.v || {};
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "chat") chat.set(m.v);
    else if (m.type === "duels") duelw.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); duelw.set(st.duels, true); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset();
  players = st.players || {}; rc = st.rc || null; rcBets = st.rcBets || {}; want = null;
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

setInterval(() => { renderPill(); renderCard(); }, 250);
requestAnimationFrame(frame);
render();
