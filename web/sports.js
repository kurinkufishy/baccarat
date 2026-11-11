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

/* ================= constants (keep in sync with server/src/sports.js) ================= */
const PLAY_MS = 45000;
const CHIPS = [{ v: 100, c: "#3f7fbf", l: "100" }, { v: 1000, c: "#1f9d55", l: "1K" }, { v: 10000, c: "#2b2b33", l: "10K" }, { v: 100000, c: "#c98a12", l: "100K" }, { v: 1000000, c: "#0f8f8a", l: "1M" }, { v: 100000000, c: "#b0306a", l: "100M" }];
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const fmtK = (n) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return s + (a >= 1e12 ? (+(a / 1e12).toFixed(1)) + "T" : a >= 1e9 ? (+(a / 1e9).toFixed(1)) + "B" : a >= 1e6 ? (+(a / 1e6).toFixed(1)) + "M" : a >= 1000 ? (+(a / 1000).toFixed(1)) + "K" : String(a)); };
const sgn = (n) => (n > 0 ? "+" : "") + fmt(n);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const sum = (b) => Object.values(b || {}).reduce((a, v) => a + v, 0);

/* ================= sign-in + server ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
const auth = configured ? getAuth(initializeApp(firebaseConfig)) : null;
let conn = null, online = false;
const sNow = () => Date.now() + (conn ? conn.offset() : 0);
const call = (name, data) => (conn ? conn.call(name, data) : Promise.reject(new Error("接続中…少し待ってね")));
const errMsg = (e) => (e && e.message ? e.message : "うまくいかなかった。もう一度試してね");

/* ================= state ================= */
let user = null, me = null, gate = "loading", gateErr = "", joining = false;
let players = {}, sp = null, spBets = {}, want = null, sending = false, chip = 1000, statsOpen = false, flashMsg = "", flashT = null;
const live = () => gate === "in";
const myP = () => players[me];
const serverBets = () => { const b = spBets[me]; return sp && b && b.round === sp.round ? b.bets : {}; };
const myBets = () => want || serverBets();
const myFree = () => (myP() ? myP().chips - (sum(myBets()) - sum(serverBets())) : 0);
const open = () => sp && sp.match && (sp.phase === "paused" || (sp.phase === "betting" && sNow() < sp.closesAt - 300));
function flash(t) { flashMsg = t; renderPill(); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderPill(); }, 2600); }
const LABEL = { h: "ホーム勝ち", d: "引き分け", a: "アウェイ勝ち", o: "2.5点より多い", u: "2.5点より少ない", by: "両チーム得点する", bn: "両チーム得点しない" };
const SHORT = { h: "ホーム", d: "引分", a: "アウェイ", o: "オーバー", u: "アンダー", by: "両得点○", bn: "両得点×" };

/* ================= match clock ================= */
// Game minute (0..90) at time t.
const minuteAt = (t) => (sp && sp.phase === "playing" ? Math.max(0, Math.min(90, ((t - sp.startAt) / PLAY_MS) * 90)) : sp && sp.phase === "result" ? 90 : 0);
const shownEvents = (t) => (sp && sp.ev ? sp.ev.filter((e) => e.m <= minuteAt(t)) : []);
const scoreAt = (t) => { const ev = shownEvents(t).filter((e) => e.k === "goal"); return [ev.filter((e) => e.s === 0).length, ev.filter((e) => e.s === 1).length]; };

/* ================= pitch animation ================= */
// The ball follows a planned path: calm passing around midfield, then a build-up into the box before every chance or
// goal, a shot, and (after a goal) a restart from the centre. The plan is seeded by the match number, so everyone
// sees the same play. Home attacks to the right.
const MEN = [[0.07, 0.5], [0.24, 0.28], [0.24, 0.72], [0.4, 0.42], [0.44, 0.64]];
let menBuilt = "", pathKey = "", path = [];
const men = [[], []];
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function buildPath() {
  const key = sp ? sp.round + ":" + (sp.ev ? sp.ev.length : "-") : "";
  if (key === pathKey) return;
  pathKey = key; path = [[0, 0.5, 0.5]];
  if (!sp || !sp.ev) return;
  const r = rng(sp.round * 7919 + 17);
  let t = 0, x = 0.5, y = 0.5;
  const push = (m, px, py) => { if (m <= t) m = t + 0.15; t = m; x = px; y = py; path.push([m, px, py]); };
  const wander = (until) => { for (;;) { const next = t + 0.7 + r() * 0.5; if (next > until - 0.6) break; push(next, clamp(x + (r() - 0.5) * 0.3, 0.22, 0.78), clamp(0.5 + (r() - 0.5) * 0.66, 0.14, 0.86)); } };
  for (const e of [...sp.ev].sort((a, b) => a.m - b.m)) {
    // Two events close together: play the second one a little later so the ball never flies across the pitch.
    const dir = e.s === 0 ? 1 : -1, start = Math.max(t + 0.6, e.m - 2.6), em = Math.max(e.m, start + 1.8);
    wander(start);
    push(start, 0.5 + dir * 0.08, clamp(y, 0.25, 0.75));
    push(start + (em - start) * 0.5, 0.5 + dir * 0.27, 0.3 + r() * 0.4);
    push(em - 0.4, 0.5 + dir * 0.37, 0.36 + r() * 0.28);
    if (e.k === "goal") {
      push(em, 0.5 + dir * 0.5, 0.47 + r() * 0.06);   // in the net
      push(t + 0.8, 0.5 + dir * 0.5, y);              // stays there for a moment
      push(t + 1.4, 0.5, 0.5);                        // back to the centre spot
      push(t + 0.5, 0.5, 0.5);
    } else {
      const wide = r() < 0.5 ? -1 : 1;
      push(em, 0.5 + dir * 0.49, 0.5 + wide * (0.12 + r() * 0.06)); // shot just wide / saved
      push(t + 0.7, 0.5 + dir * 0.42, 0.5 + wide * 0.1);           // goal kick
      push(t + 1.2, 0.5 + dir * 0.12, 0.3 + r() * 0.4);
    }
  }
  wander(90);
  push(Math.max(t + 0.5, 90), 0.5, 0.5);
}
function ballAt(t) {
  if (!sp || sp.phase === "paused" || sp.phase === "betting") return [0.5, 0.5];
  buildPath();
  const m = minuteAt(t);
  let i = 1;
  while (i < path.length && path[i][0] < m) i++;
  if (i >= path.length) { const l = path[path.length - 1]; return [l[1], l[2]]; }
  const a = path[i - 1], b = path[i], k = clamp((m - a[0]) / (b[0] - a[0] || 1), 0, 1), s = k * k * (3 - 2 * k);
  return [a[1] + (b[1] - a[1]) * s, a[2] + (b[2] - a[2]) * s];
}
function buildMen() {
  const m = sp && sp.match; if (!m) return;
  const key = sp.round + m.home.c1 + m.away.c1; if (key === menBuilt) return; menBuilt = key;
  $("men").innerHTML = [0, 1].map((s) => MEN.map((_, i) => `<i class="man ${i === 0 ? "gk" : ""}" id="man${s}${i}" style="--c1:${s ? m.away.c1 : m.home.c1};--c2:${s ? m.away.c2 : m.home.c2}"></i>`).join("")).join("");
  for (let s = 0; s < 2; s++) men[s] = MEN.map(([fx, fy]) => [s ? 1 - fx : fx, fy]);
}
function frame() {
  requestAnimationFrame(frame);
  if (!sp || !sp.match) return;
  buildMen();
  const t = sNow(), [bx, by] = ballAt(t), el = $("pitch"), W = el.clientWidth, H = el.clientHeight;
  $("ball").style.transform = `translate(${bx * W - 6}px,${by * H - 6}px)`;
  const playing = sp.phase === "playing" && t >= sp.startAt;
  for (let s = 0; s < 2; s++) {
    // The outfield player closest to the ball goes for it; the rest keep shape and slide with play.
    let near = -1, best = 9;
    for (let i = 1; i < MEN.length; i++) { const [px, py] = men[s][i] || [0, 0], d = (px - bx) ** 2 + (py - by) ** 2; if (d < best) { best = d; near = i; } }
    for (let i = 0; i < MEN.length; i++) {
      const [fx, fy] = MEN[i], hx = s ? 1 - fx : fx;
      let tx, ty;
      if (!playing) { tx = hx; ty = fy; }
      else if (i === 0) { tx = hx; ty = clamp(0.5 + (by - 0.5) * 0.35, 0.38, 0.62); }          // keeper
      else if (i === near) { tx = bx + (s ? 0.02 : -0.02); ty = by; }                          // chaser
      else { tx = clamp(hx + (bx - 0.5) * 0.55, 0.05, 0.95); ty = fy + (by - 0.5) * 0.3; }      // keep shape
      const cur = men[s][i] || [tx, ty];
      cur[0] += (tx - cur[0]) * 0.08; cur[1] += (ty - cur[1]) * 0.08; men[s][i] = cur;
      const node = $("man" + s + i); if (node) node.style.transform = `translate(${cur[0] * W - 7}px,${cur[1] * H - 7}px)`;
    }
  }
}

/* ================= panels ================= */
let lastGoalKey = "", goalT = null;
function renderBoard() {
  const el = $("sboard");
  if (!live() || !sp || !sp.match) { el.innerHTML = ""; return; }
  const t = sNow(), m = sp.match, [h, a] = scoreAt(t), min = Math.floor(minuteAt(t));
  const clock = sp.phase === "playing" ? (t < sp.startAt ? "キックオフ前" : `${min}'`) : sp.phase === "result" ? "試合終了" : "試合前";
  const team = (x) => `<span class="tm"><i style="background:${esc(x.c1)};border-color:${esc(x.c2)}"></i>${esc(x.name)}</span>`;
  const show = sp.phase === "playing" || sp.phase === "result";
  const hh = `${team(m.home)}<span class="sc num">${show ? h : "-"}<em>:</em>${show ? a : "-"}</span>${team(m.away)}<span class="clk num">${clock}</span>`;
  if (el.dataset.k !== hh) { el.innerHTML = hh; el.dataset.k = hh; }
  // GOAL banner
  const goals = shownEvents(t).filter((e) => e.k === "goal"), g = goals[goals.length - 1];
  const key = sp.round + ":" + goals.length;
  if (g && key !== lastGoalKey && sp.phase === "playing") {
    lastGoalKey = key;
    const x = g.s ? m.away : m.home;
    $("goalban").innerHTML = `<b>GOAL!</b><span>${esc(x.name)}　${g.m}'</span>`; $("goalban").style.setProperty("--c", x.c1); $("goalban").hidden = false;
    clearTimeout(goalT); goalT = setTimeout(() => ($("goalban").hidden = true), 2400);
  }
  if (!g) lastGoalKey = sp.round + ":0";
}
function renderPill() {
  const el = $("pill");
  if (!live() || !sp || !sp.match) { el.innerHTML = ""; return; }
  const t = sNow();
  let h;
  if (flashMsg) h = `<div class="pill msg">${esc(flashMsg)}</div>`;
  else if (sp.phase === "paused") h = `<div class="pill msg">休憩中・賭けると試合が始まるよ</div>`;
  else if (sp.phase === "betting") { const s = Math.max(0, Math.ceil((sp.closesAt - t) / 1000)); h = `<div class="pill msg ${s <= 5 ? "hurry" : ""}"><b class="num">${s}</b>秒で締切</div>`; }
  else if (sp.phase === "playing" && t < sp.startAt) h = `<div class="pill msg">まもなくキックオフ</div>`;
  else if (sp.phase === "result") { const me1 = myP()?.spLast && myP().spLast.round === sp.round ? myP().spLast : null; h = me1 ? `<div class="pill msg ${me1.d >= 0 ? "won" : ""}">払い戻し ${fmt(me1.ret)}（${sgn(me1.d)}）</div>` : `<div class="pill msg">試合終了</div>`; }
  else h = "";
  if (el.dataset.k !== h) { el.innerHTML = h; el.dataset.k = h; }
}
function renderMarkets() {
  if (!sp || !sp.match) { $("markets").innerHTML = '<div class="empty">試合を準備中…</div>'; return; }
  const m = sp.match, o = m.odds, b = myBets(), can = live() && open() && !sending;
  const won = sp.phase === "result" && sp.score ? winSet(sp.score) : null;
  $("cardnote").textContent = `第${sp.round}試合`;
  const btn = (k, label) => `<button class="mk ${b[k] ? "has" : ""} ${won && won.has(k) ? "won" : ""}" data-k="${k}" ${can ? "" : "disabled"}><span>${label}</span><b class="num">${o[k].toFixed(2)}</b>${b[k] ? `<i class="num">${fmtK(b[k])}</i>` : ""}</button>`;
  const h = `<div class="match"><span class="tm"><i style="background:${esc(m.home.c1)};border-color:${esc(m.home.c2)}"></i>${esc(m.home.name)}<small>ホーム</small></span><span class="vs">vs</span><span class="tm"><i style="background:${esc(m.away.c1)};border-color:${esc(m.away.c2)}"></i>${esc(m.away.name)}<small>アウェイ</small></span></div>
    <div class="mg"><div class="mgh">勝敗</div><div class="mrow three">${btn("h", esc(m.home.name) + " 勝ち")}${btn("d", "引き分け")}${btn("a", esc(m.away.name) + " 勝ち")}</div></div>
    <div class="mg"><div class="mgh">合計ゴール（2.5点）</div><div class="mrow">${btn("o", "3点以上（オーバー）")}${btn("u", "2点以下（アンダー）")}</div></div>
    <div class="mg"><div class="mgh">両チーム得点</div><div class="mrow">${btn("by", "両方とも点を取る")}${btn("bn", "どっちかが0点")}</div></div>`;
  if ($("markets").dataset.k !== h) { $("markets").innerHTML = h; $("markets").dataset.k = h; }
}
function winSet(score) { const [h, a] = score, w = new Set([h > a ? "h" : h === a ? "d" : "a", h + a >= 3 ? "o" : "u", h > 0 && a > 0 ? "by" : "bn"]); return w; }
function renderSide() {
  const t = Object.entries(spBets).filter(([, b]) => sp && b.round === sp.round && b.total > 0).map(([uid, b]) => [uid, uid === me ? { ...b, bets: myBets() } : b]);
  const h = t.length ? t.map(([uid, b]) => { const p = players[uid] || {}; return `<div class="trow">${avatar(p, esc)}<span class="n">${esc(p.name)}${uid === me ? '<span class="you">あなた</span>' : ""}</span><span class="tk">${Object.entries(b.bets).map(([k, v]) => `<span>${SHORT[k]} ${fmtK(v)}</span>`).join("")}</span></div>`; }).join("")
    : `<div class="empty small">${sp && sp.phase === "playing" ? "この試合は誰も賭けてないよ" : "まだ誰も賭けてないよ"}</div>`;
  if ($("tickets").dataset.k !== h) { $("tickets").innerHTML = h; $("tickets").dataset.k = h; }
  const hist = (sp && sp.history) || [];
  const hh = hist.length ? hist.slice(-10).reverse().map((x) => `<div class="hrow"><span class="mut num">#${x.r}</span><span class="hn2">${esc(x.home)}</span><b class="num">${x.score[0]} - ${x.score[1]}</b><span class="hn2 r">${esc(x.away)}</span></div>`).join("") : '<div class="empty small">まだ試合してないよ</div>';
  if ($("khist").dataset.k !== hh) { $("khist").innerHTML = hh; $("khist").dataset.k = hh; }
  const ev = sp && sp.match ? shownEvents(sNow()) : [];
  const fh = ev.length ? [...ev].reverse().map((e) => { const x = e.s ? sp.match.away : sp.match.home; return `<div class="ev ${e.k}"><span class="num m">${e.m}'</span><i style="background:${esc(x.c1)}"></i><span>${e.k === "goal" ? "⚽ ゴール！" : "決定機！"} ${esc(x.name)}</span></div>`; }).join("")
    : `<div class="empty small">${sp && sp.phase === "playing" ? "キックオフ！" : "試合が始まると流れが出るよ"}</div>`;
  if ($("feed").dataset.k !== fh) { $("feed").innerHTML = fh; $("feed").dataset.k = fh; }
}
function renderMid() {
  let h;
  if (!live()) h = '<span class="note">ログインすると賭けられるよ</span>';
  else h = `<button class="cbtn" id="clr" aria-label="ベットを全部取り消す" ${open() && sum(myBets()) && !sending ? "" : "disabled"}>×</button>`
    + CHIPS.map((c) => `<button class="chip ${c.v === chip ? "on" : ""}" style="--cc:${c.c}" data-v="${c.v}" aria-pressed="${c.v === chip}">${c.l}</button>`).join("")
    + '<span class="note small">チップを選んで賭けたいボタンを押す</span>';
  if ($("mid").dataset.k !== h) { $("mid").innerHTML = h; $("mid").dataset.k = h; }
  $("mytotal").textContent = fmt(live() ? sum(myBets()) : 0);
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>SPORTS</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。</p>`;
  else if (gate === "loading") h = `<h1>SPORTS</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>SPORTS</h1><p>バカラと同じチップで遊べるスポーツベット。<br>Googleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button><p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>SPORTS</h1><p>ニックネームを決めてね。<br>最初に 10,000 チップもらえるよ（バカラと共通）。</p>
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
  $("roundtxt").textContent = on && sp ? `#${sp.round}` : "";
  $("statsbtn").hidden = !on; chat.live(on); ach.update(on);
  $("bal").textContent = on && myP() ? fmt(myFree()) : "—";
  $("walletbtn").disabled = !(on && myP());
  const dbt = (myP() && myP().dep) || 0;
  $("debt").hidden = !(on && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (on) { wallet.watch(); wallet.draw(); }
  renderGate(); renderMid(); renderMarkets(); renderSide(); renderBoard(); renderPill(); renderStats();
}

/* ================= betting ================= */
async function sendBets(next) {
  if (sending) return;
  const prev = want; want = next; sending = true; render();
  try { await call("spBets", { bets: next, round: sp.round }); want = null; }
  catch (e) { want = prev; flash(errMsg(e)); }
  sending = false; render();
}
$("markets").addEventListener("click", (e) => {
  const b = e.target.closest(".mk"); if (!b || b.disabled || !open()) return;
  if (chip > myFree()) { flash("チップが足りない。残高の＋から借りられるよ"); return; }
  const next = { ...myBets() }; next[b.dataset.k] = (next[b.dataset.k] || 0) + chip;
  sendBets(next);
});
$("mid").addEventListener("click", (e) => {
  if (e.target.closest("#clr")) { sendBets({}); return; }
  const c = e.target.closest(".chip"); if (c) { chip = +c.dataset.v; render(); }
});

/* ================= shared modules ================= */
setupGames("sports");
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
const chat = setupChat({ call, errMsg, esc, getMe: () => me, getPlayers: () => players });
const ach = setupAch({ call, errMsg, flash, esc, fmt, getMe: () => me, getPlayers: () => players, busy: () => sp && sp.phase === "playing" });
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
  const p = myP() || {}, st = p.spst || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = p.spcurve || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = sgn(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round((st.w / dec) * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${(st.w / st.n) * 100}%"></i><em style="width:${(st.p / st.n) * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>プラス ${st.w}</span><span><i style="background:#ff7a84"></i>マイナス ${st.l}</span><span>${st.n}試合</span>`;
  if (curve.length < 2) { $("chartbox").innerHTML = '<div class="empty">試合に賭けると利益のグラフが出るよ</div>'; return; }
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
    if (m.type === "sp") { const prev = sp && sp.round; sp = m.v; if (prev !== sp.round) { want = null; menBuilt = ""; pathKey = ""; } }
    else if (m.type === "spBets") spBets = m.v || {};
    else if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; if (m.uid === me && m.p && gate === "join") gate = "in"; }
    else if (m.type === "chat") chat.set(m.v);
    else if (m.type === "notice") flash(m.text);
  }
  render();
}
function onReady(st, uid) {
  me = uid; chat.set(st.chat); ach.setDefs(st.achDefs, st.frameDefs, st.bubbleDefs); ach.reset();
  players = st.players || {}; sp = st.sp || null; spBets = st.spBets || {}; want = null;
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

setInterval(() => { if (live()) { renderPill(); renderBoard(); renderSide(); renderMarkets(); } }, 250);
requestAnimationFrame(frame);
render();
