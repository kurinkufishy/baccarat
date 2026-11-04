// The little round avatar with the first letter of a name, plus its frame if the player wears one.
const SAFE = /^[a-z]{1,16}$/;
export function avatar(p, esc, frame = p && p.frame, cls = "") {
  const fr = frame && SAFE.test(frame) ? ` fr fr-${frame}` : "";
  return `<span class="dot${fr}${cls ? " " + cls : ""}" style="--c:${esc((p && p.color) || "#888")}">${esc(((p && p.name) || "?")[0])}</span>`;
}
