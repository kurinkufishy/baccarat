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
const ART_KEIBA = `<svg viewBox="0 0 160 96" aria-hidden="true"><defs><linearGradient id="gks" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7cc8ff"/><stop offset="1" stop-color="#d8f0ff"/></linearGradient></defs><rect width="160" height="96" fill="url(#gks)"/><rect y="34" width="160" height="62" fill="#2f8f3f"/><g fill="#38a24a"><rect x="0" y="34" width="10" height="62"/><rect x="20" y="34" width="10" height="62"/><rect x="40" y="34" width="10" height="62"/><rect x="60" y="34" width="10" height="62"/><rect x="80" y="34" width="10" height="62"/><rect x="100" y="34" width="10" height="62"/><rect x="120" y="34" width="10" height="62"/><rect x="140" y="34" width="10" height="62"/></g><rect y="32" width="160" height="3" fill="#fff"/><g fill="#fff"><rect x="6" y="26" width="2" height="8"/><rect x="28" y="26" width="2" height="8"/><rect x="50" y="26" width="2" height="8"/><rect x="72" y="26" width="2" height="8"/><rect x="94" y="26" width="2" height="8"/><rect x="116" y="26" width="2" height="8"/><rect x="138" y="26" width="2" height="8"/></g><rect x="138" y="20" width="3" height="76" fill="#fff"/><rect x="132" y="16" width="15" height="6" rx="1" fill="#d7263d"/><g transform="translate(14 40) scale(1.05)"><path d="M17 27 l-3 13M22 27 l2 13M34 27 l5 12M39 26 l-4 13" stroke="#5a3a24" stroke-width="3" stroke-linecap="round"/><path d="M6 22 q-5 4 -4 11 q4 -5 7 -7z" fill="#5a3a24"/><ellipse cx="26" cy="23" rx="17" ry="8" fill="#5a3a24"/><path d="M38 19 q6 -9 12 -11 l3 2 q-5 3 -8 12z" fill="#5a3a24"/><path d="M48 8 q7 -2 11 2 q1 3 -2 4 l-9 -1z" fill="#5a3a24"/><rect x="20" y="17" width="12" height="9" rx="2" fill="#fff"/><text x="26" y="24.5" text-anchor="middle" font-size="8" font-weight="900" fill="#111">4</text><path d="M27 16 q-1 -6 4 -9 l5 3 q-2 4 -3 7z" fill="#2a62d6"/><circle cx="35" cy="5" r="3.2" fill="#2a62d6"/></g><g transform="translate(58 50) scale(1.1)"><path d="M17 27 l-3 13M22 27 l2 13M34 27 l5 12M39 26 l-4 13" stroke="#7b4a2a" stroke-width="3" stroke-linecap="round"/><path d="M6 22 q-5 4 -4 11 q4 -5 7 -7z" fill="#7b4a2a"/><ellipse cx="26" cy="23" rx="17" ry="8" fill="#7b4a2a"/><path d="M38 19 q6 -9 12 -11 l3 2 q-5 3 -8 12z" fill="#7b4a2a"/><path d="M48 8 q7 -2 11 2 q1 3 -2 4 l-9 -1z" fill="#7b4a2a"/><rect x="20" y="17" width="12" height="9" rx="2" fill="#fff"/><text x="26" y="24.5" text-anchor="middle" font-size="8" font-weight="900" fill="#111">3</text><path d="M27 16 q-1 -6 4 -9 l5 3 q-2 4 -3 7z" fill="#d7263d"/><circle cx="35" cy="5" r="3.2" fill="#d7263d"/></g></svg>`;
ART.keiba = ART_KEIBA;
ART.sports = `<svg viewBox="0 0 160 96" aria-hidden="true"><rect width="160" height="96" fill="#2f8f3f"/><g fill="#38a24a"><rect x="0" width="20" height="96"/><rect x="40" width="20" height="96"/><rect x="80" width="20" height="96"/><rect x="120" width="20" height="96"/></g><g fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2"><rect x="6" y="6" width="148" height="84"/><line x1="80" y1="6" x2="80" y2="90"/><circle cx="80" cy="48" r="14"/><rect x="6" y="28" width="22" height="40"/><rect x="132" y="28" width="22" height="40"/></g><circle cx="58" cy="38" r="5" fill="#1f6fe0" stroke="#fff" stroke-width="1.5"/><circle cx="104" cy="58" r="5" fill="#d7263d" stroke="#1d1d1f" stroke-width="1.5"/><circle cx="118" cy="44" r="5" fill="#d7263d" stroke="#1d1d1f" stroke-width="1.5"/><circle cx="132" cy="46" r="4.5" fill="#fff" stroke="#999"/><rect x="44" y="70" width="72" height="18" rx="5" fill="rgba(0,0,0,.7)"/><text x="80" y="83" text-anchor="middle" font-size="12" font-weight="900" fill="#fff">2 - 1</text></svg>`;
ART.poker = `<svg viewBox="0 0 160 96" aria-hidden="true"><rect width="160" height="96" fill="#1a110c"/><ellipse cx="80" cy="52" rx="70" ry="36" fill="#5a3420"/><ellipse cx="80" cy="52" rx="62" ry="29" fill="#16794a"/><g transform="translate(46 38)"><rect width="18" height="25" rx="2.5" fill="#fbfbf8"/><text x="9" y="11" text-anchor="middle" font-size="9" font-weight="900" fill="#1d2127">A</text><text x="9" y="21" text-anchor="middle" font-size="9" fill="#1d2127">♠</text></g><g transform="translate(66 38)"><rect width="18" height="25" rx="2.5" fill="#fbfbf8"/><text x="9" y="11" text-anchor="middle" font-size="9" font-weight="900" fill="#c9202b">K</text><text x="9" y="21" text-anchor="middle" font-size="9" fill="#c9202b">♥</text></g><g transform="translate(86 38)"><rect width="18" height="25" rx="2.5" fill="#fbfbf8"/><text x="9" y="11" text-anchor="middle" font-size="9" font-weight="900" fill="#c9202b">Q</text><text x="9" y="21" text-anchor="middle" font-size="9" fill="#c9202b">♦</text></g><g transform="translate(118 62)"><circle r="8" fill="#c98a12"/><circle r="8" fill="none" stroke="#fff" stroke-width="1.6" stroke-dasharray="3 2.3"/></g><g transform="translate(36 66)"><circle r="7" fill="#2a62d6"/><circle r="7" fill="none" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2.2"/></g><text x="80" y="16" text-anchor="middle" font-size="10" font-weight="800" fill="#d9b56b" font-family="Cinzel,serif" letter-spacing="2">HOLD'EM</text></svg>`;
ART.crash = `<svg viewBox="0 0 160 96" aria-hidden="true"><rect width="160" height="96" fill="#0e1424"/><g stroke="#fff" stroke-opacity=".06"><line x1="0" x2="160" y1="30" y2="30"/><line x1="0" x2="160" y1="60" y2="60"/></g><path d="M12 84 Q70 82 100 60 T148 14 L148 96 L12 96Z" fill="rgba(34,211,107,.18)"/><path d="M12 84 Q70 82 100 60 T148 14" fill="none" stroke="#22d36b" stroke-width="3"/><text x="140" y="22" font-size="18" text-anchor="middle">🚀</text><text x="44" y="46" font-size="22" font-weight="900" fill="#22d36b">4.27x</text></svg>`;
ART.chinchiro = `<svg viewBox="0 0 160 96" aria-hidden="true"><rect width="160" height="96" fill="#2a0d08"/><circle cx="80" cy="50" r="38" fill="#1c3466"/><circle cx="80" cy="50" r="31" fill="#f5f2ea"/><g transform="translate(57 40)"><rect width="16" height="16" rx="3" fill="#fff" stroke="#ddd"/><circle cx="8" cy="8" r="3.4" fill="#d4202f"/></g><g transform="translate(76 46) rotate(12)"><rect width="16" height="16" rx="3" fill="#fff" stroke="#ddd"/><circle cx="8" cy="8" r="3.4" fill="#d4202f"/></g><g transform="translate(92 36) rotate(-10)"><rect width="16" height="16" rx="3" fill="#fff" stroke="#ddd"/><circle cx="8" cy="8" r="3.4" fill="#d4202f"/></g><text x="80" y="90" text-anchor="middle" font-size="10" font-weight="900" fill="#ffd76a">ピンゾロ！</text></svg>`;
ART.duel = `<svg viewBox="0 0 160 96" aria-hidden="true"><rect width="160" height="96" fill="#1a0a28"/><circle cx="40" cy="48" r="16" fill="#1f6fe0"/><text x="40" y="54" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">A</text><circle cx="120" cy="48" r="16" fill="#d7263d"/><text x="120" y="54" text-anchor="middle" font-size="16" font-weight="900" fill="#fff">B</text><circle cx="80" cy="44" r="15" fill="#d4a017"/><circle cx="80" cy="44" r="11" fill="#f3d27a"/><text x="80" y="49" text-anchor="middle" font-size="12" font-weight="900" fill="#3a2500">表</text><text x="80" y="82" text-anchor="middle" font-size="12" font-weight="900" fill="#ffd76a" letter-spacing="2">VS</text></svg>`;
const GAMES = [
  { id: "bac", href: "./", name: "バカラ", sub: "みんなで1テーブル・15秒で配る" },
  { id: "bj", href: "blackjack.html", name: "ブラックジャック", sub: "最大6人・ディーラーと勝負" },
  { id: "keiba", href: "keiba.html", name: "競馬", sub: "8頭立て・単勝/複勝・30秒で締切" },
  { id: "sports", href: "sports.html", name: "スポーツベット", sub: "バーチャルサッカー・勝敗/ゴール数" },
  { id: "poker", href: "poker.html", name: "ポーカー", sub: "友達と対戦・テキサスホールデム・最大6人" },
  { id: "crash", href: "crash.html", name: "クラッシュ", sub: "みんなで乗って爆発前に降りる" },
  { id: "chinchiro", href: "chinchiro.html", name: "チンチロ", sub: "友達と対戦・サイコロで総取り" },
  { id: "duel", href: "duel.html", name: "タイマン", sub: "友達を指名して1対1の一発勝負" },
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
