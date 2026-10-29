// Verify a Firebase Authentication ID token (RS256 JWT) with Web Crypto. No Firebase SDK needed on the server.
const JWKS_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
let cache = { keys: null, until: 0 };

const b64url = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const json = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

async function keys(fetchImpl, now) {
  if (cache.keys && now < cache.until) return cache.keys;
  const r = await fetchImpl(JWKS_URL);
  if (!r.ok) throw new Error("could not load Google signing keys");
  const body = await r.json();
  const maxAge = +((r.headers.get("cache-control") || "").match(/max-age=(\d+)/) || [0, 3600])[1];
  cache = { keys: Object.fromEntries((body.keys || []).map((k) => [k.kid, k])), until: now + Math.min(maxAge, 6 * 3600) * 1000 };
  return cache.keys;
}

/**
 * Returns {uid, email} for a valid token from a verified Google account in this project, or throws.
 * @param {string} token @param {string} projectId @param {{fetch?: Function, now?: number, keyOverride?: object}} [o]
 */
export async function verifyIdToken(token, projectId, o = {}) {
  if (typeof token !== "string" || token.length > 4096) throw new Error("bad token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad token");
  const head = json(b64url(parts[0])), claims = json(b64url(parts[1]));
  if (head.alg !== "RS256" || !head.kid) throw new Error("bad token header");
  const now = o.now ?? Date.now(), sec = Math.floor(now / 1000);
  const jwk = o.keyOverride || (await keys(o.fetch || fetch, now))[head.kid];
  if (!jwk) throw new Error("unknown signing key");
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  if (!ok) throw new Error("bad signature");
  if (claims.aud !== projectId || claims.iss !== "https://securetoken.google.com/" + projectId) throw new Error("wrong project");
  if (!(claims.exp > sec - 30) || !(claims.iat <= sec + 300) || !(claims.auth_time <= sec + 300)) throw new Error("expired");
  if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 128) throw new Error("bad subject");
  if (!claims.firebase || claims.firebase.sign_in_provider !== "google.com") throw new Error("Googleアカウントでログインしてね");
  if (claims.email_verified !== true) throw new Error("メールが確認済みのGoogleアカウントでログインしてね");
  return { uid: claims.sub, email: claims.email || "" };
}
