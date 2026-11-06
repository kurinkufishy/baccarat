import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { connect } from "./net.js";
import { setupWallet } from "./wallet.js";
import { setupChat } from "./chat.js";
import { setupRename } from "./rename.js";
import { setupAch } from "./ach.js";
import { avatar } from "./avatar.js";

/* ================= constants (keep in sync with server/src/fxgame.js) ================= */
const SPREAD = 0.006, LEVS = [1, 5, 10, 25, 50, 100], MAX_POS = 5, MIN_MARGIN = 100, KEEP_TICKS = 300, KEEP_CANDLES = 180;
const CHIPS = [{ v: 100, c: "#3f7fbf", l: "100" }, { v: 1000, c: "#1f9d55", l: "1K" }, { v: 10000, c: "#2b2b33", l: "10K" }, { v: 100000, c: "#c98a12", l: "100K" }, { v: 1000000, c: "#0f8f8a", l: "1M" }, { v: 100000000, c: "#b0306a", l: "100M" }];
const r3 = (x) => Math.round(x * 1000) / 1000;
const ask = (p) => r3(p + SPREAD / 2), bid = (p) => r3(p - SPREAD / 2);
const pnl = (pos, p) => Math.max(Math.floor(pos.margin * pos.lev * pos.side * ((pos.side > 0 ? bid(p) : ask(p)) / pos.entry - 1)), -pos.margin);
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const fmtK = (n) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return s + (a >= 1e12 ? (+(a / 1e12).toFixed(1)) + "T" : a >= 1e9 ? (+(a / 1e9).toFixed(1)) + "B" : a >= 1e6 ? (+(a / 1e6).toFixed(1)) + "M" : a >= 1000 ? (+(a / 1000).toFixed(1)) + "K" : String(a)); };
const sgn = (n) => (n > 0 ? "+" : "") + fmt(n);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const p3 = (x) => Number(x).toFixed(3);

/* ================= sign-in + server ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
let conn = null, online = false, importAvail = false, importing = false;
const sNow = () => Date.now() + (conn ? conn.offset() : 0);
const call = (name, data) => (conn ? conn.call(name, data) : Promise.reject(new Error("接続中…少し待ってね")));
const errMsg = (e) => (e && e.message ? e.message : "うまくいかなかった。もう一度試してね");

/* ================= state ================= */
let user = null, me = null, gate = "loading", gateErr = "", joining = false;
let players = {}, fx = { price: 150, lastAt: 0, ticks: [], candles: [] }, prevPrice = null;
let amt = 1000, lev = 10, mode = "tick", busy = false, statsOpen = false, flashMsg = "", flashT = null;
let myPosIds = new Set();

const myP = () => players[me];
const myFree = () => (myP() ? myP().chips : 0);
const live = () => gate === "in";
const marketOn = () => fx.lastAt && sNow() - fx.lastAt < 4000;
function flash(t) { flashMsg = t; renderQuote(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderQuote(); }, 2600); }

/* ================= chart ================= */
let drawQueued = false;
function queueDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawChart(); renderQuote(); renderPositions(); renderOrder(); }); }
function drawChart() {
  const svg = $("chart"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  const top = 92, bot = 24, right = 66, left = 8, cw = W - left - right, ch = H - top - bot;
  const mine = (myP()?.fxPos) || [];
  let pts, lo = Infinity, hi = -Infinity, h = "";
  if (mode === "tick") {
    pts = fx.ticks;
    if (pts.length < 2) { svg.innerHTML = ""; return; }
    for (const [, p] of pts) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  } else {
    pts = fx.candles.slice(-Math.max(20, Math.floor(cw / 9)));
    if (!pts.length) { svg.innerHTML = ""; return; }
    for (const c of pts) { lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); }
  }
  // Keep my entry prices on screen when they're reasonably close.
  for (const pos of mine) { if (Math.abs(pos.entry - fx.price) / fx.price < 0.03) { lo = Math.min(lo, pos.entry); hi = Math.max(hi, pos.entry); } }
  const pad = Math.max((hi - lo) * 0.12, fx.price * 0.0004); lo -= pad; hi += pad;
  const Y = (p) => top + (1 - (p - lo) / (hi - lo)) * ch;
  // grid + price labels
  const step = niceStep((hi - lo) / 5);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Y(v);
    h += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="gl"/><text x="${W - right + 6}" y="${y + 4}" class="gt">${v.toFixed(step < 0.01 ? 3 : 2)}</text>`;
  }
  const up = pts.length > 1 && fx.price >= (mode === "tick" ? pts[0][1] : pts[0][1]);
  if (mode === "tick") {
    // Use the whole width even when there is only a little history yet (at least a 1-minute window).
    const t1 = pts[pts.length - 1][0], t0 = Math.min(t1 - 60000, Math.max(t1 - KEEP_TICKS * 1000, pts[0][0]));
    const X = (t) => left + ((t - t0) / (t1 - t0)) * cw;
    const d = pts.map(([t, p], i) => `${i ? "L" : "M"}${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join("");
    h += `<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${up ? "#22d36b" : "#ff5c6c"}" stop-opacity=".28"/><stop offset="1" stop-color="${up ? "#22d36b" : "#ff5c6c"}" stop-opacity="0"/></linearGradient></defs>`;
    h += `<path d="${d}L${X(t1)},${top + ch}L${X(pts[0][0])},${top + ch}Z" fill="url(#ar)"/><path d="${d}" class="ln ${up ? "up" : "dn"}"/>`;
    const span = (t1 - t0) / 1000, every = span > 150 ? 60 : span > 70 ? 30 : 15;
    for (let s = every; s < span; s += every) { const x = X(t1 - s * 1000); h += `<text x="${x}" y="${H - 6}" class="gt mid">${s >= 60 && s % 60 === 0 ? s / 60 + "分前" : s + "秒前"}</text>`; }
    h += `<circle cx="${X(t1)}" cy="${Y(fx.price)}" r="4" class="dot ${up ? "up" : "dn"}"/><circle cx="${X(t1)}" cy="${Y(fx.price)}" r="9" class="pulse ${up ? "up" : "dn"}"/>`;
  } else {
    const n = pts.length, bw = cw / Math.max(n, 20);
    pts.forEach((c, i) => {
      const x = left + cw - (n - i) * bw + bw / 2, g = c[4] >= c[1];
      h += `<line x1="${x}" x2="${x}" y1="${Y(c[2])}" y2="${Y(c[3])}" class="wk ${g ? "up" : "dn"}"/><rect x="${x - bw * 0.35}" y="${Y(Math.max(c[1], c[4]))}" width="${bw * 0.7}" height="${Math.max(1, Math.abs(Y(c[1]) - Y(c[4])))}" class="cd ${g ? "up" : "dn"}"/>`;
    });
    for (let i = n - 1; i >= 0; i -= 15) { const d = new Date(pts[i][0]); h += `<text x="${left + cw - (n - i) * bw + bw / 2}" y="${H - 6}" class="gt mid">${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}</text>`; }
  }
  // my entries
  for (const pos of mine) {
    const y = Y(pos.entry); if (y < top - 4 || y > top + ch + 4) continue;
    const g = pnl(pos, fx.price) >= 0;
    h += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="en ${pos.side > 0 ? "b" : "s"}"/><text x="${W - right - 6}" y="${y - 5}" class="et ${g ? "up" : "dn"}" text-anchor="end">${pos.side > 0 ? "買" : "売"} ×${pos.lev} ${sgn(pnl(pos, fx.price))}</text>`;
  }
  // current price tag
  const yp = Y(fx.price), tick = prevPrice === null || fx.price >= prevPrice;
  h += `<line x1="${left}" x2="${W - right}" y1="${yp}" y2="${yp}" class="cur"/><rect x="${W - right + 2}" y="${yp - 10}" width="${right - 4}" height="20" rx="4" class="tag ${tick ? "up" : "dn"}"/><text x="${W - right + 6}" y="${yp + 4}" class="tagt">${p3(fx.price)}</text>`;
  svg.innerHTML = h;
}
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }

/* ================= panels ================= */
function spanTxt() { const n = fx.ticks.length ? Math.round((fx.ticks[fx.ticks.length - 1][0] - fx.ticks[0][0]) / 1000) : 0; return n >= 60 ? Math.round(n / 60) + "分" : n + "秒"; }
function renderQuote() {
  const ref = fx.ticks.length ? fx.ticks[0][1] : fx.price, ch = fx.price - ref, pct = ref ? (ch / ref) * 100 : 0;
  const up = prevPrice === null || fx.price >= prevPrice;
  $("quote").innerHTML = flashMsg ? `<div class="qflash">${esc(flashMsg)}</div>`
    : `<div class="qp num ${up ? "up" : "dn"}">${p3(fx.price)}</div><div class="qc num ${ch >= 0 ? "up" : "dn"}">${ch >= 0 ? "▲" : "▼"} ${Math.abs(ch).toFixed(3)} (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)<span class="mut"> ${spanTxt()}前比</span></div>${live() && !marketOn() ? '<div class="qstop">相場をつないでます…</div>' : ""}`;
}
function renderOrder() {
  $("levs").innerHTML = LEVS.map((l) => `<button class="lev ${l === lev ? "on" : ""}" data-l="${l}" role="radio" aria-checked="${l === lev}">×${l}</button>`).join("");
  const a = Math.min(amt, myFree()), move = Math.floor(a * lev * 0.01);
  $("ordinfo").innerHTML = live() ? `<div><span class="mut">証拠金</span> <b class="num">${fmt(a)}</b></div><div class="mut small">取引額 ${fmtK(a * lev)}・1%動くと ±${fmt(move)}・ロスカットまで ${(100 / lev).toFixed(lev >= 50 ? 1 : 0)}%</div>` : "";
  const can = live() && marketOn() && !busy && a >= MIN_MARGIN && ((myP()?.fxPos) || []).length < MAX_POS;
  $("obuy").disabled = !can; $("osell").disabled = !can;
  $("askp").textContent = p3(ask(fx.price)); $("bidp").textContent = p3(bid(fx.price));
}
function posRow(pos, owner, mineRow) {
  const d = pnl(pos, fx.price), pct = (d / pos.margin) * 100;
  return `<div class="prow">${owner ? avatar(owner, esc) : ""}<span class="sd ${pos.side > 0 ? "b" : "s"}">${pos.side > 0 ? "買" : "売"}</span><span class="pi"><b>×${pos.lev}</b> <span class="num">${fmtK(pos.margin)}</span><small class="num">${owner ? esc(owner.name) + " · " : ""}${p3(pos.entry)}</small></span><span class="pl num ${d >= 0 ? "up" : "dn"}">${sgn(d)}<small>${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%</small></span>${mineRow ? `<button class="pclose" data-id="${pos.id}" ${busy ? "disabled" : ""}>決済</button>` : ""}</div>`;
}
function renderPositions() {
  const mine = (myP()?.fxPos) || [];
  const tot = mine.reduce((s, x) => s + pnl(x, fx.price), 0);
  $("poscount").innerHTML = mine.length ? `${mine.length}/${MAX_POS}・<span class="num ${tot >= 0 ? "up" : "dn"}">${sgn(tot)}</span>` : "";
  $("closeall").hidden = mine.length < 2; $("closeall").disabled = busy;
  const hist = (myP()?.fxhist) || [];
  $("plist").innerHTML = mine.length ? mine.map((x) => posRow(x, null, true)).join("")
    : `<div class="empty">ポジションなし。チップで証拠金を決めて、買いか売りを押してね${hist.length ? `<br><span class="small">前回: ${hist[0].liq ? "ロスカット " : ""}<span class="${hist[0].d >= 0 ? "up" : "dn"}">${sgn(hist[0].d)}</span></span>` : ""}</div>`;
  const others = [];
  for (const [uid, p] of Object.entries(players)) if (uid !== me) for (const pos of p.fxPos || []) others.push([p, pos]);
  const rank = Object.entries(players).filter(([, p]) => p.fxst && p.fxst.n).sort((a, b) => b[1].fxst.prof - a[1].fxst.prof).slice(0, 8);
  $("others").innerHTML = (others.length ? others.map(([p, pos]) => posRow(pos, p, false)).join("") : `<div class="empty small">ほかの人のポジションはまだないよ</div>`)
    + `<div class="fxrank"><div class="mut small">FX収支ランキング</div>${rank.length ? rank.map(([uid, p], i) => `<div class="rrow">${i + 1}. ${avatar(p, esc)}<span class="n">${esc(p.name)}${uid === me ? '<span class="you">あなた</span>' : ""}</span><span class="num ${p.fxst.prof >= 0 ? "up" : "dn"}">${sgn(p.fxst.prof)}</span></div>`).join("") : '<div class="mut small">まだ誰もトレードしてないよ</div>'}</div>`;
}
function renderMid() {
  let h;
  if (!live()) h = '<span class="note">ログインすると取引できるよ</span>';
  else h = `<button class="cbtn" id="clr" aria-label="証拠金を0にする">×</button>`
    + CHIPS.map((c) => `<button class="chip" style="--cc:${c.c}" data-v="${c.v}" aria-label="${c.l}を足す">${c.l}</button>`).join("")
    + `<button class="chip allbet" data-v="all" aria-label="残高を全部証拠金にする">ALL<br>IN</button>`;
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() ? Math.min(amt, myFree()) : 0);
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>FX</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>FX</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>FX</h1><p>バカラと同じチップで遊べる架空のFX。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>FX</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
      <form class="join" id="gjoin"><input id="gname" placeholder="ニックネーム" maxlength="12" autocomplete="off" value="${esc((user && user.displayName || "").slice(0, 12))}"><button class="go" type="submit" ${joining ? "disabled" : ""}>参加</button></form>
      <p class="err">${esc(gateErr)}</p><button class="ib" id="gout" style="align-self:center">別のアカウントにする</button>`;
  if (box.dataset.k !== h) { box.innerHTML = h; box.dataset.k = h; }
  const a = $("acctbtn"); a.hidden = !user;
  if (user && a.dataset.k !== user.uid) { a.dataset.k = user.uid; a.innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : "アカウント"; a.setAttribute("aria-label", "アカウント"); }
}
function render() {
  const on = live();
  $("live").classList.toggle("on", on && online && marketOn());
  $("livetxt").textContent = on ? (!online ? "再接続中…" : marketOn() ? "LIVE" : "待機中") : gate === "out" || gate === "join" ? "ログイン前" : "接続中";
  $("migbar").hidden = true;
  $("statsbtn").hidden = !on; chat.live(on); ach.update(on);
  $("bal").textContent = on && myP() ? fmt(myFree()) : "—";
  $("walletbtn").disabled = !(on && myP());
  const dbt = (myP() && myP().dep) || 0;
  $("debt").hidden = !(on && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (on) { wallet.watch(); wallet.draw(); }
  renderGate(); renderMid(); renderStats(); queueDraw();
}

/* ================= actions ================= */
async function order(side) {
  const margin = Math.min(amt, myFree());
  if (busy || margin < MIN_MARGIN) { if (margin < MIN_MARGIN) flash(`証拠金は ${MIN_MARGIN} から`); return; }
  busy = true; render();
  try { await call("fxOpen", { side, margin, lev }); flash(`${side === "buy" ? "買い" : "売り"} ×${lev}（${fmtK(margin)}）`); }
  catch (e) { flash(errMsg(e)); }
  busy = false; render();
}
async function close(id) {
  if (busy) return;
  busy = true; render();
  try { const r = await call("fxClose", { pos: id }); flash(`決済 ${sgn(r.d)}`); }
  catch (e) { flash(errMsg(e)); }
  busy = false; render();
}
$("obuy").addEventListener("click", () => order("buy"));
$("osell").addEventListener("click", () => order("sell"));
$("levs").addEventListener("click", (e) => { const b = e.target.closest(".lev"); if (b) { lev = +b.dataset.l; render(); } });
$("plist").addEventListener("click", (e) => { const b = e.target.closest(".pclose"); if (b) close(+b.dataset.id); });
$("closeall").addEventListener("click", () => close("all"));
$("cmode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; mode = b.dataset.m; document.querySelectorAll("#cmode button").forEach((x) => x.classList.toggle("on", x === b)); queueDraw(); });
$("mid").addEventListener("click", (e) => {
  if (e.target.closest("#clr")) { amt = 0; render(); return; }
  const c = e.target.closest(".chip"); if (!c) return;
  amt = c.dataset.v === "all" ? myFree() : Math.min(Math.min(amt, myFree()) + +c.dataset.v, myFree());
  render();
});

/* ================= shared modules ================= */
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
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
  const p = myP() || {}, st = p.fxst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.fxcurve || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>勝ち ${st.w}</span><span><i style="background:#ff7a84"></i>負け ${st.l}</span><span>${st.n}回</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">決済すると利益のグラフが出るよ</div>'; return; }
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
// The market only moves while someone is watching, so keep telling the server we're here (only while the tab is visible).
function watch() {
  if (!live() || !conn || document.visibilityState !== "visible") return;
  call("fxWatch").then((v) => { if (v) { fx = { price: v.price, lastAt: v.lastAt, ticks: [...(v.ticks || [])], candles: (v.candles || []).map((c) => [...c]) }; prevPrice = null; queueDraw(); render(); } }).catch(() => {});
}
setInterval(watch, 20000);
document.addEventListener("visibilitychange", watch);
function onTick(t, p) {
  prevPrice = fx.price; fx.price = p; fx.lastAt = t;
  fx.ticks.push([t, p]); if (fx.ticks.length > KEEP_TICKS) fx.ticks.splice(0, fx.ticks.length - KEEP_TICKS);
  const m = Math.floor(t / 60000) * 60000, c = fx.candles[fx.candles.length - 1];
  if (c && c[0] === m) { c[2] = Math.max(c[2], p); c[3] = Math.min(c[3], p); c[4] = p; }
  else fx.candles.push([m, c ? c[4] : p, Math.max(p, c ? c[4] : p), Math.min(p, c ? c[4] : p), p]);
  if (fx.candles.length > KEEP_CANDLES) fx.candles.splice(0, fx.candles.length - KEEP_CANDLES);
}
function checkStopOut() {
  const p = myP(); if (!p) return;
  const ids = new Set((p.fxPos || []).map((x) => x.id));
  const gone = [...myPosIds].filter((id) => !ids.has(id));
  if (gone.length && !busy && p.fxhist && p.fxhist[0] && p.fxhist[0].liq) flash(`ロスカット… ${sgn(p.fxhist[0].d)}`);
  myPosIds = ids;
}
function applyBatch(msgs) {
  let full = false;
  for (const m of msgs) {
    if (m.type === "fxTick") onTick(m.t, m.p);
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me) { checkStopOut(); if (m.p && gate === "join") { gate = "in"; watch(); } } full = true; }
    else if (m.type === "meta") importAvail = !(m.v && m.v.imported);
    else if (m.type === "chat") { chat.set(m.v); full = true; }
    else if (m.type === "notice") flash(m.text);
  }
  if (full) render(); else { $("livetxt").textContent = online ? "LIVE" : "再接続中…"; $("live").classList.toggle("on", online); queueDraw(); }
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset(); players = st.players || {}; importAvail = !(st.meta && st.meta.imported);
  myPosIds = new Set(((players[me] && players[me].fxPos) || []).map((x) => x.id));
  gate = players[me] ? "in" : "join";
  render(); watch();
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

setInterval(() => { if (live()) { renderQuote(); renderOrder(); $("livetxt").textContent = !online ? "再接続中…" : marketOn() ? "LIVE" : "待機中"; } }, 1000);
new ResizeObserver(() => queueDraw()).observe($("stage"));
render();
