// Crash: a multiplier climbs from 1.00x and blows up at a random point. Get off (cash out) before it does.
// The bust point is drawn when the round starts and stays on the server until it happens.
import { randomInt } from "./game.js";

export const CR = {
  BET_MS: 10000,
  HOLD_MS: 4000,
  IDLE_LIMIT: 2,
  RATE: 0.07,           // multiplier = e^(RATE * seconds): 2x at ~10s, 10x at ~33s
  EDGE: 0.04,           // 4% of rounds bust at 1.00x; on average 96% comes back
  MAX_AT: 1000,         // the flight never goes past 1000x
  MIN_BET: 100,
  MAX_BET: 100_000_000_000_000,
};

/** Bust point with P(bust >= x) = (1 - EDGE) / x. */
export function drawBust() {
  const u = (randomInt(0x40000000) + 0.5) / 0x40000000;
  const x = Math.floor(((1 - CR.EDGE) / u) * 100) / 100;
  return Math.min(CR.MAX_AT, Math.max(1, x));
}
export const multAt = (ms) => Math.floor(Math.exp(CR.RATE * Math.max(0, ms) / 1000) * 100) / 100;
export const msFor = (x) => Math.ceil((Math.log(x) / CR.RATE) * 1000);
