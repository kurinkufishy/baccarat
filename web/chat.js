// One chat room for everyone, shared by the baccarat and blackjack pages.
// Builds its own button and panel; the page feeds it messages and tells it when the player is signed in.
import { avatar } from "./avatar.js";

export function setupChat({ call, errMsg, esc, getMe, getPlayers }) {
  const $ = (id) => document.getElementById(id);
  const MAX = 120;
  const wide = () => window.matchMedia("(min-width: 641px)").matches;
  let msgs = [], open = false, live = false, busy = false, seen = 0, pref = null, tickT = null;
  try { seen = +localStorage.getItem("chatSeen") || 0; pref = localStorage.getItem("chatOpen"); } catch { /* storage blocked */ }
  // On a tablet or PC the chat sits open in the top-left of the table unless you closed it; on a phone it starts closed.
  open = pref === null ? wide() : pref === "1";

  const btn = document.createElement("button");
  btn.className = "ib"; btn.id = "chatbtn"; btn.hidden = true; btn.setAttribute("aria-pressed", "false");
  btn.innerHTML = `チャット<span class="cbadge num" id="cbadge" hidden></span>`;
  const icons = document.querySelector(".icons");
  icons.insertBefore(btn, $("rulesbtn") || null);

  const panel = document.createElement("section");
  panel.className = "chatp"; panel.id = "chatp"; panel.hidden = true; panel.setAttribute("aria-label", "チャット");
  panel.innerHTML = `<div class="mhead"><span>チャット <small class="mut">みんなに見える</small></span><button class="x" id="chatx" aria-label="閉じる">×</button></div>
    <div class="clog" id="clog" aria-live="polite"></div>
    <div class="cform"><div class="csug" id="csug" role="listbox" aria-label="メンションの候補" hidden></div><input id="cin" maxlength="${MAX}" placeholder="メッセージ（@で名前を呼べる）" autocomplete="off" enterkeyhint="send"><button class="go" id="csend">送信</button></div>`;
  const stage = $("stage");
  stage.appendChild(panel);
  // While the chat is closed, new messages pop up briefly in the same corner.
  const ticker = document.createElement("div");
  ticker.className = "cticker"; ticker.setAttribute("aria-hidden", "true");
  stage.appendChild(ticker);

  const bb = (uid) => { const b = getPlayers()[uid]?.bubble; return b && /^[a-z]{1,16}$/.test(b) ? " bb-" + b : ""; };
  // Redraw when someone changes their frame or bubble.
  let looks = "";
  const looksKey = () => [...new Set(msgs.map((m) => m.uid))].map((u) => { const q = getPlayers()[u] || {}; return u + (q.frame || "") + (q.bubble || ""); }).join();
  const lastId = () => (msgs.length ? msgs[msgs.length - 1].id : 0);
  const time = (at) => { const d = new Date(at); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function markSeen() { seen = lastId(); try { localStorage.setItem("chatSeen", String(seen)); } catch { /* ignore */ } }

  /* ---------- mentions ---------- */
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const myName = () => (getPlayers()[getMe()] || {}).name || "";
  const mentionsMe = (m) => m.uid !== getMe() && myName() && m.text.includes("@" + myName());
  /** Escape the text and wrap @名前 (only real player names) in a highlight. */
  function richText(text) {
    const names = [...new Set(Object.values(getPlayers()).map((p) => p.name).filter(Boolean))].sort((a, b) => b.length - a.length);
    const safe = esc(text);
    if (!names.length || !text.includes("@")) return safe;
    const re = new RegExp("@(" + names.map((n) => reEsc(esc(n))).join("|") + ")", "g");
    return safe.replace(re, (all, n) => `<span class="mention ${n === esc(myName()) ? "me" : ""}">${all}</span>`);
  }
  let sug = [], sugAt = -1, sugIdx = 0;
  function updateSug() {
    const inp = $("cin"), pos = inp.selectionStart ?? inp.value.length, before = inp.value.slice(0, pos);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) { sug = []; drawSug(); return; }
    const q = m[1].toLowerCase(); sugAt = pos - m[0].length;
    const all = Object.entries(getPlayers()).filter(([u, p]) => u !== getMe() && p.name).map(([, p]) => p);
    const starts = all.filter((p) => p.name.toLowerCase().startsWith(q)), has = all.filter((p) => !p.name.toLowerCase().startsWith(q) && p.name.toLowerCase().includes(q));
    sug = [...starts, ...has].slice(0, 6); sugIdx = 0;
    drawSug();
  }
  function drawSug() {
    const el = $("csug");
    el.hidden = !sug.length;
    el.innerHTML = sug.map((p, i) => `<button type="button" class="sg ${i === sugIdx ? "on" : ""}" data-i="${i}" role="option" aria-selected="${i === sugIdx}">${avatar(p, esc)}<span>${esc(p.name)}</span></button>`).join("");
  }
  function pickSug(i) {
    const p = sug[i]; if (!p) return;
    const inp = $("cin"), pos = inp.selectionStart ?? inp.value.length;
    const ins = "@" + p.name + " ";
    inp.value = (inp.value.slice(0, sugAt) + ins + inp.value.slice(pos)).slice(0, MAX);
    const c = Math.min(sugAt + ins.length, inp.value.length);
    inp.setSelectionRange(c, c); inp.focus();
    sug = []; drawSug();
  }
  let beepCtx = null;
  function ping() {
    try {
      beepCtx = beepCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = beepCtx.createOscillator(), g = beepCtx.createGain(), t = beepCtx.currentTime;
      o.type = "sine"; o.frequency.setValueAtTime(1046, t); o.frequency.setValueAtTime(1568, t + 0.09);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.15, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      o.connect(g).connect(beepCtx.destination); o.start(t); o.stop(t + 0.3);
    } catch { /* optional */ }
  }

  function drawLog() {
    const log = $("clog"), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = msgs.length ? msgs.map((m) => `<div class="cm ${m.uid === getMe() ? "me" : ""} ${mentionsMe(m) ? "atme" : ""}">${avatar(m, esc, getPlayers()[m.uid]?.frame)}<div class="cb"><div class="cn"><b>${esc(m.name)}</b><time>${time(m.at)}</time></div><div class="ct${bb(m.uid)}">${richText(m.text)}</div></div></div>`).join("")
      : `<div class="empty">まだ誰もしゃべってないよ</div>`;
    if (atBottom || log.dataset.first !== "1") { log.scrollTop = log.scrollHeight; log.dataset.first = "1"; }
  }
  function drawTicker() {
    clearTimeout(tickT);
    const now = Date.now(), recent = live && !open ? msgs.filter((m) => m.id > seen && now - m.at < 12000).slice(-3) : [];
    ticker.innerHTML = recent.map((m) => `<div class="tk ${mentionsMe(m) ? "atme" : ""}"><b style="color:${esc(m.color)}">${esc(m.name)}</b> ${richText(m.text)}</div>`).join("");
    if (recent.length) tickT = setTimeout(drawTicker, 2000);
  }
  function setOpen(v) { open = v; try { localStorage.setItem("chatOpen", v ? "1" : "0"); } catch { /* ignore */ } }
  function draw() {
    btn.hidden = !live;
    panel.hidden = !(live && open);
    btn.classList.toggle("on", open); btn.setAttribute("aria-pressed", String(open));
    if (open && live) markSeen();
    const unread = msgs.filter((m) => m.id > seen && m.uid !== getMe()).length;
    const atMe = msgs.some((m) => m.id > seen && mentionsMe(m));
    $("cbadge").hidden = !unread; $("cbadge").textContent = atMe ? "@" : unread > 99 ? "99+" : String(unread);
    $("cbadge").classList.toggle("at", atMe);
    $("csend").disabled = busy;
    drawTicker();
  }

  async function send() {
    const inp = $("cin"), text = inp.value.trim();
    if (!text || busy) return;
    busy = true; draw();
    try { await call("chat", { text }); inp.value = ""; }
    catch (e) { const err = document.createElement("div"); err.className = "cerr"; err.textContent = errMsg(e); $("clog").appendChild(err); $("clog").scrollTop = $("clog").scrollHeight; }
    busy = false; draw(); inp.focus();
  }

  btn.addEventListener("click", () => { setOpen(!open); draw(); if (open) { $("clog").dataset.first = ""; drawLog(); if (wide()) setTimeout(() => $("cin").focus(), 0); } });
  $("chatx").addEventListener("click", () => { setOpen(false); draw(); });
  $("csend").addEventListener("click", send);
  // Enter sends, but not while a Japanese IME is still converting.
  $("cin").addEventListener("keydown", (e) => {
    const composing = e.isComposing || e.keyCode === 229;
    if (sug.length && !composing) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sugIdx = (sugIdx + (e.key === "ArrowDown" ? 1 : sug.length - 1)) % sug.length; drawSug(); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pickSug(sugIdx); return; }
      if (e.key === "Escape") { sug = []; drawSug(); return; }
    }
    if (e.key === "Enter" && !composing) { e.preventDefault(); send(); }
  });
  for (const ev of ["input", "click", "keyup", "compositionend"]) $("cin").addEventListener(ev, (e) => { if (ev === "keyup" && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return; updateSug(); });
  $("cin").addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== $("cin")) { sug = []; drawSug(); } }, 150));
  // pointerdown so the input keeps focus (and the phone keyboard stays up)
  $("csug").addEventListener("pointerdown", (e) => { const b = e.target.closest(".sg"); if (b) { e.preventDefault(); pickSug(+b.dataset.i); } });

  return {
    set(list) {
      const prev = lastId();
      msgs = Array.isArray(list) ? list : [];
      if (prev && msgs.some((m) => m.id > prev && mentionsMe(m))) ping(); // someone called my name
      if (open) drawLog(); draw();
    },
    live(on) {
      if (live !== on) { live = on; draw(); if (on && open) { $("clog").dataset.first = ""; drawLog(); } }
      else if (open && live) { const k = looksKey(); if (k !== looks) { looks = k; drawLog(); } }
    },
  };
}
