// WebSocket link to the Cloudflare server. Signs in with the Firebase ID token, keeps the clock offset,
// reconnects on its own, and turns request/reply pairs into promises.
import { SERVER_URL } from "./server-config.js";

export function connect({ getToken, onReady, onBatch, onStatus }) {
  let ws = null, seq = 0, offset = 0, closed = false, backoff = 600, pingT = null, authed = false;
  const pend = new Map();

  function open() {
    if (closed) return;
    authed = false;
    try { ws = new WebSocket(SERVER_URL); } catch { retry(); return; }
    ws.onopen = async () => {
      try {
        const token = await getToken();
        const r = await request("auth", { token }, true);
        authed = true; backoff = 600;
        onStatus && onStatus(true);
        onReady(r.state, r.uid);
      } catch (e) {
        onStatus && onStatus(false, e && e.message);
        try { ws.close(); } catch { /* ignore */ }
      }
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if ("re" in m) {
        const p = pend.get(m.re);
        if (!p) { if (!m.ok && m.error && m.re === null) onBatch && onBatch([{ type: "notice", text: m.error }]); return; }
        pend.delete(m.re); clearTimeout(p.timer);
        const t1 = Date.now();
        if (m.now) offset = m.now - (p.t0 + t1) / 2;
        if (m.ok) p.res(m.data); else p.rej(new Error(m.error || "うまくいかなかった。もう一度試してね"));
        return;
      }
      if (m.type === "batch") onBatch(m.msgs || []);
    };
    ws.onclose = () => {
      authed = false;
      for (const [, p] of pend) { clearTimeout(p.timer); p.rej(new Error("接続が切れた。もう一度試してね")); }
      pend.clear();
      onStatus && onStatus(false);
      retry();
    };
    ws.onerror = () => {};
  }
  function retry() {
    if (closed) return;
    setTimeout(open, backoff);
    backoff = Math.min(backoff * 2, 15000);
  }
  function request(type, data, beforeAuth) {
    return new Promise((res, rej) => {
      if (!ws || ws.readyState !== 1 || (!authed && !beforeAuth)) { rej(new Error("接続中…少し待ってからもう一度試してね")); return; }
      const id = ++seq;
      const timer = setTimeout(() => { pend.delete(id); rej(new Error("サーバーから返事がない。もう一度試してね")); }, 12000);
      pend.set(id, { res, rej, timer, t0: Date.now() });
      ws.send(JSON.stringify({ ...data, id, type }));
    });
  }
  pingT = setInterval(() => { if (authed) request("ping", {}).catch(() => {}); }, 45000);
  open();
  return {
    call: (type, data) => request(type, data || {}),
    offset: () => offset,
    online: () => authed,
    close() { closed = true; clearInterval(pingT); try { ws && ws.close(); } catch { /* ignore */ } },
  };
}
