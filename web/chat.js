// One chat room for everyone, shared by the baccarat and blackjack pages.
// Builds its own button and panel; the page feeds it messages and tells it when the player is signed in.
export function setupChat({ call, errMsg, esc, getMe }) {
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
    <div class="cform"><input id="cin" maxlength="${MAX}" placeholder="メッセージ" autocomplete="off" enterkeyhint="send"><button class="go" id="csend">送信</button></div>`;
  const stage = $("stage");
  stage.appendChild(panel);
  // While the chat is closed, new messages pop up briefly in the same corner.
  const ticker = document.createElement("div");
  ticker.className = "cticker"; ticker.setAttribute("aria-hidden", "true");
  stage.appendChild(ticker);

  const lastId = () => (msgs.length ? msgs[msgs.length - 1].id : 0);
  const time = (at) => { const d = new Date(at); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function markSeen() { seen = lastId(); try { localStorage.setItem("chatSeen", String(seen)); } catch { /* ignore */ } }

  function drawLog() {
    const log = $("clog"), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = msgs.length ? msgs.map((m) => `<div class="cm ${m.uid === getMe() ? "me" : ""}"><span class="dot" style="background:${esc(m.color)}">${esc((m.name || "?")[0])}</span><div class="cb"><div class="cn"><b>${esc(m.name)}</b><time>${time(m.at)}</time></div><div class="ct">${esc(m.text)}</div></div></div>`).join("")
      : `<div class="empty">まだ誰もしゃべってないよ</div>`;
    if (atBottom || log.dataset.first !== "1") { log.scrollTop = log.scrollHeight; log.dataset.first = "1"; }
  }
  function drawTicker() {
    clearTimeout(tickT);
    const now = Date.now(), recent = live && !open ? msgs.filter((m) => m.id > seen && now - m.at < 12000).slice(-3) : [];
    ticker.innerHTML = recent.map((m) => `<div class="tk"><b style="color:${esc(m.color)}">${esc(m.name)}</b> ${esc(m.text)}</div>`).join("");
    if (recent.length) tickT = setTimeout(drawTicker, 2000);
  }
  function setOpen(v) { open = v; try { localStorage.setItem("chatOpen", v ? "1" : "0"); } catch { /* ignore */ } }
  function draw() {
    btn.hidden = !live;
    panel.hidden = !(live && open);
    btn.classList.toggle("on", open); btn.setAttribute("aria-pressed", String(open));
    if (open && live) markSeen();
    const unread = msgs.filter((m) => m.id > seen && m.uid !== getMe()).length;
    $("cbadge").hidden = !unread; $("cbadge").textContent = unread > 99 ? "99+" : String(unread);
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
  $("cin").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } });

  return {
    set(list) { msgs = Array.isArray(list) ? list : []; if (open) drawLog(); draw(); },
    live(on) { if (live !== on) { live = on; draw(); if (on && open) { $("clog").dataset.first = ""; drawLog(); } } },
  };
}
