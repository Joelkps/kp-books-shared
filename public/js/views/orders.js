// Purchase orders, suppliers, and supplier price lists.
// Used by the Products screen (Orders tab and the Price list button).
import { S, save, remove, saveMany, api, uploadFile, saveSettings , logoBytes as getLogo } from "../store.js";
import { render } from "../app.js";
import { $, $$, esc, money, pill, icon, openSheet, closeSheet, sheetHead, toast, confirmTap, empty, sheetOpen, loadScript, shareOrDownload, copyText } from "../ui.js";
import { todayStr, addDays, fmtDate, fmtShort, r2, num, slug, GST_RATE, stockOnHand, makeProductFinder, productCosts, withNewCost, poTotals, onOrder, HOME, TAX } from "../calc.js";
import { buildPoPdf } from "../pdf.js";
import { supplierReview } from "./products.js";

const cur$ = (n, c = "EUR") => `${c} ${(Math.round((Number(n) || 0) * 100) / 100).toLocaleString(TAX.locale || "en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const supId = (name) => "sup-" + slug(name || "supplier");

// ---------- Suppliers ----------
// Everyone you buy from: saved suppliers plus any named on products, bills or orders
export function suppliers() {
  const map = new Map();
  for (const c of S.contacts.values()) if (c.type === "supplier") map.set(c._id, { ...c, id: c._id });
  const add = (name, currency) => { if (!name) return; const id = supId(name); if (!map.has(id)) map.set(id, { id, name, currency: currency || "" }); else if (!map.get(id).currency && currency) map.get(id).currency = currency; };
  for (const p of S.products.values()) add(p.supplier, p.currency);
  for (const po of S.pos.values()) add(po.supplier, po.currency);
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
const supplierByName = (name) => suppliers().find((x) => x.id === supId(name)) || { name };

// Your discount off a supplier's list price. Two tiers: a normal discount, and a bigger
// one when an order's list total goes over an amount (Narvi: 20%, or 25% over EUR 20,000).
export function discountTiers(s) {
  const narvi = /narvi/i.test(s?.name || "");
  return {
    base: s?.baseDisc ?? (narvi ? 20 : 0),
    over: s?.volumeOver ?? (narvi ? 20000 : 0),
    volume: s?.volumeDisc ?? (narvi ? 25 : 0),
  };
}
export function discountFor(s, listTotal) {
  const t = discountTiers(s);
  return t.over > 0 && t.volume > 0 && listTotal > t.over ? { pct: t.volume, volume: true, over: t.over } : { pct: t.base, volume: false, over: t.over };
}

function supplierForm(name) {
  const s = supplierByName(name);
  const nProducts = [...S.products.values()].filter((p) => supId(p.supplier) === s.id).length;
  openSheet(`${sheetHead(name ? esc(s.name) : "New supplier", name ? `${nProducts} products` : "")}
    <form id="supplier-contact-form" data-old="${esc(s.id || "")}" class="form">
      <div class="grid2">
        <label class="field"><span>Name</span><input id="sc-name" value="${esc(s.name)}" required></label>
        <label class="field"><span>Contact person</span><input id="sc-contact" value="${esc(s.contact)}"></label>
        <label class="field"><span>Email for orders</span><input id="sc-email" type="email" value="${esc(s.email)}"></label>
        <label class="field"><span>Phone</span><input id="sc-phone" value="${esc(s.phone)}"></label>
        <label class="field"><span>Currency</span><input id="sc-cur" value="${esc(s.currency || "EUR")}" maxlength="3"></label>
        <label class="field"><span>Usual lead time (days)</span><input id="sc-lead" type="number" min="0" value="${esc(s.leadDays ?? 60)}"></label>
      </div>
      <div class="card">
        <span class="label">Your discount off their list price</span>
        <div class="grid3">
          <label class="field"><span>Normal discount %</span><input id="sc-disc" type="number" step="0.5" min="0" max="100" value="${discountTiers(s).base}"></label>
          <label class="field"><span>Orders over (list total, ${esc(s.currency || "EUR")})</span><input id="sc-over" type="number" step="100" min="0" value="${discountTiers(s).over || ""}" placeholder="e.g. 20000"></label>
          <label class="field"><span>…get this discount %</span><input id="sc-vdisc" type="number" step="0.5" min="0" max="100" value="${discountTiers(s).volume || ""}" placeholder="e.g. 25"></label>
        </div>
        <p class="small muted">Price lists are costed at the normal discount. Orders switch to the bigger discount by themselves when the list total goes over the amount.</p>
      </div>
      <label class="field"><span>Address</span><textarea id="sc-addr" rows="3">${esc(s.address)}</textarea></label>
      <label class="field"><span>Notes (payment terms, account number…)</span><textarea id="sc-notes" rows="2">${esc(s.notes)}</textarea></label>
      <button class="btn primary wide" type="submit">Save supplier</button>
    </form>`);
}

// ---------- Orders tab ----------
const poPill = (po) => ({ draft: pill("mute", "draft"), sent: pill("warn", po.expected && po.expected < todayStr() ? "late" : "on order"), part: pill("warn", "part received"), received: pill("good", "received"), cancelled: pill("mute", "cancelled") }[po.status || "draft"]);

export function ordersView() {
  const all = [...S.pos.values()].sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.number || "").localeCompare(a.number || ""));
  const open = all.filter((p) => ["draft", "sent", "part"].includes(p.status || "draft")), done = all.filter((p) => !open.includes(p));
  const row = (po) => { const t = poTotals(po); return `<button class="item" data-action="open-po" data-id="${esc(po._id)}">
    <span class="t">${esc(po.supplier)}</span><span class="r">${cur$(t.total, po.currency)}</span>
    <span class="s">${esc(po.number)} · ${fmtShort(po.date)} · ${t.qty} units${po.expected ? ` · wanted ${fmtShort(po.expected)}` : ""}</span><span class="r small">${poPill(po)}</span></button>`; };
  const sups = suppliers();
  return `
    <div class="row"><button class="btn primary" data-action="new-po">${icon("plus", 16)} New order</button><button class="btn" data-action="reorder-low">Order low stock</button></div>
    <h3>Open orders</h3>
    ${open.length ? `<div class="list">${open.map(row).join("")}</div>` : `<div class="list">${empty("No open orders. Start one, or tap \"Order low stock\" and the app drafts it for you.")}</div>`}
    ${done.length ? `<details><summary>Received and cancelled (${done.length})</summary><div class="list flat">${done.slice(0, 50).map(row).join("")}</div></details>` : ""}
    <div class="spread"><h3>Suppliers</h3><button class="btn small-btn" data-action="new-supplier">${icon("plus", 16)} Supplier</button></div>
    ${sups.length ? `<div class="list">${sups.map((s) => `<button class="item" data-action="open-supplier" data-name="${esc(s.name)}"><span class="t">${esc(s.name)}</span><span class="r small muted">${esc(s.currency || "")}</span><span class="s">${esc(s.email || "No email yet")}</span><span></span></button>`).join("")}</div>` : `<div class="list">${empty("Suppliers appear as you add products.")}</div>`}`;
}

// ---------- Purchase order form ----------
let poSeq = 0;
function poLineRow(l) {
  const k = ++poSeq;
  return `<div class="po-line" data-product="${esc(l.product || "")}">
    <div class="po-line-name"><strong>${esc(l.name)}</strong><span class="small muted mono">${esc(l.sku || "")}${l.hint ? " · " + esc(l.hint) : ""}</span></div>
    <label class="field"><span>Qty</span><input class="pl-qty" id="pl-qty-${k}" type="number" min="0" step="1" inputmode="numeric" value="${esc(l.qty ?? 1)}"></label>
    <label class="field"><span>List price</span><input class="pl-unit" id="pl-unit-${k}" type="number" step="0.01" inputmode="decimal" value="${esc(l.list ?? l.unit ?? "")}"></label>
    <button type="button" class="icon-btn danger" data-action="po-remove-line" aria-label="Remove">${icon("x", 16)}</button>
    <input type="hidden" class="pl-name" value="${esc(l.name)}"><input type="hidden" class="pl-sku" value="${esc(l.sku || "")}">
  </div>`;
}
// What to suggest ordering: enough to get back to twice the reorder level
function suggestQty(p) {
  const oh = stockOnHand(p, S) ?? 0, oo = onOrder(p._id, S), target = Math.max(Number(p.reorderAt) * 2 || 2, 1);
  return Math.max(1, target - oh - oo);
}
const lineFor = (p, qty) => ({ product: p._id, name: p.name, sku: p.sku, qty, list: p.listPrice ?? p.calc?.eur ?? "", hint: `${stockOnHand(p, S) ?? "?"} in stock${onOrder(p._id, S) ? `, ${onOrder(p._id, S)} on order` : ""}` });

export function poForm(id, preset = {}) {
  const po = id ? S.pos.get(id) : { supplier: preset.supplier || "", currency: preset.currency || "", date: todayStr(), lines: preset.lines || [], notes: "" };
  const s = supplierByName(po.supplier);
  const currency = po.currency || s.currency || "EUR";
  openSheet(`${sheetHead(id ? `Edit ${esc(po.number)}` : "New purchase order")}
    <form id="po-form" data-id="${esc(id || "")}" class="form">
      <div class="grid2">
        <label class="field"><span>Supplier</span><input id="po-supplier" list="po-suppliers" value="${esc(po.supplier)}" required></label>
        <label class="field"><span>Currency</span><input id="po-cur" value="${esc(currency)}" maxlength="3"></label>
        <label class="field"><span>Order date</span><input id="po-date" type="date" value="${esc(po.date)}" required></label>
        <label class="field"><span>Wanted by</span><input id="po-expected" type="date" value="${esc(po.expected || addDays(po.date, Number(s.leadDays) || 60))}"></label>
      </div>
      <datalist id="po-suppliers">${suppliers().map((x) => `<option value="${esc(x.name)}">`).join("")}</datalist>
      <div class="card">
        <div class="spread"><span class="label">Items</span><span class="row">
          <button type="button" class="btn primary small-btn" data-action="po-open-picker">${icon("search", 16)} Add product</button>
          <button type="button" class="btn small-btn" data-action="po-add-low">Add low stock</button></span></div>
        <div id="po-picker" hidden class="picker"><input type="search" id="po-picker-q" placeholder="Search this supplier's products" autocomplete="off"><div class="list" id="po-picker-results"></div></div>
        <div id="po-lines" class="lines-edit">${(po.lines || []).map(poLineRow).join("") || `<p class="small muted" id="po-empty">No items yet.</p>`}</div>
        <div class="po-sum">
          <span class="muted small">List total</span><span class="num" id="po-list"></span>
          <label class="muted small" for="po-disc">Less discount %</label><input id="po-disc" type="number" step="0.5" min="0" max="100" value="${po.discountAuto === false ? esc(po.discountPct) : ""}" placeholder="auto"><span class="small muted" id="po-disc-note"></span>
          <strong>Net total</strong><strong class="num big-total" id="po-total"></strong>
        </div>
        <p class="small muted"><span id="po-units"></span> <span id="po-nzd"></span></p>
      </div>
      <label class="field"><span>Notes to the supplier</span><textarea id="po-notes" rows="2" placeholder="e.g. Ship with our next container. Please confirm the ship date.">${esc(po.notes)}</textarea></label>
      <label class="field"><span>Your reference on their side (optional)</span><input id="po-ref" value="${esc(po.supplierRef)}"></label>
      <button class="btn primary wide" type="submit">${id ? "Save order" : "Create order"}</button>
    </form>`, { wide: true });
  updatePoTotal();
}
// Lines hold the list price; the order's discount turns it into the net unit price
const readPoLines = () => $$("#po-lines .po-line").map((r) => ({ product: r.dataset.product || "", name: $(".pl-name", r).value, sku: $(".pl-sku", r).value,
  qty: num($(".pl-qty", r).value), list: r2(num($(".pl-unit", r).value)) })).filter((l) => l.qty > 0);
// Which discount applies: what you typed, or the supplier's tier for this order size
function poDiscount() {
  const lines = readPoLines(), listTotal = lines.reduce((a, l) => a + l.qty * l.list, 0);
  const typed = $("#po-disc").value;
  const tier = discountFor(supplierByName($("#po-supplier").value), listTotal);
  return typed !== "" ? { pct: num(typed), auto: false, listTotal, tier } : { pct: tier.pct, auto: true, listTotal, tier };
}
function updatePoTotal() {
  if (!$("#po-form")) return;
  const lines = readPoLines(), cur = ($("#po-cur").value || "EUR").toUpperCase();
  const d = poDiscount(), total = r2(d.listTotal * (1 - d.pct / 100)), units = lines.reduce((a, l) => a + l.qty, 0);
  $("#po-list").textContent = cur$(d.listTotal, cur);
  $("#po-disc-note").textContent = d.auto ? (d.tier.volume ? `${d.pct}%: volume discount, list total over ${cur$(d.tier.over, cur)}` : d.pct ? `${d.pct}%: supplier's normal discount${d.tier.over ? `. ${discountTiers(supplierByName($("#po-supplier").value)).volume}% over ${cur$(d.tier.over, cur)}` : ""}` : "No supplier discount set") : "Set by you";
  $("#po-disc").placeholder = d.auto ? String(d.pct) : "auto";
  $("#po-total").textContent = cur$(total, cur);
  $("#po-units").textContent = `${units} unit${units === 1 ? "" : "s"}.`;
  const fx = [...S.products.values()].filter((p) => (p.currency || "EUR") === cur).map((p) => p.calc?.fx).filter(Boolean).pop();
  $("#po-nzd").textContent = fx && cur !== HOME() ? `About ${money(total * fx)} at your last rate (${fx}), before freight.` : "";
}
function poPickerResults(q) {
  const sup = supId($("#po-supplier")?.value);
  q = q.trim().toLowerCase();
  let list = [...S.products.values()].filter((p) => !$("#po-supplier").value || supId(p.supplier) === sup || !p.supplier);
  if (q) list = list.filter((p) => `${p.name} ${p.sku} ${p.ean || ""} ${p.group || ""}`.toLowerCase().includes(q));
  list.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  return list.slice(0, 50).map((p) => `<button type="button" class="item" data-action="po-pick" data-id="${esc(p._id)}"><span class="t">${esc(p.name)}</span><span class="r small">${p.listPrice ?? p.calc?.eur ? cur$(p.listPrice ?? p.calc.eur, p.currency || "EUR") + " list" : ""}</span><span class="s mono">${esc(p.sku || "")} · ${stockOnHand(p, S) ?? "?"} in stock</span><span></span></button>`).join("") || `<div class="empty small">No products for this supplier. Import their price list first.</div>`;
}

// ---------- One purchase order ----------
let logoBytes = null;
async function poPdf(po) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js").catch(() => loadScript("https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"));
  logoBytes = await getLogo();
  return buildPoPdf(window.PDFLib, po, S.settings, supplierByName(po.supplier), logoBytes);
}
export function openPo(id) {
  const po = S.pos.get(id); if (!po) return;
  const t = poTotals(po), sup = supplierByName(po.supplier), status = po.status || "draft";
  openSheet(`${sheetHead(`Order ${esc(po.number)}`, `${esc(po.supplier)} · ${fmtDate(po.date)}${po.expected ? " · wanted by " + fmtDate(po.expected) : ""}`)}
    <div class="row wrap-actions">
      ${["draft", "sent", "part"].includes(status) ? `<button class="btn primary" data-action="po-send" data-id="${esc(id)}">${icon("share", 18)} Send PDF</button>` : ""}
      ${["sent", "part", "draft"].includes(status) && t.outstanding ? `<button class="btn ${status === "draft" ? "" : "primary"}" data-action="po-receive" data-id="${esc(id)}">${icon("box", 18)} Receive into stock</button>` : ""}
      ${status !== "received" ? `<button class="btn" data-action="po-edit" data-id="${esc(id)}">Edit</button>` : ""}
      ${status === "draft" ? `<button class="btn" data-action="po-mark-sent" data-id="${esc(id)}">Mark as sent</button>` : ""}
    </div>
    ${sup.email ? `<p class="small">Orders go to <strong>${esc(sup.email)}</strong> <button class="link-btn" data-action="copy" data-text="${esc(sup.email)}">copy</button></p>` : `<p class="small muted">Add the supplier's email in <button class="link-btn" data-action="open-supplier" data-name="${esc(po.supplier)}">their details</button> so it's handy when sending.</p>`}
    <div class="lines">${(po.lines || []).map((l) => `<div class="line"><span>${esc(l.qty)} × ${esc(l.name)} <span class="mono small muted">${esc(l.sku || "")}</span>${l.received ? `<div class="small muted">${l.received} received</div>` : ""}</span><span class="num">${l.list ?? l.unit ? cur$((l.list ?? l.unit) * l.qty, po.currency) : ""}</span></div>`).join("")}
      ${po.discountPct ? `<div class="line muted"><span>Less ${po.discountPct}% ${po.volumeDiscount ? "volume " : ""}discount off list</span><span class="num">−${cur$((po.lines || []).reduce((a, l) => a + l.qty * (l.list ?? l.unit), 0) - t.total, po.currency)}</span></div>` : ""}
      <div class="line"><strong>Net total ${esc(po.currency)} (${t.qty} units)</strong><strong class="num">${cur$(t.total, po.currency)}</strong></div></div>
    ${po.notes ? `<p class="small pre">${esc(po.notes)}</p>` : ""}
    ${(po.receipts || []).length ? `<div><span class="label">Deliveries</span>${po.receipts.map((r) => `<p class="small">${fmtDate(r.date)}: ${r.units} units${r.ref ? `, invoice ${esc(r.ref)}` : ""}</p>`).join("")}</div>` : ""}
    <div class="row">${status !== "received" && status !== "cancelled" ? `<button class="btn" data-action="po-cancel" data-id="${esc(id)}">Cancel order</button>` : ""}<button class="btn danger" data-action="po-delete" data-id="${esc(id)}">Delete</button></div>
    <p class="status" id="sheet-status"></p>`);
}

// Turn an order into the receiving screen (same as a supplier invoice: rate, freight, costs, stock)
function receivePo(id) {
  const po = S.pos.get(id);
  const lines = (po.lines || []).map((l, i) => ({ ...l, i })).filter((l) => (l.qty || 0) - (l.received || 0) > 0);
  supplierReview({ supplier: po.supplier, invoiceNumber: po.supplierRef || po.number, date: todayStr(), currency: po.currency,
    lines: lines.map((l) => ({ name: l.name, sku: l.sku, qty: l.qty - (l.received || 0), unitPrice: l.unit, kind: "product", productId: l.product, poLine: l.i })), freight: 0,
    note: `Receiving order ${po.number}. Change the quantities to what actually arrived, and enter the rate and freight from the supplier's invoice.` }, "", "", { poId: id });
}
// Called by the receiving screen after it saves
export async function markPoReceived(poId, received, ref, date) {
  const po = S.pos.get(poId); if (!po) return;
  const lines = (po.lines || []).map((l, i) => ({ ...l, received: (Number(l.received) || 0) + (received[i] || 0) }));
  const units = Object.values(received).reduce((a, n) => a + n, 0);
  const done = lines.every((l) => l.received >= l.qty);
  await save("po", poId, { ...po, lines, status: done ? "received" : "part", receipts: [...(po.receipts || []), { date, units, ref }] });
}

// ---------- Price list import ----------
let pl = null;
export async function handlePriceList(file) {
  if (!S.me?.integrations?.ai) { toast("Connect Claude first (setup guide step 7: your Anthropic key in Cloudflare) to read price lists."); return; }
  openSheet(`${sheetHead("Reading price list")}<div class="reading"><div class="spinner"></div><p>Claude is reading every product in ${esc(file.name)}. Big lists take a few minutes, so leave this open.</p></div>`);
  try {
    const name = (file.name || "").toLowerCase();
    let body;
    if (/\.(xlsx|xls|ods)$/.test(name)) {
      // Spreadsheets: turn every sheet into CSV text in the browser
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
      const wb = window.XLSX.read(await file.arrayBuffer(), { type: "array" });
      body = { mode: "pricelist", text: wb.SheetNames.map((n) => `Sheet: ${n}\n` + window.XLSX.utils.sheet_to_csv(wb.Sheets[n])).join("\n\n") };
    } else if (/\.(csv|txt|tsv)$/.test(name) || file.type.startsWith("text/")) body = { mode: "pricelist", text: await file.text() };
    else body = { mode: "pricelist", fileKey: await uploadFile(file) };
    const o = await api("ai/read", { method: "POST", body });
    if (sheetOpen()) priceListReview(o);
  } catch (e) {
    if (sheetOpen()) openSheet(`${sheetHead("Couldn't read that price list")}<p>${esc(e.message)}</p><p class="small muted">PDF, Excel, CSV or a clear photo all work.</p>`);
  }
}

function priceListReview(o) {
  const find = makeProductFinder(S.products, { strict: true });
  const cur = String(o?.currency || "EUR").toUpperCase();
  const items = (Array.isArray(o?.items) ? o.items : []).map((it) => ({ ...it, listPrice: num(it.listPrice ?? it.price), rrp: it.rrp != null && it.rrp !== "" ? num(it.rrp) : null }))
    .filter((it) => it && it.name && (it.listPrice > 0 || it.rrp > 0)).map((it) => {
      const ex = find({ sku: it.sku, name: it.name });
      return { name: String(it.name).trim(), sku: String(it.sku || "").trim(), ean: String(it.ean || "").trim(), list: it.listPrice, rrp: it.rrp, group: it.group || "",
        existing: ex?._id || null, oldNet: ex ? Number(ex.calc?.eur) || 0 : 0, hasPrice: !!ex?.price };
    });
  const supplier = o?.supplier || "";
  const sup = supplierByName(supplier), tiers = discountTiers(sup);
  // Typical freight for this supplier, as a % of cost, from products you already have
  const theirs = [...S.products.values()].filter((p) => supplier && supId(p.supplier) === supId(supplier)).map((p) => productCosts(p)).filter((c) => c.exFreight > 0 && c.freight > 0);
  const fpct = theirs.length ? Math.round((theirs.reduce((a, c) => a + c.freight / c.exFreight, 0) / theirs.length) * 1000) / 10 : 10;
  const lastFx = [...S.products.values()].filter((p) => (p.currency || "EUR") === cur).map((p) => p.calc?.fx).filter(Boolean).pop() || "";
  pl = { items, cur, supplier };
  const nNew = items.filter((i) => !i.existing).length;
  const hasRrp = items.some((i) => i.rrp);
  openSheet(`${sheetHead("Price list", `${items.length} products · ${nNew} new${o?.effectiveDate ? " · from " + fmtDate(o.effectiveDate) : ""}`)}
    ${o?.note ? `<div class="banner"><p class="small">${esc(o.note)}</p></div>` : ""}
    <form id="pricelist-form" class="form">
      <div class="card">
        <span class="label">Your cost</span>
        <div class="grid3">
          <label class="field"><span>Supplier</span><input id="pl-supplier" value="${esc(supplier)}" list="po-suppliers" required></label>
          <label class="field"><span>Prices from</span><input id="pl-date" type="date" value="${esc(o?.effectiveDate || todayStr())}"></label>
          <label class="field"><span>Your price is based on</span><select id="pl-col">
            <option value="list">List price (${esc(cur)}, VAT 0%)</option>${hasRrp ? `<option value="rrp">Recommended retail (RRP)</option>` : ""}</select></label>
          <label class="field"><span>Your discount off that %</span><input id="pl-disc" type="number" step="0.5" min="0" max="100" value="${tiers.base}"></label>
          <label class="field"><span>1 ${esc(cur)} in ${HOME()}</span><input id="pl-fx" type="number" step="0.0001" inputmode="decimal" value="${cur === HOME() ? 1 : esc(lastFx)}" placeholder="1.9500" required></label>
          <label class="field"><span>Duty %</span><input id="pl-duty" type="number" step="0.1" value="0"></label>
          <label class="field"><span>Freight for new products, % of cost</span><input id="pl-fpct" type="number" step="0.1" value="${fpct}"></label>
        </div>
        <datalist id="po-suppliers">${suppliers().map((x) => `<option value="${esc(x.name)}">`).join("")}</datalist>
        <p class="small muted">Costed at your normal discount${tiers.over ? `. Orders over ${cur$(tiers.over, cur)} list get ${tiers.volume}% automatically` : ""}. Set tiers on the supplier (Products, Orders, Suppliers). Products you already stock keep their own freight per unit.</p>
        <label class="check"><input type="checkbox" id="pl-costs" checked> Update my costs from this date (sales before it keep the old cost)</label>
      </div>
      <div class="card">
        <span class="label">Selling prices</span>
        <label class="field"><span>What to do</span><select id="pl-sell">
          <option value="keep">Leave selling prices as they are</option>
          <option value="markup">Set them from a markup on my landed cost</option></select></label>
        <div id="pl-markup" class="grid3" hidden>
          <label class="field"><span>Markup on landed cost %</span><input id="pl-mu" type="number" step="1" min="0" value="${esc(S.settings.defaultMarkup ?? 60)}"></label>
          <label class="field"><span>Round to nearest</span><select id="pl-round"><option value="0.01">cent</option><option value="1">$1</option><option value="5">$5</option><option value="10" selected>$10</option></select></label>
          <label class="field"><span>Apply to</span><select id="pl-apply"><option value="empty">New products and ones with no price</option><option value="all">Every ticked product</option></select></label>
          <label class="check"><input type="checkbox" id="pl-gst" checked> Add GST (15%) on top</label>
        </div>
      </div>
      <div class="spread"><div class="chips">
        <button type="button" class="chip-btn" data-action="pl-pick" data-p="all">All</button>
        <button type="button" class="chip-btn" data-action="pl-pick" data-p="none">None</button>
        <button type="button" class="chip-btn" data-action="pl-pick" data-p="new">New only (${nNew})</button>
        <button type="button" class="chip-btn" data-action="pl-pick" data-p="changed">Cost changes</button>
      </div><input type="search" id="pl-q" class="search" placeholder="Filter the list"></div>
      <div class="tablewrap pl-wrap"><table class="pl-table">
        <thead><tr><th></th><th>Product</th><th class="n">List ${esc(cur)}</th><th class="n">Your net ${esc(cur)}</th><th class="n">Landed ${HOME()}</th><th class="n">Sell incl GST</th></tr></thead>
        <tbody>${items.map((it, i) => `<tr data-i="${i}" data-text="${esc(`${it.name} ${it.sku} ${it.ean} ${it.group}`.toLowerCase())}">
          <td><input type="checkbox" class="pl-on" data-i="${i}" aria-label="Include ${esc(it.name)}" checked></td>
          <td><strong>${esc(it.name)}</strong><div class="small muted"><span class="mono">${esc(it.sku || "no code")}</span>${it.group ? " · " + esc(it.group) : ""} ${it.existing ? "" : pill("good", "new")}</div></td>
          <td class="n muted" id="pl-list-${i}"></td>
          <td class="n" id="pl-net-${i}"></td>
          <td class="n" id="pl-landed-${i}">–</td>
          <td class="n" id="pl-sellc-${i}"></td></tr>`).join("")}</tbody></table></div>
      <button class="btn primary wide" type="submit" id="pl-save">Save</button>
      <p class="status" id="pl-status"></p>
    </form>`, { wide: true });
  updatePriceList();
}
// The figures for one line, from the choices at the top of the form
function priceListCosts(i) {
  const it = pl.items[i], fx = num($("#pl-fx")?.value), duty = num($("#pl-duty")?.value), fpct = num($("#pl-fpct")?.value), disc = num($("#pl-disc")?.value);
  const base = $("#pl-col")?.value === "rrp" && it.rrp ? it.rrp : it.list;
  const net = r2(base * (1 - disc / 100));
  const ex = r2(net * fx * (1 + duty / 100));
  const p = it.existing ? S.products.get(it.existing) : null;
  const freight = p && productCosts(p).freight ? productCosts(p).freight : r2(ex * fpct / 100);
  const landed = r2(ex + freight);
  // Selling price from markup, if chosen
  let sell = null;
  if ($("#pl-sell")?.value === "markup" && (($("#pl-apply")?.value === "all") || !it.hasPrice)) {
    const step = num($("#pl-round")?.value) || 0.01;
    const raw = landed * (1 + num($("#pl-mu")?.value) / 100) * ($("#pl-gst")?.checked ? 1 + GST_RATE : 1);
    sell = Math.max(step, Math.round(raw / step) * step);
  }
  return { base, net, exFreight: ex, freight, landed, fx, duty, disc, sell, change: it.oldNet ? (net - it.oldNet) / it.oldNet : null };
}
function updatePriceList() {
  if (!pl || !$("#pricelist-form")) return;
  const fx = num($("#pl-fx").value);
  $("#pl-markup").hidden = $("#pl-sell").value !== "markup";
  pl.items.forEach((it, i) => {
    const c = priceListCosts(i);
    $("#pl-list-" + i).textContent = c.base.toFixed(2);
    $("#pl-net-" + i).innerHTML = c.net.toFixed(2) + (c.change && Math.abs(c.change) > 0.0005 ? `<div>${pill(c.change > 0 ? "bad" : "good", `${c.change > 0 ? "+" : ""}${(c.change * 100).toFixed(1)}%`)}</div>` : "");
    $("#pl-landed-" + i).textContent = fx ? money(c.landed) : "–";
    const p = it.existing ? S.products.get(it.existing) : null;
    $("#pl-sellc-" + i).innerHTML = c.sell != null && fx ? `<strong>${money(c.sell)}</strong>` : p?.price ? `<span class="muted">${money(p.price)}</span>` : `<span class="muted">–</span>`;
  });
  const n = $$(".pl-on:checked").length;
  $("#pl-save").textContent = `Save ${n} product${n === 1 ? "" : "s"}`;
}

// ---------- Buttons ----------
export const actions = {
  "new-po": () => poForm(null),
  "open-po": (el) => openPo(el.dataset.id),
  "po-edit": (el) => poForm(el.dataset.id),
  "new-supplier": () => supplierForm(""),
  "open-supplier": (el) => supplierForm(el.dataset.name),
  "copy": (el) => copyText(el.dataset.text),
  "po-open-picker": () => { const pk = $("#po-picker"); pk.hidden = !pk.hidden; if (!pk.hidden) { $("#po-picker-results").innerHTML = poPickerResults($("#po-picker-q").value); $("#po-picker-q").focus(); } },
  "po-pick": (el) => {
    const p = S.products.get(el.dataset.id); if (!p) return;
    $("#po-empty")?.remove();
    if (!$("#po-supplier").value && p.supplier) $("#po-supplier").value = p.supplier;
    if (!$("#po-cur").value && p.currency) $("#po-cur").value = p.currency;
    $("#po-lines").insertAdjacentHTML("beforeend", poLineRow(lineFor(p, suggestQty(p))));
    $("#po-picker").hidden = true; $("#po-picker-q").value = ""; updatePoTotal();
  },
  "po-add-low": () => {
    const sup = supId($("#po-supplier").value), have = new Set($$("#po-lines .po-line").map((r) => r.dataset.product));
    const low = [...S.products.values()].filter((p) => (!$("#po-supplier").value || supId(p.supplier) === sup) && !have.has(p._id)
      && p.reorderAt !== "" && p.reorderAt != null && (stockOnHand(p, S) ?? Infinity) + onOrder(p._id, S) <= Number(p.reorderAt));
    if (!low.length) { toast("Nothing from this supplier is low."); return; }
    $("#po-empty")?.remove();
    $("#po-lines").insertAdjacentHTML("beforeend", low.map((p) => poLineRow(lineFor(p, suggestQty(p)))).join(""));
    toast(`Added ${low.length} low-stock item${low.length > 1 ? "s" : ""}`); updatePoTotal();
  },
  "po-remove-line": (el) => { el.closest(".po-line").remove(); updatePoTotal(); },
  // Draft one order per supplier with everything that's low
  "reorder-low": async () => {
    const low = [...S.products.values()].filter((p) => p.reorderAt !== "" && p.reorderAt != null && (stockOnHand(p, S) ?? Infinity) + onOrder(p._id, S) <= Number(p.reorderAt));
    if (!low.length) { toast("Nothing is low on stock. Set reorder levels on the Stock tab."); return; }
    const bySup = new Map();
    for (const p of low) { const k = p.supplier || "Supplier"; if (!bySup.has(k)) bySup.set(k, []); bySup.get(k).push(p); }
    let n = S.settings.nextPo || 1, first = null;
    for (const [sup, ps] of bySup) {
      const s = supplierByName(sup), id = `po-${n}`;
      await save("po", id, { number: `${S.settings.poPrefix || "PO-"}${String(n).padStart(4, "0")}`, supplier: sup, currency: ps[0].currency || s.currency || "EUR",
        date: todayStr(), expected: addDays(todayStr(), Number(s.leadDays) || 60), status: "draft", notes: "",
        ...(() => {
          const raw = ps.map((p) => { const { hint, ...l } = lineFor(p, suggestQty(p)); return l; });
          const d = discountFor(s, raw.reduce((a, l) => a + l.qty * (Number(l.list) || 0), 0));
          return { discountPct: d.pct, discountAuto: true, volumeDiscount: d.volume, lines: raw.map((l) => ({ ...l, unit: r2((Number(l.list) || 0) * (1 - d.pct / 100)), received: 0 })) };
        })() });
      first ??= id; n++;
    }
    await saveSettings({ nextPo: n });
    toast(`Drafted ${bySup.size} order${bySup.size > 1 ? "s" : ""}. Check the quantities.`);
    render(); openPo(first);
  },
  "po-send": async (el) => {
    const po = S.pos.get(el.dataset.id), st = $("#sheet-status"); st.textContent = "Making PDF…";
    const blob = new Blob([await poPdf(po)], { type: "application/pdf" });
    const r = await shareOrDownload(blob, `${S.settings.businessName} ${po.number}.pdf`, `Hi${supplierByName(po.supplier).contact ? " " + supplierByName(po.supplier).contact.split(" ")[0] : ""}, please find purchase order ${po.number} attached. Could you confirm the ship date? Thanks, ${S.settings.businessName}`);
    st.textContent = r === "downloaded" ? "PDF downloaded. Attach it to an email to the supplier." : "";
    if (r !== "cancelled" && (po.status || "draft") === "draft") { await save("po", po._id, { ...po, status: "sent", sentAt: todayStr() }); openPo(po._id); render(); }
  },
  "po-mark-sent": async (el) => { const po = S.pos.get(el.dataset.id); await save("po", po._id, { ...po, status: "sent", sentAt: todayStr() }); openPo(po._id); render(); },
  "po-receive": (el) => receivePo(el.dataset.id),
  "po-cancel": async (el) => { if (!confirmTap(el, "Tap again to cancel")) return; const po = S.pos.get(el.dataset.id); await save("po", po._id, { ...po, status: "cancelled" }); openPo(po._id); render(); },
  "po-delete": async (el) => { if (!confirmTap(el, "Tap again to delete")) return; await remove("po", el.dataset.id); closeSheet(); toast("Order deleted"); render(); },
  // Price list
  "pl-pick": (el) => {
    const p = el.dataset.p;
    $$(".pl-on").forEach((c) => { const it = pl.items[Number(c.dataset.i)]; if (c.closest("tr").hidden) return;
      const ch = priceListCosts(Number(c.dataset.i)).change;
      c.checked = p === "all" ? true : p === "none" ? false : p === "new" ? !it.existing : !!(it.existing && (!it.oldNet || (ch && Math.abs(ch) > 0.0005))); });
    updatePriceList();
  },
};

export const submits = {
  "supplier-contact-form": async (f) => {
    const name = $("#sc-name").value.trim(), id = supId(name);
    const data = { type: "supplier", name, contact: $("#sc-contact").value.trim(), email: $("#sc-email").value.trim(), phone: $("#sc-phone").value.trim(),
      currency: ($("#sc-cur").value || "EUR").toUpperCase(), leadDays: Number($("#sc-lead").value) || 0, address: $("#sc-addr").value.trim(), notes: $("#sc-notes").value.trim(),
      baseDisc: num($("#sc-disc").value), volumeOver: num($("#sc-over").value), volumeDisc: num($("#sc-vdisc").value) };
    await save("contact", id, data);
    if (f.dataset.old && f.dataset.old !== id && S.contacts.has(f.dataset.old)) await remove("contact", f.dataset.old);
    toast("Supplier saved"); closeSheet(); render();
  },
  "po-form": async (f) => {
    const editId = f.dataset.id, old = editId ? S.pos.get(editId) : null, lines = readPoLines();
    if (!lines.length) { toast("Add at least one item."); return; }
    const n = S.settings.nextPo || 1, id = editId || `po-${n}`;
    // Keep what's already been received on lines that are still there
    const prev = new Map((old?.lines || []).map((l) => [l.product || l.name, l.received || 0]));
    const d = poDiscount();
    await save("po", id, { ...(old || {}), number: old?.number || `${S.settings.poPrefix || "PO-"}${String(n).padStart(4, "0")}`,
      supplier: $("#po-supplier").value.trim(), currency: ($("#po-cur").value || "EUR").toUpperCase(), date: $("#po-date").value, expected: $("#po-expected").value,
      notes: $("#po-notes").value.trim(), supplierRef: $("#po-ref").value.trim(), status: old?.status || "draft",
      discountPct: d.pct, discountAuto: d.auto, volumeDiscount: d.auto && d.tier.volume,
      // unit = what you actually pay per unit (list less discount), used when receiving into stock
      lines: lines.map((l) => ({ ...l, unit: r2(l.list * (1 - d.pct / 100)), received: prev.get(l.product || l.name) || 0 })) });
    if (!editId) await saveSettings({ nextPo: n + 1 });
    toast(editId ? "Order saved" : "Order created"); openPo(id); render();
  },
  "pricelist-form": async () => {
    const fx = num($("#pl-fx").value); if (!fx) { toast("Enter the exchange rate first."); return; }
    const supplier = $("#pl-supplier").value.trim(), from = $("#pl-date").value || todayStr(), updateCosts = $("#pl-costs").checked;
    const picked = $$(".pl-on:checked").map((c) => Number(c.dataset.i));
    if (!picked.length) { toast("Tick at least one product."); return; }
    const ops = [];
    for (const i of picked) {
      const it = pl.items[i], c = priceListCosts(i), id = it.existing || slug(it.sku || it.name), old = S.products.get(id) || {};
      const { _id, ...keep } = old;
      // calc.eur is what you pay per unit (list less your discount); listPrice is kept for purchase orders
      const data = { ...keep, name: old.name || it.name, sku: it.sku || old.sku || "", ean: it.ean || old.ean || "", supplier, currency: pl.cur,
        listPrice: c.base, listDate: from, discountPct: c.disc, rrp: it.rrp ?? old.rrp ?? null, group: it.group || old.group || "",
        calc: { eur: c.net, fx: c.fx, duty: c.duty, freight: c.freight } };
      if (c.sell != null) data.price = r2(c.sell);
      // New products always get a cost. Existing ones only if you chose to update costs.
      if (updateCosts || !old.cost) Object.assign(data, withNewCost(old, c, from, "pricelist"));
      else data.calc = old.calc || data.calc;
      ops.push({ op: "put", kind: "product", id, data });
    }
    // Remember the discount on the supplier if it hasn't got one yet
    const sid = supId(supplier), sc = S.contacts.get(sid);
    if (!sc?.baseDisc && num($("#pl-disc").value)) {
      const t = discountTiers({ name: supplier });
      ops.push({ op: "put", kind: "contact", id: sid, data: { ...(sc || {}), _id: undefined, type: "supplier", name: sc?.name || supplier, currency: sc?.currency || pl.cur,
        baseDisc: num($("#pl-disc").value), volumeOver: sc?.volumeOver ?? t.over, volumeDisc: sc?.volumeDisc ?? t.volume } });
    }
    $("#pl-status").textContent = `Saving ${ops.length} products…`;
    await saveMany(ops);
    if ($("#pl-sell").value === "markup") await saveSettings({ defaultMarkup: num($("#pl-mu").value) });
    closeSheet(); pl = null; toast(`Saved ${picked.length} products from the price list`); render();
  },
};
export const changes = { "price-list-file": async (el) => { const f = el.files?.[0]; el.value = ""; if (f) await handlePriceList(f); } };
export const inputs = {
  "po-picker-q": (el) => { $("#po-picker-results").innerHTML = poPickerResults(el.value); },
  "pl-q": (el) => { const q = el.value.trim().toLowerCase(); $$(".pl-table tbody tr").forEach((tr) => (tr.hidden = !!q && !tr.dataset.text.includes(q))); },
};
document.addEventListener("input", (e) => { if (e.target.closest?.("#po-form")) updatePoTotal(); if (e.target.closest?.("#pricelist-form")) updatePriceList(); });
document.addEventListener("change", (e) => { if (e.target.classList?.contains("pl-on")) updatePriceList(); });
