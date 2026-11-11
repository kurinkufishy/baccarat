// Duel alerts for every page: when a friend challenges you, a card pops up wherever you are on the site.
// You can take the duel right there or jump to the duel page. Challengers also hear how it ended.
export function setupDuelWatch({ call, errMsg, getMe, getPlayers, here }) {
  const box = document.createElement("div");
  box.className = "dwatch"; box.setAttribute("aria-live", "polite");
  document.body.appendChild(box);
  let duels = [], known = null, results = [], busy = 0, baseTitle = document.title, beepCtx = null;
  const name = (u) => (getPlayers()[u] || {}).name || "だれか";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
  const fmt = (n) => Number(n || 0).toLocaleString("ja-JP");
  const dismissed = new Set();

  function beep() {
    try {
      beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = beepCtx.createOscillator(), g = beepCtx.createGain(), t = beepCtx.currentTime;
      o.type = "triangle"; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g).connect(beepCtx.destination); o.start(t); o.stop(t + 0.36);
    } catch { /* sound is optional */ }
  }
  function incoming() { const me = getMe(); return duels.filter((x) => x.status === "pending" && x.to === me && !dismissed.has(x.id) && x.expAt > Date.now()); }
  function draw() {
    const me = getMe(), inc = incoming(), now = Date.now();
    results = results.filter((r) => now - r.at < 9000);
    box.innerHTML = inc.map((x) => `<div class="dcard"><div class="dt">⚔️ 対戦の申し込み！</div>
        <div class="dm"><b>${esc(name(x.from))}</b> から ${x.game === "coin" ? "🪙 コイントス" : "🎲 ダイス"}・<b class="num">${fmt(x.stake)}</b>　<span class="num">あと${Math.max(0, Math.ceil((x.expAt - now) / 1000))}秒</span></div>
        <div class="db"><button class="go" data-acc="${x.id}" ${busy === x.id ? "disabled" : ""}>${busy === x.id ? "勝負中…" : "受ける"}</button>${here ? "" : `<a class="ib" href="duel.html">見に行く</a>`}<button class="ib" data-dec="${x.id}">断る</button><button class="x" data-hide="${x.id}" aria-label="閉じる">×</button></div></div>`).join("")
      + results.map((r) => `<div class="dcard res ${r.win ? "win" : "lose"}"><div class="dt">${r.win ? "🏆 タイマン勝利！" : "💀 タイマン敗北…"}</div><div class="dm">${esc(r.text)}</div></div>`).join("");
    document.title = inc.length ? `(${inc.length}) 対戦が届いた！ - ${baseTitle}` : baseTitle;
    void me;
  }
  box.addEventListener("click", async (e) => {
    const h = e.target.closest("[data-hide]"); if (h) { dismissed.add(+h.dataset.hide); draw(); return; }
    const d = e.target.closest("[data-dec]"); if (d) { try { await call("duelAnswer", { duel: +d.dataset.dec, accept: false }); } catch (er) { results.push({ at: Date.now(), win: false, text: errMsg(er) }); } draw(); return; }
    const a = e.target.closest("[data-acc]"); if (!a || busy) return;
    busy = +a.dataset.acc; draw();
    try { await call("duelAnswer", { duel: busy, accept: true }); }
    catch (er) { results.push({ at: Date.now(), win: false, text: errMsg(er) }); }
    busy = 0; draw();
  });
  setInterval(draw, 1000);

  return {
    /** Feed the latest duel list. first = initial state (no alerts for things that already happened). */
    set(list, first) {
      const me = getMe();
      duels = Array.isArray(list) ? list : [];
      const ids = new Set(duels.map((x) => x.id + ":" + x.status));
      if (known === null || first) { known = ids; draw(); return; }
      for (const x of duels) {
        const k = x.id + ":" + x.status;
        if (known.has(k)) continue;
        if (x.status === "pending" && x.to === me) beep();
        if (x.status === "done" && (x.from === me || x.to === me)) {
          const win = x.winner === me, other = x.from === me ? x.to : x.from;
          results.push({ at: Date.now(), win, text: `${name(other)} との${x.game === "coin" ? "コイントス" : "ダイス"}（${fmt(x.stake)}）${win ? `に勝って +${fmt(x.stake)}` : `に負けて -${fmt(x.stake)}`}` });
        }
        if ((x.status === "declined" || x.status === "expired") && x.from === me) results.push({ at: Date.now(), win: false, text: `${name(x.to)} への申し込みは${x.status === "declined" ? "断られた" : "時間切れ"}。${fmt(x.stake)} は戻ったよ` });
      }
      known = ids;
      draw();
    },
  };
}
