// Local test server: runs the real Worker code with a SQLite stand-in for D1 and an
// in-memory stand-in for R2. Not used in production. Run: npm run dev  (then open http://localhost:8787)
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import worker from "../worker/index.js";

// --- D1 stand-in ---
export function makeD1(file = ":memory:") {
  const db = new DatabaseSync(file);
  class Stmt {
    constructor(sql) { this.sql = sql; this.args = []; }
    bind(...a) { this.args = a.map((v) => (v === undefined ? null : v)); return this; }
    async all() { return { results: db.prepare(this.sql).all(...this.args) }; }
    async first() { return db.prepare(this.sql).get(...this.args) ?? null; }
    async run() { db.prepare(this.sql).run(...this.args); return { success: true }; }
    runSync() { db.prepare(this.sql).run(...this.args); }
  }
  return {
    prepare: (sql) => new Stmt(sql),
    batch: async (stmts) => { db.exec("BEGIN"); try { for (const s of stmts) s.runSync(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; } return []; },
    _db: db,
  };
}
// --- R2 stand-in ---
export function makeR2() {
  const m = new Map();
  const toBytes = async (b) => b instanceof Uint8Array ? b : b instanceof ArrayBuffer ? new Uint8Array(b) : typeof b === "string" ? new TextEncoder().encode(b) : new Uint8Array(await new Response(b).arrayBuffer());
  return {
    async put(key, body, opts = {}) { m.set(key, { bytes: await toBytes(body), httpMetadata: opts.httpMetadata || {}, uploaded: new Date() }); },
    async get(key) { const o = m.get(key); if (!o) return null; return { body: o.bytes, httpMetadata: o.httpMetadata, arrayBuffer: async () => o.bytes.buffer.slice(o.bytes.byteOffset, o.bytes.byteOffset + o.bytes.byteLength), text: async () => new TextDecoder().decode(o.bytes) }; },
    async list({ prefix = "" } = {}) { return { objects: [...m.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.bytes.length, uploaded: o.uploaded })) }; },
    async delete(key) { m.delete(key); },
    _map: m,
  };
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".json": "application/json" };
const PUBLIC = new URL("../public/", import.meta.url).pathname;
const ASSETS = { async fetch(req) {
  let p = new URL(req.url).pathname; if (p === "/") p = "/index.html";
  try { const b = await readFile(join(PUBLIC, p)); return new Response(b, { headers: { "content-type": TYPES[extname(p)] || "application/octet-stream" } }); }
  catch { const b = await readFile(join(PUBLIC, "index.html")); return new Response(b, { headers: { "content-type": "text/html" } }); }
} };

export function makeEnv(extra = {}) {
  return { DB: makeD1(process.env.DB_FILE || ":memory:"), FILES: makeR2(), ASSETS, DEV_NO_AUTH: "1", DEFAULT_BIZ: "kp", SHOPIFY_WEBHOOK_SECRET: "test-secret", ...extra };
}

export function serve(env, port = 8787) {
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    const ctx = { waitUntil: (p) => p.catch?.((e) => console.error(e)) };
    const r = await worker.fetch(request, env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (process.argv[1] && process.argv[1].endsWith("server.mjs")) {
  const env = makeEnv();
  await serve(env);
  console.log("Kauri Point Books running at http://localhost:8787");
}
