// =====================================================================
// KP Books: server side (Cloudflare Worker)
// Serves the API the app talks to, receives Shopify orders and bill emails,
// syncs the bank feed every few hours and makes weekly backups.
// The screens themselves live in /public and are served by Cloudflare directly.
// =====================================================================

import { verifyAccess, verifyShopify } from "./auth.js";
import { migrate, KINDS, now, upsertStmt, deleteStmt, auditStmt, summarize, getRecord, listRecords, putMany, kvGet, kvSet, bizSettings, bizToday, aiContext } from "./db.js";
import { orderToInvoice } from "./shopify.js";
import { syncBank, akahuReady, requestRefresh } from "./akahu.js";
import { readDocument, aiSpend } from "./ai.js";
import { handleEmail } from "./email.js";

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (message, status = 400) => json({ error: message }, status);
const nzToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
const validId = (s) => typeof s === "string" && /^[A-Za-z0-9._~:@+-]{1,160}$/.test(s);
const validBiz = (s) => typeof s === "string" && /^[a-z0-9-]{1,32}$/.test(s);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);
    try {
      await migrate(env);

      // ---- Public: Shopify webhooks (checked by signature instead of login) ----
      if (path.startsWith("/api/hooks/shopify")) return await shopifyHook(request, env, path);

      // ---- Everything else needs you signed in ----
      let who;
      try { who = await verifyAccess(request, env); } catch (e) { return fail(e.message, 401); }
      const biz = url.searchParams.get("biz") || env.DEFAULT_BIZ || "kp";
      if (!validBiz(biz)) return fail("Bad business id");

      // Who am I, and what's switched on
      if (path === "/api/me") {
        const { results } = await env.DB.prepare(`SELECT biz, data FROM records WHERE kind = 'settings' AND id = 'main' AND deleted = 0`).all();
        // Shopify orders come in through the separate kp-hooks receiver, which sits outside the sign-in lock
        const shopifyLast = await kvGet(env, "shopify-last:" + biz);
        return json({
          email: who, today: nzToday(),
          businesses: results.map((r) => ({ id: r.biz, name: JSON.parse(r.data).businessName || r.biz })),
          integrations: { ai: !!env.ANTHROPIC_API_KEY, bank: akahuReady(env), shopify: !!shopifyLast },
          shopifyLast: shopifyLast || "",
          webhookUrl: `${hooksOrigin(url.origin, env)}/api/hooks/shopify/${biz}`,
          aiBudget: Number(env.AI_BUDGET_USD) || 10,
        });
      }

      // All records for one business (the app loads everything once, then syncs changes)
      if (path === "/api/data" && request.method === "GET") {
        const { results } = await env.DB.prepare(`SELECT kind, id, data, updated_at FROM records WHERE biz = ?1 AND deleted = 0`).bind(biz).all();
        const stamp = await env.DB.prepare(`SELECT MAX(updated_at) m FROM records WHERE biz = ?1`).bind(biz).first();
        return json({ records: results.map((r) => ({ kind: r.kind, id: r.id, data: JSON.parse(r.data) })), stamp: stamp?.m || "" });
      }
      // Changes since the app last looked (new Shopify orders, edits from your other device)
      if (path === "/api/changes") {
        const since = url.searchParams.get("since") || "";
        const { results } = await env.DB.prepare(`SELECT kind, id, data, deleted, updated_at FROM records WHERE biz = ?1 AND updated_at > ?2 ORDER BY updated_at LIMIT 2000`).bind(biz, since).all();
        return json({ records: results.map((r) => ({ kind: r.kind, id: r.id, deleted: !!r.deleted, data: r.deleted ? null : JSON.parse(r.data) })),
          stamp: results.length ? results[results.length - 1].updated_at : since });
      }

      // Save or delete one record: PUT/DELETE /api/rec/<kind>/<id>
      const m = path.match(/^\/api\/rec\/([a-z]+)\/(.+)$/);
      if (m) {
        const kind = m[1], id = decodeURIComponent(m[2]);
        if (!KINDS.has(kind) || !validId(id)) return fail("Unknown record");
        const ts = now();
        if (request.method === "PUT") {
          const data = await request.json();
          if (!data || typeof data !== "object" || Array.isArray(data)) return fail("Expected an object");
          await env.DB.batch([upsertStmt(env, biz, kind, id, data, ts), auditStmt(env, biz, kind, id, "save", who, summarize(kind, data))]);
          return json({ ok: true, ts });
        }
        if (request.method === "DELETE") {
          await env.DB.batch([deleteStmt(env, biz, kind, id, ts), auditStmt(env, biz, kind, id, "delete", who, "")]);
          return json({ ok: true, ts });
        }
      }
      // Many writes at once: [{op: "put"|"delete", kind, id, data}]
      if (path === "/api/batch" && request.method === "POST") {
        const ops = await request.json();
        if (!Array.isArray(ops) || ops.length > 500) return fail("Expected up to 500 changes");
        for (let i = 0; i < ops.length; i += 50) {
          const stmts = [];
          for (const o of ops.slice(i, i + 50)) {
            if (!KINDS.has(o.kind) || !validId(o.id)) return fail(`Unknown record ${o.kind}/${o.id}`);
            stmts.push(o.op === "delete" ? deleteStmt(env, biz, o.kind, o.id, now()) : upsertStmt(env, biz, o.kind, o.id, o.data, now()));
          }
          stmts.push(auditStmt(env, biz, ops[i].kind, "*", "batch", who, `${Math.min(50, ops.length - i)} changes`));
          await env.DB.batch(stmts);
        }
        return json({ ok: true });
      }

      // Files: upload (raw body) and download
      if (path === "/api/files" && request.method === "POST") {
        const name = (url.searchParams.get("name") || "file").replace(/[^\w.-]+/g, "_").slice(0, 80);
        const type = request.headers.get("content-type") || "application/octet-stream";
        const bytes = await request.arrayBuffer();
        if (bytes.byteLength > 25 * 1024 * 1024) return fail("Files must be under 25 MB");
        const key = `${biz}/${nzToday().slice(0, 7)}/${crypto.randomUUID()}-${name}`;
        await env.FILES.put(key, bytes, { httpMetadata: { contentType: type } });
        return json({ key });
      }
      if (path.startsWith("/api/files/") && request.method === "GET") {
        const key = decodeURIComponent(path.slice("/api/files/".length));
        if (!key.startsWith(biz + "/")) return fail("Not found", 404);
        const obj = await env.FILES.get(key);
        if (!obj) return fail("Not found", 404);
        return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "application/octet-stream", "cache-control": "private, max-age=3600" } });
      }

      // Read a bill or supplier invoice with Claude: {mode: "bill"|"supplier", fileKey} or {mode, text}
      if (path === "/api/ai/read" && request.method === "POST") {
        const { mode, fileKey, text } = await request.json();
        let file = null;
        if (fileKey) {
          if (!fileKey.startsWith(biz + "/")) return fail("Not found", 404);
          const obj = await env.FILES.get(fileKey);
          if (!obj) return fail("File not found", 404);
          file = { bytes: await obj.arrayBuffer(), type: obj.httpMetadata?.contentType || "" };
        }
        const bs = await bizSettings(env, biz);
        const result = await readDocument(env, { mode, file, text, today: bizToday(bs), ctx: aiContext(bs) });
        return json(result);
      }

      // Bank: sync now
      if (path === "/api/bank/sync" && request.method === "POST") {
        const full = url.searchParams.get("full") === "1";
        await requestRefresh(env);
        const settings = (await getRecord(env, biz, "settings", "main")) || {};
        return json(await syncBank(env, biz, settings, full));
      }

      // How close you are to Cloudflare's free allowances (checked at most every 6 hours)
      if (path === "/api/usage") return json({ ...(await usage(env, url.searchParams.get("fresh") === "1")), ai: await aiSpend(env) });

      // Activity log
      if (path === "/api/audit") {
        const { results } = await env.DB.prepare(`SELECT ts, kind, id, action, who, summary FROM audit WHERE biz = ?1 ORDER BY ts DESC LIMIT 300`).bind(biz).all();
        return json({ items: results });
      }

      // Backup: everything for this business as one JSON file
      if (path === "/api/backup") return json(await backup(env, biz));
      if (path === "/api/backups") {
        const list = await env.FILES.list({ prefix: `${biz}/backups/` });
        return json({ items: list.objects.map((o) => ({ key: o.key, size: o.size, uploaded: o.uploaded })).reverse() });
      }
      // Restore from a backup file (adds or replaces records; never deletes)
      if (path === "/api/restore" && request.method === "POST") {
        const body = await request.json();
        const items = (body.records || []).filter((r) => KINDS.has(r.kind) && validId(r.id) && r.data);
        await putMany(env, biz, items, who, "restore");
        return json({ ok: true, restored: items.length });
      }

      return fail("Not found", 404);
    } catch (e) {
      console.error(e);
      return fail(e.message || "Something went wrong", 500);
    }
  },

  // Runs on the schedule in wrangler.jsonc
  async scheduled(event, env, ctx) {
    await migrate(env);
    const { results } = await env.DB.prepare(`SELECT biz, data FROM records WHERE kind = 'settings' AND id = 'main' AND deleted = 0`).all();
    const businesses = results.length ? results : [{ biz: env.DEFAULT_BIZ || "kp", data: "{}" }];
    const t = new Date(event.scheduledTime);
    const nz = new Date(t.toLocaleString("en-US", { timeZone: "Pacific/Auckland" }));
    for (const b of businesses) {
      const settings = JSON.parse(b.data);
      if (akahuReady(env)) ctx.waitUntil(syncBank(env, b.biz, settings).catch((e) => console.error("bank sync", e)));
      // Weekly backup: Sunday, the run between midnight and 3am NZ time
      if (nz.getDay() === 0 && nz.getHours() < 3) ctx.waitUntil(saveBackup(env, b.biz));
    }
  },

  // Bills emailed in (Cloudflare Email Routing)
  async email(message, env, ctx) {
    await migrate(env);
    await handleEmail(message, env);
  },
};

// ---------- Free plan usage ----------
// File storage (R2): 10 GB free. Database (D1): 500 MB per database on the free plan.
// Counting R2 means listing every file, so the answer is kept for 6 hours.
const GB = 1024 ** 3, MB = 1024 ** 2;
async function usage(env, fresh) {
  const cached = await kvGet(env, "usage");
  if (cached && !fresh) { const u = JSON.parse(cached); if (Date.now() - Date.parse(u.checkedAt) < 6 * 3600_000) return u; }
  let files = 0, fileCount = 0, cursor;
  do {
    const page = await env.FILES.list({ cursor, limit: 1000 });
    for (const o of page.objects || []) { files += o.size || 0; fileCount++; }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  let dbBytes = 0;
  try { dbBytes = (await env.DB.prepare("SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()").first())?.b || 0; } catch {}
  if (!dbBytes) {
    // Fallback: add up what's stored
    const r = await env.DB.prepare("SELECT (SELECT COALESCE(SUM(LENGTH(data)), 0) FROM records) + (SELECT COALESCE(SUM(LENGTH(summary)) + COUNT(*) * 80, 0) FROM audit) AS b").first();
    dbBytes = r?.b || 0;
  }
  const items = [
    { key: "files", name: "File storage (bills, receipts, backups)", used: files, limit: 10 * GB, detail: `${fileCount} files` },
    { key: "db", name: "Database (your books)", used: dbBytes, limit: 500 * MB },
  ].map((i) => ({ ...i, pct: Math.round((i.used / i.limit) * 1000) / 10 }));
  const u = { checkedAt: new Date().toISOString(), items, worst: Math.max(...items.map((i) => i.pct)) };
  await kvSet(env, "usage", JSON.stringify(u));
  return u;
}

async function backup(env, biz) {
  const { results } = await env.DB.prepare(`SELECT kind, id, data, updated_at FROM records WHERE biz = ?1 AND deleted = 0`).bind(biz).all();
  return { app: "kp-books", version: 1, biz, exportedAt: new Date().toISOString(),
    records: results.map((r) => ({ kind: r.kind, id: r.id, updated_at: r.updated_at, data: JSON.parse(r.data) })) };
}
async function saveBackup(env, biz) {
  const data = await backup(env, biz);
  await env.FILES.put(`${biz}/backups/${nzToday()}.json`, JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
  // Keep the latest 26 (six months of weekly backups)
  const list = await env.FILES.list({ prefix: `${biz}/backups/` });
  const old = list.objects.map((o) => o.key).sort().slice(0, -26);
  for (const k of old) await env.FILES.delete(k);
}

// kp-books.you.workers.dev -> kp-hooks.you.workers.dev
// Works on any address you open the app at (workers.dev or your own domain): HOOKS_ORIGIN in wrangler.jsonc wins
const hooksOrigin = (origin, env) => env?.HOOKS_ORIGIN || origin.replace("//kp-books.", "//kp-hooks.");

// Exported so the kp-hooks receiver (worker/hooks.js) runs exactly the same code
export async function shopifyHook(request, env, path) {
  if (request.method !== "POST") return fail("POST only", 405);
  const biz = path.split("/")[4] || env.DEFAULT_BIZ || "kp";
  if (!validBiz(biz)) return fail("Bad business id");
  const raw = await request.arrayBuffer();
  // Each business can have its own Shopify store: SHOPIFY_WEBHOOK_SECRET_ICEBATH etc
  const secret = env["SHOPIFY_WEBHOOK_SECRET_" + biz.toUpperCase().replace(/-/g, "_")] || env.SHOPIFY_WEBHOOK_SECRET;
  if (!(await verifyShopify(raw, request.headers.get("x-shopify-hmac-sha256"), secret))) return fail("Bad signature", 401);
  // Note the time, so Setup can show Shopify is connected
  await kvSet(env, "shopify-last:" + biz, new Date().toISOString());

  // Always answer 200 once the signature checks out: Shopify deletes webhooks that keep failing
  let order; try { order = JSON.parse(new TextDecoder().decode(raw)); } catch { return json({ ok: true, skipped: "not JSON" }); }
  if (!order || !order.line_items) return json({ ok: true, skipped: "not an order" });
  const settings = (await getRecord(env, biz, "settings", "main")) || {};
  const inv = orderToInvoice(order, settings);
  if (inv) {
    const old = await getRecord(env, biz, "invoice", inv.id);
    // Keep anything added in the app (notes, payment matches)
    await putMany(env, biz, [{ kind: "invoice", id: inv.id, data: { ...(old || {}), ...inv.data } }], "shopify", request.headers.get("x-shopify-topic") || "webhook");
  }
  return json({ ok: true });     // Shopify only needs a 200 back
}
