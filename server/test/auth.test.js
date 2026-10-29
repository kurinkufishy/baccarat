import test from "node:test";
import assert from "node:assert/strict";
import { verifyIdToken } from "../src/auth.js";
import { decodeFields, readOldData } from "../src/firestore.js";

const enc = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const { privateKey, publicKey } = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
const NOW = 1_800_000_000_000, sec = NOW / 1000;
async function token(claims, head = { alg: "RS256", kid: "k1" }) {
  const body = enc(head) + "." + enc(claims);
  const sig = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(body))).toString("base64url");
  return body + "." + sig;
}
const good = { aud: "proj", iss: "https://securetoken.google.com/proj", sub: "u123", iat: sec - 10, auth_time: sec - 10, exp: sec + 3000, email: "a@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" } };
const v = (t) => verifyIdToken(t, "proj", { now: NOW, keyOverride: jwk });

test("accepts a valid Google sign-in token", async () => {
  assert.deepEqual(await v(await token(good)), { uid: "u123", email: "a@example.com" });
});
test("rejects tampering, other projects, expiry and non-Google sign-in", async () => {
  const t = await token(good);
  const forged = t.split(".").slice(0, 1).concat(enc({ ...good, sub: "admin" }), t.split(".")[2]).join(".");
  await assert.rejects(v(forged));
  await assert.rejects(v(await token({ ...good, aud: "other" })));
  await assert.rejects(v(await token({ ...good, iss: "https://evil" })));
  await assert.rejects(v(await token({ ...good, exp: sec - 100 })));
  await assert.rejects(v(await token({ ...good, email_verified: false })));
  await assert.rejects(v(await token({ ...good, firebase: { sign_in_provider: "anonymous" } })));
  await assert.rejects(v(await token(good, { alg: "none", kid: "k1" })));
  await assert.rejects(v("not.a.token"));
  await assert.rejects(v(123));
});

test("decodes Firestore REST values", () => {
  const f = { chips: { integerValue: "42000" }, name: { stringValue: "くり" }, seated: { booleanValue: true },
    st: { mapValue: { fields: { n: { integerValue: "3" }, prof: { integerValue: "-900" } } } }, curve: { arrayValue: { values: [{ integerValue: "1" }, { doubleValue: 2.5 }] } }, x: { nullValue: null } };
  assert.deepEqual(decodeFields(f), { chips: 42000, name: "くり", seated: true, st: { n: 3, prof: -900 }, curve: [1, 2.5], x: null });
});

test("reads old players and returns chips still held in open bets", async () => {
  const docs = {
    players: [{ name: "x/players/u1", fields: { chips: { integerValue: "100" } } }],
    "tables/main/bets": [{ name: "x/u1", fields: { total: { integerValue: "500" } } }],
    "tables/bj/bets": [{ name: "x/u1", fields: { amount: { integerValue: "200" } } }],
  };
  const seen = [];
  const fake = async (url, init) => {
    seen.push(init.headers.Authorization);
    const path = Object.keys(docs).find((p) => url.includes("/documents/" + p + "?"));
    return { ok: true, status: 200, json: async () => ({ documents: docs[path] }) };
  };
  const r = await readOldData("proj", "TOKEN", fake);
  assert.deepEqual(r, { players: { u1: { chips: 100 } }, held: { u1: 700 } });
  assert.ok(seen.every((h) => h === "Bearer TOKEN"));
  await assert.rejects(readOldData("proj", "T", async () => ({ ok: false, status: 403 })), /読めなかった/);
});
