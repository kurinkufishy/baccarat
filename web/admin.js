// Admin page: only accounts whose user ID is listed in ADMIN_UIDS (server/wrangler.toml) can change anything.
// Every change goes through the server, which checks the ID again, so hiding this page is not what keeps it safe.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";
import { connect } from "./net.js";
import { avatar } from "./avatar.js";

const START = 10000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
const short = (n) => { const a = Math.abs(n), s = n < 0 ? "-" : ""; return s + (a >= 1e12 ? (+(a / 1e12).toFixed(2)) + "兆" : a >= 1e8 ? (+(a / 1e8).toFixed(2)) + "億" : a >= 1e4 ? (+(a / 1e4).toFixed(1)) + "万" : String(a)); };
const netOf = (p) => p.chips - (p.dep || 0) - START;

/** "1兆", "500億", "10B", "-1.5M", "12,345" → integer, or null. */
function parseAmount(s) {
  const t = String(s || "").replace(/[,\s，、_]/g, "").replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/ー/g, "-");
  const m = t.match(/^(-?)(\d+(?:\.\d+)?)(兆|億|万|千|[tTbBmMkK])?$/);
  if (!m) return null;
  const mul = { 兆: 1e12, 億: 1e8, 万: 1e4, 千: 1e3, t: 1e12, b: 1e9, m: 1e6, k: 1e3 }[(m[3] || "").toLowerCase()] || 1;
  const v = Math.round(parseFloat(m[2]) * mul) * (m[1] ? -1 : 1);
  return Number.isSafeInteger(v) ? v : null;
}

const auth = getAuth(initializeApp(firebaseConfig));
let conn = null, online = false, user = null, me = null, admin = null, myUid = "", players = {}, sel = null, sortBy = "net", busy = false;
const call = (name, data) => (conn ? conn.call(name, data) : Promise.reject(new Error("接続中…")));
let toastT = null;
function toast(t, bad) { const el = $("toast"); el.textContent = t; el.className = "toast" + (bad ? " bad" : ""); el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3200); }

function renderGate() {
  let h = "";
  if (!user) h = `<h2>ログイン</h2><p>運営のGoogleアカウントでログインしてね。</p><button class="gbtn" id="gsign">Googleでログイン</button>`;
  else if (admin === null) h = `<p>確認中…</p>`;
  else if (!admin) h = `<h2>このアカウントは運営じゃないよ</h2>
    <p>運営にするには、下のIDをサーバーの設定に入れる。GitHubの <code>server/wrangler.toml</code> の <code>ADMIN_UIDS = ""</code> の "" の中にこのIDを貼ってコミットすれば、1〜2分で使えるようになる（Claudeに渡してもOK）。</p>
    <div class="uidrow"><code id="uid">${esc(myUid)}</code><button class="ib" id="copyuid">コピー</button></div>
    <p class="mut small">このIDはGoogleアカウントの番号みたいなもので、知られてもログインはできないよ。</p>`;
  $("gate").innerHTML = h; $("gate").hidden = !!admin;
  $("main").hidden = !admin; $("logbox").hidden = !admin;
  $("signout").hidden = !user;
}
function renderList() {
  const q = $("q").value.trim().toLowerCase();
  const list = Object.entries(players).filter(([, p]) => !q || String(p.name).toLowerCase().includes(q));
  const key = { net: ([, p]) => -netOf(p), chips: ([, p]) => -p.chips, dep: ([, p]) => -(p.dep || 0), name: ([, p]) => 0 }[sortBy];
  list.sort((a, b) => (sortBy === "name" ? String(a[1].name).localeCompare(String(b[1].name), "ja") : key(a) - key(b)));
  $("plist").innerHTML = list.map(([uid, p]) => `<button class="prow ${uid === sel ? "on" : ""}" data-u="${esc(uid)}">${avatar(p, esc)}<span class="n">${esc(p.name)}${p.note ? `<small>${esc(p.note)}</small>` : ""}</span><span class="v num ${netOf(p) >= 0 ? "pos" : "neg"}">${short(netOf(p))}</span></button>`).join("") || '<div class="empty">いないよ</div>';
  document.querySelectorAll("#sorts button").forEach((b) => b.classList.toggle("on", b.dataset.s === sortBy));
}
function renderDetail() {
  const p = sel && players[sel];
  if (!p) { $("detail").innerHTML = '<div class="empty">左からプレイヤーを選んでね</div>'; return; }
  const amt = $("amt") ? $("amt").value : "", note = $("note") ? $("note").value : p.note || "", nm = $("nm") ? $("nm").value : "";
  const keepAmt = $("detail").dataset.u === sel;
  $("detail").dataset.u = sel;
  $("detail").innerHTML = `
    <div class="dhead">${avatar(p, esc, p.frame, "big")}<div><h2>${esc(p.name)}</h2><span class="mut small">ID ${esc(sel)}</span></div></div>
    <div class="nums"><div><span>残高</span><b class="num">${fmt(p.chips)}</b><small>${short(p.chips)}</small></div><div><span>借金</span><b class="num neg">${fmt(p.dep || 0)}</b><small>${short(p.dep || 0)}</small></div><div><span>収支</span><b class="num ${netOf(p) >= 0 ? "pos" : "neg"}">${fmt(netOf(p))}</b><small>${short(netOf(p))}</small></div></div>
    <div class="grp"><label for="amt">金額 <span class="mut small">（例: 1兆、500億、10B、-10B、12345）</span></label>
      <input id="amt" class="ain num" inputmode="text" autocomplete="off" value="${keepAmt ? esc(amt) : ""}"><div class="parsed" id="parsed"></div>
      <div class="btns">
        <button data-op="add">足す</button><button data-op="addDebt">借金で足す</button><button data-op="sub">引く</button>
        <button data-op="setChips">残高をこの額に</button><button data-op="setDebt">借金をこの額に</button><button data-op="setNet">収支をこの額に</button>
      </div></div>
    <div class="grp"><label for="note">ひとこと <span class="mut small">（ランキングで名前の下に出る・30文字まで）</span></label>
      <div class="row2"><input id="note" class="ain" maxlength="30" autocomplete="off" value="${esc(keepAmt ? note : p.note || "")}"><button data-op="note">保存</button><button data-op="noteClear">消す</button></div></div>
    <div class="grp"><label for="nm">名前を変える <span class="mut small">（無料・12文字まで）</span></label>
      <div class="row2"><input id="nm" class="ain" maxlength="12" autocomplete="off" value="${esc(keepAmt ? nm : "")}" placeholder="${esc(p.name)}"><button data-op="rename">変更</button></div></div>`;
  showParsed();
  $("detail").querySelectorAll("button[data-op]").forEach((b) => (b.disabled = busy));
}
function showParsed() {
  const el = $("parsed"); if (!el) return;
  const raw = $("amt").value.trim(), v = parseAmount(raw);
  el.textContent = !raw ? "" : v === null ? "読めない金額だよ" : `= ${fmt(v)}（${short(v)}）`;
  el.className = "parsed" + (raw && v === null ? " bad" : "");
}
async function act(op) {
  const p = players[sel]; if (!p || busy) return;
  let msg, data;
  const v = parseAmount($("amt") && $("amt").value);
  const needAmt = ["add", "addDebt", "sub", "setChips", "setDebt", "setNet"].includes(op);
  if (needAmt && v === null) { toast("金額を入れてね", true); return; }
  if (op === "add" || op === "addDebt") { if (v <= 0) return toast("足す額はプラスで入れてね", true); data = { op: "add", amount: v, asDebt: op === "addDebt" }; msg = `${p.name} に ${short(v)} ${op === "addDebt" ? "を借金で足す" : "足す"}`; }
  else if (op === "sub") { if (v <= 0) return toast("引く額はプラスで入れてね", true); data = { op: "add", amount: -v }; msg = `${p.name} から ${short(v)} 引く`; }
  else if (op === "setChips" || op === "setDebt") { if (v < 0) return toast("マイナスにはできないよ", true); data = { op, amount: v }; msg = `${p.name} の${op === "setChips" ? "残高" : "借金"}を ${fmt(v)} にする`; }
  else if (op === "setNet") { data = { op, amount: v }; msg = `${p.name} の収支をちょうど ${fmt(v)} にする`; }
  else if (op === "note" || op === "noteClear") { data = { op: "note", text: op === "note" ? $("note").value : "" }; msg = op === "note" ? `${p.name} のひとことを保存` : `${p.name} のひとことを消す`; }
  else if (op === "rename") { const n = $("nm").value.trim(); if (!n) return toast("新しい名前を入れてね", true); data = { op, name: n }; msg = `${p.name} の名前を「${n}」に変える`; }
  if (!confirm(msg + "？")) return;
  busy = true; renderDetail();
  try { await call("admin", { ...data, uid: sel }); toast("できた：" + msg); if ($("amt")) $("amt").value = ""; if (op === "rename") $("nm").value = ""; loadLog(); }
  catch (e) { toast(e.message || "うまくいかなかった", true); }
  busy = false; renderDetail();
}
async function loadLog() {
  try {
    const { log } = await call("admin", { op: "log" });
    $("log").innerHTML = log.length ? log.map((x) => { const d = new Date(x.at); return `<div class="lrow"><span class="mut num">${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}</span><b>${esc(x.target)}</b><span>${esc(x.what)}</span><span class="mut small">by ${esc(x.by)}</span></div>`; }).join("") : '<div class="empty">まだ何もしてないよ</div>';
  } catch { /* not admin or offline */ }
}

$("gate").addEventListener("click", async (e) => {
  if (e.target.closest("#copyuid")) { try { await navigator.clipboard.writeText(myUid); toast("コピーした"); } catch { toast("コピーできなかった。長押しで選んでね", true); } return; }
  if (!e.target.closest("#gsign")) return;
  const provider = new GoogleAuthProvider(); provider.setCustomParameters({ prompt: "select_account" });
  try { await signInWithPopup(auth, provider); } catch (er) { if (er && er.code === "auth/popup-blocked") await signInWithRedirect(auth, provider); }
});
$("signout").addEventListener("click", () => signOut(auth));
$("q").addEventListener("input", renderList);
$("sorts").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { sortBy = b.dataset.s; renderList(); } });
$("plist").addEventListener("click", (e) => { const b = e.target.closest(".prow"); if (b) { sel = b.dataset.u; renderList(); renderDetail(); } });
$("detail").addEventListener("click", (e) => { const b = e.target.closest("button[data-op]"); if (b) act(b.dataset.op); });
$("detail").addEventListener("input", (e) => { if (e.target.id === "amt") showParsed(); });
$("reloadlog").addEventListener("click", loadLog);

function status() { $("live").classList.toggle("on", online); $("livetxt").textContent = online ? "LIVE" : user ? "接続中" : "ログイン前"; }
function onReady(st, uid) {
  me = uid; myUid = uid; players = st.players || {};
  call("admin", { op: "whoami" }).then((r) => { admin = !!r.admin; renderGate(); if (admin) { renderList(); renderDetail(); loadLog(); } }).catch(() => { admin = false; renderGate(); });
}
function onBatch(msgs) {
  let ch = false;
  for (const m of msgs) if (m.type === "player") { if (m.p) players[m.uid] = m.p; else delete players[m.uid]; ch = true; }
  if (ch && admin) { renderList(); if (!busy && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("#detail"))) renderDetail(); }
}
onAuthStateChanged(auth, (u) => {
  user = u; admin = null; players = {}; sel = null;
  if (conn) { conn.close(); conn = null; }
  renderGate(); status();
  if (!u) return;
  conn = connect({ getToken: () => u.getIdToken(), onReady, onBatch, onStatus: (on) => { online = on; status(); } });
});
renderGate(); status();
