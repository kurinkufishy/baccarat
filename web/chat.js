// One chat room for everyone, shared by the baccarat and blackjack pages.
// Builds its own button and panel; the page feeds it messages and tells it when the player is signed in.
export function setupChat({ call, errMsg, esc, getMe }) {
  const $ = (id) => document.getElementById(id);
  const MAX = 120;
  let msgs = [], open = false, live = false, busy = false, seen = 0;
  try { seen = +localStorage.getItem("chatSeen") || 0; } catch { /* storage blocked */ }

  const btn = document.createElement("button");
  btn.className = "ib"; btn.id = "chatbtn"; btn.hidden = true; btn.setAttribute("aria-pressed", "false");
  btn.innerHTML = `チャット<span class="cbadge num" id="cbadge" hidden></span>`;
  const icons = document.querySelector(".icons");
  icons.insertBefore(btn, $("rulesbtn") || null);

  const panel = document.createElement("section");
  panel.className = "chatp"; panel.id = "chatp"; panel.hidden = true; panel.setAttribute("aria-label", "チャット");
  panel.innerHTML = `<div class="mhead"><span>チャット <small class="mut">みんなに見える</small></span><button class="x" id="chatx" aria-label="閉じる">×</button></div>
    <div class="clog" id="clog" aria-live="polite"></div>
    <div class="cform"><input id="cin" maxlength="${MAX}" placeholder="メッセージ（${MAX}文字まで）" autocomplete="off" enterkeyhint="send"><button class="go" id="csend">送信</button></div>`;
  document.body.appendChild(panel);

  const lastId = () => (msgs.length ? msgs[msgs.length - 1].id : 0);
  const time = (at) => { const d = new Date(at); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`; };
  function markSeen() { seen = lastId(); try { localStorage.setItem("chatSeen", String(seen)); } catch { /* ignore */ } }

  function drawLog() {
    const log = $("clog"), atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    log.innerHTML = msgs.length ? msgs.map((m) => `<div class="cm ${m.uid === getMe() ? "me" : ""}"><span class="dot" style="background:${esc(m.color)}">${esc((m.name || "?")[0])}</span><div class="cb"><div class="cn"><b>${esc(m.name)}</b><time>${time(m.at)}</time></div><div class="ct">${esc(m.text)}</div></div></div>`).join("")
      : `<div class="empty">まだ誰もしゃべってないよ</div>`;
    if (atBottom || log.dataset.first !== "1") { log.scrollTop = log.scrollHeight; log.dataset.first = "1"; }
  }
  function draw() {
    btn.hidden = !live;
    panel.hidden = !(live && open);
    btn.classList.toggle("on", open); btn.setAttribute("aria-pressed", String(open));
    if (open && live) markSeen();
    const unread = msgs.filter((m) => m.id > seen && m.uid !== getMe()).length;
    $("cbadge").hidden = !unread; $("cbadge").textContent = unread > 99 ? "99+" : String(unread);
    $("csend").disabled = busy;
  }

  async function send() {
    const inp = $("cin"), text = inp.value.trim();
    if (!text || busy) return;
    busy = true; draw();
    try { await call("chat", { text }); inp.value = ""; }
    catch (e) { const err = document.createElement("div"); err.className = "cerr"; err.textContent = errMsg(e); $("clog").appendChild(err); $("clog").scrollTop = $("clog").scrollHeight; }
    busy = false; draw(); inp.focus();
  }

  btn.addEventListener("click", () => { open = !open; draw(); if (open) { $("clog").dataset.first = ""; drawLog(); setTimeout(() => $("cin").focus(), 0); } });
  $("chatx").addEventListener("click", () => { open = false; draw(); });
  $("csend").addEventListener("click", send);
  // Enter sends, but not while a Japanese IME is still converting.
  $("cin").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); send(); } });

  return {
    set(list) { msgs = Array.isArray(list) ? list : []; if (open) drawLog(); draw(); },
    live(on) { if (live !== on) { live = on; if (!on) open = false; draw(); } },
  };
}
