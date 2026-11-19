// Drives the real app in a browser with sample data, takes screenshots, and fails on
// script errors or sideways scrolling. Run: node --experimental-sqlite dev/ui.mjs <outdir>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_PATH || "playwright");
import crypto from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { installMocks, realFetch } from "./mocks.mjs";
import { makeEnv, serve } from "./server.mjs";
import { DEFAULT_SETTINGS } from "../public/js/calc.js";

installMocks();
const PDFLibNode = createRequire(import.meta.url)(process.env.PDFLIB_PATH || "pdf-lib");
const out = process.argv[2] || "/tmp";
const env = makeEnv({ ANTHROPIC_API_KEY: "test", AKAHU_APP_TOKEN: "a", AKAHU_USER_TOKEN: "u" });
const server = await serve(env, 8811);
const base = "http://localhost:8811";
const put = (kind, id, data) => realFetch(`${base}/api/rec/${kind}/${id}?biz=kp`, { method: "PUT", body: JSON.stringify(data), headers: { "content-type": "application/json" } });

// ---- Sample data (clearly fake names) ----
// A sample NZ business, as if set up on the first-run screen
await put("settings", "main", { ...DEFAULT_SETTINGS, country: "NZ", businessName: "Kauri Point Sauna", legalName: "Kauri Point Sauna Limited", gstNumber: "123-456-789",
  address: "Auckland, New Zealand", website: "kauripointsauna.co.nz", bankName: "Kauri Point Sauna Limited", bankAccount: "12-3456-7890123-00",
  invoicePrefix: "KP-", nextManual: 16, about: "imports sauna heaters and sells them online",
  quoteTerms: DEFAULT_SETTINGS.quoteTerms + "\nConsumer law\nNothing limits your rights under the Consumer Guarantees Act 1993.",
  invoiceTerms: DEFAULT_SETTINGS.invoiceTerms + "\nConsumer law\nNothing limits your rights under the Consumer Guarantees Act 1993." });
const products = [["ns45", "Narvi NS 4.5kW", "NS45", 820, 1349, 3, 2], ["ns6", "Narvi NS 6kW", "NS6", 905, 1499, 1, 2], ["ultra9", "Narvi Ultra 9kW", "NU9", 2650, 4590, null, null], ["stones", "Traditional sauna stones 10-15 cm", "ST1015", 48, 125, 12, 4]];
for (const [id, name, sku, cost, price, countQty, reorderAt] of products)
  await put("product", id, { name, sku, cost, price, ...(countQty != null ? { countQty, countDate: "2026-10-01", reorderAt } : {}), supplier: "Narvi Oy" });
const sign = (raw) => crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
const days = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });
let n = 1040;
for (const [d, item, qty, price, who] of [[2, "Narvi NS 4.5kW", 1, 1349, "Sample Customer A"], [6, "Narvi Ultra 9kW", 1, 4590, "Sample Customer B"], [12, "Traditional sauna stones 10-15 cm", 4, 125, "Sample Customer C"], [20, "Narvi NS 6kW", 1, 1499, "Sample Customer D"], [60, "Narvi NS 4.5kW", 1, 1349, "Sample Customer E"], [70, "Narvi Ultra 9kW", 1, 4590, "Sample Customer F"]]) {
  const total = qty * price;
  const raw = JSON.stringify({ id: n, name: "#" + n, order_number: n++, financial_status: "paid", processed_at: days(d) + "T10:00:00+13:00", total_price: String(total), total_tax: String((total * 3 / 23).toFixed(2)),
    billing_address: { name: who, city: "Auckland", country_code: "NZ" }, line_items: [{ quantity: qty, title: item, price: String(price), sku: products.find((p) => p[1] === item)[2] }] });
  await realFetch(`${base}/api/hooks/shopify/kp`, { method: "POST", body: raw, headers: { "x-shopify-hmac-sha256": sign(raw) } });
}
await put("invoice", "manual-15", { type: "invoice", source: "manual", number: "INV-0015", date: days(9), dueDate: days(2), reference: "Sample sauna", customer: { name: "Sample Export Customer", address: "Papeete\nTahiti" },
  zeroRated: true, lines: [{ qty: 2, name: "Traditional sauna stones 10-15 cm", sku: "ST1015", price: 125 }, { qty: 1, name: "Narvi NS 4.5kW", sku: "NS45", price: 1349 }, { qty: 1, name: "International Freight", price: 1050 }], total: 2649, payments: [{ date: days(8), amount: 1324.5 }] });
await put("bill", "b1", { supplier: "Sample Courier Co", date: days(5), paidDate: "", total: 172.5, gst: 22.5, gstTreatment: "standard", category: "Outbound shipping & couriers", dueDate: days(-3) });
await put("bill", "b2", { supplier: "Sample Ads", date: days(15), paidDate: days(15), total: 345, gst: 45, gstTreatment: "standard", category: "Advertising & marketing" });
await realFetch(`${base}/api/bank/sync?biz=kp`, { method: "POST" });
await put("txn", "tx9", { account: "acc_biz", date: days(1), description: "SAMPLE EXPORT CUSTOMER INV-0015", amount: 1324.5, status: "new", source: "akahu" });

// ---- Browser ----
const browser = await chromium.launch();
const pdfLib = readFileSync("/opt/npm-tools/node_modules/pdf-lib/dist/pdf-lib.min.js", "utf8");
const problems = [];
async function page(width, name, extra = {}) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 860 : 900 }, deviceScaleFactor: 1, acceptDownloads: true, ...extra });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => problems.push(`${name}: ${e.message}`));
  p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|fonts/.test(m.text())) problems.push(`${name} console: ${m.text()}`); });
  await p.route("https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/**", (r) => r.fulfill({ body: pdfLib, contentType: "text/javascript" }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route("https://cdnjs.cloudflare.com/ajax/libs/jszip/**", (r) => r.fulfill({ contentType: "text/javascript", body: `window.JSZip = class { constructor() { this.f = {}; window.__zip = this.f; }
    file(n, d) { this.f[n] = d; } async generateAsync() { return new Blob([JSON.stringify(Object.keys(this.f))]); } };` }));
  // Tiny stand-in for the Excel library: records the sheets so the test can read them back
  await p.route("https://cdnjs.cloudflare.com/ajax/libs/xlsx/**", (r) => r.fulfill({ contentType: "text/javascript", body: `window.XLSX = { utils: {
    book_new: () => ({ sheets: [] }), aoa_to_sheet: (rows) => ({ rows }), book_append_sheet: (wb, ws, name) => wb.sheets.push([name, ws.rows]) },
    write: (wb) => { window.__pack = wb.sheets; return new TextEncoder().encode(JSON.stringify(wb.sheets)); } };` }));
  await p.goto(base + "/#home");
  await p.waitForSelector(".hero");
  return p;
}
const overflow = async (p, label) => { const w = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); if (w > 1) problems.push(`${label}: page scrolls sideways by ${w}px`); };
const shot = async (p, file) => { await p.waitForTimeout(150); await p.screenshot({ path: `${out}/${file}.png` }); };

// Phone
const ph = await page(390, "phone");
await shot(ph, "01-phone-home"); await overflow(ph, "phone home");
for (const v of ["sales", "bills", "bank", "products", "gst", "reports", "setup", "more"]) { await ph.goto(base + "/#" + v); await ph.waitForTimeout(250); await overflow(ph, "phone " + v); if (["bank", "sales", "products", "gst"].includes(v)) await shot(ph, "phone-" + v); }

// New invoice with the product picker, then record a payment and make the PDF
await ph.goto(base + "/#sales"); await ph.waitForTimeout(200);
await ph.click('[data-action="quick-new"]'); await ph.click('.quick [data-action="new-invoice"]');
await ph.fill("#inv-name", "Sample");
await ph.waitForSelector('[data-action="pick-customer"]'); await ph.click('[data-action="pick-customer"]');
await ph.click('[data-action="open-picker"]'); await ph.fill("#picker-q", "6kw"); await ph.click('[data-action="pick-product"]');
await ph.click('[data-action="add-line"]'); await ph.fill("#inv-lines .inv-line:last-of-type .ln-name", "Installation"); await ph.fill("#inv-lines .inv-line:last-of-type .ln-price", "450");
await shot(ph, "02-phone-invoice-form"); await overflow(ph, "invoice form");
await ph.click('#invoice-form button[type=submit]');
await ph.waitForSelector("#payment-form");
const num = await ph.textContent(".sheet-head h2");
if (!/INV-0016/.test(num)) problems.push("new invoice number was " + num);
await ph.click('[data-action="pay-full"]'); await ph.waitForTimeout(200);
const [dl] = await Promise.all([ph.waitForEvent("download", { timeout: 8000 }).catch(() => null), ph.click('[data-action="invoice-share"]')]);
if (!dl) problems.push("PDF didn't download"); else { const path = await dl.path(); const b = readFileSync(path); if (b.slice(0, 4).toString() !== "%PDF") problems.push("PDF is not a PDF"); writeFileSync(`${out}/INV-0016.pdf`, b); }
await shot(ph, "03-phone-invoice-detail");
await ph.click('[data-action="close"]');

// Bank: confirm the suggested match for the invoice payment
await ph.goto(base + "/#bank"); await ph.waitForTimeout(250);
await shot(ph, "04-phone-bank");
const before = await ph.$$eval('[data-action="txn-confirm"]', (e) => e.length);
await ph.click('[data-action="txn-confirm"]'); await ph.waitForTimeout(250);
const after = await ph.$$eval('[data-action="txn-confirm"]', (e) => e.length);
if (after !== before - 1) problems.push(`bank confirm: suggestions went ${before} -> ${after}`);
// Expense from a bank line with a rule
const open = await ph.$$('[data-action="open-txn"]');
if (open.length) { await open[0].click(); await ph.waitForTimeout(150); if (await ph.$("#txn-expense")) { await ph.check("#tx-rule"); await ph.click('#txn-expense button[type=submit]'); await ph.waitForTimeout(250); } else await ph.click('[data-action="close"]'); }

// Bills: upload a receipt, Claude (mocked) fills it in
await ph.goto(base + "/#bills"); await ph.waitForTimeout(200);
await ph.setInputFiles("#bills-upload", { name: "receipt.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") });
await ph.waitForSelector("#bill-form", { timeout: 8000 });
if ((await ph.inputValue("#b-supplier")) !== "NZ Post") problems.push("bill wasn't filled in by Claude");
await shot(ph, "05-phone-bill-check"); await overflow(ph, "bill form");
await ph.click('#bill-form button[type=submit]'); await ph.waitForTimeout(200);

// Products: supplier invoice import, choose lines, freight methods and overrides
await ph.goto(base + "/#products"); await ph.waitForTimeout(200);
await ph.setInputFiles("#supplier-file", { name: "narvi.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 sample") });
await ph.waitForSelector("#supplier-form", { timeout: 8000 });
await ph.fill("#sup-fx", "1.95"); await ph.waitForTimeout(100);
// Freight on the invoice (EUR 300 = NZD 585) shared by value: NS45 gets 585 x 420 / 1980 = 124.09
let cost = await ph.textContent("#sup-cost-0");
if (!/Landed \$943\.09/.test(cost)) problems.push("by value: " + cost);
await ph.selectOption("#sup-fmethod", "units"); await ph.fill("#sup-freight", "1400"); await ph.waitForTimeout(100);
cost = await ph.textContent("#sup-cost-0");
if (!/Freight \$100\.00/.test(cost)) problems.push("per unit: " + cost);
await ph.selectOption("#sup-fmethod", "pct"); await ph.fill("#sup-fpct", "10"); await ph.waitForTimeout(100);
cost = await ph.textContent("#sup-cost-0");
if (!/Freight \$81\.90/.test(cost)) problems.push("percent: " + cost);
// Override one line's freight by hand
await ph.fill("#sup-fr-0", "95"); await ph.waitForTimeout(100);
cost = await ph.textContent("#sup-cost-0");
if (!/Landed \$914\.00/.test(cost) || !/reset/.test(cost)) problems.push("override: " + cost);
// Pick lines: None, then New only (the bucket), then All
await ph.click('[data-action="sup-pick"][data-p="none"]');
if ((await ph.textContent("#sup-save")) !== "Save 0 products") problems.push("select none");
await ph.click('[data-action="sup-pick"][data-p="new"]');
if ((await ph.textContent("#sup-save")) !== "Save 1 product") problems.push("select new only");
await ph.click('[data-action="sup-pick"][data-p="all"]');
await shot(ph, "06-phone-supplier-import"); await overflow(ph, "supplier import");
await ph.click("#sup-save"); await ph.waitForTimeout(300);

// Catalogue: costs with and without freight
const rowText = async () => (await ph.textContent('tr[data-id="ns45"]')).replace(/\s+/g, " ");
if (!/\$914\.00/.test(await rowText())) problems.push("catalogue landed: " + await rowText());
await ph.click('[data-action="cost-view"][data-v="ex"]'); await ph.waitForTimeout(100);
if (!/\$819\.00/.test(await rowText())) problems.push("catalogue ex freight: " + await rowText());
await shot(ph, "phone-products-catalogue");

// Stock tab: delivery added 4 to NS45 (5), new bucket starts tracking at 10, then + and count
await ph.click('[data-action="prod-tab"][data-tab="stock"]'); await ph.waitForTimeout(150);
const qty = async (id) => (await ph.textContent(`[data-action="stock-adj"][data-id="${id}"] + .qty`)).trim();
if ((await qty("ns45")) !== "5") problems.push("ns45 stock " + await qty("ns45"));
if ((await qty("nb1")) !== "10") problems.push("bucket stock " + await qty("nb1"));
await ph.click('[data-action="stock-adj"][data-id="nb1"][data-n="1"]'); await ph.waitForTimeout(200);
if ((await qty("nb1")) !== "11") problems.push("after +1: " + await qty("nb1"));
await ph.click('[data-action="stock-count"][data-id="nb1"]'); await ph.fill("#cnt-qty", "8"); await ph.click('#count-form button[type=submit]'); await ph.waitForTimeout(200);
if ((await qty("nb1")) !== "8") problems.push("after count: " + await qty("nb1"));
await shot(ph, "phone-stock"); await overflow(ph, "stock");
await ph.click('[data-action="stock-history"][data-id="ns45"]'); await ph.waitForTimeout(150);
await shot(ph, "phone-stock-history"); await ph.click('[data-action="close"]');

// Quote: product, discount, note, T&Cs, margin panel; accept; turn into invoice; PDF has a T&C page
await ph.goto(base + "/#sales"); await ph.waitForTimeout(150);
await ph.click('[data-action="quick-new"]'); await ph.click('.quick [data-action="new-quote"]');
await ph.fill("#inv-name", "Sample Quote Customer");
await ph.click('[data-action="open-picker"]'); await ph.fill("#picker-q", "4.5"); await ph.click('[data-action="pick-product"]');
await ph.fill("#inv-discount", "49"); await ph.fill("#inv-message", "Lead time 3 to 4 weeks from deposit."); await ph.waitForTimeout(100);
if ((await ph.textContent("#inv-total")) !== "$1,300.00") problems.push("quote total " + await ph.textContent("#inv-total"));
const panel = (await ph.textContent("#inv-costs")).replace(/\s+/g, " ");
if (!/\$914\.00/.test(panel) || !/\$819\.00/.test(panel)) problems.push("margin panel: " + panel);
// GST exclusive: $1,300 ex GST + 15% = $1,495; zero-rated: $1,300; back to inclusive
await ph.selectOption("#inv-tax", "exclusive"); await ph.waitForTimeout(80);
if ((await ph.textContent("#inv-total")) !== "$1,495.00") problems.push("exclusive total " + await ph.textContent("#inv-total"));
await ph.selectOption("#inv-tax", "zero"); await ph.waitForTimeout(80);
if ((await ph.textContent("#inv-total")) !== "$1,300.00" || !/No GST/.test(await ph.textContent("#inv-gst"))) problems.push("zero-rated total");
await ph.selectOption("#inv-tax", "exclusive");
await ph.click(".add-line-btn"); await ph.fill("#inv-lines .inv-line:last-of-type .ln-name", "Delivery"); await ph.fill("#inv-lines .inv-line:last-of-type .ln-price", "100"); await ph.waitForTimeout(80);
if ((await ph.textContent("#inv-total")) !== "$1,610.00") problems.push("exclusive with delivery " + await ph.textContent("#inv-total"));
await ph.click("details:has(#inv-terms) > summary");
if (!(await ph.inputValue("#inv-terms")).includes("Consumer Guarantees Act")) problems.push("default terms missing");
await shot(ph, "09-phone-quote-form"); await overflow(ph, "quote form");
await ph.click('#invoice-form button[type=submit]'); await ph.waitForSelector('[data-action="quote-accepted"]');
await ph.click('[data-action="quote-accepted"]'); await ph.waitForTimeout(150);
await ph.click('[data-action="quote-to-invoice"]'); await ph.waitForTimeout(250);
const head2 = await ph.textContent(".sheet-head h2");
if (!/Invoice INV-0017/.test(head2)) problems.push("converted invoice: " + head2);
const [dl2] = await Promise.all([ph.waitForEvent("download", { timeout: 8000 }).catch(() => null), ph.click('[data-action="invoice-share"]')]);
if (dl2) { const b = readFileSync(await dl2.path()); writeFileSync(`${out}/INV-0017.pdf`, b); const pages = (await PDFLibNode.PDFDocument.load(b)).getPageCount(); if (pages < 2) problems.push("expected a T&C page, pages=" + pages); }
else problems.push("converted invoice PDF didn't download");
// Edit it and duplicate it
await ph.click('[data-action="edit-invoice"]'); await ph.fill("#inv-ref", "Edited ref"); await ph.click('#invoice-form button[type=submit]'); await ph.waitForTimeout(200);
if (!/Edited ref/.test(await ph.textContent(".sheet-head"))) problems.push("edit didn't save");
await ph.click('[data-action="duplicate-invoice"]'); await ph.waitForSelector("#invoice-form");
if (!/INV-0018/.test(await ph.textContent(".sheet-head h2"))) problems.push("duplicate: " + await ph.textContent(".sheet-head h2"));
await ph.click('[data-action="close"]');

// Price list: new products and price changes, landed estimates, cost history
await ph.goto(base + "/#products"); await ph.waitForTimeout(200);
await ph.click('[data-action="prod-tab"][data-tab="catalogue"]').catch(() => {});
await ph.setInputFiles("#price-list-file", { name: "narvi-2027.csv", mimeType: "text/csv", buffer: Buffer.from("Code,Name,Dealer EUR\nNS45,Narvi NS 4.5kW,441\n") });
await ph.waitForSelector("#pricelist-form", { timeout: 8000 });
const plHead = await ph.textContent(".sheet-head");
if (!/6 products · 2 new/.test(plHead)) problems.push("price list summary: " + plHead.replace(/\s+/g, " "));
const ns45row = (await ph.textContent('.pl-table tr:has-text("NS45")')).replace(/\s+/g, " ");
if (!/\+5\.0%/.test(ns45row)) problems.push("price change: " + ns45row);
if (!/\$954\.95/.test(ns45row)) problems.push("landed estimate keeps freight: " + ns45row);
await ph.fill("#pl-q", "accessories"); await ph.waitForTimeout(80);
const visible = await ph.$$eval(".pl-table tbody tr", (rs) => rs.filter((r) => !r.hidden).length);
if (visible !== 2) problems.push("filter rows " + visible);
await ph.fill("#pl-q", "");
if (await ph.inputValue("#pl-disc") !== "20") problems.push("Narvi discount default: " + await ph.inputValue("#pl-disc"));
await ph.selectOption("#pl-sell", "markup"); await ph.fill("#pl-mu", "50"); await ph.waitForTimeout(80);
const nvRow = (await ph.textContent('.pl-table tr:has-text("NV20")')).replace(/\s+/g, " ");
if (!/1,?680\.00/.test(nvRow) || !/\$[\d,]+0\.00/.test(nvRow)) problems.push("net/markup on new product: " + nvRow);
await shot(ph, "11-phone-price-list"); await overflow(ph, "price list");
await ph.click("#pl-save"); await ph.waitForTimeout(300);
await ph.click('[data-action="cost-view"][data-v="landed"]'); await ph.waitForTimeout(100);
if (!/\$914\.00/.test(await rowText())) problems.push("invoice cost should beat price list: " + await rowText());
if (!(await ph.$('tr[data-id="nv20"]'))) problems.push("new product NV20 not added");
{ const nv = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "nv20")?.data || {});
  if (nv.listPrice !== 2100 || nv.calc?.eur !== 1680 || nv.ean !== "6430011234567" || !(nv.price > 0) || nv.price % 10) problems.push("saved NV20: " + JSON.stringify(nv));
  const ns = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "ns45")?.data || {});
  if (ns.price !== 1349) problems.push("markup changed an existing price: " + ns.price); }

// Product editor: list less discount, freight as %, GST toggle, margin sets price
await ph.click('[data-action="open-product"][data-id="nv20"]'); await ph.waitForSelector("#product-form");
if (await ph.inputValue("#k-eur") !== "1680.00") problems.push("editor net price: " + await ph.inputValue("#k-eur"));
await ph.fill("#k-fx", "2"); await ph.selectOption("#k-frmode", "pct"); await ph.fill("#k-freight", "10"); await ph.waitForTimeout(50);
// 1680 x 2 = 3360, +10% = 3696 landed
if (!/3,696\.00/.test(await ph.textContent("#out-landed"))) problems.push("landed with % freight: " + await ph.textContent("#out-landed"));
await ph.check("#p-incgst"); await ph.waitForTimeout(50);
if (!/4,250\.40/.test(await ph.textContent("#out-landed"))) problems.push("landed incl GST: " + await ph.textContent("#out-landed"));
await ph.fill("#p-mpct", "40"); await ph.waitForTimeout(50);
// 3696 / 0.6 = 6160 ex, 7084 incl
if (await ph.inputValue("#p-priceex") !== "6160.00" || await ph.inputValue("#p-price") !== "7084.00") problems.push("margin to price: " + await ph.inputValue("#p-priceex") + " / " + await ph.inputValue("#p-price"));
if (!/2,464\.00/.test(await ph.textContent("#out-profit"))) problems.push("profit: " + await ph.textContent("#out-profit"));
await ph.fill("#p-priceex", "6000"); await ph.waitForTimeout(50);
if (await ph.inputValue("#p-price") !== "6900.00" || await ph.inputValue("#p-mpct") !== "38.4") problems.push("ex price to incl/margin: " + await ph.inputValue("#p-price") + " " + await ph.inputValue("#p-mpct"));
await shot(ph, "11b-phone-product-editor"); await overflow(ph, "product editor");
await ph.click('#product-form button[type=submit]'); await ph.waitForTimeout(250);
{ const nv = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "nv20").data);
  if (nv.price !== 6900 || nv.cost !== 3696 || nv.calc?.freightPct !== 10 || nv.listPrice !== 2100) problems.push("editor save: " + JSON.stringify({ price: nv.price, cost: nv.cost, calc: nv.calc, list: nv.listPrice })); }
await ph.click('[data-action="open-product"][data-id="ns45"]'); await ph.waitForSelector("#product-form");
{ await ph.click("#product-form details.card summary"); const n0 = await ph.$$eval('[data-action="cost-del"]', (b) => b.length);
  await ph.click('[data-action="cost-del"] >> nth=0'); await ph.click('[data-action="cost-del"] >> nth=0'); await ph.waitForTimeout(250);
  const ns = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "ns45").data);
  if (ns.costHistory.length !== n0 - 1 || !(ns.cost > 0)) problems.push("cost-del: " + JSON.stringify(ns.costHistory) + " cost " + ns.cost);
  await ph.fill("#p-aliases", "903003, Old Heater"); await ph.click('#product-form button[type=submit]'); await ph.waitForTimeout(250);
  const ns2 = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "ns45").data);
  if (JSON.stringify(ns2.aliases) !== '["903003","Old Heater"]') problems.push("aliases: " + JSON.stringify(ns2.aliases)); }
await ph.click('[data-action="open-product"][data-id="nv20"]'); await ph.waitForSelector("#product-form");
if (await ph.inputValue("#k-frmode") !== "pct" || await ph.inputValue("#k-freight") !== "10") problems.push("freight % not remembered");
await ph.click('[data-action="close"]');

// Purchase order: draft from low stock, add a product, send, receive
await ph.click('[data-action="prod-tab"][data-tab="orders"]'); await ph.waitForTimeout(150);
await ph.click('[data-action="reorder-low"]'); await ph.waitForTimeout(300);
if (!/PO-0001/.test(await ph.textContent(".sheet-head h2"))) problems.push("draft PO: " + await ph.textContent(".sheet-head h2"));
await ph.click('[data-action="po-edit"]');
await ph.click('[data-action="po-open-picker"]'); await ph.fill("#po-picker-q", "velvet"); await ph.click('[data-action="po-pick"]');
await ph.fill("#po-notes", "Please ship with the December container.");
await shot(ph, "12-phone-po-form"); await overflow(ph, "po form");
if (!/20%/.test(await ph.textContent("#po-disc-note"))) problems.push("PO discount note: " + await ph.textContent("#po-disc-note"));
await ph.click('#po-form button[type=submit]'); await ph.waitForTimeout(200);
if (!/Less 20% discount/.test(await ph.textContent("#sheet-card"))) problems.push("PO sheet discount line missing");
const [dl3] = await Promise.all([ph.waitForEvent("download", { timeout: 8000 }).catch(() => null), ph.click('[data-action="po-send"]')]);
if (dl3) writeFileSync(`${out}/PO-0001.pdf`, readFileSync(await dl3.path())); else problems.push("PO PDF didn't download");
await ph.waitForTimeout(200);
if (!/on order/.test(await ph.textContent("#sheet-card"))) {} // status pill lives in the list
const before6 = await (async () => { await ph.click('[data-action="close"]'); await ph.click('[data-action="prod-tab"][data-tab="stock"]'); await ph.waitForTimeout(100); return (await ph.textContent('[data-action="stock-adj"][data-id="ns6"] + .qty')).trim(); })();
if (!/on order/.test(await ph.textContent('[data-action="stock-history"][data-id="ns6"]'))) problems.push("stock tab doesn't show on order");
await ph.click('[data-action="prod-tab"][data-tab="orders"]'); await ph.waitForTimeout(100);
await ph.click('[data-action="open-po"]'); await ph.click('[data-action="po-receive"]');
await ph.waitForSelector("#supplier-form");
await ph.fill("#sup-fx", "1.95"); await ph.fill("#sup-freight", "600"); await ph.waitForTimeout(100);
await shot(ph, "13-phone-po-receive");
await ph.click("#sup-save"); await ph.waitForTimeout(300);
await ph.click('[data-action="prod-tab"][data-tab="stock"]'); await ph.waitForTimeout(100);
const after6 = (await ph.textContent('[data-action="stock-adj"][data-id="ns6"] + .qty')).trim();
if (Number(after6) !== Number(before6) + 5) problems.push(`receive: NS6 ${before6} -> ${after6}`);
await ph.click('[data-action="prod-tab"][data-tab="orders"]'); await ph.waitForTimeout(100);
if (!/received/.test(await ph.textContent("#view"))) problems.push("PO not marked received");
await shot(ph, "14-phone-orders");

// Subscriptions: an emailed USD receipt + the NZD bank charge file themselves; an automatic rule files a charge
await put("bill", "email-claude", { supplier: "Anthropic", date: days(1), paidDate: days(1), total: 0, originalTotal: 20, currency: "USD", gstTreatment: "none", category: "Software & subscriptions", needsReview: true, source: "email", fileKey: "kp/inbox/x.pdf", fileName: "receipt.pdf" });
await put("txn", "tx-claude", { account: "acc_biz", date: days(0), description: "ANTHROPIC SAN FRANCISCO", amount: -34.87, status: "new", source: "akahu" });
await put("rule", "r-shopify-bill", { match: "shopify billing", direction: "out", action: "expense", category: "Shopify & payment fees", gstTreatment: "none", auto: true });
await put("txn", "tx-shop", { account: "acc_biz", date: days(0), description: "SHOPIFY BILLING OTTAWA", amount: -61.5, status: "new", source: "akahu" });
await ph.goto(base + "/#bank"); await ph.reload(); await ph.waitForTimeout(1200);
const claudeBill = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "email-claude").data);
if (claudeBill.needsReview || claudeBill.total !== 34.87 || !claudeBill.txn) problems.push("USD receipt not matched: " + JSON.stringify(claudeBill));
const shopTx = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "tx-shop").data);
if (shopTx.status !== "done" || shopTx.category !== "Shopify & payment fees") problems.push("automatic rule didn't file: " + JSON.stringify(shopTx));
await ph.click('[data-action="bank-tab"][data-tab="rules"]'); await ph.waitForTimeout(100);
if (!/Automatic/.test(await ph.textContent("#view"))) problems.push("rules tab missing Automatic");
await shot(ph, "15-phone-rules");

// Shopify line that doesn't match a product: link it once, cost then shows
await put("invoice", "shopify-9001", { source: "shopify", type: "invoice", number: "KP-9001", date: days(1), status: "paid", total: 1550, customer: { name: "Link Test" },
  lines: [{ qty: 1, name: "Sauna Heater 6kW - Black Edition", sku: "SHOP-NS6-BLK", price: 1499 }, { qty: 1, name: "Narvi ultra - 9 kW", sku: "", price: 51 }] });
await ph.goto(base + "/#sales"); await ph.reload(); await ph.waitForTimeout(800);
await ph.click('[data-action="open-invoice"][data-id="shopify-9001"]'); await ph.waitForTimeout(150);
const lnText = await ph.textContent("#sheet-card .lines");
if (!/No matching product/.test(lnText)) problems.push("unmatched line not flagged: " + lnText.replace(/\s+/g, " "));
if (!/Narvi ultra - 9 kW[\s\S]*Cost \$/.test(lnText)) problems.push("loose name match failed: " + lnText.replace(/\s+/g, " "));
await ph.click('[data-action="link-line"]'); await ph.waitForSelector("#link-q");
await ph.fill("#link-q", "ns 6"); await ph.waitForTimeout(80);
await ph.click('[data-action="link-pick"][data-id="ns6"]'); await ph.waitForTimeout(300);
if (/No matching product/.test(await ph.textContent("#sheet-card .lines"))) problems.push("link didn't take");
if (/cost missing/.test(await ph.textContent("#view"))) {} 
await ph.click('[data-action="close"]');

// Xero CSV: exclusive and inclusive invoices, a credit note, and one that's really a Shopify order
{
  const shop = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.data.source === "shopify" && r.data.orderName));
  const on = shop.data.orderName.replace("#", "");
  const csv = [
    "*ContactName,EmailAddress,POAddressLine1,POCity,POCountry,*InvoiceNumber,Reference,*InvoiceDate,*DueDate,Total,InventoryItemCode,*Description,*Quantity,*UnitAmount,Discount,*AccountCode,*TaxType,TaxAmount,Currency",
    "Bay Spa Ltd,a@bay.nz,1 Beach Rd,Tauranga,New Zealand,INV-0101,,15/07/2026,22/07/2026,2300.00,NS45,Narvi NS 4.5kW,1,1000.00,,200,15% GST on Income,150.00,NZD",
    "Bay Spa Ltd,a@bay.nz,1 Beach Rd,Tauranga,New Zealand,INV-0101,,15/07/2026,22/07/2026,2300.00,,Installation,1,1000.00,,200,15% GST on Income,150.00,NZD",
    "Jo Smith,,,,,INV-0102,PO 55,3/09/2026,10/09/2026,1349.00,NS45,Narvi NS 4.5kW,1,1349.00,,200,15% GST on Income,175.96,NZD",
    "Aussie Co,,,,,INV-0103,,2/10/2026,2/10/2026,900.00,,Stones,10,90.00,,200,Zero Rated,0.00,NZD",
    "Jo Smith,,,,,CN-0001,,4/09/2026,4/09/2026,-100.00,,Refund,1,-100.00,,200,15% GST on Income,-13.04,NZD",
    `Shop Buyer,,,,,INV-0104,Shopify #${on},${shop.data.date.split("-").reverse().join("/")},${shop.data.date.split("-").reverse().join("/")},${shop.data.total},,Order,1,${shop.data.total},,200,15% GST on Income,0,NZD`,
  ].join("\n");
  await ph.goto(base + "/#sales"); await ph.waitForTimeout(200);
  await ph.setInputFiles("#sales-csv", { name: "Invoices.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await ph.waitForSelector('[data-action="xero-save"]');
  const xt = (await ph.textContent("#sheet-card")).replace(/\s+/g, " ");
  if (!/3 invoices/.test(xt) || !/Skipping 1/.test(xt) || !/1 credit note/.test(xt) || !/GST exclusive/.test(xt) || !/zero-rated/.test(xt)) problems.push("xero review: " + xt.slice(0, 400));
  await shot(ph, "16-phone-xero-import"); await overflow(ph, "xero import");
  await ph.click('[data-action="xero-save"]'); await ph.waitForTimeout(300);
  const recs = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records);
  const x1 = recs.find((r) => r.id === "xero-inv-0101")?.data, x3 = recs.find((r) => r.id === "xero-inv-0103")?.data;
  if (!x1 || x1.total !== 2300 || x1.taxMode !== "exclusive" || x1.date !== "2026-07-15" || x1.payments?.[0]?.amount !== 2300) problems.push("xero saved: " + JSON.stringify(x1));
  if (!x3 || !x3.zeroRated) problems.push("xero zero-rated: " + JSON.stringify(x3));
  if (recs.find((r) => r.id === "xero-inv-0104" || r.id === "xero-cn-0001")) problems.push("xero duplicate or credit note imported");
}
// One-off sale (gym bags): add costs to the invoice itself
await ph.goto(base + "/#sales"); await ph.reload(); await ph.waitForTimeout(600);
await ph.click('[data-action="open-invoice"][data-id="xero-inv-0103"]'); await ph.waitForSelector("#dc-form");
await ph.fill("#dc-name", "Stones from supplier"); await ph.fill("#dc-amt", "400"); await ph.click('#dc-form button[type=submit]'); await ph.waitForTimeout(250);
await ph.fill("#dc-name", "Freight"); await ph.fill("#dc-amt", "115"); await ph.selectOption("#dc-gst", "inc"); await ph.click('#dc-form button[type=submit]'); await ph.waitForTimeout(250);
{ const t = (await ph.textContent("#sheet-card")).replace(/\s+/g, " ");
  // 900 zero-rated sale, costs 400 + 100 = 500, profit 400
  if (!/Costs for this sale · \$500\.00/.test(t) || !/\$400\.00/.test(t)) problems.push("direct costs: " + t.slice(0, 600)); }
await ph.click('[data-action="close"]');
if (/cost missing/.test(await ph.textContent('[data-action="open-invoice"][data-id="xero-inv-0103"]'))) problems.push("still cost missing after direct costs");

// Package sold under one SKU: set that line's cost for this invoice only
await ph.click('[data-action="open-invoice"][data-id="xero-inv-0101"]'); await ph.waitForTimeout(150);
await ph.click('[data-action="line-cost"] >> nth=0'); await ph.waitForSelector("#line-cost-form");
await ph.fill("#lc-unit", "1150"); await ph.selectOption("#lc-gst", "inc"); await ph.click('#line-cost-form button[type=submit]'); await ph.waitForTimeout(250);
{ const t = (await ph.textContent("#sheet-card")).replace(/\s+/g, " ");
  if (!/Cost \$1,000\.00 each, set for this sale/.test(t)) problems.push("line cost override: " + t.slice(0, 500));
  const ns = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "ns45").data);
  if (ns.cost === 1000) problems.push("override changed the product"); }
await ph.click('[data-action="line-cost"] >> nth=0'); await ph.waitForSelector("#line-cost-form");
await ph.check('input[name="lc"][value="product"]'); await ph.click('#line-cost-form button[type=submit]'); await ph.waitForTimeout(250);
if (/set for this sale/.test(await ph.textContent("#sheet-card"))) problems.push("line cost reset failed");
await ph.click('[data-action="close"]');

// Freight bill linked to a sale becomes that sale's cost
{
  const bill = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.kind === "bill" && !r.deleted));
  await ph.goto(base + "/#bills"); await ph.reload(); await ph.waitForTimeout(600);
  await ph.click(`[data-action="open-bill"][data-id="${bill.id}"]`); await ph.waitForSelector("#b-forinv");
  await ph.fill("#b-forinv", "INV-0101 · Bay Spa Ltd"); await ph.click('#bill-form button[type=submit]'); await ph.waitForTimeout(400);
  const recs = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records);
  const inv = recs.find((r) => r.id === "xero-inv-0101").data, b = recs.find((r) => r.id === bill.id).data;
  if (b.forInvoice !== "xero-inv-0101" || !(inv.directCosts || []).some((d) => d.bill === bill.id)) problems.push("bill link: " + JSON.stringify({ for: b.forInvoice, dc: inv.directCosts }));
  await ph.goto(base + "/#sales"); await ph.waitForTimeout(300);
  await ph.click('[data-action="open-invoice"][data-id="xero-inv-0101"]'); await ph.waitForTimeout(150);
  await ph.click('[data-action="dc-del"] >> nth=-1'); await ph.waitForTimeout(400);
  const b2 = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === bill.id).data);
  if (b2.forInvoice) problems.push("unlinking from the sale didn't free the bill");
  await ph.click('[data-action="close"]');
}

// Asset bill: shows what's claimable each tax year
await ph.goto(base + "/#bills"); await ph.waitForTimeout(300);
await ph.click('[data-action="bill-manual"]'); await ph.waitForSelector("#bill-form");
await ph.fill("#b-supplier", "Noel Leeming"); await ph.selectOption("#b-cat", "Asset (over $1,000)"); await ph.fill("#b-date", "2026-11-10");
await ph.fill("#b-total", "3600"); await ph.waitForTimeout(80);
{ const t = (await ph.textContent("#b-sched")).replace(/\s+/g, " ");
  if (!/2026\/27\s*\$1,147\.83/.test(t) || !/\$626\.09 Investment Boost/.test(t)) problems.push("asset schedule: " + t); }
await shot(ph, "17-phone-asset-bill"); await overflow(ph, "asset bill");
await ph.click('[data-action="close"]');

// Bulk upload: three receipts at once, one a repeat of another
await ph.goto(base + "/#bills"); await ph.waitForTimeout(300);
await ph.setInputFiles("#bills-upload", [1, 2, 3].map((i) => ({ name: `r${i}.pdf`, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 r" + i) })));
await ph.waitForFunction(() => /added to "To check"/.test(document.body.textContent), null, { timeout: 15000 });
{ const t = (await ph.textContent("#view")).replace(/\s+/g, " ");
  if (!/To check \(\d+\)/.test(t) || !/possible duplicate/.test(t)) problems.push("bulk upload: " + t.slice(0, 400)); }
await ph.click('[data-action="bill-manual"]'); await ph.fill("#b-supplier", "Cash parking"); await ph.fill("#b-total", "12"); await ph.click('#bill-form button[type=submit]'); await ph.waitForTimeout(250);
await ph.click('[data-action="bills-tab"][data-tab="noreceipt"]'); await ph.waitForTimeout(100);
if (!/Cash parking/.test(await ph.textContent("#view"))) problems.push("no receipt tab");

// Receipts zip from Reports
await ph.goto(base + "/#reports"); await ph.waitForTimeout(300);
{ const dl = ph.waitForEvent("download", { timeout: 8000 }).catch(() => null);
  await ph.click('[data-action="receipts-zip"]'); const d = await dl;
  const files = await ph.evaluate(() => Object.keys(window.__zip || {}));
  if (!d || !/receipts 2026-27\.zip$/.test(d.suggestedFilename()) || !files.includes("receipts.csv") || !files.some((f) => /^\w{3} 2026\/2026-\d\d-\d\d .+\$[\d,.]+\.\w+$/.test(f))) problems.push("receipts zip: " + JSON.stringify(files)); }

// Stock value on Home, links to the Stock tab
await ph.goto(base + "/#home"); await ph.waitForSelector(".hero");
{ const t = (await ph.textContent('.tiles a[href="#products/stock"]')).replace(/\s+/g, " ");
  if (!/Stock on hand\s*\$[\d,]+\.\d\d\s*\d+ units? at landed cost/.test(t)) problems.push("home stock tile: " + t);
  await ph.click('.tiles a[href="#products/stock"]'); await ph.waitForTimeout(200);
  if (!/Stock value/.test(await ph.textContent("#view"))) problems.push("stock tile didn't open the Stock tab"); }
await shot(ph, "19-phone-products-stock");
await ph.goto(base + "/#home"); await ph.waitForSelector(".hero"); await shot(ph, "20-phone-home-tiles"); await overflow(ph, "home tiles");

// Hide costs and margins: eye button in the header
await ph.goto(base + "/#sales"); await ph.waitForTimeout(300);
await ph.click("#privacy-btn"); await ph.waitForTimeout(100);
{ const vis = async (sel) => ph.$$eval(sel, (els) => els.filter((e) => e.offsetParent !== null).length);
  if (await vis(".pill:is(.good,.warn,.bad,.mute)") && /% margin/.test(await ph.innerText("#view"))) problems.push("margins still showing in Sales");
  await ph.click('[data-action="open-invoice"][data-id="xero-inv-0101"]'); await ph.waitForTimeout(150);
  if (/Margin|Costs for this sale|Cost \$/.test(await ph.innerText("#sheet-card"))) problems.push("invoice shows costs while hidden");
  await ph.click('[data-action="close"]');
  await ph.goto(base + "/#products/catalogue"); await ph.waitForTimeout(200);
  if (await vis("td.pv-hide, th.pv-hide")) problems.push("catalogue shows cost columns while hidden");
  await ph.goto(base + "/#reports"); await ph.waitForTimeout(200);
  if (/Gross profit/.test(await ph.innerText("#view"))) problems.push("reports visible while hidden");
  await shot(ph, "21-phone-hidden-reports");
  await ph.goto(base + "/#home"); await ph.reload(); await ph.waitForSelector(".hero");
  if (!(await ph.evaluate(() => document.body.classList.contains("private")))) problems.push("hidden mode not remembered");
  if (/Gross profit/.test(await ph.innerText(".hero"))) problems.push("home profit visible while hidden");
  await shot(ph, "22-phone-hidden-home");
  await ph.click("#privacy-btn"); await ph.waitForTimeout(100);
  if (!/Gross profit/.test(await ph.innerText(".hero"))) problems.push("showing again failed"); }

// Enter a return filed in Xero for last period
await ph.goto(base + "/#gst"); await ph.waitForTimeout(300);
await ph.click('[data-action="gst-prev"]'); await ph.waitForTimeout(100);
await ph.click('[data-action="gst-filed-form"]'); await ph.waitForSelector("#filed-form");
await ph.fill("#fr-5", "23000"); await ph.fill("#fr-6", "2000"); await ph.fill("#fr-11", "11500"); await ph.fill("#fr-13", "300");
await ph.fill("#fr-15", "939.13"); await ph.waitForTimeout(50);
if (!/Matches/.test(await ph.textContent("#fr-check"))) problems.push("filed check: " + await ph.textContent("#fr-check"));
await ph.click('#filed-form button[type=submit]'); await ph.waitForTimeout(250);
{ const t = (await ph.innerText("#view")).replace(/\s+/g, " ");
  if (!/\$939\.13/.test(t) || !/as filed \(myIR\)/.test(t) || !/filed/.test(t)) problems.push("filed return view: " + t.slice(0, 500)); }
await shot(ph, "23-phone-gst-filed"); await overflow(ph, "gst filed");

// Accountant pack from Reports
await ph.goto(base + "/#reports"); await ph.waitForTimeout(300);
{ const dl = ph.waitForEvent("download", { timeout: 5000 }).catch(() => null);
  await ph.click('[data-action="accountant-pack"]');
  const d = await dl; const sheets = await ph.evaluate(() => (window.__pack || []).map((x) => x[0]));
  if (!d || !/accountant pack 2026-27\.xlsx$/.test(d.suggestedFilename()) || sheets.length !== 8) problems.push("accountant pack: " + (d && d.suggestedFilename()) + " " + JSON.stringify(sheets)); }
await shot(ph, "18-phone-reports"); await overflow(ph, "reports");

// Emailed freight bill that mentions the customer: app suggests the sale
await put("bill", "frt-1", { needsReview: true, source: "email", supplier: "Mainfreight", date: "2026-07-20", total: 230, gst: 30, gstTreatment: "standard", category: "Outbound shipping & couriers", relatedTo: "Bay Spa, Tauranga", fileKey: "kp/x.pdf" });
await put("bill", "frt-2", { needsReview: true, source: "email", supplier: "Mainfreight", date: "2026-07-22", total: 115, gstTreatment: "standard", category: "Outbound shipping & couriers", reference: "Ref INV-0101", fileKey: "kp/y.pdf" });
await ph.goto(base + "/#bills"); await ph.reload(); await ph.waitForTimeout(600);
for (const id of ["frt-1", "frt-2"]) {
  await ph.click(`[data-action="open-bill"][data-id="${id}"]`); await ph.waitForSelector("#bill-form");
  if (!(await ph.$('[data-action="bill-use-sale"]'))) { problems.push("no sale suggestion for " + id); await ph.click('[data-action="close"]'); continue; }
  await ph.click('[data-action="bill-use-sale"]');
  if (!/INV-0101/.test(await ph.inputValue("#b-forinv"))) problems.push("suggestion didn't fill " + id);
  await ph.click('[data-action="close"]');
}

// Same Import sales button takes a Shopify export too
{
  const csv = "Name,Email,Financial Status,Paid at,Currency,Subtotal,Shipping,Taxes,Total,Discount Amount,Lineitem quantity,Lineitem name,Lineitem price,Lineitem sku,Billing Name,Billing Country\n#2001,x@y.nz,paid,2026-10-01 10:00:00 +1300,NZD,125,0,16.30,125,0,1,Stones,125,ST1015,Csv Buyer,NZ";
  await ph.goto(base + "/#sales"); await ph.waitForTimeout(150);
  await ph.setInputFiles("#sales-csv", { name: "orders_export.csv", mimeType: "text/csv", buffer: Buffer.from(csv) }); await ph.waitForTimeout(400);
  const got = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.id === "shopify-2001"));
  if (!got) problems.push("Import sales didn't take the Shopify export");
}

// Search
await ph.click('[data-action="search"]'); await ph.fill("#global-q", "ultra"); await ph.waitForTimeout(100);
if (!(await ph.$$('#global-results .item')).length) problems.push("search found nothing");
await ph.fill("#global-q", "6430011234567"); await ph.waitForTimeout(100);
if (!/Velvet/.test(await ph.textContent("#global-results"))) problems.push("EAN search");
await ph.click('[data-action="close"]');
await ph.goto(base + "/#home"); await ph.waitForTimeout(250); await shot(ph, "07-phone-home-after");

// Desktop
const dk = await page(1280, "desktop");
await shot(dk, "10-desk-home"); await overflow(dk, "desktop home");
for (const v of ["sales", "bank", "reports", "gst", "products"]) { await dk.goto(base + "/#" + v); await dk.waitForTimeout(300); await shot(dk, "desk-" + v); await overflow(dk, "desktop " + v); }
// A brand-new Australian business: first-run screen, BAS, AUD
{
  const au = await page(390, "new AU business");
  await au.goto(base + "/#home"); await au.evaluate(() => localStorage.setItem("kp:biz", "aussie")); await au.reload();
  await au.waitForSelector("#first-run-form", { timeout: 8000 });
  if (/Kauri Point|123-456-789/.test(await au.innerText("#view"))) problems.push("first run shows someone else's details");
  await au.selectOption("#tx-country", "AU"); await au.waitForTimeout(50);
  if (await au.inputValue("#tx-gstRate") !== "10" || await au.inputValue("#tx-returnFormat") !== "bas" || await au.inputValue("#tx-taxYearStart") !== "7") problems.push("AU preset didn't fill in");
  if (!/ABN/.test(await au.textContent("#set-gst-label")) || !/BSB/.test(await au.textContent("#set-bank-label"))) problems.push("AU labels");
  await au.fill("#set-name", "Bondi Saunas"); await au.fill("#set-legal", "Bondi Saunas Pty Ltd"); await au.fill("#set-gst", "12 345 678 901");
  await au.fill("#set-bank", "062-000 1234 5678"); await au.fill("#set-about", "sells saunas in Sydney");
  await shot(au, "24-phone-first-run-au"); await overflow(au, "first run");
  await au.click('#first-run-form button[type=submit]'); await au.waitForSelector(".hero", { timeout: 8000 });
  const chip = await au.textContent("#period-chip");
  if (!/GST (Oct–Dec|Jan–Mar|Apr–Jun|Jul–Sep) \d{4}/.test(chip)) problems.push("AU period chip: " + chip);
  // An invoice in AUD with 10% GST
  await au.goto(base + "/#gst"); await au.waitForTimeout(300);
  const g = await au.innerText("#view");
  if (!/G1/.test(g) || !/1A/.test(g) || !/1B/.test(g) || /Box 5/.test(g)) problems.push("BAS layout: " + g.slice(0, 200));
  await shot(au, "25-phone-bas");
  // Logo upload: goes on PDFs and in the sidebar
  await au.goto(base + "/#setup"); await au.waitForSelector("#logo-file");
  await au.setInputFiles("#logo-file", { name: "logo.png", mimeType: "image/png", buffer: readFileSync(new URL("../public/icons/icon-192.png", import.meta.url)) });
  await au.waitForSelector(".logo-preview", { timeout: 5000 }).catch(() => problems.push("logo preview missing"));
  const ak = await realFetch(`${base}/api/data?biz=aussie`).then((r) => r.json()).then((d) => d.records.find((r) => r.kind === "settings").data);
  if (!ak.logoKey || ak.businessName !== "Bondi Saunas" || ak.country !== "AU") problems.push("AU settings after logo: " + JSON.stringify({ logo: ak.logoKey, n: ak.businessName, c: ak.country }));
  // Your own business is untouched
  const kp = await realFetch(`${base}/api/data?biz=kp`).then((r) => r.json()).then((d) => d.records.find((r) => r.kind === "settings").data);
  if (kp.country === "AU" || kp.businessName !== "Kauri Point Sauna") problems.push("KP settings changed by the AU business");
  await au.context().close();
}

// Print on a computer: the PDF loads in a hidden frame and the print window opens
await dk.goto(base + "/#sales"); await dk.waitForTimeout(400);
await dk.click('[data-action="open-invoice"] >> nth=0'); await dk.waitForSelector('[data-action="invoice-print"]');
await dk.click('[data-action="invoice-print"]'); await dk.waitForTimeout(1500);
{ const src = await dk.evaluate(() => document.getElementById("print-frame")?.src || "");
  if (!/^blob:/.test(src)) problems.push("print frame not created: " + src); }
// Print on a phone (touch screen): the PDF opens in a new tab
const tp = await page(390, "touch phone", { hasTouch: true, isMobile: true });
await tp.goto(base + "/#sales"); await tp.waitForTimeout(600);
await tp.click('[data-action="open-invoice"] >> nth=0'); await tp.waitForSelector('[data-action="invoice-print"]');
{ const pop = tp.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
  await tp.click('[data-action="invoice-print"]'); const t = await pop;
  // (headless Chrome can't show PDFs, so only check the tab opened)
  if (!t) problems.push("print on phone didn't open the PDF"); else await t.close(); }

// Dark mode phone home
const dctx = await browser.newContext({ viewport: { width: 390, height: 860 }, colorScheme: "dark" });
const dp = await dctx.newPage(); await dp.route(/fonts\./, (r) => r.abort()); await dp.goto(base + "/#home"); await dp.waitForSelector(".hero"); await shot(dp, "08-phone-dark");

await browser.close(); server.close();
console.log(problems.length ? "PROBLEMS:\n" + problems.join("\n") : "UI OK: no script errors, no sideways scrolling, flows work");
