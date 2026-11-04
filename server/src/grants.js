// One-off chip grants from the table owner. Each one runs once (its id is remembered in meta.grants) when the
// server starts up after a deploy. The player is found by their exact nickname; if no single player matches,
// nothing happens and /grants shows why.
// asDebt: true means it is booked like a normal "借りる": chips go up and so does their debt.
export const GRANTS = [
  { id: "2026-11-04-taktak7633-10B", name: "taktak7633", amount: 10_000_000_000, asDebt: true },
];
