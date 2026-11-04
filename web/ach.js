// Achievements window and unlock toasts, shared by both pages. The server decides what's unlocked;
// this only draws it. Toasts wait while cards are still being dealt so they never spoil a result.
export function setupAch({ esc, fmt, getMe, getPlayers, busy }) {
  const $ = (id) => document.getElementById(id);
  let defs = [], known = null, tab = "me", queue = [], showing = false;
  const TIER = { 1: "ブロンズ", 2: "シルバー", 3: "ゴールド" };

  const btn = document.createElement("button");
  btn.className = "ib"; btn.id = "achbtn"; btn.hidden = true;
  btn.textContent = "実績";
  document.querySelector(".icons").insertBefore(btn, $("rulesbtn") || null);

  const ov = document.createElement("div");
  ov.className = "overlay"; ov.id = "achm"; ov.hidden = true;
  ov.innerHTML = `<div class="modal achmodal" role="dialog" aria-modal="true" aria-labelledby="acht">
    <div class="mhead"><span id="acht">実績</span><button class="x" data-close aria-label="閉じる">×</button></div>
    <div class="tabs" id="achtabs"><button data-t="me" class="on">自分</button><button data-t="all">みんな</button></div>
    <div id="achbody"></div></div>`;
  document.body.appendChild(ov);
  const toast = document.createElement("div");
  toast.className = "achtoast"; toast.setAttribute("role", "status"); toast.hidden = true;
  document.body.appendChild(toast);

  const mine = () => (getPlayers()[getMe()] || {}).ach || {};
  const date = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}`; };

  function draw() {
    if (ov.hidden) return;
    document.querySelectorAll("#achtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    let h;
    if (tab === "me") {
      const got = mine(), n = defs.filter((a) => got[a.id]).length;
      h = `<div class="achsum"><div><b class="num">${n}</b> / ${defs.length} 解除</div><div class="achbar"><i style="width:${defs.length ? (n / defs.length) * 100 : 0}%"></i></div></div>
        <div class="achgrid">${defs.map((a) => {
          const on = !!got[a.id], hide = a.secret && !on;
          return `<div class="achc t${a.tier} ${on ? "on" : ""}"><span class="medal" aria-hidden="true">${on ? "★" : "?"}</span><div><b>${hide ? "？？？" : esc(a.name)}</b><span>${hide ? "ひみつの実績" : esc(a.desc)}</span><small>${TIER[a.tier]}${on ? "・" + date(got[a.id]) : ""}</small></div></div>`;
        }).join("")}</div>`;
    } else {
      const ps = Object.entries(getPlayers()).map(([id, p]) => {
        const got = p.ach || {}, list = defs.filter((a) => got[a.id]);
        return { id, p, n: list.length, gold: list.filter((a) => a.tier === 3).length, last: list.sort((x, y) => got[y.id] - got[x.id])[0] };
      }).sort((a, b) => b.n - a.n || b.gold - a.gold);
      h = `<div class="achrank">${ps.map((r, i) => `<div class="achr ${r.id === getMe() ? "me" : ""}"><span class="num rk">${i + 1}</span><span class="dot" style="background:${esc(r.p.color)}">${esc((r.p.name || "?")[0])}</span><span class="n">${esc(r.p.name)}<small>${r.last ? "最近: " + esc(r.last.name) : "まだなし"}</small></span><span class="num c">${r.n}<small>${r.gold ? ` ★${r.gold}` : ""}</small></span></div>`).join("") || `<div class="empty">まだ誰もいないよ</div>`}</div>`;
    }
    $("achbody").innerHTML = h;
  }

  function pump() {
    if (showing || !queue.length) return;
    if (busy()) { setTimeout(pump, 400); return; }
    const a = queue.shift();
    showing = true;
    toast.className = `achtoast t${a.tier}`;
    toast.innerHTML = `<span class="medal" aria-hidden="true">★</span><div><small>実績解除・${TIER[a.tier]}</small><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>`;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; showing = false; setTimeout(pump, 300); }, 3800);
  }

  btn.addEventListener("click", () => { ov.hidden = false; tab = "me"; draw(); });
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.hidden = true; });
  $("achtabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { tab = b.dataset.t; draw(); } });

  return {
    setDefs(list) { if (Array.isArray(list) && list.length) defs = list; },
    reset() { known = null; },
    /** Call after every state update. */
    update(live) {
      btn.hidden = !live || !defs.length;
      const p = getPlayers()[getMe()];
      if (!live || !p) return;
      const got = p.ach || {};
      if (known === null) known = new Set(Object.keys(got));
      for (const id of Object.keys(got)) {
        if (known.has(id)) continue;
        known.add(id);
        const a = defs.find((x) => x.id === id);
        if (a) queue.push(a);
      }
      pump();
      draw();
    },
  };
}
