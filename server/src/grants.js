// One-off chip grants from the table owner. Each one runs once (its id is remembered in meta.grants) when the
// server starts up after a deploy. The player is found by their exact nickname; if no single player matches,
// nothing happens and /grants shows why.
// asDebt: true means it is booked like a normal "借りる": chips go up and so does their debt.
// setChips: N instead of amount sets the balance to exactly N (debt stays as it is).
// setNet: N makes the ranking 収支 exactly N. note: "..." shows a line under the name in the ranking ("" removes it).
export const GRANTS = [
  { id: "2026-11-04-taktak7633-10B", name: "taktak7633", amount: 10_000_000_000, asDebt: true },
  { id: "2026-11-06-sousisan-10B", name: "総資産100億↑の漢🤩", amount: 100_000_000_000, asDebt: true },
  { id: "2026-11-07-sousisan-100B", name: "総資産100億↑の漢🤩", amount: 100_000_000_000, asDebt: true },
  { id: "2026-11-07-taktak7633-set", name: "taktak7633", setChips: 1_919_114_514_810 },
  { id: "2026-11-07-kitamura-50B", name: "北村康介", amount: 50_000_000_000, asDebt: true },
  { id: "2026-11-07-taktak7633-pc", name: "taktak7633", setNet: -10_000_000_000, note: "金なさすぎて売ったパソコン" },
  { id: "2026-11-07-kitamura-99.9B", name: "北村康介", amount: 99_900_000_000, asDebt: true },
  { id: "2026-11-10-kitamura-1T", name: "北村康介", amount: 1_000_000_000_000, asDebt: true },
];
