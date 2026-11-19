// Products: catalogue, costs with and without freight, stock levels,
// and loading a supplier invoice (pick the lines, choose how freight is shared).
import { S, save, remove, saveMany, api, uploadFile, localSet, localGet } from "../store.js";
import { R, register, render, rerenderKeepFocus } from "../app.js";
import { $, $$, esc, money, pill, icon, openSheet, closeSheet, sheetHead, toast, confirmTap, empty, sheetOpen } from "../ui.js";
import { todayStr, addDays, fmtDate, fmtShort, r2, num, slug, GST_RATE, stockOnHand, makeProductFinder, counts, SERVICE_LINE, productCosts, withNewCost, onOrder, isListCost, HOME, TAX } from "../calc.js";
import * as Orders from "./orders.js";

// Remembered per device: which tab, and whether costs show with or without freight
const V = { q: "", sort: "name", tab: "catalogue", costView: safeGet("costView") || "landed", stockFilter: "all" };
function safeGet(k) { try { return localStorage.getItem("kp:" + k); } catch { return null; } }

function unitsSold(p, since = "") {
  const find = makeProductFinder(new Map([["x", p]]));
  let n = 0;
  for (const inv of S.invoices.values()) if (counts(inv) && inv.date >= since) for (const l of inv.lines || []) if (find(l)) n += l.qty || 0;
  return n;
}
// Margin % at the list price, using whichever cost view is on
const marginPct = (price, cost) => (price > 0 && cost > 0 ? Math.round(((price / (1 + GST_RATE) - cost) / (price / (1 + GST_RATE))) * 100) : null);
const shownCost = (p) => { const c = productCosts(p); return V.costView === "ex" ? c.exFreight : c.landed; };
const isLow = (p, onHand) => onHand != null && p.reorderAt !== "" && p.reorderAt != null && onHand <= Number(p.reorderAt);

// ---------- Main screen ----------
function render_() {
  if (R.sub && ["catalogue", "stock", "orders"].includes(R.sub)) { V.tab = R.sub; R.sub = null; }
  const tabs = `<div class="seg" role="tablist">
    ${[["catalogue", "Catalogue"], ["stock", "Stock"], ["orders", "Orders"]].map(([k, l]) => `<button role="tab" data-action="prod-tab" data-tab="${k}" aria-selected="${V.tab === k}">${l}</button>`).join("")}</div>`;
  const head = `<div class="spread"><h2>Products</h2><div class="row">
      <label class="btn primary file small-btn">${icon("upload", 16)} Supplier invoice<input type="file" accept="image/*,application/pdf" data-change="supplier-file" id="supplier-file"></label>
      <label class="btn file small-btn">${icon("upload", 16)} Price list<input type="file" accept="application/pdf,image/*,.csv,.txt,.xlsx,.xls,.ods" data-change="price-list-file" id="price-list-file"></label>
      <button class="btn small-btn" data-action="new-product">${icon("plus", 16)} Product</button>
    </div></div>`;
  return `<section>${head}${tabs}${V.tab === "stock" ? stockView() : V.tab === "orders" ? Orders.ordersView() : catalogueView()}</section>`;
}

function catalogueView() {
  const q = V.q.toLowerCase();
  const yearAgo = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  let items = [...S.products.values()].map((p) => ({ ...p, onHand: stockOnHand(p, S), sold: unitsSold(p, yearAgo), c: productCosts(p) }));
  items.forEach((p) => (p.m = marginPct(p.price, V.costView === "ex" ? p.c.exFreight : p.c.landed)));
  if (q) items = items.filter((p) => `${p.name} ${p.sku} ${p.supplier || ""}`.toLowerCase().includes(q));
  items.sort(V.sort === "sold" ? (a, b) => b.sold - a.sold : V.sort === "margin" ? (a, b) => (a.m ?? 999) - (b.m ?? 999) : (a, b) => (a.name || "").localeCompare(b.name || ""));
  const noCost = [...S.products.values()].filter((p) => !(p.cost > 0)).length;

  // Products sold that aren't in the catalogue yet
  const known = makeProductFinder(S.products), missing = new Set();
  for (const inv of S.invoices.values()) for (const l of inv.lines || []) if (!known(l) && !SERVICE_LINE.test(l.name || "")) missing.add(slug(l.sku || l.name));

  return `
    ${missing.size ? `<div class="banner"><p>${missing.size} product${missing.size > 1 ? "s" : ""} you've sold ${missing.size > 1 ? "aren't" : "isn't"} in your catalogue yet.</p><button class="btn" data-action="add-missing">Add ${missing.size}</button></div>` : ""}
    ${noCost ? `<p class="small muted">${noCost} product${noCost > 1 ? "s have" : " has"} no cost yet, so margins on ${noCost > 1 ? "them" : "it"} can't be worked out.</p>` : ""}
    <div class="row">
      <input type="search" id="products-q" class="search" placeholder="Search name, SKU, supplier" value="${esc(V.q)}">
      <select id="products-sort" aria-label="Sort">${[["name", "A to Z"], ["sold", "Best sellers"], ["margin", "Lowest margin"]].map(([k, l]) => `<option value="${k}" ${V.sort === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <div class="seg small-seg" role="group" aria-label="Show cost">
        <button data-action="cost-view" data-v="landed" aria-selected="${V.costView === "landed"}">With freight</button>
        <button data-action="cost-view" data-v="ex" aria-selected="${V.costView === "ex"}">Without freight</button>
      </div>
    </div>
    ${items.length ? `<div class="tablewrap"><table class="prod">
      <thead><tr><th>Product</th><th class="n pv-hide">Cost ${V.costView === "ex" ? "ex freight" : "landed"}</th><th class="n hide-sm pv-hide">Freight</th><th class="n">Sell incl GST</th><th class="n pv-hide">Margin</th><th class="n hide-sm">Stock</th></tr></thead>
      <tbody>${items.map((p) => `<tr data-action="open-product" data-id="${esc(p._id)}" class="click">
        <td><strong>${esc(p.name || p.sku)}</strong>${p.example ? " " + pill("warn", "example") : ""}<div class="small muted mono">${esc(p.sku || "no SKU")}${p.supplier ? ` · ${esc(p.supplier)}` : ""}</div></td>
        <td class="n pv-hide">${p.cost > 0 ? money(V.costView === "ex" ? p.c.exFreight : p.c.landed) : `<span class="muted">–</span>`}</td>
        <td class="n hide-sm muted pv-hide">${p.c.freight ? money(p.c.freight) : "–"}</td>
        <td class="n" data-pre="Sells ">${p.price ? money(p.price) : `<span class="muted">–</span>`}</td>
        <td class="n pv-hide">${p.m != null ? pill(p.m >= 30 ? "good" : p.m >= 15 ? "warn" : "bad", p.m + "%") : ""}</td>
        <td class="n hide-sm">${p.onHand != null ? (isLow(p, p.onHand) ? pill("bad", String(p.onHand)) : p.onHand) : `<span class="muted">–</span>`}</td>
      </tr>`).join("")}</tbody></table></div>`
      : `<div class="list">${empty(q ? "No products match." : "No products yet. Upload a supplier invoice and every model, SKU and cost loads in one go.")}</div>`}`;
}

// ---------- Stock ----------
function stockView() {
  const all = [...S.products.values()].map((p) => ({ ...p, onHand: stockOnHand(p, S), c: productCosts(p) })).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const tracked = all.filter((p) => p.onHand != null), untracked = all.filter((p) => p.onHand == null);
  const low = tracked.filter((p) => isLow(p, p.onHand));
  const valueLanded = tracked.reduce((a, p) => a + Math.max(0, p.onHand) * p.c.landed, 0);
  const valueEx = tracked.reduce((a, p) => a + Math.max(0, p.onHand) * p.c.exFreight, 0);
  const list = V.stockFilter === "low" ? low : tracked;
  return `
    <div class="mini-tiles">
      <div><span class="label">Units on hand</span><span class="num">${tracked.reduce((a, p) => a + Math.max(0, p.onHand), 0)}</span></div>
      <div><span class="label">Stock value</span><span class="num">${money(valueLanded)}</span><span class="small muted">${money(valueEx)} ex freight</span></div>
      <div><span class="label">Low stock</span><span class="num">${low.length}</span></div>
    </div>
    ${untracked.length && tracked.length ? `<p class="small muted">Value is for the ${tracked.length} product${tracked.length > 1 ? "s" : ""} you track, at landed cost. ${untracked.length} aren't tracked yet (see the bottom of this list).</p>` : ""}
    ${low.length ? `<div class="banner"><p>${low.length} product${low.length > 1 ? "s are" : " is"} at or below the reorder level.</p><button class="btn primary" data-action="reorder-low">Draft an order</button></div>` : ""}
    <div class="chips"><button class="chip-btn" data-action="stock-filter" data-f="all" aria-pressed="${V.stockFilter === "all"}">All tracked</button>
      <button class="chip-btn" data-action="stock-filter" data-f="low" aria-pressed="${V.stockFilter === "low"}">Low stock${low.length ? ` (${low.length})` : ""}</button></div>
    ${list.length ? `<div class="list">${list.map((p) => `<div class="stock-row">
        <button class="stock-name" data-action="stock-history" data-id="${esc(p._id)}"><strong>${esc(p.name)}</strong><span class="small muted mono">${esc(p.sku || "")}${p.onHand > 0 && p.c.landed ? ` · ${money(p.onHand * p.c.landed)}` : ""}${p.reorderAt !== "" && p.reorderAt != null ? ` · reorder at ${esc(p.reorderAt)}` : ""}${onOrder(p._id, S) ? ` · ${onOrder(p._id, S)} on order` : ""}</span></button>
        <div class="stepper">
          <button class="icon-btn" data-action="stock-adj" data-id="${esc(p._id)}" data-n="-1" aria-label="One less">−</button>
          <span class="qty ${isLow(p, p.onHand) ? "low" : ""}">${p.onHand}</span>
          <button class="icon-btn" data-action="stock-adj" data-id="${esc(p._id)}" data-n="1" aria-label="One more">+</button>
        </div>
        <button class="btn small-btn" data-action="stock-count" data-id="${esc(p._id)}">Count</button>
      </div>`).join("")}</div>`
      : `<div class="list">${empty(V.stockFilter === "low" ? "Nothing is low. Nice." : "No products are being tracked yet. Start below, or tick \"Add to stock\" when you import a supplier invoice.")}</div>`}
    ${untracked.length ? `<details><summary>Not tracking stock (${untracked.length})</summary><div class="list flat">${untracked.map((p) => `<div class="item static"><span class="t">${esc(p.name)}</span><span class="r"><button class="btn small-btn" data-action="stock-count" data-id="${esc(p._id)}">Start tracking</button></span><span class="s mono">${esc(p.sku || "")}</span><span></span></div>`).join("")}</div></details>` : ""}
    <p class="small muted">Stock goes down by itself when you sell (Shopify or your own invoices) and up when you import a supplier invoice. Use + and − for breakages, samples or returns, and Count after a stocktake.</p>`;
}

// History for one product: the count, deliveries, adjustments and sales since
function stockHistory(id) {
  const p = S.products.get(id); if (!p) return;
  const onHand = stockOnHand(p, S);
  const rows = [];
  if (p.countDate) rows.push({ date: p.countDate, qty: Number(p.countQty) || 0, text: "Counted", count: true });
  for (const mv of S.stockmoves.values()) if (mv.product === id && mv.date > (p.countDate || "")) rows.push({ date: mv.date, qty: Number(mv.qty), text: mv.reason || "Adjusted", mv: mv._id });
  const find = makeProductFinder(new Map([[id, p]]));
  for (const inv of S.invoices.values()) if (counts(inv) && inv.status !== "refunded" && inv.date > (p.countDate || "9999"))
    for (const l of inv.lines || []) if (find(l)) rows.push({ date: inv.date, qty: -(Number(l.qty) || 0), text: `Sold · ${inv.number} ${inv.customer?.name || ""}` });
  rows.sort((a, b) => b.date.localeCompare(a.date) || (a.count ? 1 : -1));
  openSheet(`${sheetHead(esc(p.name), onHand != null ? `${onHand} on hand` : "Not tracking stock")}
    <div class="row"><button class="btn primary" data-action="stock-count" data-id="${esc(id)}">Count stock</button><button class="btn" data-action="stock-move" data-id="${esc(id)}">Add or remove units</button><button class="btn" data-action="open-product" data-id="${esc(id)}">Edit product</button></div>
    <div class="list">${rows.map((r) => `<div class="item static"><span class="t">${esc(r.text)}</span><span class="r ${r.qty > 0 && !r.count ? "pos" : ""}">${r.count ? "= " + r.qty : (r.qty > 0 ? "+" : "") + r.qty}</span>
      <span class="s">${fmtDate(r.date)}</span><span class="r">${r.mv ? `<button class="icon-btn danger" data-action="stock-undo" data-id="${esc(r.mv)}" data-p="${esc(id)}" aria-label="Remove this change">${icon("x", 16)}</button>` : ""}</span></div>`).join("") || empty("No history yet.")}</div>`);
}
function countForm(id) {
  const p = S.products.get(id), onHand = stockOnHand(p, S);
  openSheet(`${sheetHead(`Count ${esc(p.name)}`, onHand != null ? `The app thinks there are ${onHand}` : "Start tracking stock for this product")}
    <form id="count-form" data-id="${esc(id)}" class="form">
      <div class="grid2">
        <label class="field"><span>Units on the shelf now</span><input id="cnt-qty" type="number" step="1" inputmode="numeric" value="${onHand ?? ""}" required autofocus></label>
        <label class="field"><span>Warn me at or below</span><input id="cnt-reorder" type="number" step="1" inputmode="numeric" value="${esc(p.reorderAt ?? "")}" placeholder="e.g. 2"></label>
      </div>
      <p class="small muted">From today, sales take stock off this number and deliveries add to it.</p>
      <button class="btn primary wide" type="submit">Save count</button>
    </form>`);
}
function moveForm(id) {
  const p = S.products.get(id);
  openSheet(`${sheetHead(`Add or remove ${esc(p.name)}`)}
    <form id="move-form" data-id="${esc(id)}" class="form">
      <div class="grid3">
        <label class="field"><span>Units (minus to remove)</span><input id="mv-qty" type="number" step="1" inputmode="numeric" required autofocus placeholder="-1"></label>
        <label class="field"><span>Date</span><input id="mv-date" type="date" value="${todayStr()}" required></label>
        <label class="field"><span>Reason</span><select id="mv-reason"><option>Delivery</option><option>Customer return</option><option>Damaged</option><option>Display or sample</option><option>Used ourselves</option><option>Other</option></select></label>
      </div>
      <button class="btn primary wide" type="submit">Save</button>
    </form>`);
}

// ---------- Product form ----------
function productForm(id) {
  const p = id ? S.products.get(id) : { name: "", sku: "", cost: 0, price: 0, calc: {} };
  const k = p.calc || {}, c = productCosts(p), cur = p.currency || "EUR";
  const inc = localGet("costIncGst") === "1";
  // Freight as a % of cost if it was saved that way, otherwise $ per unit
  const frPct = k.freightPct != null && k.freightPct !== "";
  const priceEx = p.price ? r2(p.price / (1 + GST_RATE)) : "";
  openSheet(`${sheetHead(id ? esc(p.name) : "New product", id ? `${unitsSold(p)} sold all time${p.supplier ? " · from " + esc(p.supplier) : ""}${p.lastInvoice ? `, invoice ${esc(p.lastInvoice)}` : ""}` : "")}
    <form id="product-form" data-id="${esc(id || "")}" class="form">
      <div class="grid2">
        <label class="field"><span>Name</span><input id="p-name" value="${esc(p.name)}" required></label>
        <label class="field"><span>SKU</span><input id="p-sku" value="${esc(p.sku)}"></label>
      </div>
      <div class="card pv-hide">
        <div class="spread"><span class="label">Cost per unit</span>
          <label class="check small"><input type="checkbox" id="p-incgst" ${inc ? "checked" : ""}> Show costs incl GST</label></div>
        <div class="grid3">
          <label class="field"><span>List price (${esc(cur)})</span><input id="k-list" type="number" step="0.01" inputmode="decimal" value="${p.listPrice ?? ""}" placeholder="optional"></label>
          <label class="field"><span>Your discount %</span><input id="k-disc" type="number" step="0.5" min="0" max="100" inputmode="decimal" value="${p.discountPct ?? ""}" placeholder="0"></label>
          <label class="field"><span>Your net price (${esc(cur)})</span><input id="k-eur" type="number" step="0.01" inputmode="decimal" value="${k.eur ?? ""}" placeholder="optional"></label>
          <label class="field"><span>Currency</span><input id="k-cur" value="${esc(cur)}" maxlength="3"></label>
          <label class="field"><span>Rate: 1 ${esc(cur)} in ${HOME()}</span><input id="k-fx" type="number" step="0.0001" inputmode="decimal" value="${k.fx ?? ""}" placeholder="1.9500"></label>
          <label class="field"><span>Duty %</span><input id="k-duty" type="number" step="0.1" inputmode="decimal" value="${k.duty ?? ""}" placeholder="0"></label>
          <label class="field"><span>Cost ex freight, ${HOME()}</span><input id="p-costex" type="number" step="0.01" inputmode="decimal" value="${c.exFreight || ""}"></label>
          <label class="field"><span>Freight</span><span class="field-pair">
            <input id="k-freight" type="number" step="0.01" inputmode="decimal" value="${frPct ? k.freightPct : (c.freight || "")}" placeholder="0">
            <select id="k-frmode" aria-label="Freight as"><option value="nzd">$ per unit</option><option value="pct" ${frPct ? "selected" : ""}>% of cost</option></select></span></label>
        </div>
        <div class="cost-split">
          <div><span class="label" id="lbl-ex">Without freight</span><strong class="num" id="out-ex">–</strong><span class="small muted" id="out-ex2"></span></div>
          <div><span class="label" id="lbl-landed">Landed (with freight)</span><strong class="num" id="out-landed">–</strong><span class="small muted" id="out-landed2"></span></div>
        </div>
        <p class="small muted" id="k-note">List price less your discount gives your net price. Or type the net price, or the ${HOME()} cost straight in.</p>
      </div>
      <div class="card">
        <span class="label">Selling price</span>
        <div class="grid3">
          <label class="field"><span>Ex GST</span><input id="p-priceex" type="number" step="0.01" inputmode="decimal" value="${priceEx}"></label>
          <label class="field"><span>Incl GST</span><input id="p-price" type="number" step="0.01" inputmode="decimal" value="${p.price || ""}"></label>
          <label class="field pv-hide"><span>Margin % (on landed)</span><input id="p-mpct" type="number" step="0.1" inputmode="decimal" placeholder="e.g. 40"></label>
        </div>
        <div class="cost-split margin-split pv-hide">
          <div><span class="label">Profit per unit</span><strong class="num" id="out-profit">–</strong><span class="small muted" id="out-profit2"></span></div>
          <div><span class="label">Markup on cost</span><strong class="num" id="out-markup">–</strong><span class="small muted" id="out-markup2"></span></div>
        </div>
        <p class="small muted">Type either price, or a margin % to set the price from your landed cost.</p>
      </div>
      ${costHistoryBlock(p, id)}
      <label class="field"><span>Other codes or names it sells under</span><input id="p-aliases" value="${esc((p.aliases || []).join(", "))}" placeholder="e.g. an old SKU, or the Shopify title"><span class="small muted">Comma between each. Sales with any of these use this product's cost.</span></label>
      <label class="field"><span>Warn me when stock is at or below</span><input id="p-reorder" type="number" step="1" value="${esc(p.reorderAt ?? "")}"></label>
      <button class="btn primary wide" type="submit">Save product</button>
      ${id ? `<div class="row"><button type="button" class="btn" data-action="stock-history" data-id="${esc(id)}">Stock history</button><button type="button" class="btn danger" data-action="delete-product" data-id="${esc(id)}">Delete</button></div>` : ""}
    </form>`);
  updateProductForm();
}
// Every cost this product has had, newest first. Remove one that was recorded against the wrong product.
function costHistoryBlock(p, id) {
  const hist = [...(p.costHistory || [])].sort((a, b) => (b.from || "").localeCompare(a.from || ""));
  if (!id || !hist.length) return "";
  const label = (e) => isListCost(p, e) ? "price list (estimate)" : e.source === "invoice" ? "supplier invoice" : e.from === "2000-01-01" ? "starting cost" : "typed in";
  return `<details class="card pv-hide"><summary class="label">Cost history (${hist.length})</summary>
    <div class="list flat">${hist.map((e) => `<div class="item static"><span class="t">${e.from === "2000-01-01" ? "From the start" : "From " + fmtDate(e.from)}</span><span class="r num">${money(e.landed)}</span>
      <span class="s small">${label(e)} · ${money(e.exFreight)} + ${money(e.freight)} freight</span>
      <span class="r"><button type="button" class="icon-btn danger" data-action="cost-del" data-id="${esc(id)}" data-from="${esc(e.from)}" aria-label="Remove this cost">${icon("x", 16)}</button></span></div>`).join("")}</div>
    <p class="small muted">Each sale uses the latest real cost on or before its date.</p></details>`;
}
// Read the cost fields. List price and discount set the net price; net price and rate set the NZD cost;
// otherwise the NZD cost you typed. Freight is $ per unit or a % of the cost ex freight.
function formCosts() {
  const list = num($("#k-list")?.value), disc = num($("#k-disc")?.value);
  const eur = list ? r2(list * (1 - disc / 100)) : num($("#k-eur")?.value);
  const fx = num($("#k-fx")?.value), duty = num($("#k-duty")?.value);
  const pct = $("#k-frmode")?.value === "pct", frIn = num($("#k-freight")?.value);
  const ex = eur && fx ? r2(eur * fx * (1 + duty / 100)) : r2(num($("#p-costex")?.value));
  const freight = pct ? r2(ex * frIn / 100) : r2(frIn);
  const calc = eur && fx ? { eur, fx, duty, freight, ...(pct ? { freightPct: frIn } : {}) } : (pct ? { freightPct: frIn } : {});
  return { calc, list, disc, exFreight: ex, freight, landed: r2(ex + freight) };
}
// Which price box you last typed in, so the others follow it
let priceFrom = "inc";
function updateProductForm(src) {
  if (!$("#product-form")) return;
  const c = formCosts(), auto = !!c.calc.eur, g = 1 + GST_RATE, inc = $("#p-incgst").checked;
  // Net price follows list less discount
  const ke = $("#k-eur"); ke.readOnly = !!c.list; if (c.list) ke.value = c.calc.eur ? c.calc.eur.toFixed(2) : r2(c.list * (1 - c.disc / 100)).toFixed(2);
  const ce = $("#p-costex"); ce.readOnly = auto; if (auto) ce.value = c.exFreight.toFixed(2);
  // Costs: ex GST, or incl GST if ticked (the other shown underneath)
  const show = (n) => (n ? money(inc ? n * g : n) : "–");
  const other = (n) => (n ? `${money(inc ? n : n * g)} ${inc ? "ex" : "incl"} GST` : "");
  $("#lbl-ex").textContent = `Without freight${inc ? ", incl GST" : ""}`;
  $("#lbl-landed").textContent = `Landed${inc ? ", incl GST" : " (with freight)"}`;
  $("#out-ex").textContent = show(c.exFreight); $("#out-ex2").textContent = other(c.exFreight);
  $("#out-landed").textContent = show(c.landed); $("#out-landed2").textContent = other(c.landed);
  $("#out-landed2").textContent += c.freight && $("#k-frmode").value === "pct" ? ` · freight ${money(c.freight)}` : "";

  // Selling price: whichever box you typed in drives the other two
  const pe = $("#p-priceex"), pi = $("#p-price"), pm = $("#p-mpct");
  if (src === "p-priceex") priceFrom = "ex"; else if (src === "p-price") priceFrom = "inc"; else if (src === "p-mpct") priceFrom = "margin";
  if (priceFrom === "margin" && pm.value !== "" && c.landed) {
    const m = num(pm.value);
    if (m < 100) { const ex = r2(c.landed / (1 - m / 100)); pe.value = ex.toFixed(2); pi.value = r2(ex * g).toFixed(2); }
  } else if (priceFrom === "ex") pi.value = pe.value === "" ? "" : r2(num(pe.value) * g).toFixed(2);
  else if (src === "p-price" || !src) pe.value = pi.value === "" ? "" : r2(num(pi.value) / g).toFixed(2);
  const ex = num(pe.value);
  if (priceFrom !== "margin") pm.value = ex && c.landed ? (Math.round(((ex - c.landed) / ex) * 1000) / 10).toString() : "";
  // Profit and markup, landed and before freight
  $("#out-profit").textContent = ex && c.landed ? money(ex - c.landed) : "–";
  $("#out-profit2").textContent = ex && c.exFreight ? `${money(ex - c.exFreight)} before freight (${Math.round(((ex - c.exFreight) / ex) * 1000) / 10}%)` : "";
  $("#out-markup").textContent = ex && c.landed ? `${Math.round(((ex - c.landed) / c.landed) * 1000) / 10}%` : "–";
  $("#out-markup2").textContent = ex ? "All ex GST" : "";
}

// ---------- Supplier invoice import ----------
let sup = null;
async function handleSupplierFile(file) {
  if (!S.me?.integrations?.ai) { toast("Connect Claude first (setup guide step 7: your Anthropic key in Cloudflare) to read supplier invoices."); return; }
  openSheet(`${sheetHead("Reading supplier invoice")}<div class="reading"><div class="spinner"></div><p>Claude is reading every line of ${esc(file.name)}. Long invoices take a minute or two.</p></div>`);
  try {
    const fileKey = await uploadFile(file);
    const o = await api("ai/read", { method: "POST", body: { mode: "supplier", fileKey } });
    if (sheetOpen()) supplierReview(o, fileKey, file.name);
  } catch (e) {
    if (sheetOpen()) openSheet(`${sheetHead("Couldn't read that invoice")}<p>${esc(e.message)}</p><p class="small muted">Try a clearer scan or the original PDF.</p>`);
  }
}
export function supplierReview(o, fileKey, fileName, opts = {}) {
  const lines = (Array.isArray(o?.lines) ? o.lines : []).filter((l) => l && l.name);
  const items = lines.filter((l) => l.kind !== "freight" && l.kind !== "other");
  const cur = String(o?.currency || "EUR").toUpperCase();
  const freightCur = num(o?.freight) + lines.filter((l) => l.kind === "freight").reduce((a, l) => a + num(l.unitPrice) * (num(l.qty) || 1), 0);
  const lastFx = [...S.products.values()].filter((p) => (p.currency || "EUR") === cur).map((p) => p.calc?.fx).filter(Boolean).pop() || "";
  sup = { supplier: o?.supplier || "", invoiceNumber: o?.invoiceNumber || "", date: o?.date || todayStr(), currency: cur, fileKey, fileName, freightCur,
    items: items.map((l) => ({ name: String(l.name).trim(), sku: String(l.sku || "").trim(), qty: num(l.qty) || 1, unit: num(l.unitPrice), productId: l.productId || null, poLine: l.poLine })),
    overrides: {}, poId: opts.poId || null };
  // Match each line to a product you already have (by SKU, then name)
  const find = makeProductFinder(S.products, { strict: true });
  sup.items.forEach((it) => { it.productId ||= find({ sku: it.sku, name: it.name })?._id || null; });
  const anyNew = sup.items.some((it) => !it.productId);
  openSheet(`${sheetHead("Add products", `${esc(sup.supplier)}${sup.invoiceNumber ? " · " + esc(sup.invoiceNumber) : ""} · ${fmtDate(sup.date)} · ${sup.items.length} item${sup.items.length === 1 ? "" : "s"} in ${esc(cur)}`)}
    ${o?.note ? `<div class="banner"><p class="small">${esc(o.note)}</p></div>` : ""}
    <form id="supplier-form" class="form">
      <div class="card">
        <span class="label">Exchange rate and duty</span>
        <div class="grid2">
          <label class="field"><span>1 ${esc(cur)} in ${HOME()}</span><input id="sup-fx" type="number" step="0.0001" inputmode="decimal" value="${cur === HOME() ? 1 : esc(lastFx)}" placeholder="1.9500" required></label>
          <label class="field"><span>Duty %</span><input id="sup-duty" type="number" step="0.1" inputmode="decimal" value="0"></label>
        </div>
        <p class="small muted">Use the rate your bank actually charged.</p>
      </div>
      <div class="card">
        <span class="label">Freight</span>
        <div class="grid2">
          <label class="field"><span>How to load freight</span><select id="sup-fmethod">
            <option value="value">Share by value (dearer items carry more)</option>
            <option value="units">Share evenly per unit</option>
            <option value="pct">Percentage of each item's cost</option>
            <option value="none">No freight on these</option>
          </select></label>
          <label class="field" id="sup-ftotal-wrap"><span>Total freight to you, ${HOME()}</span><input id="sup-freight" type="number" step="0.01" inputmode="decimal" placeholder="${freightCur ? `on invoice: ${cur} ${freightCur.toFixed(2)}` : "e.g. 1450.00"}"></label>
          <label class="field" id="sup-fpct-wrap" hidden><span>Freight %</span><input id="sup-fpct" type="number" step="0.1" inputmode="decimal" placeholder="e.g. 12"></label>
        </div>
        <p class="small muted" id="sup-fnote">Include sea or air freight, clearance and local cartage. Not GST paid to Customs. You can change any item's freight below.</p>
      </div>
      <div class="spread"><span class="label">Items</span><div class="chips">
        <button type="button" class="chip-btn" data-action="sup-pick" data-p="all">All</button>
        <button type="button" class="chip-btn" data-action="sup-pick" data-p="none">None</button>
        ${anyNew ? `<button type="button" class="chip-btn" data-action="sup-pick" data-p="new">New only</button>` : ""}
      </div></div>
      <div class="list">${sup.items.map((it, i) => {
        const ex = it.productId ? S.products.get(it.productId) : null;
        return `<div class="sup-item" data-i="${i}">
          <div class="spread"><label class="check"><input type="checkbox" class="sup-on" data-i="${i}" checked><strong>${esc(it.name)}</strong></label>${ex ? pill("mute", "updates existing") : pill("good", "new")}</div>
          <div class="sup-grid">
            <label class="field"><span>SKU</span><input id="sup-sku-${i}" value="${esc(it.sku)}"></label>
            <label class="field"><span>Qty</span><input id="sup-qty-${i}" type="number" step="1" inputmode="numeric" value="${esc(it.qty)}"></label>
            <label class="field"><span>Unit ${esc(cur)}</span><input id="sup-unit-${i}" type="number" step="0.01" inputmode="decimal" value="${esc(it.unit)}"></label>
            <label class="field"><span>Freight/unit ${HOME()}</span><input id="sup-fr-${i}" class="sup-fr" data-i="${i}" type="number" step="0.01" inputmode="decimal"></label>
            <label class="field"><span>Sell incl GST</span><input id="sup-sell-${i}" type="number" step="0.01" inputmode="decimal" value="${ex?.price || ""}" placeholder="optional"></label>
          </div>
          <div class="sup-costs small" id="sup-cost-${i}"></div>
        </div>`;
      }).join("")}</div>
      <div class="card">
        <label class="check"><input type="checkbox" id="sup-stock" checked> Add the quantities to stock</label>
        <p class="small muted">Products you aren't tracking yet start tracking from this delivery.</p>
        <label class="check"><input type="checkbox" id="sup-bill"> Also save as a stock purchase bill (no NZ GST)</label>
      </div>
      <p class="small" id="sup-summary"></p>
      <button class="btn primary wide" type="submit" id="sup-save">Save products</button>
      <p class="status" id="sup-status"></p>
    </form>`, { wide: true });
  updateSupplier();
}

// Work out each line's costs from the form. Freight is shared across every line
// on the invoice (ticked or not), because it all came in the same shipment.
function supplierCosts() {
  const fx = num($("#sup-fx")?.value), duty = num($("#sup-duty")?.value), method = $("#sup-fmethod")?.value || "value";
  const fIn = $("#sup-freight")?.value, pct = num($("#sup-fpct")?.value);
  const totalFreight = fIn ? num(fIn) : r2(sup.freightCur * fx);
  const rows = sup.items.map((it, i) => ({ unit: num($("#sup-unit-" + i)?.value ?? it.unit), qty: num($("#sup-qty-" + i)?.value ?? it.qty) }));
  const value = rows.reduce((a, r) => a + r.unit * r.qty, 0), units = rows.reduce((a, r) => a + r.qty, 0);
  return rows.map((r, i) => {
    const ex = r2(r.unit * fx * (1 + duty / 100));
    let auto = 0;
    if (method === "value") auto = value > 0 ? (totalFreight * r.unit) / value : 0;
    else if (method === "units") auto = units > 0 ? totalFreight / units : 0;
    else if (method === "pct") auto = ex * pct / 100;
    const override = sup.overrides[i];
    const freight = r2(override != null ? override : auto);
    return { unit: r.unit, qty: r.qty, fx, duty, auto: r2(auto), freight, overridden: override != null, exFreight: ex, landed: fx ? r2(ex + freight) : 0 };
  });
}
function updateSupplier() {
  if (!sup || !$("#supplier-form")) return;
  const method = $("#sup-fmethod").value;
  $("#sup-ftotal-wrap").hidden = method === "pct" || method === "none";
  $("#sup-fpct-wrap").hidden = method !== "pct";
  const costs = supplierCosts();
  let freightSum = 0, landedSum = 0;
  costs.forEach((c, i) => {
    const fr = $("#sup-fr-" + i);
    // Show the worked-out freight unless you've typed your own for this line
    if (!c.overridden && document.activeElement !== fr) fr.value = c.fx ? c.auto.toFixed(2) : "";
    fr.classList.toggle("overridden", c.overridden);
    freightSum += c.freight * c.qty; landedSum += c.landed * c.qty;
    const el = $("#sup-cost-" + i);
    if (!c.fx) { el.textContent = "Enter the exchange rate to see costs"; return; }
    const sell = num($("#sup-sell-" + i)?.value), exPrice = sell / (1 + GST_RATE);
    el.innerHTML = `<span>Ex freight <strong>${money(c.exFreight)}</strong></span><span>Freight ${money(c.freight)}${c.overridden ? ` <button type="button" class="link-btn" data-action="sup-reset-fr" data-i="${i}">reset</button>` : ""}</span><span>Landed <strong>${money(c.landed)}</strong></span>` +
      (sell ? `<span>Margin ${marginPct(sell, c.landed)}% landed, ${marginPct(sell, c.exFreight)}% ex freight</span>` : "");
  });
  const n = $$(".sup-on:checked").length;
  $("#sup-save").textContent = `Save ${n} product${n === 1 ? "" : "s"}`;
  $("#sup-summary").textContent = costs[0]?.fx ? `Freight loaded: ${money(freightSum)} across the shipment. Shipment landed cost: ${money(landedSum)} ex GST.` : "";
}

// ---------- Buttons ----------
const actions = {
  "prod-tab": (el) => { V.tab = el.dataset.tab; render(); },
  "cost-view": (el) => { V.costView = el.dataset.v; localSet("costView", V.costView); render(); },
  "stock-filter": (el) => { V.stockFilter = el.dataset.f; render(); },
  "open-product": (el) => productForm(el.dataset.id),
  "new-product": () => productForm(null),
  "cost-del": async (el) => {
    if (!confirmTap(el, "Tap again to remove")) return;
    const p = S.products.get(el.dataset.id); if (!p) return;
    const { _id, ...data } = p;
    data.costHistory = (p.costHistory || []).filter((e) => e.from !== el.dataset.from);
    // Current cost = the latest one left (real costs before estimates)
    const now = productCosts(data, "2099-12-31");
    data.cost = data.costHistory.length ? now.landed : 0; data.freightPerUnit = data.costHistory.length ? now.freight : 0;
    await save("product", _id, data); toast("Cost removed"); productForm(_id); render();
  },
  "delete-product": async (el) => { if (!confirmTap(el, "Tap again to delete")) return; await remove("product", el.dataset.id); closeSheet(); toast("Deleted"); render(); },
  "add-missing": async () => {
    const known = makeProductFinder(S.products), ops = new Map();
    for (const inv of S.invoices.values()) for (const l of inv.lines || []) if (!known(l) && !SERVICE_LINE.test(l.name || "")) {
      const id = slug(l.sku || l.name); if (!ops.has(id)) ops.set(id, { op: "put", kind: "product", id, data: { sku: l.sku || "", name: l.name, price: l.price || 0, cost: 0, calc: {} } });
    }
    await saveMany([...ops.values()]); toast(`Added ${ops.size}. Add a cost to each, or import the supplier invoice.`); render();
  },
  // Stock
  "stock-history": (el) => stockHistory(el.dataset.id),
  "stock-count": (el) => countForm(el.dataset.id),
  "stock-move": (el) => moveForm(el.dataset.id),
  "stock-adj": async (el) => {
    const id = el.dataset.id, n = Number(el.dataset.n);
    await save("stockmove", `adj-${id}-${Date.now()}`.slice(0, 150), { product: id, qty: n, date: todayStr(), reason: n > 0 ? "Added by hand" : "Removed by hand" });
    render();
  },
  "stock-undo": async (el) => { await remove("stockmove", el.dataset.id); stockHistory(el.dataset.p); render(); },
  // Supplier import
  "sup-pick": (el) => {
    const p = el.dataset.p;
    $$(".sup-on").forEach((c) => { const it = sup.items[Number(c.dataset.i)]; c.checked = p === "all" ? true : p === "none" ? false : !it.productId; });
    updateSupplier();
  },
  "sup-reset-fr": (el) => { delete sup.overrides[Number(el.dataset.i)]; updateSupplier(); },
};

const submits = {
  "product-form": async (f) => {
    const name = $("#p-name").value.trim(), sku = $("#p-sku").value.trim();
    const id = f.dataset.id || slug(sku || name), old = S.products.get(id) || {};
    const c = formCosts();
    // Cost changed? Record it from today so past sales keep their old cost.
    const costFields = c.landed > 0 && (Math.abs((old.cost || 0) - c.landed) > 0.004 || !old.costHistory) ? withNewCost(old, c, todayStr()) : {};
    const data = { ...old, name, sku, ...costFields, calc: c.calc, currency: ($("#k-cur").value || "EUR").toUpperCase(),
      listPrice: c.list || null, discountPct: c.list ? c.disc : null,
      aliases: $("#p-aliases") ? $("#p-aliases").value.split(",").map((x) => x.trim()).filter(Boolean) : (old.aliases || []),
      price: r2(num($("#p-price").value)), reorderAt: $("#p-reorder").value === "" ? "" : Number($("#p-reorder").value) };
    await save("product", id, data); closeSheet(); toast("Product saved"); render();
  },
  "count-form": async (f) => {
    const p = S.products.get(f.dataset.id);
    await save("product", p._id, { ...p, countQty: Number($("#cnt-qty").value), countDate: todayStr(), reorderAt: $("#cnt-reorder").value === "" ? (p.reorderAt ?? "") : Number($("#cnt-reorder").value) });
    toast("Stock count saved"); closeSheet(); render();
  },
  "move-form": async (f) => {
    const id = f.dataset.id, qty = Number($("#mv-qty").value);
    if (!qty) { toast("Enter how many units."); return; }
    await save("stockmove", `mv-${id}-${Date.now()}`.slice(0, 150), { product: id, qty, date: $("#mv-date").value, reason: $("#mv-reason").value });
    toast("Saved"); stockHistory(id); render();
  },
  "supplier-form": async () => {
    const costs = supplierCosts();
    if (!costs[0]?.fx) { toast("Enter the exchange rate first."); return; }
    const picked = $$(".sup-on:checked").map((c) => Number(c.dataset.i));
    if (!picked.length) { toast("Tick at least one item."); return; }
    const addStock = $("#sup-stock").checked, ops = [];
    for (const i of picked) {
      const it = sup.items[i], c = costs[i], sku = $("#sup-sku-" + i).value.trim(), id = it.productId || slug(sku || it.name);
      const old = S.products.get(id) || {}, { _id, ...keep } = old, sell = num($("#sup-sell-" + i).value);
      // New cost from this delivery's date; earlier sales keep the cost they had
      const data = { ...keep, name: old.name || it.name, sku, price: sell || old.price || 0, currency: sup.currency,
        ...withNewCost(old, c, sup.date, "invoice"), calc: { eur: c.unit, fx: c.fx, freight: c.freight, duty: c.duty }, supplier: old.supplier || sup.supplier, lastInvoice: sup.invoiceNumber, lastBought: sup.date };
      if (addStock && c.qty) {
        // Not tracked yet? Start tracking from zero the day before this delivery.
        if (!old.countDate) { data.countQty = 0; data.countDate = addDays(sup.date, -1); }
        ops.push({ op: "put", kind: "stockmove", id: `${slug(sup.invoiceNumber || sup.date)}-${id}`.slice(0, 150), data: { product: id, qty: c.qty, date: sup.date, reason: `Delivery · ${sup.supplier} ${sup.invoiceNumber}`.trim() } });
      }
      ops.unshift({ op: "put", kind: "product", id, data });
    }
    if ($("#sup-bill").checked) {
      const fx = costs[0].fx, goods = costs.reduce((a, c) => a + c.unit * c.qty, 0);
      ops.push({ op: "put", kind: "bill", id: `${sup.date}-${slug(sup.supplier)}-${slug(sup.invoiceNumber || "inv")}`.slice(0, 150), data: {
        supplier: sup.supplier, reference: sup.invoiceNumber, date: sup.date, category: "Stock purchases", description: `${sup.items.length} items`,
        total: r2((goods + sup.freightCur) * fx), gstTreatment: "none", gst: 0, paidDate: "", currency: sup.currency, originalTotal: r2(goods + sup.freightCur), fileKey: sup.fileKey, fileName: sup.fileName } });
    }
    $("#sup-status").textContent = "Saving…";
    await saveMany(ops);
    // Receiving a purchase order: tick off what arrived
    if (sup.poId) { const got = {}; for (const i of picked) if (sup.items[i].poLine != null) got[sup.items[i].poLine] = costs[i].qty; await Orders.markPoReceived(sup.poId, got, sup.invoiceNumber, sup.date); }
    closeSheet(); toast(`Saved ${picked.length} product${picked.length === 1 ? "" : "s"}`); sup = null; render();
  },
};

const changes = {
  "supplier-file": async (el) => { const f = el.files?.[0]; el.value = ""; if (f) await handleSupplierFile(f); },
  "products-sort": (el) => { V.sort = el.value; render(); },
};
// Live updates while typing in the forms
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.classList?.contains("sup-fr")) { sup.overrides[Number(t.dataset.i)] = t.value === "" ? undefined : num(t.value); if (t.value === "") delete sup.overrides[Number(t.dataset.i)]; }
  if (t.closest?.("#supplier-form")) updateSupplier();
  if (t.closest?.("#product-form")) {
    if (t.id === "p-incgst") localSet("costIncGst", t.checked ? "1" : "0");
    updateProductForm(t.id);
  }
});
document.addEventListener("change", (e) => { if (e.target.closest?.("#supplier-form")) updateSupplier(); });
const inputs = { "products-q": (el) => { V.q = el.value; rerenderKeepFocus("products-q"); } };

register("products", { render: render_, actions: { ...actions, ...Orders.actions }, submits: { ...submits, ...Orders.submits },
  changes: { ...changes, ...Orders.changes }, inputs: { ...inputs, ...Orders.inputs } });
