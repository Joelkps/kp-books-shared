// =====================================================================
// Data: loads your books from the server, keeps them in memory,
// saves changes and picks up new ones (Shopify orders, your other devices).
// =====================================================================

import { DEFAULT_SETTINGS, calcOpts, applyTaxSettings } from "./calc.js";

// Map of record kind -> the collection name used in the app
const COLLECTIONS = { invoice: "invoices", bill: "bills", product: "products", contact: "contacts", bankacct: "bankaccts",
  txn: "txns", rule: "rules", period: "periods", stockmove: "stockmoves", po: "pos" };

export const S = {
  me: null,                 // who's signed in, which integrations are on
  biz: localGet("biz") || "kp",
  settings: { ...DEFAULT_SETTINGS },
  invoices: new Map(), bills: new Map(), products: new Map(), contacts: new Map(), bankaccts: new Map(),
  txns: new Map(), rules: new Map(), periods: new Map(), stockmoves: new Map(), pos: new Map(),
  stamp: "",                // last change seen from the server
  loaded: false, offline: false,
};

export function localGet(k) { try { return localStorage.getItem("kp:" + k); } catch { return null; } }
export function localSet(k, v) { try { localStorage.setItem("kp:" + k, v); } catch {} }

// ---------- Talking to the server ----------
export async function api(path, opts = {}) {
  const sep = path.includes("?") ? "&" : "?";
  let res;
  try {
    res = await fetch(`/api/${path}${sep}biz=${encodeURIComponent(S.biz)}`, {
      method: opts.method || "GET",
      headers: opts.body instanceof Blob || opts.body instanceof ArrayBuffer ? { "content-type": opts.type || "application/octet-stream" } : opts.body ? { "content-type": "application/json" } : {},
      body: opts.body instanceof Blob || opts.body instanceof ArrayBuffer ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    // A failed fetch while online usually means the sign-in expired (Access redirects to its login page)
    throw Object.assign(new Error(navigator.onLine ? "Your sign-in has expired. Reload the app to sign in again." : "You're offline. Changes can't be saved until you're back online."), { network: true });
  }
  // Access sends you to its login page when your session ends
  if (res.redirected || res.status === 401) { if (res.status === 401) { const e = await res.json().catch(() => ({})); throw Object.assign(new Error(e.error || "Please sign in again"), { auth: true }); } }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) { if (!res.ok) throw new Error(`Server error ${res.status}`); return res; }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || `Server error ${res.status}`);
  return body;
}

function applyRecord(r) {
  if (r.kind === "settings") { if (r.id === "main") { S.settings = { ...DEFAULT_SETTINGS, ...(r.deleted ? {} : r.data) }; calcOpts.freightMarkup = S.settings.freightMarkup ?? 10; applyTaxSettings(S.settings); } return; }
  const col = COLLECTIONS[r.kind]; if (!col) return;
  if (r.deleted) S[col].delete(r.id); else S[col].set(r.id, { ...r.data, _id: r.id });
}

export async function loadAll() {
  for (const c of Object.values(COLLECTIONS)) S[c] = new Map();
  S.settings = { ...DEFAULT_SETTINGS };
  const [me, data] = await Promise.all([api("me"), api("data")]);
  S.me = me;
  data.records.forEach(applyRecord);
  S.stamp = data.stamp;
  S.loaded = true;
  loadedListeners.forEach((f) => f());
  // Free plan usage, checked in the background (doesn't hold up opening the app)
  api("usage").then((u) => { S.usage = u; if (u.worst >= 80 || (u.ai && u.ai.usd >= (S.me?.aiBudget || 10) * 0.8)) listeners.forEach((f) => f([])); }).catch(() => {});
}

// Pull changes every 30 seconds while the app is open, and whenever you come back to it
let listeners = [], loadedListeners = [];
export const onChange = (fn) => listeners.push(fn);
export const onLoaded = (fn) => loadedListeners.push(fn);
export async function pullChanges() {
  if (!S.loaded) return;
  try {
    const { records, stamp } = await api("changes?since=" + encodeURIComponent(S.stamp || ""));
    S.offline = false;
    if (records.length) { records.forEach(applyRecord); S.stamp = stamp; listeners.forEach((f) => f(records)); }
  } catch { S.offline = true; }
}
setInterval(() => { if (document.visibilityState === "visible") pullChanges(); }, 30000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") pullChanges(); });

// ---------- Saving ----------
const strip = ({ _id, ...rest }) => rest;
export async function save(kind, id, data) {
  const clean = strip(data);
  await api(`rec/${kind}/${encodeURIComponent(id)}`, { method: "PUT", body: clean });
  applyRecord({ kind, id, data: clean });
  return { ...clean, _id: id };
}
export async function remove(kind, id) {
  await api(`rec/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
  applyRecord({ kind, id, deleted: true });
}
// Many changes at once: [{op: "put"|"delete", kind, id, data}]
export async function saveMany(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    await api("batch", { method: "POST", body: ops.slice(i, i + 400).map((o) => ({ ...o, data: o.data ? strip(o.data) : undefined })) });
  }
  ops.forEach((o) => applyRecord(o.op === "delete" ? { kind: o.kind, id: o.id, deleted: true } : { kind: o.kind, id: o.id, data: strip(o.data) }));
}
export const saveSettings = (patch) => save("settings", "main", { ...S.settings, ...patch });

// Files (bill PDFs, receipt photos)
export async function uploadFile(file) {
  const { key } = await api("files?name=" + encodeURIComponent(file.name || "file"), { method: "POST", body: file, type: file.type || "application/octet-stream" });
  return key;
}
export const fileUrl = (key) => `/api/files/${encodeURIComponent(key)}?biz=${encodeURIComponent(S.biz)}`;
// Your logo for PDFs: the one you uploaded in Setup, or the app's own
let logoCache = { key: null, bytes: null };
export async function logoBytes() {
  const key = S.settings.logoKey || "/logo.png";
  if (logoCache.key === key && logoCache.bytes) return logoCache.bytes;
  const url = S.settings.logoKey ? fileUrl(S.settings.logoKey) : "/logo.png";
  // Only a real PNG or JPG (a missing file can come back as the app's own page)
  const bytes = await fetch(url, { credentials: "same-origin" }).then((r) => (r.ok && /image\/(png|jpe?g)/.test(r.headers.get("content-type") || "") ? r.arrayBuffer() : null)).catch(() => null);
  logoCache = { key, bytes };
  return bytes;
}
export const logoUrl = () => (S.settings.logoKey ? fileUrl(S.settings.logoKey) : "/logo.png");
