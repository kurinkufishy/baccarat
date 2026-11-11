// Wallet shared by the baccarat and blackjack pages: borrow chips, pay back your debt, cover a friend's, or give chips away.
import { avatar } from "./avatar.js";

const MAX_BORROW = 10000000;
const BANK_RATE = 0.01; // per day, same as the server
/** Savings balance including interest up to now. */
export const bankNow = (p, now = Date.now()) => (p && p.bank ? Math.floor(p.bank * Math.pow(1 + BANK_RATE, Math.max(0, now - (p.bankAt || now)) / 86400000)) : 0);

export function setupWallet({ call, errMsg, flash, fmt, esc, getMe, getPlayers, myFree }) {
  const $ = (id) => document.getElementById(id);
  let tab = "borrow", pick = 10000, target = null, busy = false;

  const me = () => getPlayers()[getMe()];
  const debt = () => (me() && me().dep) || 0;
  const debtors = () => Object.entries(getPlayers()).filter(([id, p]) => id !== getMe() && (p.dep || 0) > 0).sort((a, b) => b[1].dep - a[1].dep);
  const others = () => Object.entries(getPlayers()).filter(([id]) => id !== getMe()).sort((a, b) => (b[1].seated - a[1].seated) || (a[1].joinedAt || 0) - (b[1].joinedAt || 0));
  const list = () => (tab === "help" ? debtors() : others());
  function max() {
    if (tab === "borrow") return MAX_BORROW;
    if (tab === "repay") return Math.min(myFree(), debt());
    if (tab === "bank") return myFree();
    const p = target && getPlayers()[target];
    if (!p) return 0;
    return tab === "give" ? myFree() : Math.min(myFree(), p.dep || 0);
  }
  const rows = (ds, label, right, cls = "") => `<div class="wlist" role="radiogroup" aria-label="${label}">${ds.map(([id, q]) => `<button class="wrow ${id === target ? "on" : ""}" data-t="${esc(id)}" role="radio" aria-checked="${id === target}">${avatar(q, esc)}<span class="n">${esc(q.name)}</span><span class="v num ${cls}">${right(q)}</span></button>`).join("")}</div>`;
  const btnText = (p) => {
    const tn = esc(getPlayers()[target]?.name || "");
    if (tab === "borrow") return `${fmt(p)} を借りる`;
    if (tab === "repay") return `${fmt(p)} を返す`;
    if (tab === "help") return `${tn} の借金を ${fmt(p)} 肩代わり`;
    return `${tn} に ${fmt(p)} あげる`;
  };
  const packs = (list) => `<div class="packs">${list.map(([v, l]) => `<button class="pack num" data-v="${v}" ${v > 0 ? "" : "disabled"}>${l || fmt(v)}</button>`).join("")}</div>`;
  const payPacks = (m) => packs([...[1000, 10000, 50000].filter((v) => v < m).map((v) => [v]), [m, "全額 " + fmt(m)]]);
  const amountBox = (label) => `<div><label class="flab" for="wamt">${label}</label><div class="amtrow"><input id="wamt" inputmode="numeric" class="num" placeholder="金額を入れる" autocomplete="off"></div></div>`;

  function ensureTarget() {
    const ds = list();
    if (!target || !ds.some(([id]) => id === target)) target = ds.length ? ds[0][0] : null;
  }
  function draw() {
    if ($("walletm").hidden) return;
    if (tab === "help" || tab === "give") ensureTarget();
    $("wbal").textContent = fmt(myFree());
    $("wdebt").textContent = fmt(debt());
    $("wdebt").classList.toggle("neg", debt() > 0);
    document.querySelectorAll("#wtabs button").forEach((b) => b.classList.toggle("on", b.dataset.w === tab));
    let h = "", btn = "", ok = false;
    const m = max(), p = Math.min(pick, m);
    if (tab === "borrow") {
      h = packs([[10000], [100000], [1000000], [10000000]]) + amountBox(`好きな額を借りる（1回 ${fmt(MAX_BORROW)} まで）`)
        + `<p class="small">借りた分は「借金」になって、ランキングの収支から引かれる。返せば元に戻るよ。チップは全部架空だから、お金はかからない。</p>`;
      ok = pick > 0 && pick <= MAX_BORROW; btn = ok ? `${fmt(pick)} を借りる` : "金額を選んでね";
    } else if (tab === "repay") {
      if (!debt()) h = `<div class="empty">借金はないよ</div>`;
      else {
        h = payPacks(m) + amountBox("返す額")
          + `<p class="small">残高から借金を返す。返した分だけ借金が減って、収支は変わらないよ。</p>`;
        ok = p > 0; btn = ok ? `${fmt(p)} を返す` : "残高が足りないよ";
      }
    } else if (tab === "help") {
      const ds = debtors();
      if (!ds.length) h = `<div class="empty">借金してる人はいないよ</div>`;
      else {
        h = rows(ds, "肩代わりする相手", (q) => `借金 ${fmt(q.dep)}`) + payPacks(m) + amountBox("肩代わりする額")
          + `<p class="small">自分の残高で相手の借金を払う。相手の借金が減って、自分の収支はその分マイナスになるよ。</p>`;
        ok = p > 0; btn = ok ? btnText(p) : "残高が足りないよ";
      }
    } else if (tab === "bank") {
      h = `<div class="bankbox"><div><span class="mut small">預金</span><b class="num" id="bankbal"></b></div><div class="mut small">利息 1日1%（ずっと預けるほど増える）・1日あたり今 +<span class="num" id="bankday"></span></div></div>`
        + packs([[1000], [10000], [100000], [1000000]]) + amountBox("金額")
        + `<div class="bankbtns"><button class="go" data-bank="deposit">預ける</button><button class="go alt" data-bank="withdraw">引き出す</button><button class="ib" data-bank="depAll">残高を全部預ける</button><button class="ib" data-bank="wdAll">全部引き出す</button></div>`
        + `<p class="small">預けたチップはゲームでは使えないけど、なくならないし利息で増える。ランキングの収支には預金もふくまれるよ。</p>`;
      btn = "";
    } else {
      const ds = others();
      if (!ds.length) h = `<div class="empty">まだほかに誰もいないよ</div>`;
      else {
        h = rows(ds, "あげる相手", (q) => `残高 ${fmt(q.chips)}`, "plain") + payPacks(m) + amountBox("あげる額")
          + `<p class="small">自分の残高から相手にチップをあげる。借金にはならないけど、自分の収支はその分マイナス、相手はプラスになるよ。ベット中のチップはあげられない。</p>`;
        ok = p > 0; btn = ok ? btnText(p) : "残高が足りないよ";
      }
    }
    const key = tab + "|" + h;
    // The typed amount is kept out of the markup, so typing never rebuilds the form (which would close the phone keyboard).
    const typing = document.activeElement && document.activeElement.id === "wamt" && tab === $("wbody").dataset.k.split("|")[0];
    if ($("wbody").dataset.k !== key && !typing) {
      $("wbody").innerHTML = h + (btn ? `<button class="go" id="wgo" style="padding:14px;width:100%;margin-top:4px"></button>` : ""); $("wbody").dataset.k = key;
      const inp = $("wamt"), packVals = [...document.querySelectorAll("#wbody .pack")].map((b) => +b.dataset.v);
      if (inp) inp.value = pick && !packVals.includes(pick) ? pick : "";
    }
    document.querySelectorAll("#wbody .pack").forEach((b) => b.classList.toggle("on", +b.dataset.v === pick));
    const g = $("wgo"); if (g) { g.textContent = busy ? "処理中…" : btn; g.disabled = busy || !ok; }
    if (tab === "bank") { const b = bankNow(me()); $("bankbal").textContent = fmt(b); $("bankday").textContent = fmt(Math.floor(b * BANK_RATE)); }
  }

  function open() { if (!me()) return; tab = "borrow"; pick = 10000; $("walletm").hidden = false; draw(); }
  $("walletbtn").addEventListener("click", open);
  $("wtabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.w; if (tab === "help" || tab === "give") ensureTarget(); pick = tab === "borrow" || tab === "bank" ? 10000 : Math.min(1000, max()); draw(); });
  $("wbody").addEventListener("click", async (e) => {
    const bk = e.target.closest("[data-bank]");
    if (bk && !busy) {
      const kind = bk.dataset.bank, bal = bankNow(me());
      const amount = kind === "depAll" ? myFree() : kind === "wdAll" ? bal : pick;
      const op = kind === "deposit" || kind === "depAll" ? "deposit" : "withdraw";
      if (!amount || amount < 1) { flash(op === "deposit" ? "預ける額がないよ" : "預金がないよ"); return; }
      busy = true;
      try { await call("bank", { op, amount }); flash(`${fmt(amount)} ${op === "deposit" ? "預けました" : "引き出しました"}`); }
      catch (er) { flash(errMsg(er)); }
      busy = false; draw(); return;
    }
    const pk = e.target.closest(".pack"); if (pk) { pick = +pk.dataset.v; const i = $("wamt"); if (i) i.value = ""; draw(); return; }
    const r = e.target.closest(".wrow"); if (r) { target = r.dataset.t; pick = Math.min(pick || 1000, max()); draw(); return; }
    if (!e.target.closest("#wgo") || busy) return;
    const amount = tab === "borrow" ? pick : Math.min(pick, max());
    busy = true; draw();
    try {
      if (tab === "borrow") { await call("deposit", { amount }); flash(`${fmt(amount)} 借りました`); }
      else if (tab === "repay") { await call("repay", { amount }); flash(`借金を ${fmt(amount)} 返しました`); }
      else if (tab === "help") { const n = getPlayers()[target]?.name || ""; await call("repay", { amount, to: target }); flash(`${n} の借金を ${fmt(amount)} 肩代わりしました`); }
      else { const n = getPlayers()[target]?.name || ""; await call("give", { amount, to: target }); flash(`${n} に ${fmt(amount)} あげました`); }
      $("walletm").hidden = true;
    } catch (er) { flash(errMsg(er)); }
    busy = false; draw();
  });
  $("wbody").addEventListener("focusout", (e) => { if (e.target.id === "wamt") setTimeout(draw, 0); });
  $("wbody").addEventListener("input", (e) => {
    if (e.target.id !== "wamt") return;
    pick = +String(e.target.value).replace(/[^\d]/g, "") || 0;
    if (tab === "borrow") pick = Math.min(MAX_BORROW, pick);
    document.querySelectorAll("#wbody .pack").forEach((b) => b.classList.toggle("on", +b.dataset.v === pick));
    const g = $("wgo"); if (g) { const m = max(), p = Math.min(pick, m), ok = p > 0;
      g.disabled = busy || !ok;
      g.textContent = !ok ? "金額を入れてね" : btnText(p).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
  });

  // Tell me when a friend covers my debt or gives me chips.
  let seen = null;
  function watch() {
    const p = me(); if (!p) return;
    const evs = [...(p.helps || []).map((h) => ["h", h]), ...(p.gifts || []).map((g) => ["g", g])];
    if (seen === null) { seen = new Set(evs.map(([t, e]) => t + e.at + e.from)); return; }
    for (const [t, e] of evs) {
      const k = t + e.at + e.from;
      if (seen.has(k)) continue;
      seen.add(k);
      const who = getPlayers()[e.from]?.name || "だれか";
      flash(t === "h" ? `${who} が借金を ${fmt(e.amount)} 肩代わりしてくれた！` : `${who} から ${fmt(e.amount)} チップもらった！`);
    }
  }
  // Interest keeps ticking while the bank tab is open.
  setInterval(() => { if (!$("walletm").hidden && tab === "bank") draw(); }, 1000);
  return { draw, watch };
}
