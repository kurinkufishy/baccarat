// One-time migration: read the old Firestore data with the player's own ID token, so the existing security rules
// decide what is readable and nobody can hand the server made-up balances.
export function decodeValue(v) {
  if (!v || typeof v !== "object") return null;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return !!v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return Date.parse(v.timestampValue);
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decodeValue);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
}
export const decodeFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, decodeValue(v)]));

async function listAll(path, projectId, token, fetchImpl) {
  const out = {};
  let pageToken = "";
  for (let i = 0; i < 20; i++) {
    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${path}?pageSize=300${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`;
    const r = await fetchImpl(url, { headers: { Authorization: "Bearer " + token } });
    if (r.status === 403 || r.status === 401) throw new Error("前のサーバーのデータを読めなかった（前のテーブルに参加していたアカウントで試してね）");
    if (!r.ok) throw new Error("前のサーバーに接続できなかった");
    const body = await r.json();
    for (const doc of body.documents || []) out[doc.name.split("/").pop()] = decodeFields(doc.fields);
    if (!body.nextPageToken) break;
    pageToken = body.nextPageToken;
  }
  return out;
}

/** Returns {players, held}: player docs, and chips still sitting in open bets that the old server never settled. */
export async function readOldData(projectId, token, fetchImpl = fetch) {
  const players = await listAll("players", projectId, token, fetchImpl);
  const held = {};
  const add = (uid, n) => { if (Number.isSafeInteger(n) && n > 0) held[uid] = (held[uid] || 0) + n; };
  const bac = await listAll("tables/main/bets", projectId, token, fetchImpl).catch(() => ({}));
  for (const [uid, b] of Object.entries(bac)) add(uid, b.total || Object.values(b.bets || {}).reduce((a, x) => a + (+x || 0), 0));
  const bj = await listAll("tables/bj/bets", projectId, token, fetchImpl).catch(() => ({}));
  for (const [uid, b] of Object.entries(bj)) add(uid, b.amount);
  return { players, held };
}
