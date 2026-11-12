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

/* ================= constants (keep in sync with server/src/fxgame.js) ================= */
const HL_DURS = { 30: 2.0, 60: 1.95, 180: 1.9, 300: 1.88 }, HL_MAX = 10;
const SPREAD = 0.006, LEVS = [1, 5, 10, 25, 50, 100], MAX_POS = 5, MIN_MARGIN = 100, KEEP_TICKS = 300, KEEP_CANDLES = 180;
const r3 = (x) => Math.round(x * 1000) / 1000;
const ask = (p) => r3(p + SPREAD / 2), bid = (p) => r3(p - SPREAD / 2);
// Mid price at which the loss reaches the whole margin (the server stops the position out there).
const liqPrice = (pos) => r3(pos.side > 0 ? pos.entry * (1 - 1 / pos.lev) + SPREAD / 2 : pos.entry * (1 + 1 / pos.lev) - SPREAD / 2);
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
let omode = "fx", dur = 60, hlSeen = null;
let amt = 1000, lev = 10, mode = "1", busy = false, statsOpen = false, flashMsg = "", flashT = null;
let showMA = true, btab = "book", ptab = "pos", hov = null, levOpen = false;
let myPosIds = new Set();
try { const m = localStorage.getItem("fxTf"); if (["tick", "1", "5", "15"].includes(m)) mode = m; showMA = localStorage.getItem("fxMA") !== "0"; } catch { /* storage blocked */ }

const myP = () => players[me];
const myFree = () => (myP() ? myP().chips : 0);
const live = () => gate === "in";
const marketOn = () => fx.lastAt && sNow() - fx.lastAt < 4000;
function flash(t) { flashMsg = t; renderQuote(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderQuote(); }, 2600); }
/** Only touch the DOM when the markup really changed (keeps hover states and avoids flicker). */
function setH(id, h) { const el = $(id); if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; } }
const hhmm = (t, sec) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}${sec ? ":" + String(d.getSeconds()).padStart(2, "0") : ""}`; };
const tfName = () => (mode === "tick" ? "ティック" : mode + "分足");

/* ================= chart ================= */
let drawQueued = false;
function queueDraw() { if (drawQueued) return; drawQueued = true; requestAnimationFrame(() => { drawQueued = false; drawChart(); renderHeader(); renderBook(); renderQuote(); renderPositions(); renderOrder(); }); }
/** Candles for the chosen time frame, built from the server's 1-minute candles. */
function series() {
  const n = +mode; if (n === 1) return fx.candles;
  const out = [];
  for (const c of fx.candles) {
    const k = Math.floor(c[0] / (n * 60000)) * n * 60000, l = out[out.length - 1];
    if (l && l[0] === k) { l[2] = Math.max(l[2], c[2]); l[3] = Math.min(l[3], c[3]); l[4] = c[4]; }
    else out.push([k, c[1], c[2], c[3], c[4]]);
  }
  return out;
}
const maAt = (cs, n, i) => { if (i < n - 1) return null; let s = 0; for (let j = i - n + 1; j <= i; j++) s += cs[j][4]; return s / n; };
function drawChart() {
  const svg = $("chart"), W = svg.clientWidth, H = svg.clientHeight;
  if (!W || !H) return;
  const top = 74, bot = 22, right = 74, left = 6, cw = W - left - right, ch = H - top - bot;
  const mine = (myP()?.fxPos) || [];
  let lo = Infinity, hi = -Infinity, h = "", legend = "", X = null, cs = null, n = 0, bw = 0, cx = null, all = null, off = 0;
  if (mode === "tick") {
    const pts = fx.ticks;
    if (pts.length < 2) { svg.innerHTML = ""; setH("clegend", ""); return; }
    for (const [, p] of pts) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  } else {
    all = series(); cs = all.slice(-Math.max(24, Math.floor(cw / 8))); off = all.length - cs.length;
    if (!cs.length) { svg.innerHTML = ""; setH("clegend", ""); return; }
    for (const c of cs) { lo = Math.min(lo, c[3]); hi = Math.max(hi, c[2]); }
  }
  for (const pos of mine) { if (Math.abs(pos.entry - fx.price) / fx.price < 0.03) { lo = Math.min(lo, pos.entry); hi = Math.max(hi, pos.entry); } }
  const pad = Math.max((hi - lo) * 0.1, fx.price * 0.0004); lo -= pad; hi += pad;
  const Y = (p) => top + (1 - (p - lo) / (hi - lo)) * ch, P = (y) => lo + (1 - (y - top) / ch) * (hi - lo);
  const step = niceStep((hi - lo) / 6), dec = step < 0.01 ? 3 : 2;
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = Y(v);
    h += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="gl"/><text x="${W - right + 8}" y="${y + 4}" class="gt">${v.toFixed(dec)}</text>`;
  }
  h += `<line x1="${W - right}" x2="${W - right}" y1="${top - 6}" y2="${top + ch}" class="ax"/><line x1="${left}" x2="${W - right}" y1="${top + ch}" y2="${top + ch}" class="ax"/>`;
  let hx = null, hp = null, ht = null;
  if (mode === "tick") {
    const pts = fx.ticks, t1 = pts[pts.length - 1][0], t0 = Math.min(t1 - 60000, Math.max(t1 - KEEP_TICKS * 1000, pts[0][0]));
    X = (t) => left + ((t - t0) / (t1 - t0)) * cw;
    const up = fx.price >= pts[0][1], col = up ? "var(--up)" : "var(--dn)";
    const d = pts.map(([t, p], i) => `${i ? "L" : "M"}${X(t).toFixed(1)},${Y(p).toFixed(1)}`).join("");
    const span = (t1 - t0) / 1000, every = span > 150 ? 60 : span > 70 ? 30 : 15;
    for (let s = every; s < span; s += every) { const x = X(t1 - s * 1000); h += `<line x1="${x}" x2="${x}" y1="${top - 6}" y2="${top + ch}" class="gl"/><text x="${x}" y="${H - 6}" class="gt mid">${hhmm(t1 - s * 1000, true)}</text>`; }
    h += `<defs><linearGradient id="ar" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col}" stop-opacity=".25"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></linearGradient></defs>`;
    h += `<path d="${d}L${X(t1)},${top + ch}L${X(pts[0][0])},${top + ch}Z" fill="url(#ar)"/><path d="${d}" class="ln ${up ? "up" : "dn"}"/>`;
    h += `<circle cx="${X(t1)}" cy="${Y(fx.price)}" r="3.5" class="dot ${up ? "up" : "dn"}"/><circle cx="${X(t1)}" cy="${Y(fx.price)}" r="9" class="pulse ${up ? "up" : "dn"}"/>`;
    let hit = pts[pts.length - 1];
    if (hov) { let best = Infinity; for (const q of pts) { const dx = Math.abs(X(q[0]) - hov.x); if (dx < best) { best = dx; hit = q; } } hx = X(hit[0]); ht = hit[0]; }
    legend = `<span class="lk">${hov ? hhmm(hit[0], true) : "いま"}</span> 価格 <b>${p3(hit[1])}</b>`;
  } else {
    n = cs.length; bw = cw / Math.max(n, 24);
    cx = (i) => left + cw - (n - i) * bw + bw / 2;
    const every = Math.max(1, Math.round(90 / bw));
    for (let i = n - 1; i >= 0; i -= every) { const x = cx(i); h += `<line x1="${x}" x2="${x}" y1="${top - 6}" y2="${top + ch}" class="gl"/><text x="${x}" y="${H - 6}" class="gt mid">${hhmm(cs[i][0])}</text>`; }
    cs.forEach((c, i) => {
      const x = cx(i), g = c[4] >= c[1];
      h += `<line x1="${x}" x2="${x}" y1="${Y(c[2])}" y2="${Y(c[3])}" class="wk ${g ? "up" : "dn"}"/><rect x="${x - bw * 0.36}" y="${Y(Math.max(c[1], c[4]))}" width="${Math.max(1, bw * 0.72)}" height="${Math.max(1, Math.abs(Y(c[1]) - Y(c[4])))}" class="cd ${g ? "up" : "dn"}"/>`;
    });
    const m7 = [], m25 = [];
    if (showMA) {
      for (let i = 0; i < n; i++) { m7.push(maAt(all, 7, i + off)); m25.push(maAt(all, 25, i + off)); }
      const path = (arr) => arr.map((v, i) => (v === null ? "" : `${arr[i - 1] == null ? "M" : "L"}${cx(i).toFixed(1)},${Y(v).toFixed(1)}`)).join("");
      h += `<g clip-path="url(#cclip)"><path d="${path(m7)}" class="ma m7"/><path d="${path(m25)}" class="ma m25"/></g><defs><clipPath id="cclip"><rect x="${left}" y="${top}" width="${cw}" height="${ch}"/></clipPath></defs>`;
    }
    let i = n - 1;
    if (hov) { i = Math.max(0, Math.min(n - 1, Math.round((hov.x - left - cw + n * bw - bw / 2) / bw))); hx = cx(i); ht = cs[i][0]; }
    const c = cs[i], chg = ((c[4] - c[1]) / c[1]) * 100, cl = c[4] >= c[1] ? "up" : "dn";
    legend = `<span class="lk">${hhmm(c[0])}</span> 始 <b class="${cl}">${p3(c[1])}</b> 高 <b class="${cl}">${p3(c[2])}</b> 安 <b class="${cl}">${p3(c[3])}</b> 終 <b class="${cl}">${p3(c[4])}</b> <b class="${cl}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</b>`
      + (showMA ? `<br><span class="m7">MA7 ${m7[i] == null ? "—" : p3(m7[i])}</span>　<span class="m25">MA25 ${m25[i] == null ? "—" : p3(m25[i])}</span>` : "");
  }
  // my liquidation and entry lines
  const used = [];
  for (const pos of mine) {
    const yl = Y(liqPrice(pos));
    if (yl >= top - 4 && yl <= top + ch + 4) h += `<line x1="${left}" x2="${W - right}" y1="${yl}" y2="${yl}" class="lqln"/><text x="${left + 6}" y="${yl - 4}" class="lqt">ロスカット ${p3(liqPrice(pos))}（${pos.side > 0 ? "ロング" : "ショート"} ${pos.lev}x）</text>`;
    const y = Y(pos.entry); if (y < top - 4 || y > top + ch + 4) continue;
    const d = pnl(pos, fx.price);
    let by = y; while (used.some((u) => Math.abs(u - by) < 20)) by += 20; // stack labels that would overlap
    used.push(by);
    h += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="en ${pos.side > 0 ? "b" : "s"}"/><g transform="translate(${W - right - 138},${by - 9})"><rect width="${132}" height="18" rx="3" class="etb ${pos.side > 0 ? "b" : "s"}"/><text x="6" y="12.5" class="et">${pos.side > 0 ? "ロング" : "ショート"} ${pos.lev}x</text><text x="126" y="12.5" class="et2 ${d >= 0 ? "up" : "dn"}" text-anchor="end">${sgn(d)}</text></g>`;
  }
  for (const o of (myP()?.hl) || []) {
    const y = Y(o.entry); if (y < top - 4 || y > top + ch + 4) continue;
    const secs = Math.max(0, Math.ceil((o.exp - sNow()) / 1000));
    h += `<line x1="${left}" x2="${W - right}" y1="${y}" y2="${y}" class="hlln"/><text x="${W - right - 6}" y="${y + 13}" class="hlt" text-anchor="end">${o.dir > 0 ? "▲HIGH" : "▼LOW"} あと${secs}秒</text>`;
  }
  // current price line + tag (with a countdown to the candle close, like the exchanges)
  const yp = Y(fx.price), tick = prevPrice === null || fx.price >= prevPrice;
  let cd = "";
  if (mode !== "tick") { const span = +mode * 60000, left_ = span - (sNow() % span), s = Math.ceil(left_ / 1000); cd = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; }
  h += `<line x1="${left}" x2="${W - right}" y1="${yp}" y2="${yp}" class="cur ${tick ? "up" : "dn"}"/><rect x="${W - right + 1}" y="${yp - 10}" width="${right - 2}" height="${cd ? 34 : 20}" rx="2" class="tag ${tick ? "up" : "dn"}"/><text x="${W - right + 7}" y="${yp + 4}" class="tagt">${p3(fx.price)}</text>${cd ? `<text x="${W - right + 7}" y="${yp + 19}" class="tagt sm">${cd}</text>` : ""}`;
  // crosshair
  if (hov && hov.y >= top && hov.y <= top + ch && hx !== null) {
    h += `<line x1="${hx}" x2="${hx}" y1="${top - 6}" y2="${top + ch}" class="xh"/><line x1="${left}" x2="${W - right}" y1="${hov.y}" y2="${hov.y}" class="xh"/>`
      + `<rect x="${W - right + 1}" y="${hov.y - 10}" width="${right - 2}" height="20" rx="2" class="xhb"/><text x="${W - right + 7}" y="${hov.y + 4}" class="xht">${p3(P(hov.y))}</text>`
      + `<rect x="${hx - 34}" y="${top + ch + 2}" width="68" height="18" rx="2" class="xhb"/><text x="${hx}" y="${top + ch + 15}" class="xht" text-anchor="middle">${hhmm(ht, mode === "tick")}</text>`;
  }
  svg.innerHTML = h;
  setH("clegend", legend);
}
function niceStep(x) { const e = Math.pow(10, Math.floor(Math.log10(x))), f = x / e; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * e; }
{
  const svg = $("chart"), at = (e) => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  let hideT = null;
  svg.addEventListener("pointermove", (e) => { if (e.pointerType === "touch" && !e.isPrimary) return; hov = at(e); clearTimeout(hideT); queueDraw(); });
  svg.addEventListener("pointerdown", (e) => { hov = at(e); queueDraw(); });
  svg.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") { hov = null; queueDraw(); } });
  svg.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") { clearTimeout(hideT); hideT = setTimeout(() => { hov = null; queueDraw(); }, 2500); } });
}

/* ================= header / book ================= */
function market() {
  let L = 0, S = 0, n = 0;
  for (const p of Object.values(players)) for (const pos of p.fxPos || []) { const v = pos.margin * pos.lev; if (pos.side > 0) L += v; else S += v; n++; }
  return { L, S, n };
}
function renderHeader() {
  const up = prevPrice === null || fx.price >= prevPrice;
  const c0 = fx.candles[0], ref = c0 ? c0[1] : fx.ticks.length ? fx.ticks[0][1] : fx.price, chg = fx.price - ref, pct = ref ? (chg / ref) * 100 : 0;
  let hi = fx.price, lo = fx.price; for (const c of fx.candles) { hi = Math.max(hi, c[2]); lo = Math.min(lo, c[3]); }
  const mins = c0 ? Math.max(1, Math.round((sNow() - c0[0]) / 60000)) : 0, span = mins >= 60 ? Math.round(mins / 60) + "時間" : mins + "分";
  const el = $("hlast"); el.textContent = p3(fx.price); el.className = "num " + (up ? "up" : "dn");
  $("hlastsub").innerHTML = `<span class="${chg >= 0 ? "up" : "dn"}">${chg >= 0 ? "+" : ""}${pct.toFixed(2)}%</span>`;
  const m = market(), tot = m.L + m.S;
  setH("xstats", `<div><span>${span}変動</span><b class="num ${chg >= 0 ? "up" : "dn"}">${chg >= 0 ? "+" : ""}${chg.toFixed(3)}</b></div>`
    + `<div><span>${span}高値</span><b class="num">${p3(hi)}</b></div><div><span>${span}安値</span><b class="num">${p3(lo)}</b></div>`
    + `<div><span>建玉</span><b class="num">${fmtK(tot)}</b></div>`
    + `<div><span>ロング/ショート</span><b class="num">${tot ? `<i class="up">${Math.round((m.L / tot) * 100)}%</i> / <i class="dn">${Math.round((m.S / tot) * 100)}%</i>` : "—"}</b></div>`
    + `<div><span>スプレッド</span><b class="num">${SPREAD.toFixed(3)}</b></div>`);
  document.title = `${p3(fx.price)} ${chg >= 0 ? "▲" : "▼"} KURI/JPY · FX`;
}
const hash = (x) => { x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); x = Math.imul(x ^ (x >>> 16), 0x45d9f3b); return (x ^ (x >>> 16)) >>> 0; };
function renderBook() {
  $("bookv").hidden = btab !== "book"; $("tradesv").hidden = btab !== "trades";
  document.querySelectorAll("#btabs button").forEach((b) => b.classList.toggle("on", b.dataset.b === btab));
  const up = prevPrice === null || fx.price >= prevPrice;
  if (btab === "book") {
    const rows = window.matchMedia("(max-width:760px)").matches ? 7 : 10, stepP = 0.002, tn = Math.floor((fx.lastAt || 0) / 1000);
    // Decoration only: sizes are made up from the price level, wobbling a little every tick.
    const size = (px) => { const k = Math.round(px * 1000), a = hash(k), b = hash(k * 31 + tn); return Math.round((40 + (a % 2400)) * (0.55 + (b % 1000) / 1100)); };
    const side = (start, dir) => { let cum = 0; return Array.from({ length: rows }, (_, i) => { const px = r3(start + dir * i * stepP), s = size(px); cum += s; return { px, s, cum }; }); };
    const as = side(ask(fx.price), 1), bs = side(bid(fx.price), -1), mx = Math.max(as[rows - 1].cum, bs[rows - 1].cum);
    const row = (r, cls) => `<div class="bkr ${cls}" style="--w:${((r.cum / mx) * 100).toFixed(1)}%"><span>${p3(r.px)}</span><span>${fmt(r.s)}</span><span>${fmtK(r.cum)}</span></div>`;
    setH("asks", [...as].reverse().map((r) => row(r, "a")).join(""));
    setH("bids", bs.map((r) => row(r, "b")).join(""));
    setH("bmid", `<b class="num ${up ? "up" : "dn"}">${p3(fx.price)} ${up ? "↑" : "↓"}</b><span class="mut num">買 ${p3(ask(fx.price))} / 売 ${p3(bid(fx.price))}</span>`);
    const m = market(), tot = m.L + m.S, lp = tot ? Math.round((m.L / tot) * 100) : 50;
    setH("lsr", `<div class="lsrbar"><i style="width:${lp}%"></i></div><div class="lsrt"><span class="up">L ${tot ? lp + "%" : "—"}</span><span class="mut">みんなの建玉</span><span class="dn">${tot ? 100 - lp + "%" : "—"} S</span></div>`);
  } else {
    const t = fx.ticks.slice(-40);
    setH("trades", t.map((q, i) => [q, t[i - 1]]).reverse().map(([q, pv]) => { const d = pv ? q[1] - pv[1] : 0; return `<div class="bkr"><span class="${d >= 0 ? "up" : "dn"}">${p3(q[1])}</span><span class="${d > 0 ? "up" : d < 0 ? "dn" : "mut"}">${d > 0 ? "+" : ""}${d.toFixed(3)}</span><span class="mut">${hhmm(q[0], true)}</span></div>`; }).join("") || '<div class="empty small">まだ約定がないよ</div>');
  }
}
function renderQuote() {
  const msg = flashMsg || (live() && !marketOn() ? "相場をつないでます…" : "");
  $("quote").hidden = !msg; $("quote").textContent = msg;
}

/* ================= order panel ================= */
const durTxt = (s) => (s < 60 ? s + "秒" : s / 60 + "分");
function parseAmt(s) {
  const m = String(s).replace(/[,\s，]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)([kmbt]?)$/);
  if (!m) return 0;
  return Math.floor(+m[1] * ({ "": 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 })[m[2]]);
}
function syncAmt() {
  const inp = $("amtin"), free = myFree();
  if (document.activeElement !== inp) { const v = amt ? fmt(amt) : ""; if (inp.value !== v) inp.value = v; }
  const pc = free > 0 ? Math.min(100, Math.round((amt / free) * 100)) : 0;
  if (document.activeElement !== $("pct")) $("pct").value = String(pc);
  $("pct").style.setProperty("--p", pc + "%");
  document.querySelectorAll("#pmarks button").forEach((b) => b.classList.toggle("on", pc >= +b.dataset.p));
}
function renderOrder() {
  document.querySelectorAll("#otabs button").forEach((b) => b.classList.toggle("on", b.dataset.o === omode));
  $("fxctl").hidden = omode !== "fx"; $("durs").hidden = omode !== "hl";
  $("levbtn").textContent = lev + "x"; $("levbtn").setAttribute("aria-expanded", String(levOpen)); $("levpop").hidden = !levOpen || omode !== "fx";
  setH("levpop", LEVS.map((l) => `<button class="${l === lev ? "on" : ""}" data-l="${l}" role="radio" aria-checked="${l === lev}">${l}x</button>`).join("") + `<div class="mut small">倍率が高いほど少しの値動きでロスカットされる</div>`);
  $("amtlb").textContent = omode === "hl" ? "掛け金" : "証拠金";
  syncAmt();
  const a = Math.min(amt, myFree()), on = live();
  if (omode === "hl") {
    setH("durs", Object.entries(HL_DURS).map(([s, r]) => `<button class="${+s === dur ? "on" : ""}" data-d="${s}" role="radio" aria-checked="${+s === dur}">${durTxt(+s)}<small>×${r.toFixed(2)}</small></button>`).join(""));
    setH("ordinfo", on ? `<div><span>判定</span><b>${durTxt(dur)}後</b></div><div><span>当たり</span><b class="num">${fmt(Math.floor(a * HL_DURS[dur]))}</b></div><div><span>同じ値段</span><b>負け</b></div>` : "");
    const can = on && marketOn() && !busy && a >= 100 && ((myP()?.hl) || []).length < HL_MAX;
    $("obuy").disabled = !can; $("osell").disabled = !can;
    $("obuyt").textContent = "HIGH ▲"; $("osellt").textContent = "LOW ▼";
    $("obuys").textContent = `${durTxt(dur)}後に上`; $("osells").textContent = `${durTxt(dur)}後に下`;
    setH("obuym", `<span>基準 ${p3(fx.price)}</span><span>払戻 ${fmtK(Math.floor(a * HL_DURS[dur]))}</span>`);
    setH("osellm", `<span>基準 ${p3(fx.price)}</span><span>払戻 ${fmtK(Math.floor(a * HL_DURS[dur]))}</span>`);
  } else {
    const move = Math.floor(a * lev * 0.01);
    setH("ordinfo", on ? `<div><span>取引額</span><b class="num">${fmtK(a * lev)}</b></div><div><span>1%動くと</span><b class="num">±${fmtK(move)}</b></div><div><span>ロスカットまで</span><b class="num">${(100 / lev).toFixed(lev >= 50 ? 1 : 0)}%</b></div>` : "");
    const can = on && marketOn() && !busy && a >= MIN_MARGIN && ((myP()?.fxPos) || []).length < MAX_POS;
    $("obuy").disabled = !can; $("osell").disabled = !can;
    $("obuyt").textContent = "ロング"; $("osellt").textContent = "ショート"; $("obuys").textContent = "買い・上がると思う"; $("osells").textContent = "売り・下がると思う";
    const lq = (side) => { const p = liqPrice({ side, entry: side > 0 ? ask(fx.price) : bid(fx.price), lev }); return lev === 1 && side > 0 ? "なし" : p3(p); };
    setH("obuym", `<span>価格 ${p3(ask(fx.price))}</span><span>コスト ${fmtK(a)}</span><span>ロスカット ${lq(1)}</span>`);
    setH("osellm", `<span>価格 ${p3(bid(fx.price))}</span><span>コスト ${fmtK(a)}</span><span>ロスカット ${lq(-1)}</span>`);
  }
  // account box
  const p = myP() || {}, used = (p.fxPos || []).reduce((s, x) => s + x.margin, 0) + (p.hl || []).reduce((s, x) => s + x.amount, 0);
  const upnl = (p.fxPos || []).reduce((s, x) => s + pnl(x, fx.price), 0), dbt = p.dep || 0;
  setH("xacct", on ? `<div class="xh2">アカウント</div><div><span>残高</span><b class="num">${fmt(myFree())}</b></div><div><span>使用中</span><b class="num">${fmt(used)}</b></div><div><span>含み損益</span><b class="num ${upnl > 0 ? "up" : upnl < 0 ? "dn" : ""}">${sgn(upnl)}</b></div>${dbt > 0 ? `<div><span>借金</span><b class="num dn">${fmt(dbt)}</b></div>` : ""}` : "");
}

/* ================= positions ================= */
const symCell = (side, lev_) => `<div class="sym"><b>KURI/JPY</b><span class="stag ${side > 0 ? "long" : "short"}">${side > 0 ? "ロング" : "ショート"}${lev_ ? " " + lev_ + "x" : ""}</span></div>`;
function posTable(rows, others) {
  if (!rows.length) return "";
  return `<table class="xtbl"><thead><tr>${others ? "<th>プレイヤー</th>" : ""}<th>銘柄</th><th>取引額</th><th>建値</th><th>現在値</th><th>ロスカット価格</th><th>証拠金</th><th>含み損益（ROE）</th>${others ? "" : "<th></th>"}</tr></thead><tbody>`
    + rows.map(([owner, pos]) => {
      const d = pnl(pos, fx.price), roe = (d / pos.margin) * 100, mark = pos.side > 0 ? bid(fx.price) : ask(fx.price);
      return `<tr class="${!others && roe <= -70 ? "danger" : ""}">${others ? `<td data-l="プレイヤー" class="who">${avatar(owner, esc)}<span>${esc(owner.name)}</span></td>` : ""}<td class="first">${symCell(pos.side, pos.lev)}</td>`
        + `<td data-l="取引額" class="num">${fmtK(pos.margin * pos.lev)}</td><td data-l="建値" class="num">${p3(pos.entry)}</td><td data-l="現在値" class="num">${p3(mark)}</td>`
        + `<td data-l="ロスカット価格" class="num lq">${pos.lev === 1 && pos.side > 0 ? "なし" : p3(liqPrice(pos))}</td><td data-l="証拠金" class="num">${fmt(pos.margin)}</td>`
        + `<td data-l="含み損益（ROE）" class="num pl ${d >= 0 ? "up" : "dn"}"><b>${sgn(d)}</b><small>${roe >= 0 ? "+" : ""}${roe.toFixed(2)}%</small></td>`
        + (others ? "" : `<td class="act"><button class="pclose" data-id="${pos.id}" ${busy ? "disabled" : ""}>成行決済</button></td>`) + `</tr>`;
    }).join("") + `</tbody></table>`;
}
function renderPositions() {
  const p = myP() || {}, mine = p.fxPos || [], hls = p.hl || [];
  $("tc_pos").textContent = mine.length ? ` (${mine.length})` : ""; $("tc_hl").textContent = hls.length ? ` (${hls.length})` : "";
  document.querySelectorAll("#ptabs button[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === ptab));
  $("closeall").hidden = !(ptab === "pos" && mine.length >= 2); $("closeall").disabled = busy;
  const empty = (t) => `<div class="empty">${t}</div>`;
  let h = "";
  if (!live() && ptab !== "all" && ptab !== "rank") h = empty("ログインすると自分のポジションがここに出るよ");
  else if (ptab === "pos") h = posTable(mine.map((x) => [null, x]), false) || empty(`ポジションなし。注文パネルで証拠金を決めて、ロングかショートを押してね（最大${MAX_POS}つ）`);
  else if (ptab === "hl") {
    h = hls.length ? `<table class="xtbl"><thead><tr><th>銘柄</th><th>掛け金</th><th>判定</th><th>基準価格</th><th>現在値</th><th>配当</th><th>残り</th><th>見込み</th></tr></thead><tbody>`
      + hls.map((o) => {
        const left = Math.max(0, Math.ceil((o.exp - sNow()) / 1000)), diff = fx.price - o.entry, win = o.dir * diff > 0;
        return `<tr class="${win ? "win" : "lose"}"><td class="first"><div class="sym"><b>KURI/JPY</b><span class="stag ${o.dir > 0 ? "long" : "short"}">${o.dir > 0 ? "HIGH ▲" : "LOW ▼"}</span></div></td><td data-l="掛け金" class="num">${fmt(o.amount)}</td><td data-l="判定" class="num">${durTxt(o.dur || 60)}</td><td data-l="基準価格" class="num">${p3(o.entry)}</td><td data-l="現在値" class="num">${p3(fx.price)}</td><td data-l="配当" class="num">×${o.rate.toFixed(2)}</td><td data-l="残り" class="num cdn">${left}秒</td><td data-l="見込み" class="num pl ${win ? "up" : "dn"}"><b>${win ? "+" + fmt(Math.floor(o.amount * o.rate) - o.amount) : "-" + fmt(o.amount)}</b><small>${win ? "当たり中" : diff === 0 ? "同値（負け）" : "はずれ中"}</small></td></tr>`;
      }).join("") + `</tbody></table>` : empty("ハイローのポジションなし。注文パネルの「ハイロー」タブから入れるよ");
  } else if (ptab === "hist") {
    const rows = [...(p.fxhist || []).map((x) => ({ ...x, k: "fx" })), ...(p.hlhist || []).map((x) => ({ ...x, k: "hl" }))].sort((a, b) => b.at - a.at).slice(0, 24);
    h = rows.length ? `<table class="xtbl"><thead><tr><th>銘柄</th><th>時刻</th><th>種類</th><th>建値 → 決済</th><th>金額</th><th>損益</th></tr></thead><tbody>`
      + rows.map((x) => `<tr><td class="first">${x.k === "fx" ? symCell(x.side, x.lev) : `<div class="sym"><b>KURI/JPY</b><span class="stag ${x.dir > 0 ? "long" : "short"}">${x.dir > 0 ? "HIGH" : "LOW"}</span></div>`}</td><td data-l="時刻" class="num">${hhmm(x.at, true)}</td><td data-l="種類">${x.k === "fx" ? (x.liq ? '<span class="dn">ロスカット</span>' : "決済") : "ハイロー " + durTxt(x.dur || 60)}</td><td data-l="建値 → 決済" class="num">${p3(x.entry)} → ${p3(x.exit)}</td><td data-l="${x.k === "fx" ? "証拠金" : "掛け金"}" class="num">${fmt(x.k === "fx" ? x.margin : x.amount)}</td><td data-l="損益" class="num pl ${x.d >= 0 ? "up" : "dn"}"><b>${sgn(x.d)}</b></td></tr>`).join("")
      + `</tbody></table>` : empty("まだ取引してないよ");
  } else if (ptab === "all") {
    const rows = [];
    for (const [uid, q] of Object.entries(players)) if (uid !== me) for (const pos of q.fxPos || []) rows.push([q, pos]);
    h = posTable(rows, true) || empty("ほかの人のポジションはまだないよ");
  } else {
    const rank = Object.entries(players).filter(([, q]) => q.fxst && q.fxst.n).sort((a, b) => b[1].fxst.prof - a[1].fxst.prof).slice(0, 20);
    h = rank.length ? `<table class="xtbl rank"><thead><tr><th>#</th><th>プレイヤー</th><th>トレード数</th><th>勝率</th><th>FX収支</th></tr></thead><tbody>`
      + rank.map(([uid, q], i) => { const st = q.fxst, dec = st.w + st.l; return `<tr class="${uid === me ? "meRow" : ""}"><td class="rk">${i + 1}</td><td data-l="" class="who">${avatar(q, esc)}<span>${esc(q.name)}${uid === me ? '<span class="you">あなた</span>' : ""}</span></td><td data-l="トレード数" class="num">${fmt(st.n)}</td><td data-l="勝率" class="num">${dec ? Math.round((st.w / dec) * 100) + "%" : "–"}</td><td data-l="FX収支" class="num pl ${st.prof >= 0 ? "up" : "dn"}"><b>${sgn(st.prof)}</b></td></tr>`; }).join("")
      + `</tbody></table>` : empty("まだ誰もトレードしてないよ");
  }
  setH("ptab", h);
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
  if (on) { wallet.watch(); wallet.draw(); }
  renderGate(); renderStats(); queueDraw();
}

/* ================= actions ================= */
async function order(side) {
  if (omode === "hl") {
    const a = Math.min(amt, myFree());
    if (busy || a < 100) { if (a < 100) flash("掛け金は 100 から"); return; }
    busy = true; render();
    try { await call("hlOpen", { dir: side === "buy" ? "high" : "low", amount: a, dur }); flash(`${side === "buy" ? "HIGH" : "LOW"}・${durTxt(dur)}（${fmtK(a)}）`); }
    catch (e) { flash(errMsg(e)); }
    busy = false; render(); return;
  }
  const margin = Math.min(amt, myFree());
  if (busy || margin < MIN_MARGIN) { if (margin < MIN_MARGIN) flash(`証拠金は ${MIN_MARGIN} から`); return; }
  busy = true; render();
  try { await call("fxOpen", { side, margin, lev }); flash(`${side === "buy" ? "ロング" : "ショート"} ${lev}x（${fmtK(margin)}）約定`); }
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
$("otabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { omode = b.dataset.o; levOpen = false; render(); } });
$("btabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { btab = b.dataset.b; queueDraw(); } });
$("ptabs").addEventListener("click", (e) => { const b = e.target.closest("button[data-t]"); if (b) { ptab = b.dataset.t; queueDraw(); } });
$("durs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { dur = +b.dataset.d; render(); } });
$("levbtn").addEventListener("click", (e) => { e.stopPropagation(); levOpen = !levOpen; render(); });
$("levpop").addEventListener("click", (e) => { e.stopPropagation(); const b = e.target.closest("button"); if (b) { lev = +b.dataset.l; levOpen = false; render(); } });
document.addEventListener("click", () => { if (levOpen) { levOpen = false; render(); } });
$("ptab").addEventListener("click", (e) => { const b = e.target.closest(".pclose"); if (b) close(+b.dataset.id); });
$("closeall").addEventListener("click", () => close("all"));
$("cmode").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  mode = b.dataset.m; try { localStorage.setItem("fxTf", mode); } catch { /* ignore */ }
  document.querySelectorAll("#cmode button").forEach((x) => x.classList.toggle("on", x === b));
  $("tflabel").textContent = tfName(); $("mabtn").hidden = mode === "tick"; queueDraw();
});
$("mabtn").addEventListener("click", () => { showMA = !showMA; try { localStorage.setItem("fxMA", showMA ? "1" : "0"); } catch { /* ignore */ } $("mabtn").classList.toggle("on", showMA); $("mabtn").setAttribute("aria-pressed", String(showMA)); queueDraw(); });
document.querySelectorAll("#cmode button").forEach((x) => x.classList.toggle("on", x.dataset.m === mode));
$("tflabel").textContent = tfName(); $("mabtn").hidden = mode === "tick"; $("mabtn").classList.toggle("on", showMA);
$("amtin").addEventListener("input", () => { amt = parseAmt($("amtin").value); syncAmt(); renderOrder(); });
$("amtin").addEventListener("blur", () => { amt = Math.min(amt, myFree()); syncAmt(); renderOrder(); });
$("amtin").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing) $("amtin").blur(); });
$("pct").addEventListener("input", () => { amt = Math.floor((myFree() * +$("pct").value) / 100); syncAmt(); renderOrder(); });
$("pmarks").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { amt = Math.floor((myFree() * +b.dataset.p) / 100); syncAmt(); renderOrder(); } });

/* ================= shared modules ================= */
setupGames("fx");
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
  // High/Low results
  const hh = p.hlhist || [], top = hh[0] ? hh[0].at + ":" + hh.length : "";
  if (hlSeen !== null && top && top !== hlSeen) { const x = hh[0]; flash(x.d > 0 ? `ハイロー当たり！ +${fmt(x.d)}` : `ハイローはずれ… ${fmt(x.d)}`); }
  hlSeen = top;
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
    else if (m.type === "duels") duelw.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  if (full) render(); else { $("bal").textContent = myP() ? fmt(myFree()) : "—"; $("livetxt").textContent = online ? "LIVE" : "再接続中…"; $("live").classList.toggle("on", online); queueDraw(); }
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); duelw.set(st.duels, true); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset(); players = st.players || {}; importAvail = !(st.meta && st.meta.imported);
  myPosIds = new Set(((players[me] && players[me].fxPos) || []).map((x) => x.id));
  { const hh = (players[me] && players[me].hlhist) || []; hlSeen = hh[0] ? hh[0].at + ":" + hh.length : ""; }
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

setInterval(() => { if (live()) { queueDraw(); $("livetxt").textContent = !online ? "再接続中…" : marketOn() ? "LIVE" : "待機中"; } }, 1000);
new ResizeObserver(() => queueDraw()).observe($("stage"));
render();
