// =====================================================================
// KP Books: app start-up, navigation and event wiring.
// Each screen lives in /js/views and registers its own buttons and forms.
// =====================================================================

import { S, loadAll, pullChanges, onChange, localSet, logoUrl } from "./store.js";
import { $, $$, esc, icon, closeSheet, sheetOpen, toast, openSheet, sheetHead, money } from "./ui.js";
import { periodKeyFor, periodLabel, fmtDate, invoicePay, todayStr, TAX } from "./calc.js";

// ---------- Screens ----------
// Each view module exports: render() -> HTML, and optionally actions/submits/changes/inputs.
const views = {};
const handlers = { actions: {}, submits: {}, changes: {}, inputs: {} };
export function register(name, mod) {
  views[name] = mod;
  for (const k of Object.keys(handlers)) Object.assign(handlers[k], mod[k] || {});
}

// Navigation. "tab" is shown in the phone's bottom bar; the rest sit under More.
export const NAV = [
  { id: "home", label: "Home", icon: "home", tab: true },
  { id: "sales", label: "Sales", icon: "sales", tab: true },
  { id: "bills", label: "Bills", icon: "bills", tab: true },
  { id: "bank", label: "Bank", icon: "bank", tab: true },
  { id: "products", label: "Products", icon: "products" },
  { id: "gst", label: "GST", icon: "gst" },
  { id: "reports", label: "Reports", icon: "reports" },
  { id: "setup", label: "Setup", icon: "setup" },
];

export const R = { view: "home" };     // current route

export function go(view) { if (location.hash !== "#" + view) location.hash = view; else render(); }

export function render() {
  if (!S.loaded) return;
  const v = views[R.view] || views.home;
  $("#view").innerHTML = v.render();
  v.after?.();
  // nav state
  $$("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.nav === R.view || (a.dataset.nav === "more" && !NAV.find((n) => n.id === R.view)?.tab)));
  $$("[data-nav]").forEach((a) => { if (a.hasAttribute("aria-current")) a.setAttribute("aria-current", "page"); });
  const curKey = periodKeyFor(todayStr(), S.settings);
  $("#biz-name").textContent = S.settings.businessName || "KP Books";
  $("#period-chip").textContent = `${TAX.taxName} ${periodLabel(curKey)}`;
  const logo = $(".side-logo"); if (logo && logo.getAttribute("src") !== logoUrl()) logo.src = logoUrl();
  $("#offline").hidden = !S.offline;
  document.documentElement.style.setProperty("--accent-brand", S.settings.accent || "#2c5a43");
}

// Re-render without losing the cursor in a search box
export function rerenderKeepFocus(id) {
  const el = document.getElementById(id), pos = el?.selectionStart;
  render();
  const n = document.getElementById(id);
  if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }
}

function route() {
  // "#products/stock" opens the Products screen on its Stock tab
  const [h, sub] = (location.hash.replace("#", "") || "home").split("/");
  R.view = views[h] || h === "more" ? h : "home";
  R.sub = sub || null;
  if (sheetOpen()) closeSheet();
  render();
  window.scrollTo(0, 0);
}

// ---------- Layout ----------
function shell() {
  const tabs = NAV.filter((n) => n.tab);
  document.body.insertAdjacentHTML("afterbegin", `
    <aside class="side" aria-label="Sections">
      <div class="side-brand"><img src="/logo.png" alt="" class="side-logo" onerror="this.hidden=true" onload="this.hidden=false"><span id="biz-switch-wrap"></span></div>
      ${NAV.map((n) => `<a href="#${n.id}" data-nav="${n.id}">${icon(n.icon)}<span>${n.label}</span></a>`).join("")}
    </aside>
    <header class="top">
      <div class="brand"><h1 id="biz-name">Books</h1><span class="chip" id="period-chip"></span><span class="chip warn" id="offline" hidden>Offline</span></div>
      <div class="row">
        <button class="icon-btn" data-action="privacy" id="privacy-btn" aria-pressed="false" aria-label="Hide costs and margins" title="Hide costs and margins">${icon("eye")}</button>
        <button class="icon-btn" data-action="search" aria-label="Search">${icon("search")}</button>
        <button class="btn primary new-btn" data-action="quick-new">${icon("plus", 18)}<span>New</span></button>
      </div>
    </header>
    <nav class="tabs" aria-label="Sections">
      ${tabs.map((n) => `<a href="#${n.id}" data-nav="${n.id}">${icon(n.icon, 22)}<span>${n.label}</span></a>`).join("")}
      <a href="#more" data-nav="more">${icon("more", 22)}<span>More</span></a>
    </nav>`);
}

// "More" screen for the phone
register("more", {
  render: () => `<section><h2>More</h2><div class="list">
    ${NAV.filter((n) => !n.tab).map((n) => `<a class="item link" href="#${n.id}"><span class="t">${icon(n.icon)} ${n.label}</span><span class="r">${icon("chevron", 18)}</span></a>`).join("")}
  </div></section>`,
});

// ---------- Quick add (the + New button) ----------
handlers.actions["quick-new"] = () => openSheet(`${sheetHead("New")}
  <div class="quick">
    <button data-action="new-invoice">${icon("sales")}<span><strong>Invoice</strong><small>Bill a customer</small></span></button>
    <button data-action="new-quote">${icon("sales")}<span><strong>Quote</strong><small>Price up a job</small></span></button>
    <label class="file-tile">${icon("camera")}<span><strong>Snap a receipt</strong><small>Use the camera</small></span><input type="file" accept="image/*" capture="environment" data-change="bill-file" id="quick-snap"></label>
    <label class="file-tile">${icon("upload")}<span><strong>Upload a bill</strong><small>PDF or photo</small></span><input type="file" accept="image/*,application/pdf,.eml,.txt" data-change="bill-file" id="quick-bill"></label>
    <button data-action="new-product">${icon("products")}<span><strong>Product</strong><small>Add to your catalogue</small></span></button>
    <button data-action="bill-manual">${icon("bills")}<span><strong>Expense</strong><small>Type it in</small></span></button>
  </div>`);

// ---------- Hide costs and margins (for showing someone the app) ----------
// Tap the eye in the header. Costs, margins and profit blur or hide until you tap it again.
// Remembered on this device only.
function applyPrivacy(on) {
  document.body.classList.toggle("private", on);
  const b = document.getElementById("privacy-btn");
  if (b) { b.setAttribute("aria-pressed", String(on)); b.innerHTML = icon(on ? "eyeOff" : "eye"); b.title = on ? "Show costs and margins" : "Hide costs and margins"; b.setAttribute("aria-label", b.title); }
}
handlers.actions.privacy = () => {
  const on = !document.body.classList.contains("private");
  try { localStorage.setItem("kp:private", on ? "1" : "0"); } catch {}
  applyPrivacy(on);
  toast(on ? "Costs and margins hidden" : "Costs and margins showing");
};

// ---------- Search everything ----------
handlers.actions.search = () => {
  openSheet(`${sheetHead("Search")}<input type="search" id="global-q" placeholder="Invoices, customers, bills, products, bank" autocomplete="off" autofocus><div id="global-results" class="list" style="margin-top:12px"></div>`);
  $("#global-q").focus();
};
handlers.inputs["global-q"] = (el) => {
  const q = el.value.trim().toLowerCase(), out = [];
  if (q.length >= 2) {
    for (const i of S.invoices.values()) if (`${i.number} ${i.customer?.name} ${i.customer?.email} ${i.reference} ${(i.lines || []).map((l) => l.name).join(" ")}`.toLowerCase().includes(q))
      out.push([i.date, `<button class="item" data-action="open-invoice" data-id="${esc(i._id)}"><span class="t">${esc(i.number)} · ${esc(i.customer?.name || "")}</span><span class="r">${money(i.total)}</span><span class="s">${i.type === "quote" ? "Quote" : "Invoice"} · ${fmtDate(i.date)}</span><span class="r small">${invoicePay(i).due > 0 ? "owing" : ""}</span></button>`]);
    for (const b of S.bills.values()) if (`${b.supplier} ${b.reference} ${b.description} ${b.category}`.toLowerCase().includes(q))
      out.push([b.date, `<button class="item" data-action="open-bill" data-id="${esc(b._id)}"><span class="t">${esc(b.supplier)}</span><span class="r">${money(b.total)}</span><span class="s">Bill · ${fmtDate(b.date)} · ${esc(b.category)}</span><span></span></button>`]);
    for (const p of S.products.values()) if (`${p.name} ${p.sku} ${p.ean || ""} ${p.group || ""} ${p.supplier || ""}`.toLowerCase().includes(q))
      out.push(["9999", `<button class="item" data-action="open-product" data-id="${esc(p._id)}"><span class="t">${esc(p.name)}</span><span class="r">${p.price ? money(p.price) : ""}</span><span class="s">Product · ${esc(p.sku || "")}</span><span></span></button>`]);
    for (const t of S.txns.values()) if (`${t.description} ${t.merchant}`.toLowerCase().includes(q) || String(Math.abs(t.amount)).startsWith(q))
      out.push([t.date, `<button class="item" data-action="open-txn" data-id="${esc(t._id)}"><span class="t">${esc(t.description)}</span><span class="r">${money(t.amount)}</span><span class="s">Bank · ${fmtDate(t.date)}</span><span></span></button>`]);
  }
  out.sort((a, b) => b[0].localeCompare(a[0]));
  $("#global-results").innerHTML = q.length < 2 ? "" : out.length ? out.slice(0, 60).map((x) => x[1]).join("") : `<div class="empty small">Nothing found for "${esc(el.value)}"</div>`;
};

// ---------- Event wiring: one listener per event type for the whole app ----------
document.addEventListener("click", async (ev) => {
  if (ev.target.id === "sheet") { closeSheet(); return; }
  const el = ev.target.closest("[data-action]");
  if (!el || el.tagName === "INPUT" || el.tagName === "SELECT") return;
  const a = el.dataset.action;
  if (a === "close") { closeSheet(); return; }
  const fn = handlers.actions[a];
  if (!fn) return;
  ev.preventDefault();
  try { await fn(el, ev); } catch (e) { console.error(e); toast(e.message || "Something went wrong"); }
});
document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target, fn = handlers.submits[f.id];
  if (!fn) return;
  const btn = f.querySelector("button[type=submit]"); if (btn) btn.disabled = true;
  try { await fn(f, ev); } catch (e) { console.error(e); toast(e.message || "Couldn't save"); }
  finally { if (btn?.isConnected) btn.disabled = false; }
});
document.addEventListener("change", async (ev) => {
  const el = ev.target;
  const fn = handlers.changes[el.dataset.change] || handlers.changes[el.id];
  if (fn) try { await fn(el, ev); } catch (e) { console.error(e); toast(e.message || "Something went wrong"); }
});
document.addEventListener("input", (ev) => {
  const el = ev.target;
  const fn = handlers.inputs[el.dataset.input] || handlers.inputs[el.id];
  if (fn) fn(el, ev);
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && sheetOpen()) closeSheet(); });
window.addEventListener("hashchange", route);

// When new data arrives (a Shopify order, a change from your phone), refresh the screen
// unless you're in the middle of a form.
onChange((records) => {
  if (!sheetOpen()) render();
  const orders = records.filter((r) => r.kind === "invoice" && r.data?.source === "shopify" && !r.deleted);
  if (orders.length === 1) toast(`New Shopify order ${orders[0].data.number}`);
  else if (orders.length > 1) toast(`${orders.length} Shopify orders updated`);
});

// ---------- Start ----------
export async function start() {
  shell();
  { let on = false; try { on = localStorage.getItem("kp:private") === "1"; } catch {} applyPrivacy(on); }
  try {
    await loadAll();
    route();
  } catch (e) {
    $("#view").innerHTML = `<section><div class="banner bad"><p><strong>Couldn't load your books.</strong> ${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></section>`;
  }
  // Installable app: cache the screens so it opens fast and works with a weak signal
  if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register("/sw.js").catch(() => {});
}

// Switching business (e.g. the ice bath brand)
handlers.changes["biz-switch"] = async (el) => {
  if (el.value === "__new") { el.value = S.biz; handlers.actions["new-biz"]?.(); return; }
  S.biz = el.value; localSet("biz", S.biz);
  $("#view").innerHTML = `<section><div class="empty">Loading…</div></section>`;
  await loadAll(); render();
};
