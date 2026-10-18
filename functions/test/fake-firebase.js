// In-memory stand-ins for firebase-admin and firebase-functions, enough to run index.js in tests.
const Module = require("node:module");

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }
const INC = Symbol("increment");
const FieldValue = { increment: (n) => ({ [INC]: n }) };
const clone = (o) => (o === undefined ? undefined : JSON.parse(JSON.stringify(o)));

function makeDb() {
  const docs = new Map();
  let lock = Promise.resolve();
  const snap = (path) => ({ id: path.split("/").pop(), ref: ref(path), exists: docs.has(path), data: () => clone(docs.get(path)) });
  const apply = (path, op, data) => {
    if (op === "delete") return docs.delete(path);
    if (op === "set") return docs.set(path, clone(data));
    if (!docs.has(path)) throw new Error("update on missing doc " + path);
    const cur = docs.get(path);
    for (const [k, v] of Object.entries(data)) cur[k] = v && v[INC] !== undefined ? (cur[k] || 0) + v[INC] : clone(v);
  };
  const setMerge = (path, data) => { if (!docs.has(path)) docs.set(path, {}); apply(path, "update", data); };
  function ref(path) {
    return {
      id: path.split("/").pop(), path,
      get: async () => snap(path),
      set: async (d, o) => (o && o.merge ? setMerge(path, d) : apply(path, "set", d)),
      update: async (d) => apply(path, "update", d),
      delete: async () => apply(path, "delete"),
    };
  }
  const children = (cpath) => [...docs.keys()].filter((k) => k.startsWith(cpath + "/") && k.split("/").length === cpath.split("/").length + 1);
  function query(cpath, filters = []) {
    return {
      _q: true,
      where: (f, op, v) => query(cpath, [...filters, [f, op, v]]),
      run: () => children(cpath).filter((k) => filters.every(([f, , v]) => docs.get(k)[f] === v)).map(snap),
      get: async () => ({ docs: query(cpath, filters).run() }),
    };
  }
  function collection(cpath) {
    return { ...query(cpath), path: cpath, doc: (id) => ref(cpath + "/" + id), count: () => ({ get: async () => ({ data: () => ({ count: children(cpath).length }) }) }) };
  }
  async function runTransaction(fn) {
    const prev = lock; let release; lock = new Promise((r) => (release = r));
    await prev;
    try {
      const writes = [];
      const tx = {
        get: async (r) => (r._q ? { docs: r.run() } : snap(r.path)),
        getAll: async (...rs) => rs.map((r) => snap(r.path)),
        set: (r, d, o) => { writes.push(() => (o && o.merge ? setMerge(r.path, d) : apply(r.path, "set", d))); },
        update: (r, d) => { writes.push(() => apply(r.path, "update", d)); },
        delete: (r) => { writes.push(() => apply(r.path, "delete")); },
      };
      const out = await fn(tx);
      writes.forEach((w) => w());
      return out;
    } finally { release(); }
  }
  return { docs, doc: ref, collection, runTransaction };
}

const db = makeDb();
const fakes = {
  "firebase-functions/v2/https": { onCall: (h) => h, HttpsError },
  "firebase-functions/v2": { setGlobalOptions: () => {} },
  "firebase-admin/app": { initializeApp: () => {} },
  "firebase-admin/firestore": { getFirestore: () => db, FieldValue },
};
const origLoad = Module._load;
Module._load = function (req, ...rest) { return fakes[req] || origLoad.call(this, req, ...rest); };

const authFor = (uid, extra = {}) => ({ uid, token: { email: uid + "@example.com", email_verified: true, firebase: { sign_in_provider: "google.com" }, ...extra } });
module.exports = { db, HttpsError, authFor };
