// Wallet shared by the baccarat and blackjack pages: borrow chips, pay back your debt, or cover a friend's.
const MAX_BORROW = 1000000;

export function setupWallet({ call, errMsg, flash, fmt, esc, getMe, getPlayers, myFree }) {
  const $ = (id) => document.getElementById(id);
  let tab = "borrow", pick = 10000, target = null, busy = false;

  const me = () => getPlayers()[getMe()];
  const debt = () => (me() && me().dep) || 0;
  const debtors = () => Object.entries(getPlayers()).filter(([id, p]) => id !== getMe() && (p.dep || 0) > 0).sort((a, b) => b[1].dep - a[1].dep);
  function max() {
    if (tab === "borrow") return MAX_BORROW;
    if (tab === "repay") return Math.min(myFree(), debt());
    const p = target && getPlayers()[target];
    return p ? Math.min(myFree(), p.dep || 0) : 0;
  }
  const packs = (list) => `<div class="packs">${list.map(([v, l]) => `<button class="pack num ${v === pick ? "on" : ""}" data-v="${v}" ${v > 0 ? "" : "disabled"}>${l || fmt(v)}</button>`).join("")}</div>`;
  const payPacks = (m) => packs([...[1000, 10000, 50000].filter((v) => v < m).map((v) => [v]), [m, "全額 " + fmt(m)]]);
  const amountBox = (label) => `<div><label class="flab" for="wamt">${label}</label><div class="amtrow"><input id="wamt" inputmode="numeric" class="num" placeholder="金額を入れる" autocomplete="off" value="${pick && ![1000, 10000, 50000, 100000].includes(pick) ? pick : ""}"></div></div>`;

  function ensureTarget() {
    const ds = debtors();
    if (ds.length && (!target || !ds.some(([id]) => id === target))) target = ds[0][0];
  }
  function draw() {
    if ($("walletm").hidden) return;
    if (tab === "help") ensureTarget();
    $("wbal").textContent = fmt(myFree());
    $("wdebt").textContent = fmt(debt());
    $("wdebt").classList.toggle("neg", debt() > 0);
    document.querySelectorAll("#wtabs button").forEach((b) => b.classList.toggle("on", b.dataset.w === tab));
    let h = "", btn = "", ok = false;
    const m = max(), p = Math.min(pick, m);
    if (tab === "borrow") {
      h = packs([[1000], [10000], [50000], [100000]]) + amountBox(`好きな額を借りる（1回 ${fmt(MAX_BORROW)} まで）`)
        + `<p class="small">借りた分は「借金」になって、ランキングの収支から引かれる。返せば元に戻るよ。チップは全部架空だから、お金はかからない。</p>`;
      ok = pick > 0 && pick <= MAX_BORROW; btn = ok ? `${fmt(pick)} を借りる` : "金額を選んでね";
    } else if (tab === "repay") {
      if (!debt()) h = `<div class="empty">借金はないよ</div>`;
      else {
        h = payPacks(m) + amountBox("返す額")
          + `<p class="small">残高から借金を返す。返した分だけ借金が減って、収支は変わらないよ。</p>`;
        ok = p > 0; btn = ok ? `${fmt(p)} を返す` : "残高が足りないよ";
      }
    } else {
      const ds = debtors();
      if (!ds.length) h = `<div class="empty">借金してる人はいないよ</div>`;
      else {
        h = `<div class="wlist" role="radiogroup" aria-label="肩代わりする相手">${ds.map(([id, q]) => `<button class="wrow ${id === target ? "on" : ""}" data-t="${esc(id)}" role="radio" aria-checked="${id === target}"><span class="dot" style="background:${esc(q.color)}">${esc((q.name || "?")[0])}</span><span class="n">${esc(q.name)}</span><span class="v num">借金 ${fmt(q.dep)}</span></button>`).join("")}</div>`
          + payPacks(m) + amountBox("肩代わりする額")
          + `<p class="small">自分の残高で相手の借金を払う。相手の借金が減って、自分の収支はその分マイナスになるよ。</p>`;
        const tn = getPlayers()[target]?.name || "";
        ok = p > 0; btn = ok ? `${esc(tn)} の借金を ${fmt(p)} 肩代わり` : "残高が足りないよ";
      }
    }
    const key = tab + "|" + h;
    if ($("wbody").dataset.k !== key) { $("wbody").innerHTML = h + (btn ? `<button class="go" id="wgo" style="padding:14px;width:100%;margin-top:4px"></button>` : ""); $("wbody").dataset.k = key; }
    const g = $("wgo"); if (g) { g.textContent = busy ? "処理中…" : btn; g.disabled = busy || !ok; }
  }

  function open() { if (!me()) return; tab = "borrow"; pick = 10000; $("walletm").hidden = false; draw(); }
  $("walletbtn").addEventListener("click", open);
  $("wtabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; tab = b.dataset.w; if (tab === "help") ensureTarget(); pick = tab === "borrow" ? 10000 : Math.min(1000, max()); draw(); });
  $("wbody").addEventListener("click", async (e) => {
    const pk = e.target.closest(".pack"); if (pk) { pick = +pk.dataset.v; const i = $("wamt"); if (i) i.value = ""; draw(); return; }
    const r = e.target.closest(".wrow"); if (r) { target = r.dataset.t; pick = Math.min(pick || 1000, max()); draw(); return; }
    if (!e.target.closest("#wgo") || busy) return;
    const amount = tab === "borrow" ? pick : Math.min(pick, max());
    busy = true; draw();
    try {
      if (tab === "borrow") { await call("deposit", { amount }); flash(`${fmt(amount)} 借りました`); }
      else if (tab === "repay") { await call("repay", { amount }); flash(`借金を ${fmt(amount)} 返しました`); }
      else { const n = getPlayers()[target]?.name || ""; await call("repay", { amount, to: target }); flash(`${n} の借金を ${fmt(amount)} 肩代わりしました`); }
      $("walletm").hidden = true;
    } catch (er) { flash(errMsg(er)); }
    busy = false; draw();
  });
  $("wbody").addEventListener("input", (e) => {
    if (e.target.id !== "wamt") return;
    pick = +String(e.target.value).replace(/[^\d]/g, "") || 0;
    if (tab === "borrow") pick = Math.min(MAX_BORROW, pick);
    document.querySelectorAll("#wbody .pack").forEach((b) => b.classList.toggle("on", +b.dataset.v === pick));
    const g = $("wgo"); if (g) { const m = max(), p = Math.min(pick, m), ok = p > 0;
      g.disabled = busy || !ok;
      g.textContent = !ok ? "金額を入れてね" : tab === "borrow" ? `${fmt(p)} を借りる` : tab === "repay" ? `${fmt(p)} を返す` : `${getPlayers()[target]?.name || ""} の借金を ${fmt(p)} 肩代わり`; }
  });

  // Tell me when a friend covers my debt.
  let seen = null;
  function watch() {
    const p = me(); if (!p) return;
    const hs = p.helps || [];
    if (seen === null) { seen = new Set(hs.map((h) => h.at + h.from)); return; }
    for (const h of hs) {
      const k = h.at + h.from;
      if (seen.has(k)) continue;
      seen.add(k);
      flash(`${getPlayers()[h.from]?.name || "だれか"} が借金を ${fmt(h.amount)} 肩代わりしてくれた！`);
    }
  }
  return { draw, watch };
}
