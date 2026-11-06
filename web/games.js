// "ゲーム" switcher shared by every page: one folded button in the top bar that opens a panel of game cards.
const ART = {
  bac: `<svg viewBox="0 0 160 96" aria-hidden="true"><defs><radialGradient id="gbf" cx="50%" cy="35%" r="80%"><stop offset="0" stop-color="#b3262d"/><stop offset=".6" stop-color="#7d161c"/><stop offset="1" stop-color="#4a0b10"/></radialGradient></defs>
    <rect width="160" height="96" fill="url(#gbf)"/><path d="M8 70 Q80 52 152 70" fill="none" stroke="#d9b56b" stroke-opacity=".5"/>
    <text x="80" y="24" text-anchor="middle" font-family="Cinzel,serif" font-size="11" fill="#d9b56b" letter-spacing="2">PLAYER | BANKER</text>
    <g transform="translate(46 34) rotate(-10)"><rect width="30" height="42" rx="4" fill="#faf7f0"/><text x="5" y="13" font-size="11" font-weight="800" fill="#c9202b">9</text><text x="15" y="30" font-size="15" text-anchor="middle" fill="#c9202b">♥</text></g>
    <g transform="translate(84 31) rotate(8)"><rect width="30" height="42" rx="4" fill="#faf7f0"/><text x="5" y="13" font-size="11" font-weight="800" fill="#1d2127">8</text><text x="15" y="30" font-size="15" text-anchor="middle" fill="#1d2127">♠</text></g>
    <circle cx="30" cy="80" r="8" fill="#2565d4" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"/><circle cx="130" cy="80" r="8" fill="#cc2a33" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"/></svg>`,
  bj: `<svg viewBox="0 0 160 96" aria-hidden="true"><defs><radialGradient id="gjf" cx="50%" cy="30%" r="85%"><stop offset="0" stop-color="#22865f"/><stop offset=".6" stop-color="#145a43"/><stop offset="1" stop-color="#0a3427"/></radialGradient></defs>
    <rect width="160" height="96" fill="url(#gjf)"/><path d="M6 20 Q80 44 154 20" fill="none" stroke="#d9b56b" stroke-opacity=".45"/>
    <g transform="translate(50 30) rotate(-12)"><rect width="32" height="45" rx="4" fill="#faf7f0"/><text x="5" y="13" font-size="12" font-weight="800" fill="#1d2127">A</text><text x="16" y="33" font-size="18" text-anchor="middle" fill="#1d2127">♠</text></g>
    <g transform="translate(74 27) rotate(6)"><rect width="32" height="45" rx="4" fill="#faf7f0"/><text x="5" y="13" font-size="12" font-weight="800" fill="#c9202b">K</text><text x="16" y="33" font-size="18" text-anchor="middle" fill="#c9202b">♥</text></g>
    <g transform="translate(124 66)"><circle r="15" fill="#d9a632"/><circle r="15" fill="none" stroke="#fff" stroke-width="2" stroke-dasharray="4 3.85"/><circle r="10" fill="#f3d27a"/><text y="4.5" text-anchor="middle" font-size="12" font-weight="900" fill="#3a2500">21</text></g></svg>`,
  fx: `<svg viewBox="0 0 160 96" aria-hidden="true"><defs><linearGradient id="gxa" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d36b" stop-opacity=".35"/><stop offset="1" stop-color="#22d36b" stop-opacity="0"/></linearGradient></defs>
    <rect width="160" height="96" fill="#0c141d"/><g stroke="#ffffff" stroke-opacity=".06"><line x1="0" x2="160" y1="24" y2="24"/><line x1="0" x2="160" y1="48" y2="48"/><line x1="0" x2="160" y1="72" y2="72"/></g>
    <path d="M8 74 L28 66 L44 70 L62 54 L78 58 L96 40 L112 46 L130 26 L152 18 L152 96 L8 96Z" fill="url(#gxa)"/>
    <path d="M8 74 L28 66 L44 70 L62 54 L78 58 L96 40 L112 46 L130 26 L152 18" fill="none" stroke="#22d36b" stroke-width="2.2" stroke-linejoin="round"/>
    <g><line x1="30" x2="30" y1="40" y2="62" stroke="#ff5c6c"/><rect x="26" y="44" width="8" height="12" fill="#ff5c6c"/><line x1="48" x2="48" y1="30" y2="54" stroke="#22d36b"/><rect x="44" y="36" width="8" height="12" fill="#22d36b"/><line x1="66" x2="66" y1="22" y2="40" stroke="#22d36b"/><rect x="62" y="26" width="8" height="10" fill="#22d36b"/></g>
    <circle cx="152" cy="18" r="3.5" fill="#22d36b"/><text x="10" y="16" font-size="10" font-weight="800" fill="#d9b56b" font-family="Cinzel,serif">KURI/JPY</text></svg>`,
};
const GAMES = [
  { id: "bac", href: "./", name: "バカラ", sub: "みんなで1テーブル・15秒で配る" },
  { id: "bj", href: "blackjack.html", name: "ブラックジャック", sub: "最大6人・ディーラーと勝負" },
  { id: "fx", href: "fx.html", name: "FX", sub: "KURI/JPY・レバレッジ最大100倍" },
];

export function setupGames(current) {
  const icons = document.querySelector(".icons");
  const btn = document.createElement("button");
  btn.className = "ib gamesbtn"; btn.id = "gamesbtn";
  btn.setAttribute("aria-haspopup", "true"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "gamesp");
  btn.innerHTML = `ゲーム<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
  const live = document.getElementById("live");
  icons.insertBefore(btn, live ? live.nextSibling : icons.firstChild);

  const panel = document.createElement("nav");
  panel.className = "gamesp"; panel.id = "gamesp"; panel.hidden = true; panel.setAttribute("aria-label", "ゲームをえらぶ");
  panel.innerHTML = `<div class="gph">ゲームをえらぶ</div>` + GAMES.map((g) => g.id === current
    ? `<div class="gcard cur" aria-current="page"><div class="gart">${ART[g.id]}</div><div class="gtx"><b>${g.name}</b><span>${g.sub}</span></div><em>いまここ</em></div>`
    : `<a class="gcard" href="${g.href}"><div class="gart">${ART[g.id]}</div><div class="gtx"><b>${g.name}</b><span>${g.sub}</span></div></a>`).join("");
  document.body.appendChild(panel);

  function place() {
    const r = btn.getBoundingClientRect(), w = Math.min(340, innerWidth - 24);
    panel.style.width = w + "px";
    panel.style.top = r.bottom + 8 + "px";
    panel.style.left = Math.max(12, Math.min(r.right - w, innerWidth - w - 12)) + "px";
  }
  function show(on) {
    panel.hidden = !on; btn.setAttribute("aria-expanded", String(on)); btn.classList.toggle("on", on);
    if (on) place();
  }
  btn.addEventListener("click", (e) => { e.stopPropagation(); show(panel.hidden); });
  document.addEventListener("click", (e) => { if (!panel.hidden && !panel.contains(e.target)) show(false); });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !panel.hidden) { show(false); btn.focus(); } });
  addEventListener("resize", () => { if (!panel.hidden) place(); });
  addEventListener("scroll", () => { if (!panel.hidden) place(); }, { passive: true });
}
