// =====================================================================
// Screen helpers shared by every view: formatting, pills, the slide-up sheet,
// toasts, and a few icons.
// =====================================================================

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Money in your own currency (Setup, Tax & country). "$1,234.56" for NZD and AUD.
import { TAX } from "./calc.js";
let fmt = null, fmtKey = "";
export const money = (n) => {
  const k = TAX.locale + TAX.currency;
  if (k !== fmtKey) {
    try { fmt = new Intl.NumberFormat(TAX.locale, { style: "currency", currency: TAX.currency, currencyDisplay: "narrowSymbol" }); }
    catch { fmt = new Intl.NumberFormat("en-NZ", { style: "currency", currency: "NZD" }); }
    fmtKey = k;
  }
  return fmt.format(Math.round((Number(n) || 0) * 100) / 100);
};
// Plain number with 2 decimals in your locale: 1,234.56
export const amount = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(TAX.locale || "en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Short labels for chart axes: $0, $500, $2.5k, $10k
export const moneyShort = (n) => { const a = Math.abs(n); return (n < 0 ? "-$" : "$") + (a >= 1000 ? (a / 1000).toFixed(a % 1000 ? 1 : 0).replace(/\.0$/, "") + "k" : Math.round(a)); };

export const pill = (cls, text) => `<span class="pill ${cls}">${esc(text)}</span>`;

// ---------- Sheet: the panel that slides up for forms and details ----------
let sheetStack = [];
export function openSheet(html, { wide = false } = {}) {
  const card = $("#sheet-card");
  card.classList.toggle("wide", wide);
  card.innerHTML = html;
  $("#sheet").hidden = false;
  document.body.classList.add("sheet-open");
  card.scrollTop = 0;
  const f = card.querySelector("[autofocus]") || null;
  f?.focus();
}
export function closeSheet() {
  $("#sheet").hidden = true;
  $("#sheet-card").innerHTML = "";
  document.body.classList.remove("sheet-open");
  sheetStack = [];
  window.dispatchEvent(new Event("sheetclosed"));
}
export const sheetOpen = () => !$("#sheet").hidden;
export const sheetHead = (title, sub = "") => `<div class="sheet-head"><div><h2>${title}</h2>${sub ? `<p class="small muted">${sub}</p>` : ""}</div><button type="button" class="icon-btn" data-action="close" aria-label="Close">${icon("x")}</button></div>`;

// ---------- Toast ----------
export function toast(msg, ms = 2600) {
  const t = $("#toast"); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}

// Buttons that need a second tap to confirm (browsers' confirm() dialogs are clunky on phones)
export function confirmTap(el, label = "Tap again to confirm") {
  if (el.dataset.armed) return true;
  el.dataset.armed = "1"; const old = el.innerHTML; el.textContent = label;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.armed; el.innerHTML = old; } }, 3500);
  return false;
}

// Load a script from a CDN the first time it's needed (pdf-lib, pdf.js)
const scripts = {};
export function loadScript(src) {
  return (scripts[src] ||= new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => { delete scripts[src]; rej(new Error("Couldn't load " + src)); };
    document.head.appendChild(s);
  }));
}

// Copy text with a fallback for older phones
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copied"); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand("copy"); toast("Copied"); } catch { toast("Couldn't copy"); } t.remove(); }
}

// Share a file (phone share sheet: Mail, Messages, WhatsApp) or download it
export async function shareOrDownload(blob, filename, text = "") {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename, text }); return "shared"; }
    catch (e) { if (e.name === "AbortError") return "cancelled"; }
  }
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

// ---------- Icons (simple line icons, 24px grid) ----------
const ICONS = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  sales: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  bills: "M4 6h16v12H4zM4 10h16M8 15h3",
  bank: "M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18",
  products: "M3 7l9-4 9 4-9 4zM3 7v10l9 4 9-4V7M12 11v10",
  gst: "M5 3h14v18H5zM8 7h8M8 11h2M14 11h2M8 15h2M14 15h2",
  reports: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  setup: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  plus: "M12 5v14M5 12h14",
  x: "M6 6l12 12M18 6L6 18",
  camera: "M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  upload: "M12 16V4M7 9l5-5 5 5M4 20h16",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  eye: "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff: "M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.9 0 3.6-.6 5-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2",
  share: "M4 12v8h16v-8M12 3v13M7 8l5-5 5 5",
  print: "M6 9V3h12v6M6 18H4v-7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7h-2M6 14h12v7H6z",
  check: "M5 12l5 5L20 7",
  sync: "M21 12a9 9 0 0 1-15.5 6.2M3 12A9 9 0 0 1 18.5 5.8M21 4v5h-5M3 20v-5h5",
  chevron: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  box: "M21 8l-9-5-9 5v8l9 5 9-5zM3 8l9 5 9-5M12 13v8",
  mail: "M3 5h18v14H3zM3 6l9 7 9-7",
};
export const icon = (name, size = 20) => `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICONS[name] || ""}"/></svg>`;

// Empty state with a next step
export const empty = (text, action = "") => `<div class="empty"><p>${text}</p>${action}</div>`;
