// Blackjack rules (ported from functions/bjgame.js).
import { randomInt } from "./game.js";

const BJ = {
  DECKS: 6,
  RESHUFFLE_BELOW: 78,     // cards left in the shoe (about 75% penetration of 312)
  MAX_HANDS: 6,
  MIN_BET: 100,
  MAX_BET: 10_000_000,
  BET_MS: 15000,
  TURN_MS: 15000,
  CARD_MS: 600,            // client animation per card dealt
  ACT_GRACE_MS: 1000,      // late taps accepted this long after a turn expires
  HOLD_MS: 5000,           // result stays on screen
};
const RK = "A23456789TJQK";

function newShoe(decks = BJ.DECKS) {
  const a = [];
  for (let d = 0; d < decks; d++) for (const s of "SHDC") for (const r of RK) a.push(r + s);
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a.join("");
}
const rankValue = (c) => { const i = RK.indexOf(c[0]); return i === 0 ? 1 : i >= 9 ? 10 : i + 1; };

/** Best total and whether an ace is still counted as 11. */
function total(cards) {
  let t = 0, aces = 0;
  for (const c of cards) { const v = rankValue(c); t += v; if (v === 1) aces++; }
  let soft = false;
  if (aces && t + 10 <= 21) { t += 10; soft = true; }
  return { total: t, soft };
}
const isBlackjack = (cards) => cards.length === 2 && total(cards).total === 21;

/** Dealer draws to 17 and stands on all 17s, soft 17 included. */
function dealerDraws(cards, draw) {
  const out = [...cards];
  while (total(out).total < 17) out.push(draw());
  return out;
}

/** Amount returned to the player (stake included). */
function settle(hand, dealerCards) {
  const p = total(hand.cards).total, d = total(dealerCards).total;
  const pBJ = hand.status === "bj", dBJ = isBlackjack(dealerCards);
  if (hand.status === "bust") return { ret: 0, out: "lose" };
  if (pBJ && dBJ) return { ret: hand.bet, out: "push" };
  if (pBJ) return { ret: hand.bet + Math.floor(hand.bet * 1.5), out: "bj" };
  if (dBJ) return { ret: 0, out: "lose" };
  if (d > 21 || p > d) return { ret: hand.bet * 2, out: "win" };
  if (p === d) return { ret: hand.bet, out: "push" };
  return { ret: 0, out: "lose" };
}

function cleanBet(v) {
  if (!Number.isSafeInteger(v) || v < 0 || v > BJ.MAX_BET) throw "invalid-amount";
  if (v !== 0 && v < BJ.MIN_BET) throw "too-small";
  return v;
}

export { BJ, newShoe, rankValue, total, isBlackjack, dealerDraws, settle, cleanBet };
