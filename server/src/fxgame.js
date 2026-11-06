// Fake FX market ("KURI/JPY"). The server makes up the price one tick at a time with crypto randomness, so nobody
// can see the future. Prices only move while someone has the FX page open; otherwise the market just waits.
import { randomInt } from "./game.js";

export const FX = {
  START: 150,          // price the market starts at and drifts back toward
  TICK_MS: 1000,
  SPREAD: 0.006,       // ask - bid, in yen
  SIGMA: 0.00035,      // typical move per tick (log return) ≈ 0.035%
  JUMP_P: 0.004,       // chance per tick of a "news" jump
  JUMP_SIGMA: 0.0015,  // typical jump ≈ 0.15%
  PULL: 0.0004,        // gentle pull back toward START so it never runs away forever
  LEVS: [1, 5, 10, 25, 50, 100],
  MAX_POS: 5,
  MIN_MARGIN: 100,
  MAX_MARGIN: 100_000_000_000_000,
  KEEP_TICKS: 300,     // 5 minutes of 1-second ticks
  KEEP_CANDLES: 180,   // 3 hours of 1-minute candles
  STALE_MS: 5000,      // no new orders if the price hasn't moved for this long
};

const u01 = () => (randomInt(0x40000000) + 0.5) / 0x40000000;
const gauss = () => Math.sqrt(-2 * Math.log(u01())) * Math.cos(2 * Math.PI * u01());
const r3 = (x) => Math.round(x * 1000) / 1000;

export const freshFx = () => ({ price: FX.START, lastAt: 0, ticks: [], candles: [] });

export function nextPrice(p) {
  let r = FX.SIGMA * gauss() - FX.PULL * Math.log(p / FX.START);
  if (randomInt(1_000_000) < FX.JUMP_P * 1_000_000) r += FX.JUMP_SIGMA * gauss();
  return Math.max(1, r3(p * Math.exp(r)));
}

export const ask = (p) => r3(p + FX.SPREAD / 2);
export const bid = (p) => r3(p - FX.SPREAD / 2);

/** Profit of a position if closed at mid price p. Never below -margin (that's a full stop-out). */
export function pnl(pos, p) {
  const exit = pos.side > 0 ? bid(p) : ask(p);
  const raw = Math.floor(pos.margin * pos.lev * pos.side * (exit / pos.entry - 1));
  return Math.max(raw, -pos.margin);
}

/** Add one tick to the market history (ticks and 1-minute candles). */
export function record(fx, t, p) {
  fx.price = p; fx.lastAt = t;
  fx.ticks.push([t, p]);
  if (fx.ticks.length > FX.KEEP_TICKS) fx.ticks.splice(0, fx.ticks.length - FX.KEEP_TICKS);
  const m = Math.floor(t / 60000) * 60000, c = fx.candles[fx.candles.length - 1];
  if (c && c[0] === m) { c[2] = Math.max(c[2], p); c[3] = Math.min(c[3], p); c[4] = p; }
  else fx.candles.push([m, c ? c[4] : p, Math.max(p, c ? c[4] : p), Math.min(p, c ? c[4] : p), p]);
  if (fx.candles.length > FX.KEEP_CANDLES) fx.candles.splice(0, fx.candles.length - FX.KEEP_CANDLES);
}
