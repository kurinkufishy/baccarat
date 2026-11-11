// Achievements window and unlock toasts, shared by both pages. The server decides what's unlocked;
// this only draws it. Toasts wait while cards are still being dealt so they never spoil a result.
import { avatar } from "./avatar.js";

export function setupAch({ call, errMsg, flash, esc, fmt, getMe, getPlayers, busy }) {
  const $ = (id) => document.getElementById(id);
  let defs = [], known = null, tab = "me", tierF = 0, queue = [], showing = false, busyFr = false;
  // Unlockable looks: avatar frames and chat bubbles. Same rules, different field on the player.
  const LOOKS = {
    frame: { field: "frame", action: "setFrame", label: "フレーム", list: [], seen: null,
      intro: "実績を集めるとフレームが使えるようになるよ。つけたフレームはチャットやランキングでみんなに見える。",
      preview: (p, id) => avatar(p, esc, id, "big") },
    bubble: { field: "bubble", action: "setBubble", label: "吹き出し", list: [], seen: null,
      intro: "チャットの吹き出しの見た目を変えられるよ。みんなの画面でもこの見た目になる。",
      preview: (p, id) => `<span class="ct bprev${id ? " bb-" + id : ""}">よろしく！</span>` },
  };
  const TIER = { 1: "ブロンズ", 2: "シルバー", 3: "ゴールド" };

  const btn = document.createElement("button");
  btn.className = "ib"; btn.id = "achbtn"; btn.hidden = true;
  btn.textContent = "実績";
  document.querySelector(".icons").insertBefore(btn, $("rulesbtn") || null);

  const ov = document.createElement("div");
  ov.className = "overlay"; ov.id = "achm"; ov.hidden = true;
  ov.innerHTML = `<div class="modal achmodal" role="dialog" aria-modal="true" aria-labelledby="acht">
    <div class="mhead"><span id="acht">実績</span><button class="x" data-close aria-label="閉じる">×</button></div>
    <div class="tabs" id="achtabs"><button data-t="me" class="on">自分</button><button data-t="frame">フレーム</button><button data-t="bubble">吹き出し</button><button data-t="all">みんな</button></div>
    <div id="achbody"></div></div>`;
  document.body.appendChild(ov);
  const toast = document.createElement("div");
  toast.className = "achtoast"; toast.setAttribute("role", "status"); toast.hidden = true;
  document.body.appendChild(toast);

  const mine = () => (getPlayers()[getMe()] || {}).ach || {};
  const short = (n) => n >= 1e12 ? (+(n / 1e12).toFixed(1)) + "兆" : n >= 1e8 ? (+(n / 1e8).toFixed(1)) + "億" : n >= 1e4 ? (+(n / 1e4).toFixed(1)) + "万" : String(Math.floor(n));
  /** How far a player is toward an achievement's goal (see PROG on the server). */
  function progVal(p, k) {
    const neg = k[0] === "-", key = neg ? k.slice(1) : k;
    let v;
    if (key === "wag") v = ["st", "bjst", "fxst", "rcst", "hlst", "spst", "pkst", "crst"].reduce((s, f) => s + ((p[f] && p[f].wag) || 0), 0);
    else if (key === "achn") v = Object.keys(p.ach || {}).filter((id) => id !== "collector" && defs.some((a) => a.id === id)).length;
    else v = key.split(".").reduce((o, f) => (o && typeof o === "object" ? o[f] : undefined), p) || 0;
    return Math.max(0, neg ? -v : v);
  }
  function progHtml(p, a) {
    if (!a.prog) return "";
    const v = Math.min(progVal(p, a.prog.k), a.prog.goal), pct = (v / a.prog.goal) * 100;
    return `<div class="aprog"><i style="width:${pct}%"></i></div><small class="num">${a.prog.k.includes(".b") || a.prog.k.includes(".j") ? "いま " : ""}${short(v)} / ${short(a.prog.goal)}</small>`;
  }
  const date = (at) => { const d = new Date(at); return `${d.getMonth() + 1}/${d.getDate()}`; };

  function draw() {
    if (ov.hidden) return;
    document.querySelectorAll("#achtabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    let h;
    if (tab === "me") {
      const got = mine(), n = defs.filter((a) => got[a.id]).length;
      const card = (a) => {
        const on = !!got[a.id], hide = a.secret && !on;
        return `<div class="achc t${a.tier} ${on ? "on" : ""}"><span class="medal" aria-hidden="true">${on ? "★" : "?"}</span><div><b>${hide ? "？？？" : esc(a.name)}</b><span>${hide ? "ひみつの実績" : esc(a.desc)}</span>${on ? `<small>${date(got[a.id])} 解除</small>` : progHtml(getPlayers()[getMe()] || {}, a)}</div></div>`;
      };
      const count = (t) => { const l = defs.filter((a) => a.tier === t); return [l.filter((a) => got[a.id]).length, l.length]; };
      const pills = [[0, "すべて", [n, defs.length]], [1, "ブロンズ", count(1)], [2, "シルバー", count(2)], [3, "ゴールド", count(3)]];
      const section = (t) => {
        const [g, all] = count(t);
        const list = defs.filter((a) => a.tier === t).sort((x, y) => (got[y.id] ? 1 : 0) - (got[x.id] ? 1 : 0));
        return `<section class="achsec t${t}"><h3><span class="medal sm" aria-hidden="true">★</span>${TIER[t]}<span class="num">${g} / ${all}</span></h3><div class="achgrid">${list.map(card).join("")}</div></section>`;
      };
      h = `<div class="achsum"><div><b class="num">${n}</b> / ${defs.length} 解除</div><div class="achbar"><i style="width:${defs.length ? (n / defs.length) * 100 : 0}%"></i></div></div>
        <div class="achpills" role="tablist">${pills.map(([t, l, [g, all]]) => `<button class="achpill ${t ? "t" + t : ""} ${t === tierF ? "on" : ""}" data-tier="${t}" role="tab" aria-selected="${t === tierF}">${l}<span class="num">${g}/${all}</span></button>`).join("")}</div>
        ${(tierF ? [tierF] : [1, 2, 3]).map(section).join("")}`;
    } else if (LOOKS[tab]) {
      const L = LOOKS[tab], p = getPlayers()[getMe()] || {}, cur = p[L.field] || "";
      h = `<p class="small" style="margin:0">${L.intro}</p>
        <div class="frgrid">${[{ id: "", name: tab === "bubble" ? "ふつう" : "なし", how: "" }, ...L.list].map((f) => {
          const ok = f.id === "" || frameOk(p, f), on = f.id === cur;
          return `<button class="frc ${on ? "on" : ""}" data-f="${esc(f.id)}" ${!ok || on || busyFr ? "disabled" : ""}>${L.preview(p, f.id)}<b>${esc(f.name)}</b><small>${on ? "つけてる" : ok ? "つける" : "🔒 " + esc(f.how) + reqProg(p, f)}</small></button>`;
        }).join("")}</div>`;
    } else {
      const ps = Object.entries(getPlayers()).map(([id, p]) => {
        const got = p.ach || {}, list = defs.filter((a) => got[a.id]);
        return { id, p, n: list.length, gold: list.filter((a) => a.tier === 3).length, last: list.sort((x, y) => got[y.id] - got[x.id])[0] };
      }).sort((a, b) => b.n - a.n || b.gold - a.gold);
      h = `<div class="achrank">${ps.map((r, i) => `<div class="achr ${r.id === getMe() ? "me" : ""}"><span class="num rk">${i + 1}</span>${avatar(r.p, esc)}<span class="n">${esc(r.p.name)}<small>${r.last ? "最近: " + esc(r.last.name) : "まだなし"}</small></span><span class="num c">${r.n}<small>${r.gold ? ` ★${r.gold}` : ""}</small></span></div>`).join("") || `<div class="empty">まだ誰もいないよ</div>`}</div>`;
    }
    $("achbody").innerHTML = h;
  }

  function pump() {
    if (showing || !queue.length) return;
    if (busy()) { setTimeout(pump, 400); return; }
    const a = queue.shift();
    showing = true;
    toast.className = `achtoast t${a.tier}`;
    toast.innerHTML = `<span class="medal" aria-hidden="true">★</span><div><small>${a.look ? "新しい" + a.look : "実績解除・" + TIER[a.tier]}</small><b>${esc(a.name)}</b><span>${esc(a.desc)}</span></div>`;
    toast.hidden = false;
    setTimeout(() => { toast.hidden = true; showing = false; setTimeout(pump, 300); }, 3800);
  }

  function reqProg(p, f) {
    const got = Object.keys(p.ach || {}).filter((id) => tierOf(id));
    if (f.req.count) return `（${Math.min(got.length, f.req.count)}/${f.req.count}）`;
    if (f.req.gold) return `（${Math.min(got.filter((id) => tierOf(id) === 3).length, f.req.gold)}/${f.req.gold}）`;
    const a = f.req.ach && defs.find((x) => x.id === f.req.ach);
    if (a && a.prog) return `（${short(Math.min(progVal(p, a.prog.k), a.prog.goal))}/${short(a.prog.goal)}）`;
    return "";
  }
  const tierOf = (id) => (defs.find((a) => a.id === id) || {}).tier;
  function frameOk(p, f) {
    const got = Object.keys(p.ach || {}).filter((id) => tierOf(id));
    if (f.req.count) return got.length >= f.req.count;
    if (f.req.gold) return got.filter((id) => tierOf(id) === 3).length >= f.req.gold;
    if (f.req.ach) return got.includes(f.req.ach);
    return false;
  }
  $("achbody").addEventListener("click", async (e) => {
    const pill = e.target.closest(".achpill"); if (pill) { tierF = +pill.dataset.tier; draw(); return; }
    const b = e.target.closest(".frc"); if (!b || b.disabled || busyFr) return;
    const L = LOOKS[tab]; if (!L) return;
    busyFr = true; draw();
    try { await call(L.action, { [L.field]: b.dataset.f }); flash(b.dataset.f ? `${L.label}「${L.list.find((f) => f.id === b.dataset.f)?.name}」にした` : `${L.label}を元に戻した`); }
    catch (er) { flash(errMsg(er)); }
    busyFr = false; draw();
  });
  btn.addEventListener("click", () => { ov.hidden = false; tab = "me"; tierF = 0; draw(); });
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-close]")) ov.hidden = true; });
  $("achtabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { tab = b.dataset.t; draw(); } });

  return {
    setDefs(list, fr, bb) { if (Array.isArray(list) && list.length) defs = list; if (Array.isArray(fr)) LOOKS.frame.list = fr; if (Array.isArray(bb)) LOOKS.bubble.list = bb; },
    reset() { known = null; LOOKS.frame.seen = null; LOOKS.bubble.seen = null; },
    /** Call after every state update. */
    update(live) {
      btn.hidden = !live || !defs.length;
      const p = getPlayers()[getMe()];
      if (!live || !p) return;
      // My own frame on the account button too.
      const img = document.querySelector("#acctbtn img");
      if (img) img.className = p.frame ? `fr fr-${p.frame}` : "";
      const got = p.ach || {};
      if (known === null) known = new Set(Object.keys(got));
      for (const id of Object.keys(got)) {
        if (known.has(id)) continue;
        known.add(id);
        const a = defs.find((x) => x.id === id);
        if (a) queue.push(a);
      }
      // Tell me when a new frame or bubble becomes available.
      for (const L of Object.values(LOOKS)) {
        const usable = L.list.filter((f) => frameOk(p, f)).map((f) => f.id);
        if (L.seen === null) { L.seen = new Set(usable); continue; }
        for (const id of usable) if (!L.seen.has(id)) { L.seen.add(id); const f = L.list.find((x) => x.id === id); queue.push({ tier: 3, name: `${L.label}「${f.name}」`, desc: `実績の画面の「${L.label}」から使えるよ`, look: L.label }); }
      }
      pump();
      draw();
    },
  };
}
