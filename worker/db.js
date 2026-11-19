// ---------- Database ----------
// Everything is stored as "records": one row per invoice, bill, product, bank transaction etc.
// Each row holds its details as JSON. This keeps the database simple and lets the app grow
// new fields without database changes.

// Tables are created automatically the first time the app runs.
export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS records (
     biz TEXT NOT NULL,           -- which business (e.g. kp)
     kind TEXT NOT NULL,          -- invoice, bill, product, txn ...
     id TEXT NOT NULL,
     data TEXT NOT NULL,          -- the details, as JSON
     updated_at TEXT NOT NULL,    -- ISO time, used to sync changes to your devices
     deleted INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (biz, kind, id))`,
  `CREATE INDEX IF NOT EXISTS records_updated ON records (biz, updated_at)`,
  `CREATE TABLE IF NOT EXISTS audit (
     ts TEXT NOT NULL, biz TEXT, kind TEXT, id TEXT, action TEXT, who TEXT, summary TEXT)`,
  `CREATE INDEX IF NOT EXISTS audit_ts ON audit (biz, ts)`,
  `CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`,
];

// The kinds of record the app may write. Anything else is refused.
export const KINDS = new Set(["settings", "invoice", "bill", "product", "contact", "bankacct", "txn", "rule", "period", "stockmove", "po"]);

let ready = false;
export const resetForTests = () => { ready = false; };   // dev tests only
export async function migrate(env) {
  if (ready) return;
  await env.DB.batch(SCHEMA.map((s) => env.DB.prepare(s)));
  await runDataFixes(env);
  ready = true;
}

// ---------- One-off data fixes ----------
// Each runs once, ever (a "fix:" flag is kept in kv), and never overwrites something you've changed.
// They live in fixes.js, which is private to each copy of the app (the shared copy has none).
import { FIXES } from "./fixes.js";
async function runDataFixes(env) {
  const biz = env.DEFAULT_BIZ || "kp";
  for (const [name, fix] of Object.entries(FIXES)) {
    const flag = `fix:${name}`;
    try {
      if (await kvGet(env, flag)) continue;
      await fix(env, biz);
      await kvSet(env, flag, new Date().toISOString());
    } catch (e) { console.error("data fix " + name, e); }      // try again next start-up
  }
}

// A time string that always sorts after the previous one, even within the same millisecond
let lastTs = "";
export function now() {
  let t = new Date().toISOString();
  if (t <= lastTs) t = new Date(Date.parse(lastTs) + 1).toISOString();
  lastTs = t;
  return t;
}

export function upsertStmt(env, biz, kind, id, data, ts) {
  return env.DB.prepare(
    `INSERT INTO records (biz, kind, id, data, updated_at, deleted) VALUES (?1, ?2, ?3, ?4, ?5, 0)
     ON CONFLICT (biz, kind, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = 0`
  ).bind(biz, kind, id, JSON.stringify(data), ts);
}
export function deleteStmt(env, biz, kind, id, ts) {
  // Soft delete, so other devices learn about it on their next sync
  return env.DB.prepare(`UPDATE records SET deleted = 1, updated_at = ?4 WHERE biz = ?1 AND kind = ?2 AND id = ?3`).bind(biz, kind, id, ts);
}
export function auditStmt(env, biz, kind, id, action, who, summary) {
  return env.DB.prepare(`INSERT INTO audit (ts, biz, kind, id, action, who, summary) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(new Date().toISOString(), biz, kind, id, action, who, String(summary || "").slice(0, 200));
}

// One-line description of a record for the activity log
export function summarize(kind, d = {}) {
  if (kind === "invoice") return `${d.number || ""} ${d.customer?.name || ""} $${d.total ?? ""}`;
  if (kind === "bill") return `${d.supplier || ""} $${d.total ?? ""}`;
  if (kind === "product") return `${d.name || ""} ${d.sku || ""}`;
  if (kind === "txn") return `${d.description || ""} ${d.amount ?? ""} ${d.status || ""}`;
  return d.name || d.description || "";
}

export async function getRecord(env, biz, kind, id) {
  const row = await env.DB.prepare(`SELECT data FROM records WHERE biz = ?1 AND kind = ?2 AND id = ?3 AND deleted = 0`).bind(biz, kind, id).first();
  return row ? JSON.parse(row.data) : null;
}
export async function listRecords(env, biz, kind) {
  const { results } = await env.DB.prepare(`SELECT id, data FROM records WHERE biz = ?1 AND kind = ?2 AND deleted = 0`).bind(biz, kind).all();
  return results.map((r) => ({ id: r.id, ...JSON.parse(r.data) }));
}

// Write many records in chunks (D1 batches run as one transaction)
export async function putMany(env, biz, items, who, action = "sync") {
  const ts0 = now();
  for (let i = 0; i < items.length; i += 50) {
    const chunk = items.slice(i, i + 50);
    const stmts = chunk.map((it) => upsertStmt(env, biz, it.kind, it.id, it.data, now()));
    if (chunk.length <= 5) chunk.forEach((it) => stmts.push(auditStmt(env, biz, it.kind, it.id, action, who, summarize(it.kind, it.data))));
    await env.DB.batch(stmts);
  }
  if (items.length > 5) await auditStmt(env, biz, items[0].kind, "*", action, who, `${items.length} records`).run();
  return ts0;
}

// The business's Setup, for things the server needs to know (Claude's reading context, time zone)
export async function bizSettings(env, biz) {
  try { const r = await env.DB.prepare(`SELECT data FROM records WHERE biz = ?1 AND kind = 'settings' AND id = 'main' AND deleted = 0`).bind(biz).first(); return r ? JSON.parse(r.data) : {}; }
  catch { return {}; }
}
export const aiContext = (s = {}) => ({ country: s.country || "NZ", currency: s.currency, gstRate: s.gstRate, taxName: s.taxName, about: s.about, lowValueAsset: s.lowValueAsset });
const ZONES = { NZ: "Pacific/Auckland", AU: "Australia/Sydney" };
export const bizToday = (s = {}) => new Date().toLocaleDateString("en-CA", { timeZone: s.timeZone || ZONES[s.country || "NZ"] || "UTC" });

export async function kvGet(env, k) { const r = await env.DB.prepare(`SELECT v FROM kv WHERE k = ?1`).bind(k).first(); return r ? r.v : null; }
export async function kvSet(env, k, v) { await env.DB.prepare(`INSERT INTO kv (k, v) VALUES (?1, ?2) ON CONFLICT (k) DO UPDATE SET v = excluded.v`).bind(k, v).run(); }
