// Sales: invoices, quotes, customers, payments, PDFs and the Shopify import
import { S, save, remove, saveMany, saveSettings , logoBytes as getLogo } from "../store.js";
import { register, render, rerenderKeepFocus, go } from "../app.js";
import { $, $$, esc, money, pill, icon, openSheet, closeSheet, sheetHead, toast, confirmTap, loadScript, shareOrDownload, copyText, empty } from "../ui.js";
import { todayStr, addDays, fmtDate, fmtShort, r2, num, slug, invoiceCalc, invoicePay, makeProductFinder, counts, isQuote, GST_FRACTION, GST_RATE, linesCost, costAt, SERVICE_LINE, FREIGHT_LINE, productCosts, lineKey, HOME, TAX } from "../calc.js";
import { buildInvoicePdf } from "../pdf.js";
import { parseCSV } from "../csv.js";

const V = { tab: "invoices", q: "", filter: "all", shown: 50 };

// ---------- List rows ----------
export function payPill(inv) {
  if (isQuote(inv)) return { open: pill("mute", "quote"), accepted: pill("good", "accepted"), declined: pill("mute", "declined"), invoiced: pill("good", "invoiced") }[inv.status || "open"] || pill("mute", "quote");
  if (inv.status === "refunded") return pill("mute", "refunded");
  if (inv.status === "cancelled") return pill("mute", "cancelled");
  const p = invoicePay(inv);
  return { paid: pill("good", "paid"), part: pill("warn", "deposit paid"), unpaid: pill("warn", "unpaid"), overdue: pill("bad", `${p.daysLate}d overdue`) }[p.state];
}
function marginPill(c) {
  if (c.missing) return `<span class="pv-hide">${pill("warn", "cost missing")}</span>`;
  if (c.exGst <= 0) return "";
  const p = Math.round(c.pct * 100);
  // Costed from the price list only: show it, but marked as an estimate
  if (c.estimated) return `<span class="pv-hide">${pill("mute", `${p}% est.`)}</span>`;
  return `<span class="pv-hide">${pill(p >= 30 ? "good" : p >= 15 ? "warn" : "bad", `${p}% margin`)}</span>`;
}
export function salesRow(inv) {
  const c = invoiceCalc(inv, makeProductFinder(S.products));
  const owing = !isQuote(inv) && invoicePay(inv).due > 0;
  const right = isQuote(inv) || owing || inv.status === "refunded" || inv.status === "cancelled" ? payPill(inv) : marginPill(c);
  return `<button class="item" data-action="open-invoice" data-id="${esc(inv._id)}">
    <span class="t">${esc(inv.customer?.name || "Customer")}${inv.example ? " " + pill("warn", "example") : ""}</span>
    <span class="r">${money(c.net)}</span>
    <span class="s">${esc(inv.number)} · ${fmtShort(inv.date)}${inv.source === "shopify" ? " · Shopify" : ""}${inv.zeroRated ? " · export" : ""}</span>
    <span class="r small">${right}</span>
  </button>`;
}

// ---------- Customers (built from invoices, plus any you add) ----------
export const customerKey = (c) => slug((c?.email || c?.name || "").toLowerCase());
function customers() {
  const map = new Map();
  for (const ct of S.contacts.values()) if (ct.type !== "supplier") map.set(ct._id, { ...ct, key: ct._id, invoices: [] });
  for (const inv of S.invoices.values()) {
    const k = customerKey(inv.customer); if (!k || k === "x") continue;
    if (!map.has(k)) map.set(k, { key: k, ...inv.customer, invoices: [] });
    const c = map.get(k); c.invoices.push(inv);
    if (!c.phone && inv.customer?.phone) c.phone = inv.customer.phone;
    if (!c.address && inv.customer?.address) c.address = inv.customer.address;
  }
  return [...map.values()].map((c) => {
    const real = c.invoices.filter(counts);
    return { ...c, spent: r2(real.reduce((a, i) => a + invoiceCalc(i).net, 0)), owing: r2(real.reduce((a, i) => a + invoicePay(i).due, 0)),
      last: real.map((i) => i.date).sort().pop() || "" };
  }).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
}

// ---------- Main screen ----------
function render_() {
  const tabs = `<div class="seg" role="tablist">
    ${["invoices", "quotes", "customers"].map((t) => `<button role="tab" data-action="sales-tab" data-tab="${t}" aria-selected="${V.tab === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}
  </div>`;
  const head = `<div class="spread"><h2>Sales</h2><div class="row">
      <label class="btn file small-btn">${icon("upload", 16)} Import sales<input type="file" accept=".csv,text/csv" data-change="import-sales" id="sales-csv"></label>
      <button class="btn primary" data-action="${V.tab === "quotes" ? "new-quote" : "new-invoice"}">${icon("plus", 16)} ${V.tab === "quotes" ? "Quote" : "Invoice"}</button>
    </div></div>`;
  const search = `<input type="search" id="sales-q" class="search" placeholder="${V.tab === "customers" ? "Search customers" : "Search number, customer, product"}" value="${esc(V.q)}">`;
  const q = V.q.toLowerCase();

  if (V.tab === "customers") {
    const list = customers().filter((c) => !q || `${c.name} ${c.email} ${c.company} ${c.phone}`.toLowerCase().includes(q));
    return `<section>${head}${tabs}${search}
      ${list.length ? `<div class="list">${list.slice(0, V.shown).map((c) => `<button class="item" data-action="open-customer" data-id="${esc(c.key)}">
        <span class="t">${esc(c.name || c.email)}</span><span class="r">${money(c.spent)}</span>
        <span class="s">${esc([c.email, c.phone].filter(Boolean).join(" · ") || "No contact details")}</span>
        <span class="r small">${c.owing > 0 ? pill("warn", money(c.owing) + " owing") : c.last ? "last " + fmtShort(c.last) : ""}</span></button>`).join("")}</div>`
        : `<div class="list">${empty(q ? "No customers match." : "Customers appear here as you invoice them.")}</div>`}
      <button class="btn" data-action="new-contact">${icon("plus", 16)} Add customer</button>
    </section>`;
  }

  const quotes = V.tab === "quotes";
  let all = [...S.invoices.values()].filter((i) => isQuote(i) === quotes)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.number || "").localeCompare(a.number || ""));
  if (q) all = all.filter((i) => `${i.number} ${i.customer?.name} ${i.customer?.email} ${i.reference} ${i.orderName} ${(i.lines || []).map((l) => `${l.name} ${l.sku}`).join(" ")}`.toLowerCase().includes(q));
  if (!quotes && V.filter !== "all") all = all.filter((i) => V.filter === "owing" ? counts(i) && invoicePay(i).due > 0 : V.filter === "shopify" ? i.source === "shopify" : i.source !== "shopify");
  const owingSum = [...S.invoices.values()].filter((i) => counts(i)).reduce((a, i) => a + invoicePay(i).due, 0);
  const filters = quotes ? "" : `<div class="chips">${[["all", "All"], ["owing", `Owing ${owingSum ? money(owingSum) : ""}`], ["shopify", "Shopify"], ["manual", "Your invoices"]]
    .map(([k, l]) => `<button class="chip-btn" data-action="sales-filter" data-f="${k}" aria-pressed="${V.filter === k}">${esc(l)}</button>`).join("")}</div>`;

  return `<section>${head}${tabs}${search}${filters}
    <p class="status" id="import-status"></p>
    ${all.length ? `<div class="list">${all.slice(0, V.shown).map(salesRow).join("")}</div>` :
      `<div class="list">${empty(q ? "Nothing matches that search." : quotes ? "No quotes yet. A quote turns into an invoice in one tap when the customer says yes." : "No invoices yet. Shopify orders arrive here by themselves once the webhook is set up, or import a CSV export from Shopify.")}</div>`}
    ${all.length > V.shown ? `<button class="btn" data-action="sales-more">Show more</button>` : ""}
    ${quotes ? "" : `<p class="small muted">Import sales takes a Shopify order export (Orders, Export, "CSV for Excel") or an invoice export from your old accounts. Re-importing is safe.</p>`}
  </section>`;
}

// ---------- Invoice detail ----------
function paymentsBlock(inv) {
  const p = invoicePay(inv);
  return `<div class="card">
    <div class="spread"><span class="label">Payments</span>${payPill(inv)}</div>
    ${(inv.payments || []).map((pm, i) => `<div class="spread small"><span>${fmtDate(pm.date)}${pm.txn ? " · from bank" : ""}</span><span class="row"><span class="num">${money(pm.amount)}</span><button type="button" class="icon-btn danger" data-action="del-payment" data-id="${esc(inv._id)}" data-i="${i}" aria-label="Remove payment">${icon("x", 16)}</button></span></div>`).join("") || `<p class="small muted">Nothing received yet.</p>`}
    <div class="spread"><strong>Still owing</strong><strong class="num">${money(p.due)}</strong></div>
    ${p.due > 0 ? `<form id="payment-form" data-id="${esc(inv._id)}" class="pay-form">
      <label class="field"><span>Amount</span><input id="pay-amt" type="number" step="0.01" inputmode="decimal" value="${(p.paid > 0 ? p.due : r2(inv.total / 2)).toFixed(2)}" required></label>
      <label class="field"><span>Date received</span><input id="pay-date" type="date" value="${todayStr()}" required></label>
      <button class="btn primary" type="submit">Record</button>
    </form>
    <div class="row"><button type="button" class="btn small-btn" data-action="pay-full" data-id="${esc(inv._id)}">Paid in full today</button></div>` : ""}
  </div>`;
}
// What a freight line cost you: the linked freight bill, or your usual markup worked back
function freightNote(inv, l, i) {
  const bills = (inv.directCosts || []).filter((d) => d.freight);
  if (bills.length) return `Cost in Costs for this sale (${bills.map((d) => esc(d.name)).join(", ")})`;
  const mode = inv.zeroRated ? "zero" : taxModeOf(inv), charged = l.price * l.qty, ex = mode === "inclusive" ? charged / (1 + GST_RATE) : charged;
  const mu = S.settings.freightMarkup ?? 10;
  return `Cost about ${money(ex / (1 + mu / 100))} ex GST (your usual ${mu}% markup). Link the freight bill for the real cost. <button class="link-btn" data-action="line-cost" data-inv="${esc(inv._id)}" data-i="${i}">Change</button>`;
}

// Set the cost of one line on one invoice (a package, a special deal) without touching the product
function lineCostForm(invId, i) {
  const inv = S.invoices.get(invId), l = inv?.lines?.[i]; if (!l) return;
  const ov = inv.lineCosts?.[lineKey(l)], pr = makeProductFinder(S.products)(l);
  const mode = ov ? (ov.none ? "none" : "own") : "product";
  openSheet(`${sheetHead("Cost of this line", `${esc(l.qty)} × ${esc(l.name)} · on ${esc(inv.number)} only`)}
    <form id="line-cost-form" data-inv="${esc(invId)}" data-i="${i}" class="form">
      <label class="check"><input type="radio" name="lc" value="own" ${mode === "own" ? "checked" : ""}> My cost for this line</label>
      <div class="grid2">
        <label class="field"><span>Cost per unit, ${HOME()}</span><input id="lc-unit" type="number" step="0.01" inputmode="decimal" value="${ov?.unit ?? ""}" placeholder="landed, all in"></label>
        <label class="field"><span>Amount is</span><select id="lc-gst"><option value="ex">ex GST</option><option value="inc">incl GST (I'll take it off)</option></select></label>
      </div>
      <label class="check"><input type="radio" name="lc" value="none" ${mode === "none" ? "checked" : ""}> No cost on this line. I'll add the costs under Costs for this sale.</label>
      <label class="check"><input type="radio" name="lc" value="product" ${mode === "product" ? "checked" : ""}> Use the product's cost${pr?.cost ? ` (${esc(pr.name)}, ${money(costAt(pr, inv.date))} each)` : " (none found)"}</label>
      <p class="small muted">For a package, put the total cost of everything in it as the cost per unit. The product's own cost doesn't change.</p>
      <button class="btn primary wide" type="submit">Save</button>
    </form>`);
  $("#lc-unit").addEventListener("input", () => { $('input[name="lc"][value="own"]').checked = true; });
}

// Costs for one sale: things that aren't stock products (custom items, their freight, printing)
function directCostsBlock(inv, open) {
  const list = inv.directCosts || [], sum = list.reduce((a, d) => a + (Number(d.amount) || 0), 0);
  return `<details class="card pv-hide" ${list.length || open ? "open" : ""}><summary class="label">Costs for this sale${list.length ? ` · ${money(sum)}` : ""}</summary>
    ${list.map((d, i) => `<div class="spread small"><span>${esc(d.name)}${d.date ? ` <span class="muted">· ${fmtDate(d.date)}</span>` : ""}</span><span class="row"><span class="num">${money(d.amount)}</span><button type="button" class="icon-btn danger" data-action="dc-del" data-id="${esc(inv._id)}" data-i="${i}" aria-label="Remove cost">${icon("x", 16)}</button></span></div>`).join("")}
    <form id="dc-form" data-id="${esc(inv._id)}" class="pay-form">
      <label class="field"><span>What</span><input id="dc-name" placeholder="e.g. Bags from supplier, freight" required></label>
      <label class="field"><span>Amount ${HOME()}</span><input id="dc-amt" type="number" step="0.01" inputmode="decimal" required></label>
      <label class="field"><span>Amount is</span><select id="dc-gst"><option value="ex">ex GST</option><option value="inc">incl GST (I'll take it off)</option></select></label>
      <label class="check"><input type="checkbox" id="dc-freight"> This is the freight</label>
      <button class="btn" type="submit">Add cost</button>
    </form>
    <p class="small muted">For items that aren't products you stock. Heaters and accessories get their cost from the product.</p>
  </details>`;
}
function openInvoice(id) {
  const inv = S.invoices.get(id); if (!inv) return;
  const find = makeProductFinder(S.products);
  const c = invoiceCalc(inv, find), p = invoicePay(inv), quote = isQuote(inv);
  openSheet(`${sheetHead(`${quote ? "Quote" : "Invoice"} ${esc(inv.number)}`, `${fmtDate(inv.date)}${inv.source === "shopify" ? " · Shopify " + esc(inv.orderName) : ""}${inv.reference ? " · " + esc(inv.reference) : ""}`)}
    <div class="row wrap-actions">
      <button class="btn primary" data-action="invoice-share" data-id="${esc(id)}">${icon("share", 18)} Send PDF</button>
      <button class="btn" data-action="invoice-print" data-id="${esc(id)}">${icon("print", 18)} Print</button>
      <button class="btn" data-action="invoice-preview" data-id="${esc(id)}">Preview</button>
      ${inv.source !== "shopify" ? `<button class="btn" data-action="edit-invoice" data-id="${esc(id)}">Edit</button>` : ""}
      ${quote && inv.status !== "invoiced" ? `<button class="btn" data-action="quote-to-invoice" data-id="${esc(id)}">${icon("check", 18)} Turn into invoice</button>` : ""}
      ${quote && inv.status === "invoiced" && inv.invoiceId ? `<button class="btn" data-action="open-invoice" data-id="${esc(inv.invoiceId)}">Open invoice</button>` : ""}
      ${inv.fromQuoteId && S.invoices.has(inv.fromQuoteId) ? `<button class="btn" data-action="open-invoice" data-id="${esc(inv.fromQuoteId)}">Open quote ${esc(inv.fromQuote)}</button>` : ""}
      <button class="btn" data-action="duplicate-invoice" data-id="${esc(id)}">Duplicate</button>
      ${!quote && p.due > 0 && inv.dueDate && inv.dueDate < todayStr() ? `<button class="btn" data-action="invoice-remind" data-id="${esc(id)}">Send reminder</button>` : ""}
    </div>
    <div id="pdf-preview" class="preview" hidden></div>
    <div class="grid2">
      <div><span class="label">Customer</span><p><strong>${esc(inv.customer?.name || "")}</strong></p><p class="small muted pre">${esc([inv.customer?.company, inv.customer?.email, inv.customer?.phone, inv.customer?.address].filter(Boolean).join("\n"))}</p></div>
      ${inv.shipTo?.address ? `<div><span class="label">Ship to</span><p class="small pre">${esc([inv.shipTo.name, inv.shipTo.address].filter(Boolean).join("\n"))}</p></div>` : ""}
    </div>
    <div class="lines">
      ${(inv.lines || []).map((l, i) => { const pr = find(l), ov = inv.lineCosts?.[lineKey(l)]; return `<div class="line"><span>${esc(l.qty)} × ${esc(l.name)}${l.sku ? ` <span class="mono small muted">${esc(l.sku)}</span>` : ""}<div class="small muted pv-hide">${ov ? (ov.none ? "Not costed here (see Costs for this sale)" : `Cost ${money(ov.unit)} each, set for this sale`) + ` <button class="link-btn" data-action="line-cost" data-inv="${esc(id)}" data-i="${i}">Change</button>` : pr?.cost ? "Cost " + money(costAt(pr, inv.date)) + " each" + (productCosts(pr, inv.date).est ? " (price list estimate, upload the supplier invoice for the real cost)" : "") + ` <button class="link-btn" data-action="line-cost" data-inv="${esc(id)}" data-i="${i}">Change</button>` : FREIGHT_LINE.test(l.name || "") ? freightNote(inv, l, i) : SERVICE_LINE.test(l.name || "") ? "" : pr ? `${esc(pr.name)} has no cost yet. <button class="link-btn" data-action="open-product-cost" data-id="${esc(pr._id)}">Add its cost</button>` : `No matching product. <button class="link-btn" data-action="link-line" data-inv="${esc(id)}" data-i="${i}">Link to a product</button> or <button class="link-btn" data-action="line-cost" data-inv="${esc(id)}" data-i="${i}">set its cost</button>`}</div></span><span class="num">${money(l.price * l.qty)}</span></div>`; }).join("")}
      ${inv.shipping ? `<div class="line"><span>Shipping</span><span class="num">${money(inv.shipping)}</span></div>` : ""}
      ${inv.discount ? `<div class="line"><span>Discount</span><span class="num">−${money(inv.discount)}</span></div>` : ""}
      <div class="line"><strong>Total incl GST</strong><strong class="num">${money(inv.total)}</strong></div>
      ${inv.refunded ? `<div class="line"><span>Refunded</span><span class="num">−${money(inv.refunded)}</span></div>` : ""}
      <div class="line muted"><span>${inv.zeroRated ? "Zero-rated export, no GST" : taxModeOf(inv) === "exclusive" ? "GST 15% added" : "GST included"}</span><span class="num">${money(inv.gst ?? c.gst)}</span></div>
    </div>
    ${!quote && Array.isArray(inv.payments) ? paymentsBlock(inv) : ""}
    ${quote ? "" : directCostsBlock(inv, c.missing > 0)}
    <div class="mini-tiles">
      <div><span class="label">Sale ex GST</span><span class="num">${money(c.exGst)}</span></div>
      <div class="pv-hide"><span class="label">Cost</span><span class="num">${money(c.cogs)}</span></div>
      <div class="pv-hide"><span class="label">Margin</span><span class="num">${money(c.margin)}</span></div>
    </div>
    ${inv.message ? `<div><span class="label">Note to customer</span><p class="small pre">${esc(inv.message)}</p></div>` : ""}
    ${inv.notes ? `<div><span class="label">Private notes</span><p class="small muted pre">${esc(inv.notes)}</p></div>` : ""}
    ${inv.terms ? `<p class="small muted">T&amp;Cs printed on the last page of the PDF.</p>` : ""}
    <div class="row">
      <button class="btn danger" data-action="delete-invoice" data-id="${esc(id)}">Delete</button>
      ${!quote && inv.source !== "shopify" && inv.status !== "cancelled" ? `<button class="btn" data-action="void-invoice" data-id="${esc(id)}">Cancel invoice</button>` : ""}
      ${quote && ["open", "declined"].includes(inv.status || "open") ? `<button class="btn" data-action="quote-accepted" data-id="${esc(id)}">Mark accepted</button>` : ""}
      ${quote && ["open", "accepted"].includes(inv.status || "open") ? `<button class="btn" data-action="quote-declined" data-id="${esc(id)}">Mark declined</button>` : ""}
    </div>
    <p class="status" id="sheet-status"></p>`);
}

// ---------- Customer detail ----------
function openCustomer(key) {
  const c = customers().find((x) => x.key === key); if (!c) return;
  openSheet(`${sheetHead(esc(c.name || c.email), esc([c.email, c.phone].filter(Boolean).join(" · ")))}
    <div class="mini-tiles"><div><span class="label">Spent</span><span class="num">${money(c.spent)}</span></div><div><span class="label">Owing</span><span class="num">${money(c.owing)}</span></div><div><span class="label">Orders</span><span class="num">${c.invoices.filter((i) => !isQuote(i)).length}</span></div></div>
    ${c.address ? `<p class="small muted pre">${esc(c.address)}</p>` : ""}
    <div class="row"><button class="btn primary" data-action="new-invoice" data-customer="${esc(key)}">${icon("plus", 16)} Invoice</button><button class="btn" data-action="new-quote" data-customer="${esc(key)}">${icon("plus", 16)} Quote</button>
    ${c.email ? `<button class="btn" data-action="copy" data-text="${esc(c.email)}">Copy email</button>` : ""}</div>
    <div class="list">${c.invoices.sort((a, b) => b.date.localeCompare(a.date)).map(salesRow).join("") || empty("No invoices yet.")}</div>`);
}
function contactForm() {
  openSheet(`${sheetHead("Add customer")}
    <form id="contact-form" class="form">
      <div class="grid2">
        <label class="field"><span>Name</span><input id="ct-name" required autofocus></label>
        <label class="field"><span>Company</span><input id="ct-company"></label>
        <label class="field"><span>Email</span><input id="ct-email" type="email"></label>
        <label class="field"><span>Phone</span><input id="ct-phone" type="tel"></label>
      </div>
      <label class="field"><span>Address</span><textarea id="ct-addr" rows="3"></textarea></label>
      <button class="btn primary" type="submit">Save customer</button>
    </form>`);
}

// ---------- Invoice / quote form ----------
let lineSeq = 0;
function lineRow(l) {
  const k = ++lineSeq;
  return `<div class="inv-line">
    <label class="field ln-desc"><span>Description${l.sku ? ` <span class="mono">· ${esc(l.sku)}</span>` : ""}</span><input id="ln-name-${k}" class="ln-name" list="product-names" value="${esc(l.name)}" required></label>
    <label class="field"><span>Qty</span><input id="ln-qty-${k}" class="ln-qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(l.qty ?? 1)}" required></label>
    <label class="field"><span>Unit price</span><input id="ln-price-${k}" class="ln-price" type="number" step="0.01" inputmode="decimal" value="${esc(l.price)}" required></label>
    <button type="button" class="icon-btn danger" data-action="remove-line" aria-label="Remove line">${icon("x", 16)}</button>
    <input type="hidden" class="ln-sku" value="${esc(l.sku || "")}">
  </div>`;
}
const readLines = () => $$("#inv-lines .inv-line").map((row) => ({
  name: $(".ln-name", row).value.trim(), qty: num($(".ln-qty", row).value),
  price: r2(num($(".ln-price", row).value)), sku: $(".ln-sku", row).value.trim(),
})).filter((l) => l.name);
// How the prices on a quote or invoice are typed in:
//   inclusive: prices include GST (like your Shopify prices)
//   exclusive: prices are before GST, and 15% is added on top
//   zero:      zero-rated export, no GST
export const taxModeOf = (inv) => inv?.taxMode || (inv?.zeroRated ? "zero" : "inclusive");
const TAX_LABEL = { inclusive: "GST inclusive", exclusive: "GST exclusive", zero: "Zero-rated (export, no GST)" };
export function docTotals(lines, discount, mode) {
  const sub = r2(lines.reduce((a, l) => a + l.qty * l.price, 0) - (Number(discount) || 0));
  if (mode === "exclusive") { const gst = r2(sub * GST_RATE); return { sub, gst, total: r2(sub + gst), exGst: sub }; }
  if (mode === "zero") return { sub, gst: 0, total: sub, exGst: sub };
  const gst = r2(sub * GST_FRACTION); return { sub, gst, total: sub, exGst: r2(sub - gst) };
}
const curMode = () => $("#inv-tax")?.value || "inclusive";

// Totals, plus your costs and margin (with and without freight) so you can price a quote
function updateTotal() {
  const t = $("#inv-total"); if (!t) return;
  const lines = readLines(), mode = curMode();
  const tot = docTotals(lines, num($("#inv-discount")?.value), mode), total = tot.total;
  t.textContent = money(total);
  $("#inv-gst").textContent = mode === "zero" ? "No GST (zero-rated)" : mode === "exclusive" ? `${money(tot.sub)} + ${money(tot.gst)} GST` : `incl ${money(tot.gst)} GST`;
  const dl = $("#inv-disc-label"); if (dl) dl.textContent = `Discount, $ ${mode === "inclusive" ? "incl" : "excl"} GST`;
  const panel = $("#inv-costs"); if (!panel) return;
  const cost = linesCost(lines, makeProductFinder(S.products));
  const exTotal = tot.exGst;
  if (!cost.landed) { panel.innerHTML = lines.length ? `<span class="small muted">Add products with costs to see your margin here.</span>` : ""; return; }
  const m = (c) => { const v = exTotal - c, pc = exTotal > 0 ? Math.round((v / exTotal) * 100) : 0; return `<strong class="${pc < 15 ? "neg" : ""}">${money(v)}</strong> <span class="muted">${pc}%</span>`; };
  panel.innerHTML = `<span class="label">Your numbers (not on the ${$("#invoice-form").dataset.type === "quote" ? "quote" : "invoice"})</span>
    <div class="cost-grid">
      <span></span><span class="label">With freight</span><span class="label">Without freight</span>
      <span class="muted small">Cost</span><span class="num">${money(cost.landed)}</span><span class="num">${money(cost.exFreight)}</span>
      <span class="muted small">Margin</span><span class="num">${m(cost.landed)}</span><span class="num">${m(cost.exFreight)}</span>
    </div>
    ${cost.missing ? `<span class="small muted">${cost.missing} line${cost.missing > 1 ? "s have" : " has"} no cost, so the margin is higher than it really is.</span>` : ""}`;
}
// ---------- Link a sale line to a product ----------
// Shopify titles and SKUs don't always match the supplier's. Linking once remembers
// the Shopify name/SKU on the product, so every past and future sale of it finds its cost.
let linking = null;
function linkLine(invId, i) {
  const inv = S.invoices.get(invId), l = inv?.lines?.[i]; if (!l) return;
  linking = { invId, line: l };
  openSheet(`${sheetHead("Which product is this?", esc(l.name) + (l.sku ? ` · ${esc(l.sku)}` : ""))}
    <input type="search" id="link-q" class="search" placeholder="Search name, code or EAN" value="${esc(String(l.name).split(/\s+-\s+|\s+/).slice(0, 2).join(" "))}" autofocus>
    <div class="list" id="link-results">${linkResults(String(l.name).split(/\s+-\s+|\s+/).slice(0, 2).join(" "))}</div>
    <p class="small muted">Picking one remembers this Shopify name${l.sku ? " and SKU" : ""}, so every sale of it uses that product's cost from now on.</p>`);
}
function linkResults(q) {
  q = q.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = [...S.products.values()].filter((p) => { const t = `${p.name} ${p.sku} ${p.ean || ""} ${p.group || ""}`.toLowerCase(); return words.every((w) => t.includes(w)); })
    .sort((a, b) => (a.name || "").localeCompare(b.name || "")).slice(0, 40);
  if (!hits.length) return `<div class="empty small">Nothing matches. Try fewer words.</div>`;
  return hits.map((p) => `<button type="button" class="item" data-action="link-pick" data-id="${esc(p._id)}"><span class="t">${esc(p.name)}</span><span class="r">${p.cost ? money(p.cost) : `<span class="small muted">no cost</span>`}</span><span class="s mono">${esc(p.sku || "no SKU")}</span><span class="r small muted">cost</span></button>`).join("");
}

function productResults(q) {
  q = q.trim().toLowerCase();
  const all = [...S.products.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  const hits = q ? all.filter((p) => `${p.name} ${p.sku} ${p.ean || ""} ${p.group || ""} ${p.supplier || ""}`.toLowerCase().includes(q)) : all;
  if (!all.length) return `<div class="empty small">No products yet. Import a supplier invoice on the Products screen.</div>`;
  if (!hits.length) return `<div class="empty small">Nothing matches. Use "Add line" to type your own.</div>`;
  return hits.slice(0, 40).map((p) => `<button type="button" class="item" data-action="pick-product" data-id="${esc(p._id)}">
    <span class="t">${esc(p.name)}</span><span class="r">${p.price ? money(p.price) : `<span class="small muted">no price</span>`}</span>
    <span class="s mono">${esc(p.sku || "no SKU")}</span><span class="r small muted"></span></button>`).join("");
}
function customerResults(q) {
  q = q.trim().toLowerCase();
  if (q.length < 1) return "";
  const hits = customers().filter((c) => `${c.name} ${c.email} ${c.company}`.toLowerCase().includes(q)).slice(0, 6);
  return hits.map((c) => `<button type="button" class="item" data-action="pick-customer" data-id="${esc(c.key)}"><span class="t">${esc(c.name)}</span><span class="r"></span><span class="s">${esc(c.email || c.phone || "")}</span><span></span></button>`).join("");
}

function invoiceForm(id, type = "invoice", customerKey_ = null) {
  const inv = id ? S.invoices.get(id) : null;
  type = inv?.type || type;
  const quote = type === "quote";
  const pre = customerKey_ ? customers().find((c) => c.key === customerKey_) : null;
  const c = inv?.customer || pre || {}, sh = inv?.shipTo || {};
  const date = inv?.date || todayStr();
  const lines = inv?.lines?.length ? inv.lines : [{ qty: 1, name: "", sku: "", price: "" }];
  openSheet(`${sheetHead(inv ? `Edit ${esc(inv.number)}` : quote ? "New quote" : "New invoice")}
    <form id="invoice-form" data-id="${esc(id || "")}" data-type="${type}" class="form">
      <div class="field picker-wrap"><span>Customer</span>
        <input id="inv-name" value="${esc(c.name)}" required autocomplete="off" placeholder="Name, or search past customers">
        <div class="list picker-pop" id="cust-results"></div></div>
      <details ${c.email || c.address ? "open" : ""}><summary>Contact and address</summary>
        <div class="grid2">
          <label class="field"><span>Company</span><input id="inv-company" value="${esc(c.company)}"></label>
          <label class="field"><span>Email</span><input id="inv-email" type="email" value="${esc(c.email)}"></label>
          <label class="field"><span>Phone</span><input id="inv-phone" type="tel" value="${esc(c.phone)}"></label>
        </div>
        <label class="field"><span>Billing address</span><textarea id="inv-addr" rows="3">${esc(c.address)}</textarea></label>
        <label class="check"><input type="checkbox" id="inv-ship" ${sh.address ? "checked" : ""}> Ship to a different address</label>
        <div id="ship-fields" class="grid2" ${sh.address ? "" : "hidden"}>
          <label class="field"><span>Ship to name</span><input id="inv-shipname" value="${esc(sh.name)}"></label>
          <label class="field"><span>Ship to address</span><textarea id="inv-shipaddr" rows="3">${esc(sh.address)}</textarea></label>
        </div>
      </details>
      <label class="field"><span>Prices are</span><select id="inv-tax">
        ${["inclusive", "exclusive", "zero"].map((m) => `<option value="${m}" ${taxModeOf(inv) === m ? "selected" : ""}>${TAX_LABEL[m]}</option>`).join("")}</select></label>
      <div class="card">
        <div class="spread"><span class="label">Items</span>
          <span class="row"><button type="button" class="btn primary small-btn" data-action="open-picker">${icon("search", 16)} Add product</button><button type="button" class="btn small-btn" data-action="add-line">${icon("plus", 16)} Add line</button></span></div>
        <div id="picker" hidden class="picker">
          <input type="search" id="picker-q" placeholder="Search name or SKU" autocomplete="off">
          <div class="list" id="picker-results"></div>
        </div>
        <div id="inv-lines" class="lines-edit">${lines.map(lineRow).join("")}</div>
        <button type="button" class="btn small-btn add-line-btn" data-action="add-line">${icon("plus", 16)} Add line</button>
        <div class="spread"><label class="field discount"><span id="inv-disc-label">Discount, $ incl GST</span><input id="inv-discount" type="number" step="0.01" min="0" inputmode="decimal" value="${inv?.discount || ""}" placeholder="0.00"></label>
          <div class="total-box"><span class="muted small" id="inv-gst"></span><strong class="num big-total" id="inv-total">$0.00</strong></div></div>
      </div>
      <div class="cost-panel pv-hide" id="inv-costs" aria-live="polite"></div>
      <datalist id="product-names">${[...S.products.values()].map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist>
      <div class="grid3">
        <label class="field"><span>${quote ? "Quote date" : "Issue date"}</span><input id="inv-date" type="date" value="${esc(date)}" required></label>
        <label class="field"><span>${quote ? "Valid until" : "Due date"}</span><input id="inv-due" type="date" value="${esc(inv?.dueDate || addDays(date, quote ? S.settings.quoteDays ?? 30 : S.settings.dueDays ?? 7))}"></label>
        <label class="field"><span>Reference</span><input id="inv-ref" value="${esc(inv?.reference)}" placeholder="e.g. Smith job, PO 123"></label>
      </div>
      <label class="field"><span>Note to the customer (printed on the ${quote ? "quote" : "invoice"})</span><textarea id="inv-message" rows="2" placeholder="e.g. Lead time 3 to 4 weeks from deposit.">${esc(inv?.message)}</textarea></label>
      <details ${inv?.terms ? "open" : ""}><summary>Payment terms and T&amp;Cs</summary>
        <label class="field"><span>Payment terms (short, beside the bank details)</span><textarea id="inv-payterms" rows="2">${esc(inv?.paymentTerms ?? S.settings.paymentTerms)}</textarea></label>
        <label class="field"><span>Terms and conditions (printed on their own page)</span><textarea id="inv-terms" rows="8">${esc(inv?.terms ?? (quote ? S.settings.quoteTerms : S.settings.invoiceTerms) ?? "")}</textarea></label>
        <div class="row"><button type="button" class="btn small-btn" data-action="terms-default" data-type="${type}">Use my standard T&amp;Cs</button><button type="button" class="btn small-btn" data-action="terms-clear">No T&amp;Cs on this one</button></div>
        <p class="small muted">Set your standard wording in Setup.</p>
      </details>
      <label class="field"><span>Private notes (only you see these)</span><input id="inv-notes" value="${esc(inv?.notes)}"></label>
      <button class="btn primary wide" type="submit">${inv ? "Save changes" : quote ? "Create quote" : "Create invoice"}</button>
    </form>`, { wide: true });
  updateTotal();
}

// ---------- PDF ----------
let logoBytes = null;
async function pdfBytes(inv) {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js").catch(() => loadScript("https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js"));
  logoBytes = await getLogo();
  return buildInvoicePdf(window.PDFLib, inv, S.settings, logoBytes);
}
async function loadPdfJs() {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  return window.pdfjsLib;
}
export { loadPdfJs };

// ---------- Invoice export import (from your old accounts, e.g. Xero) ----------
// Xero: Business, Invoices, tick the invoices, Export. One row per invoice line.
// Column names vary a little (some start with *), so we match them loosely.
function xeroDate(t) {
  t = String(t || "").trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{2,4})/);                       // 8/11/2026 (NZ: day first)
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  const d = new Date(t); return isNaN(d) ? "" : d.toLocaleDateString("en-CA");  // "8 Nov 2026"
}
export function xeroInvoicesFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("That file is empty.");
  const key = (h) => String(h).replace(/^﻿/, "").replace(/[*\s]/g, "").toLowerCase();
  const idx = {}; rows[0].forEach((h, i) => { idx[key(h)] = i; });
  if (idx.invoicenumber == null || idx.contactname == null) throw new Error("That isn't a Xero invoice export. It needs the ContactName and InvoiceNumber columns.");
  const H = (r, k) => (idx[k] == null ? "" : String(r[idx[k]] ?? "").trim());
  const groups = new Map();
  for (const r of rows.slice(1)) { const n = H(r, "invoicenumber"); if (!n) continue; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(r); }
  const hasStatus = idx.status != null;
  const out = [], credits = [];
  for (const [number, rs] of groups) {
    const r0 = rs[0];
    const type = (H(r0, "type") + " " + number).toLowerCase();
    if (/credit|^cn-|\bcn-/.test(type)) { credits.push(number); continue; }
    const status = H(r0, "status").toLowerCase();
    if (/draft|deleted|voided|submitted/.test(status)) continue;
    const lines = rs.map((r) => {
      const qty = num(H(r, "quantity")) || 1, disc = num(H(r, "discount"));
      return { qty, name: H(r, "description") || H(r, "inventoryitemcode") || "Item", sku: H(r, "inventoryitemcode"), price: r2(num(H(r, "unitamount")) * (1 - disc / 100)),
        tax: num(H(r, "taxamount")), taxType: H(r, "taxtype").toLowerCase() };
    }).filter((l) => l.price || l.name !== "Item");
    const sum = r2(lines.reduce((a, l) => a + l.qty * l.price, 0)), tax = r2(lines.reduce((a, l) => a + l.tax, 0));
    const total = num(H(r0, "total")) || r2(sum + tax);
    // Work out how Xero had the amounts: GST exclusive, inclusive, or no GST (export)
    const zero = tax === 0 && lines.some((l) => /zero|export|exempt|no gst|none/.test(l.taxType));
    const taxMode = zero ? "zero" : Math.abs(sum + tax - total) < 0.06 && tax > 0 ? "exclusive" : "inclusive";
    const date = xeroDate(H(r0, "invoicedate"));
    const address = ["poaddressline1", "poaddressline2", "poaddressline3", "pocity", "poregion", "popostalcode", "pocountry"].map((k) => H(r0, k)).filter(Boolean).join("\n");
    out.push({ id: "xero-" + slug(number), data: {
      type: "invoice", source: "xero", number, reference: H(r0, "reference"), date, dueDate: xeroDate(H(r0, "duedate")) || date,
      status: "open", taxMode, zeroRated: taxMode === "zero", gst: taxMode === "zero" ? 0 : tax || r2(total * GST_FRACTION),
      customer: { name: H(r0, "contactname"), email: H(r0, "emailaddress"), address },
      lines: lines.map(({ tax, taxType, ...l }) => l), total, currency: H(r0, "currency") || HOME(),
      xeroStatus: status, importedAt: new Date().toISOString(),
    } });
  }
  return { invoices: out, credits, hasStatus };
}
// Is this Xero invoice really a Shopify order we already have? (Shopify-to-Xero apps copy orders across)
function xeroDuplicate(x) {
  const ref = `${x.reference} ${x.number}`;
  for (const inv of S.invoices.values()) {
    if (inv.source !== "shopify") continue;
    const no = String(inv.orderName || "").replace("#", "");
    if (no && new RegExp(`(^|[^0-9])#?${no}([^0-9]|$)`).test(ref)) return inv;
    if (Math.abs((inv.total || 0) - x.total) < 0.05 && inv.date && x.date && Math.abs(new Date(inv.date) - new Date(x.date)) <= 3 * 864e5) return inv;
  }
  return null;
}
let xeroImport = null;
function xeroReview(res) {
  const fresh = [], dupes = [];
  for (const x of res.invoices) { const d = xeroDuplicate(x.data); if (d) dupes.push({ x, d }); else fresh.push(x); }
  xeroImport = { fresh, dupes, hasStatus: res.hasStatus };
  const dates = fresh.map((x) => x.data.date).filter(Boolean).sort();
  const sum = fresh.reduce((a, x) => a + x.data.total, 0);
  const owing = fresh.filter((x) => /authori[sz]ed|awaiting/.test(x.data.xeroStatus)).length;
  openSheet(`${sheetHead("Import sales", `${fresh.length} invoice${fresh.length === 1 ? "" : "s"}${dates.length ? ` · ${fmtDate(dates[0])} to ${fmtDate(dates.at(-1))}` : ""}`)}
    <div class="card"><div class="spread"><span>Total incl GST</span><strong class="num">${money(sum)}</strong></div>
      ${res.credits.length ? `<p class="small muted">Skipped ${res.credits.length} credit note${res.credits.length > 1 ? "s" : ""}. Add refunds to the invoice they belong to.</p>` : ""}
      ${dupes.length ? `<details><summary class="small">Skipping ${dupes.length} that are already here as Shopify orders</summary><div class="list flat">${dupes.map(({ x, d }) => `<div class="item static"><span class="t">${esc(x.data.number)} · ${esc(x.data.customer.name)}</span><span class="r num">${money(x.data.total)}</span><span class="s">same as Shopify ${esc(d.orderName || d.number)}</span><span></span></div>`).join("")}</div></details>` : ""}
    </div>
    ${res.hasStatus && owing ? `<p class="small">${owing} still awaiting payment in Xero. They'll show as owing.</p>` : ""}
    ${res.hasStatus ? "" : `<label class="field"><span>These invoices are</span><select id="xero-paid">
      <option value="paid">Paid</option><option value="owing">Awaiting payment (still owed to you)</option></select></label>`}
    <p class="small muted">Paid invoices count as paid on their invoice date. Importing the same file again just updates them.</p>
    <div class="list">${fresh.slice(0, 60).map((x) => `<div class="item static"><span class="t">${esc(x.data.number)} · ${esc(x.data.customer.name)}</span><span class="r num">${money(x.data.total)}</span><span class="s">${fmtDate(x.data.date)} · ${x.data.lines.length} line${x.data.lines.length === 1 ? "" : "s"} · ${{ exclusive: "GST exclusive", inclusive: "GST inclusive", zero: "zero-rated" }[x.data.taxMode]}</span><span></span></div>`).join("")}</div>
    ${fresh.length > 60 ? `<p class="small muted">and ${fresh.length - 60} more</p>` : ""}
    <button class="btn primary wide" data-action="xero-save" ${fresh.length ? "" : "disabled"}>Import ${fresh.length} invoice${fresh.length === 1 ? "" : "s"}</button>`);
}

// ---------- Shopify CSV import ----------
async function importShopify(text) {
  const say = (m) => { const s = $("#import-status"); if (s) s.textContent = m; else toast(m); };
  const { orders, skipped } = shopifyOrdersFromCSV(text);
    if (!orders.length) { say(`No paid orders found${skipped ? ` (${skipped} unpaid or pending skipped)` : ""}.`); return; }
    let added = 0;
    const ops = orders.map((o) => { if (!S.invoices.has(o.id)) added++; return { op: "put", kind: "invoice", id: o.id, data: { ...(S.invoices.get(o.id) || {}), ...o.data } }; });
    say(`Importing ${orders.length} orders…`);
    await saveMany(ops);
    const msg = `Imported ${added} new and updated ${orders.length - added} orders${skipped ? `. Skipped ${skipped} unpaid or pending.` : "."}`;
    say(msg); toast(msg); render();
}
function shopifyOrdersFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("That file is empty.");
  const idx = {}; rows[0].forEach((h, i) => (idx[h.trim()] = i));
  if (idx["Name"] == null || idx["Lineitem name"] == null) throw new Error("That isn't a Shopify order export. It needs the Name and Lineitem columns.");
  const H = (r, k) => (idx[k] == null ? "" : (r[idx[k]] ?? "").trim());
  const groups = new Map();
  for (const r of rows.slice(1)) { const n = H(r, "Name"); if (!n) continue; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(r); }
  const orders = []; let skipped = 0;
  const addr = (r, p) => [`${p} Address1`, `${p} Address2`, `${p} City`, `${p} Province`, `${p} Zip`, `${p} Country`].map((k) => H(r, k)).filter(Boolean).join("\n");
  for (const [name, rs] of groups) {
    const r0 = rs.find((r) => H(r, "Financial Status")) || rs[0];
    const fin = H(r0, "Financial Status").toLowerCase();
    if (!["paid", "partially_refunded", "refunded", "partially_paid"].includes(fin)) { skipped++; continue; }
    const country = (H(r0, "Shipping Country") || H(r0, "Billing Country")).toUpperCase();
    const taxes = num(H(r0, "Taxes"));
    const orderNo = name.replace(/^#/, "");
    const bill = addr(r0, "Billing"), ship = addr(r0, "Shipping");
    orders.push({ id: "shopify-" + slug(orderNo), data: {
      type: "invoice", source: "shopify", orderName: name,
      number: (S.settings.invoicePrefix ?? "KP-") + orderNo,
      date: (H(r0, "Paid at") || H(r0, "Created at")).slice(0, 10),
      status: H(r0, "Cancelled at") ? "cancelled" : fin === "refunded" ? "refunded" : "paid",
      customer: { name: H(r0, "Billing Name") || H(r0, "Shipping Name"), email: H(r0, "Email"), company: H(r0, "Billing Company"), phone: H(r0, "Billing Phone") || H(r0, "Phone"), address: bill },
      shipTo: ship && ship !== bill ? { name: H(r0, "Shipping Name"), address: ship } : null,
      country, zeroRated: taxes === 0 && !!country && country !== "NZ",
      lines: rs.map((r) => ({ qty: num(H(r, "Lineitem quantity")) || 1, name: H(r, "Lineitem name"), price: num(H(r, "Lineitem price")), sku: H(r, "Lineitem sku") })).filter((l) => l.name),
      shipping: num(H(r0, "Shipping")), discount: num(H(r0, "Discount Amount")), total: num(H(r0, "Total")),
      taxes, refunded: num(H(r0, "Refunded Amount")), currency: H(r0, "Currency") || HOME(), importedAt: new Date().toISOString(),
    } });
  }
  return { orders, skipped };
}

// ---------- Buttons ----------
const actions = {
  "sales-tab": (el) => { V.tab = el.dataset.tab; V.q = ""; V.shown = 50; render(); },
  "sales-filter": (el) => { V.filter = el.dataset.f; render(); },
  "sales-more": () => { V.shown += 50; render(); },
  "open-invoice": (el) => openInvoice(el.dataset.id),
  "xero-save": async () => {
    if (!xeroImport) return;
    const allOwing = !xeroImport.hasStatus && $("#xero-paid")?.value === "owing";
    const ops = xeroImport.fresh.map((x) => {
      const old = S.invoices.get(x.id) || {};
      const owing = allOwing || /authori[sz]ed|awaiting/.test(x.data.xeroStatus);
      // Paid: one payment on the invoice date. Owing: no payments yet (keeps any you've added since).
      const payments = old.payments?.length ? old.payments : owing ? [] : [{ date: x.data.date, amount: x.data.total, note: "Paid (from Xero)" }];
      return { op: "put", kind: "invoice", id: x.id, data: { ...old, ...x.data, payments } };
    });
    await saveMany(ops);
    const n = ops.length; xeroImport = null; closeSheet(); toast(`Imported ${n} invoice${n === 1 ? "" : "s"}`); render();
  },
  "line-cost": (el) => lineCostForm(el.dataset.inv, Number(el.dataset.i)),
  "dc-del": async (el) => {
    const inv = S.invoices.get(el.dataset.id); if (!inv) return;
    const { _id, ...data } = inv, gone = (inv.directCosts || [])[Number(el.dataset.i)];
    data.directCosts = (inv.directCosts || []).filter((_, i) => i !== Number(el.dataset.i));
    await save("invoice", _id, data);
    // Removing a linked freight bill: the bill goes back to being an ordinary expense
    if (gone?.bill && S.bills.has(gone.bill)) { const { _id: bid, ...b } = S.bills.get(gone.bill); delete b.forInvoice; await save("bill", bid, b); }
    openInvoice(_id); render();
  },
  "link-line": (el) => linkLine(el.dataset.inv, Number(el.dataset.i)),
  "link-pick": async (el) => {
    const p = S.products.get(el.dataset.id); if (!p || !linking) return;
    const { _id, ...data } = p, l = linking.line;
    data.aliases = [...new Set([...(p.aliases || []), l.name, l.sku].filter(Boolean))];
    await save("product", _id, data);
    toast(`Linked to ${p.name}`); const invId = linking.invId; linking = null; openInvoice(invId); render();
  },
  "open-product-cost": (el) => { location.hash = "#products"; setTimeout(() => document.querySelector(`[data-action="open-product"][data-id="${CSS.escape(el.dataset.id)}"]`)?.click(), 300); },
  "open-customer": (el) => openCustomer(el.dataset.id),
  "new-contact": () => contactForm(),
  "new-invoice": (el) => invoiceForm(null, "invoice", el?.dataset?.customer),
  "new-quote": (el) => invoiceForm(null, "quote", el?.dataset?.customer),
  "edit-invoice": (el) => invoiceForm(el.dataset.id),
  "copy": (el) => copyText(el.dataset.text),
  "add-line": () => { $("#inv-lines").insertAdjacentHTML("beforeend", lineRow({ qty: 1, name: "", price: "" })); $$("#inv-lines .ln-name").pop().focus(); },
  "remove-line": (el) => { if ($$("#inv-lines .inv-line").length > 1) { el.closest(".inv-line").remove(); updateTotal(); } },
  "open-picker": () => { const pk = $("#picker"); pk.hidden = !pk.hidden; if (!pk.hidden) { $("#picker-results").innerHTML = productResults($("#picker-q").value); $("#picker-q").focus(); } },
  "pick-product": (el) => {
    const p = S.products.get(el.dataset.id); if (!p) return;
    const blank = $$("#inv-lines .inv-line").find((r) => !$(".ln-name", r).value.trim());
    const unit = p.price ? (curMode() === "inclusive" ? p.price : p.price / (1 + GST_RATE)) : 0;
    const html = lineRow({ qty: 1, name: p.name, sku: p.sku, price: unit ? unit.toFixed(2) : "" });
    if (blank) blank.outerHTML = html; else $("#inv-lines").insertAdjacentHTML("beforeend", html);
    $("#picker").hidden = true; $("#picker-q").value = ""; updateTotal();
    toast(p.price ? `Added ${p.name}` : `Added ${p.name}. Enter a price.`);
  },
  "pick-customer": (el) => {
    const c = customers().find((x) => x.key === el.dataset.id); if (!c) return;
    $("#inv-name").value = c.name || ""; $("#inv-company").value = c.company || ""; $("#inv-email").value = c.email || "";
    $("#inv-phone").value = c.phone || ""; $("#inv-addr").value = c.address || "";
    $("#cust-results").innerHTML = ""; $("details", $("#invoice-form")).open = true;
  },
  "pay-full": async (el) => {
    const inv = S.invoices.get(el.dataset.id), p = invoicePay(inv);
    await save("invoice", inv._id, { ...inv, payments: [...(inv.payments || []), { date: todayStr(), amount: p.due }] });
    toast(`Recorded ${money(p.due)}`); openInvoice(inv._id); render();
  },
  "del-payment": async (el) => {
    const inv = S.invoices.get(el.dataset.id);
    await save("invoice", inv._id, { ...inv, payments: inv.payments.filter((_, i) => i !== Number(el.dataset.i)) });
    toast("Payment removed"); openInvoice(inv._id); render();
  },
  "delete-invoice": async (el) => { if (!confirmTap(el, "Tap again to delete")) return; await remove("invoice", el.dataset.id); closeSheet(); toast("Deleted"); render(); },
  "void-invoice": async (el) => { if (!confirmTap(el, "Tap again to cancel it")) return; const inv = S.invoices.get(el.dataset.id); await save("invoice", inv._id, { ...inv, status: "cancelled" }); openInvoice(inv._id); render(); },
  "quote-accepted": async (el) => { const inv = S.invoices.get(el.dataset.id); await save("invoice", inv._id, { ...inv, status: "accepted", acceptedAt: todayStr() }); toast("Marked accepted"); openInvoice(inv._id); render(); },
  "duplicate-invoice": async (el) => {
    // A fresh copy with today's date and the next number, opened for editing
    const src = S.invoices.get(el.dataset.id), quote = isQuote(src), key = quote ? "nextQuote" : "nextManual", n = S.settings[key] || 1;
    const { _id, payments, status, sentAt, invoiceId, fromQuote, fromQuoteId, acceptedAt, orderName, shopifyId, importedAt, refunded, ...rest } = src;
    const id = `${quote ? "quote" : "manual"}-${n}`;
    await save("invoice", id, { ...rest, source: "manual", status: "open", refunded: 0, date: todayStr(), dueDate: addDays(todayStr(), quote ? S.settings.quoteDays ?? 30 : S.settings.dueDays ?? 7),
      number: `${quote ? S.settings.quotePrefix || "QU-" : S.settings.manualPrefix || "INV-"}${String(n).padStart(4, "0")}`, payments: quote ? undefined : [] });
    await saveSettings({ [key]: n + 1 });
    toast("Copy made. Change what you need."); invoiceForm(id); render();
  },
  "terms-default": (el) => { $("#inv-terms").value = (el.dataset.type === "quote" ? S.settings.quoteTerms : S.settings.invoiceTerms) || ""; },
  "terms-clear": () => { $("#inv-terms").value = ""; },
  "quote-declined": async (el) => { const inv = S.invoices.get(el.dataset.id); await save("invoice", inv._id, { ...inv, status: "declined" }); openInvoice(inv._id); render(); },
  "quote-to-invoice": async (el) => {
    const q = S.invoices.get(el.dataset.id), n = S.settings.nextManual || 1, id = `manual-${n}`;
    const inv = { ...q, _id: undefined, type: "invoice", status: "open", fromQuote: q.number, fromQuoteId: q._id, date: todayStr(), dueDate: addDays(todayStr(), S.settings.dueDays ?? 7),
      number: `${S.settings.manualPrefix || "INV-"}${String(n).padStart(4, "0")}`, payments: [],
      terms: S.settings.invoiceTerms || q.terms || "" };
    await save("invoice", id, inv);
    await saveSettings({ nextManual: n + 1 });
    await save("invoice", q._id, { ...q, status: "invoiced", invoiceId: id });
    toast(`Invoice ${inv.number} created`); openInvoice(id); render();
  },
  "invoice-share": async (el) => {
    const inv = S.invoices.get(el.dataset.id), st = $("#sheet-status");
    st.textContent = "Making PDF…";
    const blob = new Blob([await pdfBytes(inv)], { type: "application/pdf" });
    const what = isQuote(inv) ? "quote" : "invoice";
    const r = await shareOrDownload(blob, `${S.settings.businessName} ${inv.number}.pdf`,
      `Hi ${inv.customer?.name?.split(" ")[0] || "there"}, please find ${what} ${inv.number} attached. Thanks, ${S.settings.businessName}`);
    st.textContent = r === "downloaded" ? "PDF downloaded." : "";
    if (r === "shared" && !inv.sentAt) await save("invoice", inv._id, { ...inv, sentAt: new Date().toISOString() });
  },
  // Print: on a computer the print window opens straight away. On a phone or tablet the PDF
  // opens in a new tab, where the share button has Print.
  "invoice-print": async (el) => {
    const inv = S.invoices.get(el.dataset.id), st = $("#sheet-status");
    const touch = matchMedia("(pointer: coarse)").matches;
    const tab = touch ? window.open("", "_blank") : null;      // open now, while it still counts as your tap
    st.textContent = "Making PDF…";
    const url = URL.createObjectURL(new Blob([await pdfBytes(inv)], { type: "application/pdf" }));
    if (touch) {
      if (tab) tab.location.href = url; else location.href = url;
      st.textContent = "";
    } else {
      document.getElementById("print-frame")?.remove();
      const f = Object.assign(document.createElement("iframe"), { id: "print-frame", src: url, title: "Print" });
      f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
      f.onload = () => { try { f.contentWindow.focus(); f.contentWindow.print(); st.textContent = ""; } catch { window.open(url, "_blank"); st.textContent = "PDF opened in a new tab. Print from there."; } };
      document.body.appendChild(f);
    }
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  },
  "invoice-preview": async (el) => {
    const inv = S.invoices.get(el.dataset.id), box = $("#pdf-preview"), st = $("#sheet-status");
    if (!box.hidden) { box.hidden = true; return; }
    st.textContent = "Drawing preview…";
    const bytes = await pdfBytes(inv);
    const lib = await loadPdfJs();
    const pdf = await lib.getDocument({ data: bytes }).promise;
    const page = await pdf.getPage(1);
    const vp = page.getViewport({ scale: Math.min(2.5, (box.parentElement.clientWidth * (devicePixelRatio || 1)) / 595) });
    const canvas = document.createElement("canvas"); canvas.width = vp.width; canvas.height = vp.height;
    await page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise;
    box.replaceChildren(canvas); box.hidden = false; st.textContent = "";
  },
  "invoice-remind": async (el) => {
    const inv = S.invoices.get(el.dataset.id), p = invoicePay(inv);
    const text = `Hi ${inv.customer?.name?.split(" ")[0] || "there"}, a friendly reminder that invoice ${inv.number} for ${money(p.due)} was due on ${fmtDate(inv.dueDate)}. ` +
      `You can pay by bank transfer to ${S.settings.bankName}, ${S.settings.bankAccount}, using ${inv.number} as the reference. Thanks, ${S.settings.businessName}`;
    if (navigator.share) { try { await navigator.share({ text }); return; } catch (e) { if (e.name === "AbortError") return; } }
    copyText(text);
  },
};

const submits = {
  "invoice-form": async (f) => {
    const editId = f.dataset.id, old = editId ? S.invoices.get(editId) : null, type = f.dataset.type;
    const lines = readLines();
    if (!lines.length) { toast("Add at least one line."); return; }
    const mode = curMode(), zero = mode === "zero", quote = type === "quote";
    const tot = docTotals(lines, num($("#inv-discount").value), mode);
    const counterKey = quote ? "nextQuote" : "nextManual", n = S.settings[counterKey] || 1;
    const data = {
      ...(old || {}), type, source: "manual",
      number: old ? old.number : `${quote ? S.settings.quotePrefix || "QU-" : S.settings.manualPrefix || "INV-"}${String(n).padStart(4, "0")}`,
      date: $("#inv-date").value, dueDate: $("#inv-due").value, reference: $("#inv-ref").value.trim(), notes: $("#inv-notes").value.trim(),
      status: old?.status || "open",
      customer: { name: $("#inv-name").value.trim(), company: $("#inv-company").value.trim(), email: $("#inv-email").value.trim(), phone: $("#inv-phone").value.trim(), address: $("#inv-addr").value.trim() },
      shipTo: $("#inv-ship").checked ? { name: $("#inv-shipname").value.trim(), address: $("#inv-shipaddr").value.trim() } : null,
      zeroRated: zero, country: zero ? "" : "NZ",
      taxMode: mode, lines, shipping: 0, discount: r2(num($("#inv-discount").value)), total: tot.total, gst: tot.gst, refunded: 0, currency: HOME(),
      message: $("#inv-message").value.trim(), terms: $("#inv-terms").value.trim(), paymentTerms: $("#inv-payterms").value.trim(),
      payments: quote ? undefined : old?.payments || [],
    };
    const id = editId || `${quote ? "quote" : "manual"}-${n}`;
    await save("invoice", id, data);
    if (!editId) await saveSettings({ [counterKey]: n + 1 });
    toast(editId ? "Saved" : `${quote ? "Quote" : "Invoice"} ${data.number} created`);
    openInvoice(id); render();
  },
  "line-cost-form": async (f) => {
    const inv = S.invoices.get(f.dataset.inv), l = inv?.lines?.[Number(f.dataset.i)]; if (!l) return;
    const mode = $('input[name="lc"]:checked')?.value || "product", key = lineKey(l);
    const { _id, ...data } = inv; data.lineCosts = { ...(inv.lineCosts || {}) };
    if (mode === "product") delete data.lineCosts[key];
    else if (mode === "none") data.lineCosts[key] = { none: true };
    else {
      let unit = num($("#lc-unit").value); if ($("#lc-gst").value === "inc") unit = r2(unit / (1 + GST_RATE));
      if (!(unit >= 0) || $("#lc-unit").value === "") { toast("Type the cost per unit."); return; }
      data.lineCosts[key] = { unit: r2(unit) };
    }
    await save("invoice", _id, data); toast("Cost saved for this sale"); openInvoice(_id); render();
  },
  "dc-form": async (f) => {
    const inv = S.invoices.get(f.dataset.id); if (!inv) return;
    let amount = num($("#dc-amt").value); if ($("#dc-gst").value === "inc") amount = r2(amount / (1 + GST_RATE));
    const { _id, ...data } = inv;
    data.directCosts = [...(inv.directCosts || []), { name: $("#dc-name").value.trim(), amount: r2(amount), date: todayStr(), ...($("#dc-freight").checked || FREIGHT_LINE.test($("#dc-name").value) ? { freight: true } : {}) }];
    await save("invoice", _id, data); toast("Cost added"); openInvoice(_id); render();
  },
  "payment-form": async (f) => {
    const inv = S.invoices.get(f.dataset.id);
    const amt = r2(num($("#pay-amt").value)); if (amt <= 0) { toast("Enter the amount received."); return; }
    await save("invoice", inv._id, { ...inv, payments: [...(inv.payments || []), { date: $("#pay-date").value, amount: amt }] });
    toast(`Recorded ${money(amt)}`); openInvoice(inv._id); render();
  },
  "contact-form": async () => {
    const c = { type: "customer", name: $("#ct-name").value.trim(), company: $("#ct-company").value.trim(), email: $("#ct-email").value.trim(), phone: $("#ct-phone").value.trim(), address: $("#ct-addr").value.trim() };
    const id = customerKey(c);
    await save("contact", id, c); toast("Customer saved"); openCustomer(id); render();
  },
};

const changes = {
  // One button for any sales export: a Shopify order export, or an invoice export from your old accounts (Xero)
  "import-sales": async (el) => {
    const file = el.files?.[0]; el.value = ""; if (!file) return;
    const text = await file.text(), head = (text.split(/\r?\n/)[0] || "").toLowerCase();
    try {
      if (head.includes("lineitem name")) return await importShopify(text);
      if (head.replace(/[*\s]/g, "").includes("invoicenumber")) return xeroReview(xeroInvoicesFromCSV(text));
      toast("That file isn't a sales export I know. Use a Shopify order export, or an invoice export from your old accounts.");
    } catch (e) { toast(e.message); }
  },
  "inv-ship": (el) => { $("#ship-fields").hidden = !el.checked; },


  "inv-tax": () => updateTotal(),
  "inv-date": (el) => { const f = $("#invoice-form"); if (!f.dataset.id) $("#inv-due").value = addDays(el.value, f.dataset.type === "quote" ? S.settings.quoteDays ?? 30 : S.settings.dueDays ?? 7); },
};
// Typing a known product name fills its SKU and price
document.addEventListener("change", (ev) => {
  const el = ev.target; if (!el.classList?.contains("ln-name")) return;
  const row = el.closest(".inv-line"), p = [...S.products.values()].find((x) => x.name === el.value.trim());
  if (p) { $(".ln-sku", row).value = p.sku || ""; const pr = $(".ln-price", row); if (!pr.value && p.price) pr.value = p.price.toFixed(2); updateTotal(); }
});
document.addEventListener("input", (ev) => { if (ev.target.closest?.("#inv-lines")) updateTotal(); });

const inputs = {
  "sales-q": (el) => { V.q = el.value; V.shown = 50; rerenderKeepFocus("sales-q"); },
  "picker-q": (el) => { $("#picker-results").innerHTML = productResults(el.value); },
  "link-q": (el) => { $("#link-results").innerHTML = linkResults(el.value); },
  "inv-discount": () => updateTotal(),
  "inv-name": (el) => { if (!$("#invoice-form").dataset.id) $("#cust-results").innerHTML = customerResults(el.value); },
};

register("sales", { render: render_, actions, submits, changes, inputs });
