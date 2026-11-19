// ---------- Bank feed (Akahu) ----------
// Akahu is NZ's open banking service. A free "personal app" lets this app read your own
// accounts. Akahu refreshes from your bank once a day; we pull the new transactions.

import { listRecords, putMany, kvGet, kvSet } from "./db.js";

const API = "https://api.akahu.io/v1";

async function akahu(env, path, init = {}) {
  const res = await fetch(API + path, {
    ...init,
    headers: { Authorization: `Bearer ${env.AKAHU_USER_TOKEN}`, "X-Akahu-Id": env.AKAHU_APP_TOKEN, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) throw new Error(`Akahu ${path}: ${body.message || res.status}`);
  return body;
}

export const akahuReady = (env) => !!(env.AKAHU_APP_TOKEN && env.AKAHU_USER_TOKEN);

// Ask Akahu to check the bank now (allowed once an hour; errors are fine to ignore)
export async function requestRefresh(env) {
  try { await akahu(env, "/refresh", { method: "POST" }); } catch { /* resting, try later */ }
}

// Pull accounts and transactions into one business's books
export async function syncBank(env, biz, settings = {}, full = false) {
  if (!akahuReady(env)) throw new Error("Bank feed isn't set up. Add your Akahu tokens (setup guide step 8).");

  // 1. Accounts and balances
  const { items: accounts } = await akahu(env, "/accounts");
  const existingAccts = new Map((await listRecords(env, biz, "bankacct")).map((a) => [a.id, a]));
  const acctWrites = accounts.map((a) => {
    const old = existingAccts.get(a._id) || {};
    return { kind: "bankacct", id: a._id, data: {
      ...old, id: undefined,
      name: a.name, bank: a.connection?.name || "", number: a.formatted_account || "", type: a.type,
      balance: a.balance?.current ?? null, available: a.balance?.available ?? null, currency: a.balance?.currency || "NZD",
      refreshedAt: a.refreshed?.transactions || a.refreshed?.balance || null,
      // You choose which accounts belong to this business on the Bank screen. New accounts start switched off
      // unless they look like a business account.
      use: old.use ?? /business|biz|ltd|limited/i.test(a.name || ""),
    } };
  });
  for (const w of acctWrites) delete w.data.id;
  await putMany(env, biz, acctWrites, "bank sync", "sync");
  const useIds = new Set(acctWrites.filter((w) => w.data.use).map((w) => w.id));

  // 2. Transactions since the last sync (minus a week, in case the bank posts late)
  const cursorKey = `akahu:last:${biz}`;
  const last = await kvGet(env, cursorKey);
  const startDate = last && !full ? new Date(Date.parse(last) - 7 * 864e5) : new Date(settings.bankFrom || `${new Date().getFullYear() - 1}-04-01`);
  const existing = new Map((await listRecords(env, biz, "txn")).map((t) => [t.id, t]));
  const writes = [];
  let cursor = null, pages = 0;
  do {
    const q = new URLSearchParams({ start: startDate.toISOString() });
    if (cursor) q.set("cursor", cursor);
    const page = await akahu(env, "/transactions?" + q);
    for (const t of page.items || []) {
      if (!useIds.has(t._account)) continue;   // only accounts switched on for this business
      const old = existing.get(t._id);
      const raw = {
        account: t._account, date: String(t.date).slice(0, 10), description: t.description || "",
        amount: Number(t.amount), balance: t.balance ?? null, bankType: t.type || "",
        merchant: t.merchant?.name || "", akahuCategory: t.category?.name || "",
        source: "akahu",
      };
      // Keep anything you've done to the transaction (matched, categorised, ignored)
      if (old) {
        const { id, ...keep } = old;
        if (JSON.stringify({ ...keep, ...raw }) === JSON.stringify(keep)) continue;
        writes.push({ kind: "txn", id: t._id, data: { ...keep, ...raw } });
      } else {
        writes.push({ kind: "txn", id: t._id, data: { ...raw, status: "new" } });
      }
    }
    cursor = page.cursor?.next || null;
  } while (cursor && ++pages < 60);

  if (writes.length) await putMany(env, biz, writes, "bank sync", "sync");
  await kvSet(env, cursorKey, new Date().toISOString());
  return { accounts: accounts.length, added: writes.length, chooseAccounts: useIds.size === 0 };
}
