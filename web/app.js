import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signInWithCredential, onAuthStateChanged, signOut, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot, connectFirestoreEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js";
import { firebaseConfig, functionsRegion } from "./firebase-config.js";
import { setupWallet } from "./wallet.js";

/* ================= constants (keep in sync with functions/game.js) ================= */
const START = 10000, BET_MS = 15000, HOLD_MS = 4500, MAX_DEPOSIT = 1000000;
const CHIPS = [{ v: 100, c: "#3f7fbf", l: "100" }, { v: 500, c: "#8e44ad", l: "500" }, { v: 1000, c: "#1f9d55", l: "1K" }, { v: 5000, c: "#d63447", l: "5K" }, { v: 10000, c: "#2b2b33", l: "10K" }, { v: 50000, c: "#c98a12", l: "50K" }, { v: 1000000, c: "#0f8f8a", l: "1M" }];
const MAX_SPOT = 10000000; // per spot, same as functions/game.js
const SPOTS = [
  { k: "ppair", nm: "P ペア", od: "11:1", side: 1 }, { k: "player", nm: "プレイヤー", od: "1:1" }, { k: "tie", nm: "タイ", od: "8:1" },
  { k: "banker", nm: "バンカー", od: "0.95:1" }, { k: "bpair", nm: "B ペア", od: "11:1", side: 1 }];
const RK = "A23456789TJQK", SU = { S: "♠", H: "♥", D: "♦", C: "♣" };
const emptyBets = () => ({ ppair: 0, player: 0, tie: 0, banker: 0, bpair: 0 });
const fresh = () => ({ round: 1, phase: "paused", P: [], B: [], res: null, road: [], dealId: 0, closesAt: 0, dealtAt: 0, shoeLeft: 416 });
const cv = (c) => { const i = RK.indexOf(c[0]); return i >= 9 ? 0 : i + 1; };
const tot = (h) => h.reduce((a, c) => a + cv(c), 0) % 10;
const sum = (b) => b ? Object.values(b).reduce((a, x) => a + (+x || 0), 0) : 0;
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const fmtK = (n) => n >= 1e6 ? (+(n / 1e6).toFixed(1)) + "M" : n >= 1000 ? (+(n / 1000).toFixed(1)) + "K" : String(n);
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? Math.min(ms, 60) : ms));
const chipColor = (v) => { let c = CHIPS[0].c; for (const x of CHIPS) if (v >= x.v) c = x.c; return c; };
const sameBets = (a, b) => ["ppair", "player", "tie", "banker", "bpair"].every((k) => (a?.[k] || 0) === (b?.[k] || 0));
function animMs(P, B) {
  const p = P.length, b = B.length;
  const nat = p === 2 && b === 2 && (tot(P) >= 8 || tot(B) >= 8);
  return 200 + 4 * 860 + 250 + 4 * 740 + (nat ? 700 : 0) + (p - 2 + b - 2) * 3300 + 400;
}

/* ================= firebase ================= */
const configured = !String(firebaseConfig.apiKey || "").startsWith("PASTE");
const emu = ["localhost", "127.0.0.1"].includes(location.hostname) && new URLSearchParams(location.search).has("emu");
let auth, fs, fns;
if (configured || emu) {
  const app = initializeApp(emu && !configured ? { apiKey: "demo", authDomain: "localhost", projectId: "demo-baccarat", appId: "demo" } : firebaseConfig);
  auth = getAuth(app); fs = getFirestore(app); fns = getFunctions(app, functionsRegion);
  if (emu) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(fs, "127.0.0.1", 8080);
    connectFunctionsEmulator(fns, "127.0.0.1", 5001);
    // Test hook, only on localhost with ?emu: sign in with a fake Google account.
    window.__emuSignIn = (email) => signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: email.replace(/\W/g, ""), email, email_verified: true, name: email })));
  }
}
let offset = 0; // server clock - local clock
const sNow = () => Date.now() + offset;
async function call(name, data) {
  const t0 = Date.now();
  const r = await httpsCallable(fns, name)(data || {});
  const t1 = Date.now();
  if (r.data && r.data.now) offset = r.data.now - (t0 + t1) / 2;
  return r.data;
}
const errMsg = (e) => (e && e.message && !/^internal$/i.test(e.message) ? e.message : "うまくいかなかった。もう一度試してね");

/* ================= state ================= */
let user = null, me = null, gate = "loading", gateErr = "";
let state = fresh(), players = {}, betsMap = {}, myDocExists = null;
let memberUnsubs = [], myUnsub = null, firstState = true;
let want = null, ackWant = null, sending = false;
let amount = 1000, animating = false, animatedDeal = null, animState = null, revealedRound = 0;
let shownP = [], shownB = [], bannerMsg = "";
let tab = "live", sideOpen = innerWidth >= 1000, statsOpen = false, joining = false;

/* masked view of a player: hides a settlement until its deal animation has finished on this screen */
function view(id) {
  const p = players[id];
  if (!p) return null;
  const hidden = (p.lastRound || 0) > revealedRound;
  const bd = betsMap[id];
  let bets = bd && bd.round === state.round ? bd.bets : null;
  if (hidden && p.lastBets) bets = p.lastBets;
  let chips = p.chips, hist = p.hist || [], curve = p.curve || [], st = p.st || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 };
  if (hidden) {
    chips -= p.lastRet || 0;
    const h = hist[0];
    hist = hist.filter((x) => x.r <= revealedRound);
    curve = curve.slice(0, -1);
    if (h) st = { n: st.n - 1, w: st.w - (h.d > 0), l: st.l - (h.d < 0), p: st.p - (h.d === 0), wag: st.wag - h.stake, prof: st.prof - h.d };
  }
  return { id, ...p, chips, hist, curve, st, bets, hidden };
}
function serverMyBets() { const bd = betsMap[me]; return bd && bd.round === state.round ? bd.bets : emptyBets(); }
function myBets() {
  const v = view(me);
  if (v && v.hidden) return v.bets || emptyBets();
  return want || ackWant || serverMyBets();
}
const myStake = () => sum(myBets());
function myFree() { const v = view(me); if (!v) return 0; return v.chips - (v.hidden ? 0 : myStake() - sum(serverMyBets())); }
const seated = () => !!(players[me] && players[me].seated);
function seatList() {
  return Object.keys(players).map(view).filter((p) => p && (p.seated || sum(p.bets) > 0)).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
}
function bettingOpen() {
  if (animating) return false;
  if (state.phase === "paused") return true;
  return state.phase === "betting" && (!state.closesAt || sNow() < state.closesAt - 400);
}

/* ================= betting (optimistic, coalesced) ================= */
function queueBets(next) {
  want = next; render();
  if (!sending) pump();
}
async function pump() {
  sending = true;
  while (want) {
    const w = want;
    try { await call("setBets", { bets: w, round: state.round }); if (want === w) { ackWant = w; want = null; } }
    catch (e) { want = null; ackWant = null; flash(errMsg(e)); }
  }
  sending = false; render();
}
function placeBet(k) {
  if (!seated()) return;
  if (!bettingOpen()) { flash("ベット締切。次のゲームを待ってね"); return; }
  const free = myFree();
  if (free <= 0) { flash("チップが足りない。残高の＋から借りられるよ"); return; }
  const b = { ...myBets() };
  const v = Math.min(amount === "all" ? free : amount, free, MAX_SPOT - b[k]);
  if (v <= 0) { flash("1か所に置けるのは 10,000,000 まで"); return; }
  b[k] += v;
  placedStack.push({ k, v });
  queueBets(b);
}
let placedStack = [], placedRound = 0;
function undo() {
  if (!bettingOpen()) return;
  const b = { ...myBets() };
  if (placedStack.length && placedRound === state.round) { const p = placedStack.pop(); b[p.k] = Math.max(0, b[p.k] - p.v); }
  else Object.keys(b).forEach((k) => (b[k] = 0));
  queueBets(b);
}
function repeatOrDouble() {
  if (!bettingOpen()) return;
  const cur = myBets(), s = sum(cur), last = players[me] && players[me].lastBets;
  if (s) { if (s > myFree()) { flash("チップが足りなくて2倍にできない"); return; } const b = {}; for (const k in cur) b[k] = cur[k] * 2; placedStack = []; queueBets(b); }
  else if (last && sum(last)) { if (sum(last) > myFree()) { flash("チップが足りなくて同じベットにできない"); return; } placedStack = []; queueBets({ ...emptyBets(), ...last }); }
}

/* ================= stage geometry ================= */
let G = null;
const hands = { L: { x: 0, y: 0 }, R: { x: 0, y: 0 } }, tw = { L: null, R: null };
function layout() {
  const s = $("stage"), W = s.clientWidth, H = s.clientHeight; if (!W || !H) return;
  const narrow = W < 640;
  const cw = narrow ? Math.min(W * .105, H * .17) : Math.min(W * .066, H * .2), ch = cw * 1.42;
  const y = H * (narrow ? .55 : .56);
  const xs = narrow ? { P2: .12, P0: .28, P1: .405, B0: .595, B1: .72, B2: .88 } : { P2: .275, P0: .37, P1: .445, B0: .555, B1: .63, B2: .725 };
  G = {
    W, H, cw, ch, y, xs, narrow,
    shoe: { x: W * (narrow ? .1 : .075), y: H * (narrow ? .2 : .22) }, mid: { x: W * .5, y: H * .42 },
    sh: { L: { x: W * (narrow ? .3 : .36), y: -H * .12 }, R: { x: W * (narrow ? .7 : .64), y: -H * .12 } },
    rest: { L: { x: W * .435, y: H * .17 }, R: { x: W * .565, y: H * .17 } },
  };
  $("cards").style.setProperty("--cw", cw + "px");
  $("armsvg").setAttribute("viewBox", `0 0 ${W} ${H}`);
  const b = $("backsvg"); b.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const g = "#d9b56b", fsz = narrow ? cw * .42 : cw * .5;
  const sx = G.shoe.x, sy = G.shoe.y, sw = cw * 1.25, shh = cw * .95;
  b.innerHTML = `<defs>
      <path id="arc1" d="M${W * .16} ${H * .4} Q${W * .5} ${H * .27} ${W * .84} ${H * .4}"/>
      <path id="arc2" d="M${W * .12} ${H * .88} Q${W * .5} ${H * 1.0} ${W * .88} ${H * .88}"/>
      <radialGradient id="rimg" cx="50%" cy="0%" r="100%"><stop offset="0" stop-color="#5b2a1c"/><stop offset="1" stop-color="#2a110b"/></radialGradient>
    </defs>
    <ellipse cx="${W / 2}" cy="${-H * .03}" rx="${W * .33}" ry="${H * .14}" fill="url(#rimg)"/>
    <ellipse cx="${W / 2}" cy="${-H * .03}" rx="${W * .33}" ry="${H * .14}" fill="none" stroke="${g}" stroke-opacity=".55" stroke-width="2"/>
    <ellipse cx="${W / 2}" cy="${-H * .03}" rx="${W * .31}" ry="${H * .115}" fill="none" stroke="#000" stroke-opacity=".25" stroke-width="1"/>
    <text font-family="Cinzel,serif" font-weight="700" font-size="${fsz}" fill="${g}" fill-opacity=".85" letter-spacing="${fsz * .12}"><textPath href="#arc1" startOffset="50%" text-anchor="middle">PLAYER  |  BANKER</textPath></text>
    <path d="M${W * .2} ${H * .43} Q${W * .5} ${H * .315} ${W * .8} ${H * .43}" fill="none" stroke="${g}" stroke-opacity=".25"/>
    <text font-family="Rubik,sans-serif" font-weight="600" font-size="${Math.max(9, cw * .15)}" fill="${g}" fill-opacity=".55" letter-spacing="2"><textPath href="#arc2" startOffset="50%" text-anchor="middle">BANKER PAYS 0.95 TO 1 · TIE PAYS 8 TO 1 · PAIR PAYS 11 TO 1</textPath></text>
    <g transform="translate(${sx} ${sy}) rotate(-14)">
      <rect x="${-sw / 2 + 4}" y="${-shh / 2 + 6}" width="${sw}" height="${shh}" rx="5" fill="#000" opacity=".3"/>
      <rect x="${-sw / 2}" y="${-shh / 2}" width="${sw}" height="${shh}" rx="5" fill="#e9edf2" fill-opacity=".85" stroke="#fff" stroke-width="1.5"/>
      <rect x="${-sw / 2 + cw * .12}" y="${-shh / 2 + cw * .12}" width="${sw - cw * .24}" height="${shh - cw * .3}" rx="3" fill="#2f56b0" stroke="#fff" stroke-opacity=".5"/>
      <rect x="${sw / 2 - cw * .32}" y="${shh / 2 - cw * .28}" width="${cw * .5}" height="${cw * .4}" rx="3" fill="#2f56b0" stroke="#fff" stroke-width="1.5" transform="rotate(10 ${sw / 2} ${shh / 2})"/>
    </g>`;
  if (!animating) { hands.L = { ...G.rest.L }; hands.R = { ...G.rest.R }; }
  drawArms();
}
const slotPos = (side, i) => ({ x: G.W * G.xs[side + i], y: G.y, rot: i === 2 ? 90 : 0 });
function drawArms() {
  if (!G) return; let h = "";
  for (const k of ["L", "R"]) {
    const S = G.sh[k], P = hands[k], dir = k === "L" ? -1 : 1;
    const C = { x: (S.x + P.x) / 2 + dir * G.W * .012, y: (S.y + P.y) / 2 + G.H * .02 };
    const a = Math.atan2(P.y - C.y, P.x - C.x), ca = Math.cos(a), sa = Math.sin(a);
    const hl = G.cw * .8, hw = G.cw * .52, sw = G.cw * .56;
    const W1 = { x: P.x - ca * hl * .42, y: P.y - sa * hl * .42 }, W0 = { x: W1.x - ca * G.cw * .14, y: W1.y - sa * G.cw * .14 };
    const th = -dir;
    h += `<path d="M${S.x} ${S.y} Q${C.x} ${C.y} ${W0.x} ${W0.y}" stroke="#15161b" stroke-width="${sw}" fill="none" stroke-linecap="round"/>`
      + `<path d="M${S.x} ${S.y} Q${C.x} ${C.y} ${W0.x} ${W0.y}" stroke="#2a2c33" stroke-width="${sw * .3}" fill="none" stroke-linecap="round" opacity=".6"/>`
      + `<line x1="${W0.x}" y1="${W0.y}" x2="${W1.x + ca * 2}" y2="${W1.y + sa * 2}" stroke="#f3f3f1" stroke-width="${sw * .94}"/>`
      + `<g transform="translate(${P.x} ${P.y}) rotate(${a * 180 / Math.PI})">`
      + `<rect x="${-hl * .45}" y="${-hw / 2}" width="${hl * .95}" height="${hw}" rx="${hw * .46}" fill="#e8bb97"/>`
      + `<ellipse cx="${-hl * .05}" cy="${th * hw * .5}" rx="${hl * .26}" ry="${hw * .17}" fill="#dcaa84" transform="rotate(${th * 18} ${-hl * .05} ${th * hw * .5})"/>`
      + `<path d="M${hl * .1} ${-hw * .2} H${hl * .4} M${hl * .1} 0 H${hl * .44} M${hl * .1} ${hw * .2} H${hl * .38}" stroke="#c48d68" stroke-width="${Math.max(1, G.cw * .018)}" stroke-linecap="round"/>`
      + `</g>`;
  }
  $("armg").innerHTML = h;
}
function moveHand(k, x, y, ms) {
  return new Promise((res) => {
    const from = { ...hands[k] }, t0 = performance.now(), id = {}; tw[k] = id;
    if (reduced() || ms <= 0) { hands[k] = { x, y }; drawArms(); return res(); }
    const step = (t) => {
      if (tw[k] !== id) return res();
      let q = Math.min(1, (t - t0) / ms); q = q < .5 ? 2 * q * q : 1 - Math.pow(-2 * q + 2, 2) / 2;
      hands[k] = { x: from.x + (x - from.x) * q, y: from.y + (y - from.y) * q }; drawArms();
      if (q < 1) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
}
const rest = (k, ms = 320) => moveHand(k, G.rest[k].x, G.rest[k].y, ms);

/* ================= cards ================= */
function faceHTML(c) {
  const red = c[1] === "H" || c[1] === "D", r = c[0] === "T" ? "10" : c[0], s = SU[c[1]];
  return `<div class="f front ${red ? "red" : ""}"><span class="ix"><b>${r}</b><i>${s}</i></span><span class="pip">${s}</span><span class="ix bt"><b>${r}</b><i>${s}</i></span></div>`;
}
function makeCard(side, i, c, up, won) {
  const p = slotPos(side, i), el = document.createElement("div");
  el.className = "tc" + (up ? " up" : "") + (won ? " won" : "");
  el.style.width = G.cw + "px"; el.style.height = G.ch + "px";
  el.style.left = (p.x - G.cw / 2) + "px"; el.style.top = (p.y - G.ch / 2) + "px";
  el.style.transform = p.rot ? "rotate(90deg)" : "none";
  el.innerHTML = `<div class="in"><div class="f back"></div>${faceHTML(c)}</div>`;
  return el;
}
let cardsKey = "";
function renderCards() {
  if (animating || !G) return;
  const show = state.phase === "result" && state.P && state.P.length;
  const key = show ? `${state.dealId}|${G.W}x${G.H}` : "none";
  if (key === cardsKey) return; cardsKey = key;
  const box = $("cards"); box.innerHTML = "";
  if (!show) return;
  const w = state.res && state.res.w;
  ["P", "B"].forEach((s) => state[s].forEach((c, i) => box.appendChild(makeCard(s, i, c, true, w === s))));
}

/* ================= dealing animation ================= */
const say = (t) => { bannerMsg = t; renderTimer(true); };
async function dealCard(side, i, st, els) {
  const el = makeCard(side, i, st[side][i], false, false); $("cards").appendChild(el); els[side + i] = el;
  const p = slotPos(side, i), sh = G.shoe;
  const rot = p.rot ? "rotate(90deg)" : "rotate(0deg)";
  const off = (q) => `translate(${q.x - p.x}px,${q.y - p.y}px)`;
  el.style.visibility = "hidden";
  await moveHand("L", sh.x + G.cw * .2, sh.y + G.cw * .1, 220);
  el.style.visibility = "";
  if (reduced()) { rest("L", 0); return; }
  if (side === "P") {
    const a = el.animate([{ transform: `${off(sh)} rotate(-14deg)` }, { transform: rot }], { duration: 360, easing: "cubic-bezier(.3,.7,.3,1)" });
    moveHand("L", p.x, p.y + G.ch * .1, 360);
    await a.finished.catch(() => {}); rest("L");
  } else {
    const mid = G.mid, a = el.animate([{ transform: `${off(sh)} rotate(-14deg)` }, { transform: `${off(mid)} rotate(-4deg)`, offset: .5 }, { transform: rot }], { duration: 620, easing: "ease-in-out" });
    moveHand("L", mid.x - G.cw * .3, mid.y, 310).then(() => rest("L"));
    setTimeout(() => moveHand("R", p.x, p.y + G.ch * .1, 310), 240);
    await a.finished.catch(() => {}); rest("R");
  }
  await wait(60);
}
async function flipCard(side, i, els, squeeze) {
  const el = els[side + i], inner = el.querySelector(".in"), p = slotPos(side, i);
  if (squeeze) {
    await Promise.all([moveHand("L", p.x - G.cw * .35, p.y + G.ch * .28, 300), moveHand("R", p.x + G.cw * .35, p.y + G.ch * .28, 300)]);
    const a = inner.animate([{ transform: "rotateX(0)" }, { transform: "rotateX(30deg)", offset: .25 }, { transform: "rotateX(14deg)", offset: .45 }, { transform: "rotateX(38deg)", offset: .7 }, { transform: "rotateY(180deg)" }], { duration: reduced() ? 1 : 1700, easing: "ease-in-out", fill: "forwards" });
    await a.finished.catch(() => {});
    el.classList.add("up"); a.cancel(); rest("L"); rest("R");
  } else {
    const k = side === "P" ? "L" : "R";
    await moveHand(k, p.x, p.y + G.ch * .32, 200);
    const a = inner.animate([{ transform: "rotateY(0)" }, { transform: "rotateY(180deg)" }], { duration: reduced() ? 1 : 380, easing: "ease-in-out", fill: "forwards" });
    await a.finished.catch(() => {});
    el.classList.add("up"); a.cancel(); rest(k);
  }
  (side === "P" ? shownP : shownB).push(animState[side][i]);
  renderBoard();
  await wait(squeeze ? 400 : 140);
}
async function animate(st) {
  if (!G) layout();
  animating = true; animState = st; shownP = []; shownB = []; bannerMsg = "";
  $("cards").innerHTML = ""; cardsKey = "anim"; render();
  const els = {};
  try {
    say("ノーモアベット"); await wait(200);
    for (const [s, i] of [["P", 0], ["B", 0], ["P", 1], ["B", 1]]) await dealCard(s, i, st, els);
    await wait(250);
    say("プレイヤー"); await flipCard("P", 0, els); await flipCard("P", 1, els);
    say("バンカー"); await flipCard("B", 0, els); await flipCard("B", 1, els);
    if (tot(st.P.slice(0, 2)) >= 8 || tot(st.B.slice(0, 2)) >= 8) { say("ナチュラル！"); await wait(700); }
    if (st.P[2]) { say("プレイヤー 3枚目"); await dealCard("P", 2, st, els); say("絞り…"); await flipCard("P", 2, els, true); }
    if (st.B[2]) { say("バンカー 3枚目"); await dealCard("B", 2, st, els); say("絞り…"); await flipCard("B", 2, els, true); }
    const w = st.res && st.res.w;
    Object.entries(els).forEach(([k, el]) => { if (k[0] === w) el.classList.add("won"); });
  } finally {
    rest("L"); rest("R");
    animating = false; bannerMsg = "";
    revealedRound = Math.max(revealedRound, st.round);
    cardsKey = state.phase === "result" && state.dealId === st.dealId && G ? `${st.dealId}|${G.W}x${G.H}` : "";
    animState = null; statsKey = "";
    render();
  }
}

/* ================= rendering ================= */
let flashT = null, flashMsg = "", pillKey = "";
function flash(t) { flashMsg = t; renderTimer(true); clearTimeout(flashT); flashT = setTimeout(() => { flashMsg = ""; renderTimer(true); }, 2400); }
function renderTimer(force) {
  const now = sNow(); let key = "", html = "";
  if (flashMsg) { key = "f" + flashMsg; html = `<div class="pill msg">${esc(flashMsg)}</div>`; }
  else if (animating) { key = "a" + bannerMsg; html = bannerMsg ? `<div class="pill msg">${esc(bannerMsg)}</div>` : ""; }
  else if (gate !== "in") { key = "o"; }
  else if (state.phase === "betting") {
    const left = state.closesAt ? state.closesAt - now : BET_MS;
    if (left > 0) {
      const s = Math.ceil(left / 1000); key = "b" + s;
      html = `<div class="pill bet"><span class="ring"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5" class="rbg"/><circle cx="18" cy="18" r="15.5" class="rfg" id="rfg"/></svg><b class="num">${s}</b></span>ベットしてください</div>`;
    } else { key = "c"; html = '<div class="pill msg">ベット締切</div>'; }
  }
  else if (state.phase === "paused") { key = "p"; html = '<div class="pill msg">休憩中 · チップを置くと次のゲームが始まるよ</div>'; }
  else if (state.res) {
    const w = state.res.w; let extra = "";
    const v = view(me);
    if (v && v.lastRound === state.round && !v.hidden) extra = ` <span class="me num">${v.lastDelta >= 0 ? "+" : ""}${fmt(v.lastDelta)}</span>`;
    key = "r" + state.dealId + extra;
    html = `<div class="pill res ${w}">${w === "P" ? "プレイヤー" : w === "B" ? "バンカー" : "タイ"}${extra}</div>`;
  }
  if (force || key !== pillKey) { $("pill").innerHTML = html; pillKey = key; }
  const frac = state.phase === "betting" && !animating ? (state.closesAt ? Math.max(0, Math.min(1, (state.closesAt - now) / BET_MS)) : 1) : 0;
  const r = $("rfg"); if (r) { r.style.strokeDashoffset = String(97.4 * (1 - frac)); r.classList.toggle("low", frac < .34); }
  const tb = $("tbar"); if (tb) { tb.style.transform = `scaleX(${frac})`; tb.classList.toggle("low", frac < .34); }
  const open = bettingOpen();
  document.querySelectorAll("#board .spot").forEach((s) => s.classList.toggle("closed", !open && state.phase !== "result"));
}
const miniHTML = (c) => { const red = c[1] === "H" || c[1] === "D", r = c[0] === "T" ? "10" : c[0]; return `<span class="mini ${red ? "red" : ""}">${r}<span>${SU[c[1]]}</span></span>`; };
const personIcon = '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="3" r="2.2" fill="currentColor"/><path d="M1 10 Q5 4.5 9 10Z" fill="currentColor"/></svg>';
let boardKey = "";
function renderBoard() {
  const list = seatList();
  const betsOf = (p) => (p.id === me ? myBets() : p.bets) || emptyBets();
  const bettors = list.filter((p) => sum(betsOf(p)) > 0);
  const T = {}; SPOTS.forEach((s) => (T[s.k] = bettors.reduce((a, p) => a + (betsOf(p)[s.k] || 0), 0)));
  const mainTot = T.player + T.tie + T.banker;
  const r = state.res, showRes = state.phase === "result" && !animating && r;
  const hit = new Set(); if (showRes) { hit.add(r.w === "P" ? "player" : r.w === "B" ? "banker" : "tie"); if (r.pp) hit.add("ppair"); if (r.bp) hit.add("bpair"); }
  const P = animating ? shownP : (state.phase === "result" ? state.P || [] : []), B = animating ? shownB : (state.phase === "result" ? state.B || [] : []);
  const mb = myBets();
  const lock = !seated();
  const html = SPOTS.map((s) => {
    const n = bettors.filter((p) => betsOf(p)[s.k] > 0).length;
    const my = mb[s.k] ? `<span class="mychip num" style="--cc:${chipColor(mb[s.k])}">${fmtK(mb[s.k])}</span>` : "";
    let inner = `<span class="nm">${s.nm}</span><span class="od">${s.od}</span>`;
    if (!s.side) inner += `<span class="pct num">${mainTot ? Math.round(T[s.k] / mainTot * 100) : 0}%</span>`;
    if (s.k === "player" || s.k === "banker") { const h = s.k === "player" ? P : B; inner += `<span class="sc num">${h.length ? tot(h) : ""}</span><span class="minis">${h.map(miniHTML).join("")}</span>`; }
    if (s.k === "tie") inner += `<span class="big">和</span>`;
    if (!s.side) inner += `<span class="ppl">${personIcon}${n}</span>${T[s.k] ? `<span class="tot num">${fmtK(T[s.k])}</span>` : ""}`;
    return `<button class="spot ${s.k} ${s.side ? "sidebet" : ""} ${hit.has(s.k) ? "hit" : ""}" data-k="${s.k}" ${lock ? "disabled" : ""} aria-label="${s.nm}に賭ける">${inner}${my}</button>`;
  }).join("") + '<span class="tbar" id="tbar"></span>';
  if (html !== boardKey) { $("board").innerHTML = html; boardKey = html; renderTimer(); }
}
function renderRoads() {
  const road = (state.road || []).filter((x) => x.r <= revealedRound);
  const c = { P: 0, B: 0, T: 0, pp: 0, bp: 0 }; road.forEach((x) => { c[x.w]++; if (x.pp) c.pp++; if (x.bp) c.bp++; });
  $("beadhead").innerHTML = `<span>#${road.length}</span><span class="c"><i style="background:var(--pl)">P</i>${c.P}</span><span class="c"><i style="background:var(--bk)">B</i>${c.B}</span><span class="c"><i style="background:var(--tie)">T</i>${c.T}</span><span class="c"><i style="background:#fff;border:3px solid var(--pl);width:12px;height:12px"></i>${c.pp}</span><span class="c"><i style="background:#fff;border:3px solid var(--bk);width:12px;height:12px"></i>${c.bp}</span>`;
  const bead = road.slice(-84), bcols = Math.ceil(bead.length / 6) + 1;
  $("beadgrid").innerHTML = bead.map((x) => `<div class="cell ${x.w}">${x.w}${x.pp ? '<i class="pp"></i>' : ""}${x.bp ? '<i class="bp"></i>' : ""}</div>`).join("") + "<div></div>".repeat(Math.max(0, bcols * 6 - bead.length));
  const cells = [], occ = new Set(); let streak = -1, last = null, cc = 0, cr = 0, tail = false, pre = 0;
  for (const x of road) {
    if (x.w === "T") { if (cells.length) cells[cells.length - 1].t++; else pre++; continue; }
    if (x.w !== last) { streak++; cc = streak; cr = 0; tail = false; while (occ.has(cc + "," + cr)) cc++; }
    else if (!tail && cr + 1 < 6 && !occ.has(cc + "," + (cr + 1))) cr++;
    else { cc++; tail = true; }
    occ.add(cc + "," + cr); cells.push({ c: cc, r: cr, w: x.w, t: pre, pp: x.pp, bp: x.bp }); pre = 0; last = x.w;
  }
  const maxc = cells.reduce((a, x) => Math.max(a, x.c), -1), cols = maxc + 3;
  $("biggrid").style.gridTemplateColumns = `repeat(${cols},16px)`;
  $("biggrid").innerHTML = cells.map((x) => `<div class="br ${x.w}" style="grid-column:${x.c + 1};grid-row:${x.r + 1}">${x.t === 1 ? '<i class="t"></i>' : x.t > 1 ? `<span class="tn">${x.t}</span>` : ""}${x.pp ? '<i class="pp"></i>' : ""}${x.bp ? '<i class="bp"></i>' : ""}</div>`).join("") + `<div style="grid-column:${cols};grid-row:6"></div>`;
  [$("beadscroll"), $("bigscroll")].forEach((e) => { e.scrollLeft = e.scrollWidth; });
}
const netOf = (p) => p.chips + (p.id === me ? sum(serverMyBets()) : (betsMap[p.id] && betsMap[p.id].round === state.round ? betsMap[p.id].total : 0)) - START - (p.dep || 0);
function renderSide(list) {
  const on = gate === "in";
  $("sidebtn").hidden = !on; $("statsbtn").hidden = !on;
  $("side").hidden = !(on && sideOpen); $("sidebtn").classList.toggle("on", sideOpen); $("sidebtn").setAttribute("aria-pressed", sideOpen);
  $("sidebtn").textContent = `メンバー ${list.length}`;
  if (!on || !sideOpen) return;
  document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === tab));
  const dot = (p) => `<span class="dot" style="background:${esc(p.color)}">${esc((p.name || "?")[0])}</span>`;
  const nm = (p) => `<span class="n">${esc(p.name)}${p.id === me ? '<span class="you">あなた</span>' : ""}</span>`;
  let h = "";
  if (tab === "live") {
    const rows = [];
    list.forEach((p) => { const b = p.id === me ? myBets() : p.bets; if (sum(b) > 0) rows.push(`<div class="row">${dot(p)}${nm(p)}<span class="v num mut">ベット ${fmt(sum(b))}</span></div>`); });
    const hist = []; Object.keys(players).map(view).forEach((p) => (p.hist || []).forEach((x) => hist.push({ p, x })));
    hist.sort((a, b) => b.x.r - a.x.r || b.x.stake - a.x.stake);
    hist.slice(0, 14).forEach(({ p, x }) => rows.push(`<div class="row">${dot(p)}${nm(p)}<span class="v num ${x.d > 0 ? "pos" : "neg"}">#${x.r} ${x.d >= 0 ? "+" : ""}${fmt(x.d)}</span></div>`));
    h = rows.length ? rows.join("") : '<div class="empty">まだ誰も賭けていません</div>';
  } else {
    const rk = Object.keys(players).map(view).map((p) => ({ p, net: netOf(p) })).sort((a, b) => b.net - a.net).slice(0, 30);
    h = rk.length ? rk.map(({ p, net }, i) => `<div class="row">${dot(p)}${nm(p)}<span class="v num ${net > 0 ? "pos" : "neg"}">${i + 1}位 ${net >= 0 ? "+" : ""}${fmt(net)}</span></div>`).join("") : '<div class="empty">まだ誰もいません</div>';
  }
  $("sidebody").innerHTML = h;
  $("sidefoot").innerHTML = "";
}
function renderWinners() {
  const rr = state.phase === "result" ? state.round : state.round - 1;
  const ws = animating || gate !== "in" ? [] : Object.keys(players).map(view).filter((p) => p.lastRound === rr && rr <= revealedRound && p.lastDelta > 0).sort((a, b) => b.lastDelta - a.lastDelta).slice(0, 5);
  $("winners").innerHTML = ws.map((p) => `<span><b class="num">+${fmt(p.lastDelta)}</b>${esc(p.name)}</span>`).join("");
}
let midKey = "";
function renderMid() {
  let h;
  if (gate !== "in") h = '<span class="note">ログインすると参加できるよ</span>';
  else if (!seated()) h = `<form class="join" id="joinf"><input id="joinname" placeholder="ニックネーム" maxlength="12" autocomplete="off" value="${esc(players[me]?.name || "")}"><button class="go" type="submit">着席</button></form>`;
  else {
    const stake = myStake(), open = bettingOpen(), last = players[me]?.lastBets;
    const rep = stake ? "2倍" : "リピート", repDis = !open || (!stake && !(last && sum(last)));
    h = `<button class="cbtn" id="undo" aria-label="ひとつ戻す" ${!open || !stake ? "disabled" : ""}>↶</button>`
      + CHIPS.map((c) => `<button class="chip ${c.v === amount ? "on" : ""}" style="--cc:${c.c}" data-v="${c.v}" aria-pressed="${c.v === amount}">${c.l}</button>`).join("")
      + `<button class="chip allbet ${amount === "all" ? "on" : ""}" data-v="all" aria-pressed="${amount === "all"}" aria-label="ALL BET 残高を全部賭ける">ALL<br>BET</button>`
      + `<button class="cbtn wide" id="rep" ${repDis ? "disabled" : ""}>${rep}</button>`
      ;
  }
  if (h !== midKey) { $("mid").innerHTML = h; midKey = h; }
}
function renderGate() {
  $("gate").hidden = gate === "in";
  const box = $("gatebox");
  let h = "";
  if (gate === "unconfigured") h = `<h1>BACCARAT</h1><p><b>firebase-config.js</b> にFirebaseの設定値を貼ると動くよ。手順はREADMEを見てね。</p>`;
  else if (gate === "loading") h = `<h1>BACCARAT</h1><p>接続中…</p>`;
  else if (gate === "out") h = `<h1>BACCARAT</h1><p>架空チップで遊ぶ仲間内のバカラテーブル。<br>Googleアカウントでログインしてね。</p>
      <button class="gbtn" id="gsign"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Googleでログイン</button>
      <p class="err">${esc(gateErr)}</p>`;
  else if (gate === "join") h = `<h1>BACCARAT</h1><p>テーブルで使うニックネームを決めてね。<br>最初に 10,000 チップもらえるよ。</p>
      <form class="join" id="gjoin"><input id="gname" placeholder="ニックネーム" maxlength="12" autocomplete="off" value="${esc((user && user.displayName || "").slice(0, 12))}"><button class="go" type="submit" ${joining ? "disabled" : ""}>参加</button></form>
      <p class="err">${esc(gateErr)}</p><button class="ib" id="gout" style="align-self:center">別のアカウントにする</button>`;
  if (box.dataset.k !== h) { box.innerHTML = h; box.dataset.k = h; }
  const a = $("acctbtn");
  a.hidden = !user;
  if (user) { const k = user.uid; if (a.dataset.k !== k) { a.dataset.k = k; a.innerHTML = user.photoURL ? `<img src="${esc(user.photoURL)}" alt="" referrerpolicy="no-referrer">` : "アカウント"; a.setAttribute("aria-label", "アカウント"); } }
}
function render() {
  const list = seatList();
  const live = gate === "in";
  $("live").classList.toggle("on", live);
  $("livetxt").textContent = live ? "LIVE" : gate === "out" || gate === "join" ? "ログイン前" : "接続中";
  $("roundtxt").textContent = live ? `#${state.round}` : "";
  $("bal").textContent = live && players[me] ? fmt(myFree()) : "—";
  $("mytotal").textContent = fmt(live ? myStake() : 0);
  $("walletbtn").disabled = !(live && players[me]);
  const dbt = (players[me] && players[me].dep) || 0;
  $("debt").hidden = !(live && dbt > 0); $("debt").textContent = `借金 ${fmt(dbt)}`;
  if (live) { wallet.watch(); wallet.draw(); }
  renderGate(); renderCards(); renderBoard(); renderRoads(); renderSide(list); renderWinners(); renderMid(); renderTimer(); renderStats();
}

/* ================= wallet ================= */
const wallet = setupWallet({ call, errMsg, flash, fmt, esc, getMe: () => me, getPlayers: () => players, myFree });
document.querySelectorAll(".overlay").forEach((o) => o.addEventListener("click", (e) => { if (e.target === o || e.target.closest("[data-close]")) o.hidden = true; }));
addEventListener("keydown", (e) => { if (e.key === "Escape") document.querySelectorAll(".overlay").forEach((o) => (o.hidden = true)); });
$("rulesbtn").addEventListener("click", () => { $("rulesm").hidden = false; });
$("acctbtn").addEventListener("click", () => { $("acctmail").textContent = user?.email || ""; $("leavebtn").hidden = !seated(); $("acctm").hidden = false; });
$("leavebtn").addEventListener("click", async () => { $("acctm").hidden = true; try { want = null; ackWant = null; await call("leave"); } catch (e) { flash(errMsg(e)); } });
$("signout").addEventListener("click", () => { $("acctm").hidden = true; signOut(auth); });

/* ================= stats ================= */
let statsKey = "";
$("statsbtn").addEventListener("click", () => { statsOpen = !statsOpen; statsKey = ""; render(); });
$("statsx").addEventListener("click", () => { statsOpen = false; render(); });
function renderStats() {
  $("statsp").hidden = !(statsOpen && gate === "in"); $("statsbtn").classList.toggle("on", statsOpen); $("statsbtn").setAttribute("aria-pressed", statsOpen);
  if (!statsOpen || gate !== "in") return;
  const v = view(me), st = (v && v.st) || { n: 0, w: 0, l: 0, p: 0, wag: 0, prof: 0 }, curve = (v && v.curve) || [];
  const key = JSON.stringify(st) + curve.length; if (key === statsKey) return; statsKey = key;
  const pf = $("s_prof"); pf.textContent = (st.prof > 0 ? "+" : "") + fmt(st.prof); pf.style.color = st.prof > 0 ? "var(--go)" : st.prof < 0 ? "#ff7a84" : "";
  $("s_wag").textContent = fmt(st.wag);
  const dec = st.w + st.l; $("s_rate").textContent = dec ? Math.round(st.w / dec * 1000) / 10 + "%" : "–";
  $("winbar").innerHTML = st.n ? `<i style="width:${st.w / st.n * 100}%"></i><em style="width:${st.p / st.n * 100}%"></em>` : "";
  $("wl").innerHTML = `<span><i style="background:var(--go)"></i>勝ち ${st.w}</span><span><i style="background:var(--muted)"></i>引き分け ${st.p}</span><span><i style="background:var(--bk)"></i>負け ${st.l}</span>`;
  drawChart(curve);
}
function drawChart(curve) {
  const box = $("chartbox");
  if (!curve.length) { box.innerHTML = '<div class="empty">ベットして結果が出ると、ここに利益の推移が出るよ</div>'; return; }
  const pts = [0, ...curve], W = 320, H = 160, pl = 4, pr = 4, pt = 10, pb = 10;
  let mx = Math.max(0, ...pts), mn = Math.min(0, ...pts); if (mx === mn) { mx += 1; mn -= 1; }
  const X = (i) => pl + (W - pl - pr) * i / (pts.length - 1 || 1), Y = (v) => pt + (H - pt - pb) * (mx - v) / (mx - mn);
  const z = Y(0), zr = Math.min(1, Math.max(0, z / H));
  const line = pts.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${X(pts.length - 1).toFixed(1)} ${z.toFixed(1)} L${X(0).toFixed(1)} ${z.toFixed(1)} Z`;
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="累計利益の推移。最新 ${fmt(pts[pts.length - 1])}">
    <defs><linearGradient id="pg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${H}"><stop offset="${zr}" stop-color="#22d36b"/><stop offset="${zr}" stop-color="#ff4d5e"/></linearGradient></defs>
    <path d="${area}" fill="url(#pg)" fill-opacity=".16"/>
    <line x1="0" x2="${W}" y1="${z}" y2="${z}" stroke="#9aa3ae" stroke-opacity=".45" stroke-dasharray="3 4" vector-effect="non-scaling-stroke"/>
    <path d="${line}" fill="none" stroke="url(#pg)" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    <line id="cx" x1="0" x2="0" y1="0" y2="${H}" stroke="#f1f3f5" stroke-opacity=".35" vector-effect="non-scaling-stroke" visibility="hidden"/>
  </svg><div class="tip num" id="ctip" hidden></div>`;
  const svg = box.querySelector("svg"), tip = $("ctip"), cx = svg.querySelector("#cx");
  const move = (ev) => {
    const r = svg.getBoundingClientRect(), px = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const i = Math.max(0, Math.min(pts.length - 1, Math.round((px / r.width * W - pl) / (W - pl - pr) * (pts.length - 1))));
    const x = X(i); cx.setAttribute("x1", x); cx.setAttribute("x2", x); cx.setAttribute("visibility", "visible");
    tip.hidden = false; tip.style.left = (8 + x / W * r.width) + "px"; tip.style.top = (8 + Y(pts[i]) / H * r.height) + "px";
    tip.textContent = i ? `${i}回目　${pts[i] > 0 ? "+" : ""}${fmt(pts[i])}` : "スタート　0";
  };
  svg.addEventListener("pointermove", move); svg.addEventListener("pointerleave", () => { tip.hidden = true; cx.setAttribute("visibility", "hidden"); });
  svg.addEventListener("touchmove", move, { passive: true });
}

/* ================= events ================= */
$("board").addEventListener("click", (e) => { const b = e.target.closest(".spot"); if (b) { if (placedRound !== state.round) { placedStack = []; placedRound = state.round; } placeBet(b.dataset.k); } });
$("mid").addEventListener("click", (e) => {
  const c = e.target.closest(".chip"); if (c) { amount = c.dataset.v === "all" ? "all" : +c.dataset.v; render(); return; }
  if (e.target.closest("#undo")) undo();
  if (e.target.closest("#rep")) repeatOrDouble();
});
async function doJoin(name) {
  if (joining) return; joining = true; gateErr = ""; render();
  try { await call("join", { name }); }
  catch (e) { gateErr = errMsg(e); flash(gateErr); }
  joining = false; render();
}
$("mid").addEventListener("submit", (e) => { e.preventDefault(); const n = $("joinname").value.trim(); if (n) doJoin(n); });
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
$("sidebtn").addEventListener("click", () => { sideOpen = !sideOpen; render(); });
document.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { tab = b.dataset.tab; render(); } });

/* ================= realtime ================= */
function stopMember() { memberUnsubs.forEach((u) => u()); memberUnsubs = []; }
function startMember() {
  if (memberUnsubs.length) return;
  firstState = true;
  memberUnsubs.push(onSnapshot(doc(fs, "tables/main"), (s) => {
    const d = s.exists() ? s.data() : fresh();
    const prevRound = state.round;
    state = d;
    if (prevRound !== d.round) { want = null; ackWant = null; }
    if (firstState) {
      firstState = false; animatedDeal = d.dealId;
      revealedRound = d.phase === "result" ? d.round : d.round - 1;
    } else if (d.phase === "result" && d.dealId !== animatedDeal) {
      animatedDeal = d.dealId;
      if (document.visibilityState === "visible" && sNow() - (d.dealtAt || 0) < animMs(d.P, d.B)) { animate(d); return; }
      revealedRound = Math.max(revealedRound, d.round);
    } else if (d.phase !== "result" && !animating) revealedRound = Math.max(revealedRound, d.round - 1);
    render();
  }, onListenErr));
  memberUnsubs.push(onSnapshot(collection(fs, "players"), (q) => {
    const next = {}; q.docs.forEach((x) => { next[x.id] = x.data(); }); players = next; render();
  }, onListenErr));
  memberUnsubs.push(onSnapshot(collection(fs, "tables/main/bets"), (q) => {
    const next = {}; q.docs.forEach((x) => { next[x.id] = x.data(); }); betsMap = next;
    if (ackWant && sameBets(ackWant, serverMyBets())) ackWant = null;
    render();
  }, onListenErr));
  call("tick").catch(() => {});
}
function onListenErr(e) { console.warn(e); flash("接続が切れました。ページを再読み込みしてね"); }

if (!auth) { gate = "unconfigured"; render(); }
else onAuthStateChanged(auth, (u) => {
  user = u; me = u ? u.uid : null;
  if (myUnsub) { myUnsub(); myUnsub = null; }
  stopMember(); players = {}; betsMap = {}; state = fresh(); want = null; ackWant = null;
  if (!u) { gate = "out"; render(); return; }
  gate = "loading"; render();
  myUnsub = onSnapshot(doc(fs, "players/" + u.uid), (s) => {
    if (s.exists()) { players[me] = s.data(); if (gate !== "in") { gate = "in"; startMember(); } }
    else { gate = "join"; stopMember(); }
    render();
  }, (e) => { console.warn(e); gate = "join"; render(); });
});

/* ================= clock: ask the server to move the table on ================= */
let lastTick = 0;
setInterval(() => {
  renderTimer();
  if (gate !== "in" || document.visibilityState !== "visible") return;
  const now = sNow(), local = Date.now();
  if (local - lastTick < 1500) return;
  let due = false;
  if (state.phase === "betting") due = !state.closesAt || now >= state.closesAt + 150;
  else if (state.phase === "result" && !animating) due = now >= (state.dealtAt || 0) + animMs(state.P || [], state.B || []) + HOLD_MS + 150;
  if (due) { lastTick = local + Math.random() * 400; call("tick").catch(() => {}); }
}, 250);

/* ================= boot ================= */
new ResizeObserver(() => { if (animating) return; layout(); cardsKey = ""; renderCards(); }).observe($("stage"));
layout(); render();
