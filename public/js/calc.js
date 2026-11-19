// =====================================================================
// All the money maths: GST periods and returns, margins, payments,
// stock on hand, profit and loss. No screen code here, so it's easy to check.
// =====================================================================

// ---------- Tax setup ----------
// Everything country-specific lives here and comes from Setup (Tax & country). A country preset fills
// sensible defaults; every value can be overridden. applyTaxSettings() runs whenever settings load.
export let GST_RATE = 0.15;
export let GST_FRACTION = 3 / 23;            // GST share of a GST-inclusive amount
export const TAX = {
  country: "NZ", currency: "NZD", locale: "en-NZ", timeZone: "Pacific/Auckland",
  taxName: "GST", taxIdLabel: "GST number", bankLabel: "Bank account",
  returnFormat: "nz",        // "nz" IRD GST101A boxes 5-15 · "bas" Australian BAS (G1, 1A, 1B) · "simple" plain summary
  periodMonths: 2,           // 1 monthly, 2 two-monthly, 3 quarterly, 6 six-monthly, 12 yearly
  periodAnchor: 2,           // a month that a period ends in (2 = Feb, Apr, Jun... for 2-monthly)
  dueRule: "nz",             // "nz" IRD dates · "au" ATO BAS dates · "days" a set number of days after the period
  dueDays: 28,
  taxYearStart: 4,           // month the income tax year starts (NZ April, AU July)
  boostPct: 20,              // NZ Investment Boost: % of a new asset deducted upfront (0 = none)
  lowValueAsset: 1000,       // assets at or under this (ex GST) are written off in full
  deprRate: 50,              // default diminishing-value rate for new assets
};
export const COUNTRY_PRESETS = {
  NZ: { country: "NZ", currency: "NZD", locale: "en-NZ", timeZone: "Pacific/Auckland", gstRate: 15, taxName: "GST", taxIdLabel: "GST number", bankLabel: "Bank account",
        returnFormat: "nz", periodMonths: 2, periodAnchor: 2, dueRule: "nz", dueDays: 28, taxYearStart: 4, taxRate: 28, boostPct: 20, lowValueAsset: 1000, deprRate: 50 },
  AU: { country: "AU", currency: "AUD", locale: "en-AU", timeZone: "Australia/Sydney", gstRate: 10, taxName: "GST", taxIdLabel: "ABN", bankLabel: "BSB and account number",
        returnFormat: "bas", periodMonths: 3, periodAnchor: 3, dueRule: "au", dueDays: 28, taxYearStart: 7, taxRate: 25, boostPct: 0, lowValueAsset: 20000, deprRate: 30 },
  OTHER: { country: "OTHER", currency: "USD", locale: "en-US", timeZone: "UTC", gstRate: 10, taxName: "Sales tax", taxIdLabel: "Tax number", bankLabel: "Bank account",
        returnFormat: "simple", periodMonths: 3, periodAnchor: 3, dueRule: "days", dueDays: 30, taxYearStart: 1, taxRate: 25, boostPct: 0, lowValueAsset: 1000, deprRate: 25 },
};
// Settings saved before these options existed are NZ, on 2-monthly periods (periodEnds even/odd)
export function taxConfig(s = {}) {
  const base = COUNTRY_PRESETS[s.country] || COUNTRY_PRESETS.NZ;
  const pick = (k) => (s[k] !== undefined && s[k] !== "" && s[k] !== null ? s[k] : base[k]);
  // periodEnds ("even"/"odd") is how 2-monthly NZ periods were saved before periodAnchor existed
  const anchor = s.periodAnchor ?? (s.periodEnds ? (s.periodEnds === "odd" ? 1 : 2) : base.periodAnchor);
  const out = {};
  for (const k of Object.keys(TAX)) out[k] = pick(k);
  out.periodAnchor = Number(anchor) || 1;
  out.periodMonths = Number(out.periodMonths) || 2;
  out.gstRate = Number(pick("gstRate"));
  out.dueDays = Number(s.gstDueDays ?? base.dueDays);    // "dueDays" in settings is for invoices, so returns use gstDueDays
  return out;
}
export function applyTaxSettings(s = {}) {
  const c = taxConfig(s);
  Object.assign(TAX, c);
  GST_RATE = (Number.isFinite(c.gstRate) ? c.gstRate : 15) / 100;
  GST_FRACTION = GST_RATE / (1 + GST_RATE);
}
export const HOME = () => TAX.currency;      // your own currency (NZD, AUD...)

// Expense categories. stock: true = part of what products cost you, so it's counted
// through product cost (margin), not again as a running expense.
export const BILL_CATEGORIES = [
  { name: "Stock purchases", stock: true },
  { name: "Inbound freight (stock)", stock: true },
  { name: "Customs duty (stock)", stock: true },
  { name: "Outbound shipping & couriers" },
  { name: "Shopify & payment fees" },
  { name: "Advertising & marketing" },
  { name: "Software & subscriptions" },
  { name: "Packaging" },
  { name: "Vehicle & travel" },
  { name: "Phone & internet" },
  { name: "Rent & utilities" },
  { name: "Accounting & legal" },
  { name: "Bank fees", noGst: true },
  { name: "Equipment" },
  { name: "Entertainment (50%)", half: true },     // client meals, drinks, functions: half is deductible
  { name: "Asset (over $1,000)", asset: true },    // laptop, tools, vehicle: depreciated, not expensed
  { name: "Other" },
];
export const isAssetCat = (cat) => !!BILL_CATEGORIES.find((c) => c.name === cat && c.asset);
const isHalfCat = (cat) => !!BILL_CATEGORIES.find((c) => c.name === cat && c.half);
export const DEPRECIATION = "Depreciation & Investment Boost";
export const isStockCat = (cat) => !!BILL_CATEGORIES.find((c) => c.name === cat && c.stock);

export const DEFAULT_SETTINGS = {
  // Your business: filled in on the first-run setup screen, changed any time in Setup
  businessName: "",
  legalName: "",
  gstNumber: "",            // GST number, ABN or tax number (label set by country)
  address: "",
  phone: "", email: "", website: "",
  about: "",                // one line on what the business does, so Claude reads your bills well
  bankName: "",
  bankAccount: "",
  paymentTerms: "Payment due within 7 days of invoice.",
  invoiceNote: "",
  // Standard T&Cs, printed on their own page. A starting point only: edit in Setup and have them checked.
  quoteTerms: [
    "Quote",
    "This quote is valid until the date shown. It shows whether prices include tax.",
    "Orders and payment",
    "Your order is confirmed once you accept this quote and any deposit asked for is paid.",
    "Delivery",
    "Lead times are estimates. Risk passes to you on delivery.",
    "Warranty and returns",
    "Products carry the manufacturer's warranty. Nothing in these terms limits your rights under consumer law.",
  ].join("\n"),
  invoiceTerms: [
    "Payment",
    "Payment is due by the due date shown. Please use the invoice number as your payment reference. Goods remain our property until paid in full.",
    "Delivery",
    "Risk passes to you on delivery. Please check goods on arrival and tell us about any damage within 48 hours.",
    "Warranty and returns",
    "Products carry the manufacturer's warranty. Nothing in these terms limits your rights under consumer law.",
  ].join("\n"),
  invoicePrefix: "WEB-",    // online store orders: WEB-1042
  manualPrefix: "INV-",     // your own invoices: INV-0001
  quotePrefix: "QU-",
  nextManual: 1,
  nextQuote: 1,
  poPrefix: "PO-",          // purchase orders to suppliers: PO-0001
  nextPo: 1,
  dueDays: 7,
  quoteDays: 30,            // how long quotes stay valid
  basis: "payments",        // GST basis: "payments" (cash) or "invoice" (accrual)
  taxRate: 28,              // income tax set-aside, % of profit
  accent: "#2c5a43",
  // Country and tax (country presets in COUNTRY_PRESETS fill the rest; see Setup, Tax & country)
};

// ---------- Small helpers ----------
export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, "")); return isFinite(n) ? n : 0; };
export const pad = (n) => String(n).padStart(2, "0");
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const todayStr = () => new Date().toLocaleDateString("en-CA", { timeZone: TAX.timeZone || "UTC" });
export const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._~:@+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "x";
export const inRange = (d, r) => !!d && d >= r.start && d <= r.end;
export const fmtDate = (s) => { if (!s) return ""; const [y, m, d] = s.split("-").map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
export const fmtShort = (s) => { if (!s) return ""; const [, m, d] = s.split("-").map(Number); return `${d} ${MONTHS[m - 1]}`; };

// ---------- GST periods ----------
// A period is named by its END month: "2026-11" = Oct to Nov 2026 on 2-monthly periods.
// Length and which months periods end in come from Setup (TAX.periodMonths, TAX.periodAnchor).
const monthIndex = (y, m) => y * 12 + (m - 1);
const fromIndex = (t) => `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`;
const endsPeriod = (m) => ((m - TAX.periodAnchor) % TAX.periodMonths + TAX.periodMonths) % TAX.periodMonths === 0;
export function periodKeyFor(dateStr) {
  const [y, m] = dateStr.split("-").map(Number);
  let t = monthIndex(y, m);
  while (!endsPeriod((t % 12) + 1)) t++;
  return fromIndex(t);
}
export function periodRange(key) {
  const [y, m] = key.split("-").map(Number);
  const [sy, sm] = fromIndex(monthIndex(y, m) - TAX.periodMonths + 1).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${sy}-${pad(sm)}-01`, end: `${y}-${pad(m)}-${pad(last)}`, sm, sy, m, y };
}
export function shiftPeriod(key, n) {
  const [y, m] = key.split("-").map(Number);
  return fromIndex(monthIndex(y, m) + n * TAX.periodMonths);
}
export function periodLabel(key) {
  const r = periodRange(key);
  if (TAX.periodMonths === 1) return `${MONTHS[r.m - 1]} ${r.y}`;
  return r.sy === r.y ? `${MONTHS[r.sm - 1]}–${MONTHS[r.m - 1]} ${r.y}` : `${MONTHS[r.sm - 1]} ${r.sy}–${MONTHS[r.m - 1]} ${r.y}`;
}
// When the return is due
//  nz: IRD: 28th of the month after the period ends, except March (7 May) and November (15 January)
//  au: ATO: quarterly 28th of the month after the quarter (December quarter 28 February); monthly 21st of the next month
//  days: a set number of days after the period ends (Setup)
export function gstDueDate(key) {
  const { y, m, end } = periodRange(key);
  const next = () => (m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`);
  if (TAX.dueRule === "au") {
    if (TAX.periodMonths === 1) return `${next()}-21`;
    if (m === 12) return `${y + 1}-02-28`;
    return `${next()}-28`;
  }
  if (TAX.dueRule === "days") return addDays(end, Number(TAX.dueDays) || 28);
  if (m === 3) return `${y}-05-07`;
  if (m === 11) return `${y + 1}-01-15`;
  return m === 12 ? `${y + 1}-01-28` : `${y}-${pad(m + 1)}-28`;
}
// Income tax year: starts on the 1st of TAX.taxYearStart (NZ April, AU July, 1 = calendar year)
export function taxYear(dateStr) {
  const [y, m] = dateStr.split("-").map(Number), sm = TAX.taxYearStart || 1;
  const sy = m >= sm ? y : y - 1;
  if (sm === 1) return { start: `${sy}-01-01`, end: `${sy}-12-31`, label: String(sy), startYear: sy };
  const ey = sy + 1, endM = sm - 1, endD = new Date(Date.UTC(ey, endM, 0)).getUTCDate();
  return { start: `${sy}-${pad(sm)}-01`, end: `${ey}-${pad(endM)}-${pad(endD)}`, label: `${sy}/${String(ey).slice(2)}`, startYear: sy };
}
export const taxYearRange = (startYear) => taxYear(`${startYear}-${pad(TAX.taxYearStart || 1)}-01`);

// ---------- Products ----------
// Invoice lines with these words aren't stock, so they never need a cost
// Freight you charge on an invoice. Its cost is the real freight bill when you've linked one,
// otherwise worked back from your usual markup on freight (Setup, default 10%).
export const FREIGHT_LINE = /freight|shipping|delivery|courier/i;
export const calcOpts = { freightMarkup: 10 };
export const SERVICE_LINE = /freight|shipping|delivery|courier|install|deposit|labour|labor/i;

// A product's cost per unit, NZD ex GST, with and without its share of freight.
// calc = { eur: supplier unit price, fx: NZD per unit of currency, freight: NZD per unit, duty: % }
// Costs change over time (new price lists, new shipments). Each product keeps a
// history so a sale is costed at what the product cost at the time, not today.
// costHistory: [{ from: "YYYY-MM-DD", exFreight, freight, landed }]
export function productCosts(p, date) {
  // With a history, "now" means today's entry (so a price list dated next month waits its turn)
  let hist = Array.isArray(p?.costHistory) ? p.costHistory : null;
  date = date || todayStr();
  // Real costs (supplier invoices, ones you typed) always win over price-list estimates.
  // Price-list costs are only used while a product has no real cost at all, and are flagged as estimates.
  let est = false;
  if (hist?.length) {
    const real = hist.filter((e) => !isListCost(p, e));
    if (real.length) hist = real; else est = true;
  }
  if (hist?.length) {
    let h = null;
    for (const e of hist) if (e.from <= date && (!h || e.from >= h.from)) h = e;
    // Sold before the first recorded cost? Use the earliest one we know.
    if (!h) h = hist.reduce((a, e) => (!a || e.from < a.from ? e : a), null);
    if (h) return { exFreight: r2(h.exFreight), freight: r2(h.freight), landed: r2(h.landed), est };
  }
  const k = p?.calc || {};
  if (k.eur && k.fx) {
    const ex = r2(k.eur * k.fx * (1 + (Number(k.duty) || 0) / 100));
    const freight = r2(Number(k.freight) || 0);
    return { exFreight: ex, freight, landed: r2(ex + freight) };
  }
  // Costs typed in by hand
  const landed = r2(p?.cost || 0), freight = r2(p?.freightPerUnit || 0);
  return { exFreight: r2(landed - freight), freight, landed };
}

// Cost of the lines on a quote or invoice, both ways, for working out a price
export const costAt = (p, date) => productCosts(p, date).landed;

// Record a new cost on a product from a date, keeping the old one for earlier sales.
// Returns the fields to save: { cost, freightPerUnit, costHistory }
// Was this cost entry made from a price list? (Older entries: the one dated the same day as the list.)
export const isListCost = (p, e) => e.source === "pricelist" || (!e.source && !!p?.listDate && e.from === p.listDate);
// source: "invoice" (supplier invoice), "pricelist" (an estimate) or "manual" (typed in the product editor)
export function withNewCost(p, costs, from = todayStr(), source = "manual") {
  let hist = Array.isArray(p?.costHistory) ? [...p.costHistory] : [];
  // First change on a product that already had a cost: keep that cost for everything before
  if (!hist.length && p?.cost > 0) { const old = productCosts({ ...p, costHistory: undefined }); hist.push({ from: "2000-01-01", ...old }); }
  // Same date: replace it, unless that would let an estimate overwrite a real cost
  const clash = hist.find((e) => e.from === from);
  if (clash && source === "pricelist" && !isListCost(p, clash)) return { cost: p.cost, freightPerUnit: p.freightPerUnit, costHistory: hist };
  hist = hist.filter((e) => e.from !== from);
  hist.push({ from, source, exFreight: r2(costs.exFreight), freight: r2(costs.freight), landed: r2(costs.landed) });
  hist.sort((a, b) => a.from.localeCompare(b.from));
  // The product's "current" cost is the newest entry that has started
  const cur = productCosts({ costHistory: hist, listDate: p?.listDate }, todayStr() > from ? todayStr() : from);
  return { cost: cur.landed, freightPerUnit: cur.freight, costHistory: hist.slice(-40) };
}

export function linesCost(lines, findProduct) {
  let landed = 0, exFreight = 0, missing = 0;
  for (const l of lines) {
    if (SERVICE_LINE.test(l.name || "")) continue;
    const p = findProduct(l);
    if (!p || !(p.cost > 0)) { missing++; continue; }
    const c = productCosts(p);
    landed += c.landed * (l.qty || 0); exFreight += c.exFreight * (l.qty || 0);
  }
  return { landed: r2(landed), exFreight: r2(exFreight), missing };
}

// Squash a name for loose matching: "Narvi Ultra - 9kW" and "NARVI ULTRA 9 kW" both become "narviultra9kw"
export const looseName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
// Finds the product for an invoice line: by SKU, then exact name, then loose name,
// then any other names you've linked to it (Shopify titles or SKUs that differ from the supplier's).
// strict (supplier invoices and price lists): two different supplier codes are never the same
// product, even if the names match (e.g. a heater and its newer WiFi version).
export function makeProductFinder(products, { strict = false } = {}) {
  const bySku = new Map(), byName = new Map(), byLoose = new Map(), byAlias = new Map();
  for (const p of products.values()) {
    if (p.sku) bySku.set(slug(p.sku), p);
    if (p.name) { byName.set(p.name.toLowerCase(), p); byLoose.set(looseName(p.name), p); }
    for (const a of p.aliases || []) byAlias.set(looseName(a), p);
  }
  const ok = (line, p) => (p && (!strict || !line.sku || !p.sku || slug(p.sku) === slug(line.sku) || (p.aliases || []).some((a) => looseName(a) === looseName(line.sku)))) ? p : null;
  return (line) => (line.sku && (bySku.get(slug(line.sku)) || byAlias.get(looseName(line.sku))))
    || ok(line, byName.get(String(line.name || "").toLowerCase())) || ok(line, byLoose.get(looseName(line.name))) || ok(line, byAlias.get(looseName(line.name))) || null;
}

// ---------- Invoices ----------
export const isQuote = (inv) => inv.type === "quote";
export const counts = (inv) => !isQuote(inv) && inv.status !== "cancelled" && inv.status !== "declined";

// Identifies a line on an invoice even if Shopify sends the order again
export const lineKey = (l) => looseName(`${l.sku || ""}|${l.name || ""}`) || "line";
export function invoiceCalc(inv, findProduct) {
  const net = r2((inv.total || 0) - (inv.refunded || 0));             // GST-inclusive after refunds
  const gst = inv.zeroRated ? 0 : r2(net * GST_FRACTION);
  const exGst = r2(net - gst);
  const back = inv.status === "refunded" || net <= 0;
  let cogs = 0, missing = 0, estimated = 0;
  const realFreight = (inv.directCosts || []).some((d) => d.freight);
  let freightEst = 0;
  if (!back) for (const l of inv.lines || []) {
    // A cost you set for this line on this invoice beats the product's cost
    const o = inv.lineCosts?.[lineKey(l)];
    if (o) { if (!o.none) cogs += (Number(o.unit) || 0) * (l.qty || 0); continue; }
    if (FREIGHT_LINE.test(l.name || "")) {
      // No freight bill linked: cost = what you charged (ex GST) less your usual markup
      if (!realFreight) {
        const mode = inv.zeroRated ? "zero" : inv.taxMode || "inclusive";
        const charged = (Number(l.price) || 0) * (l.qty || 0), ex = mode === "inclusive" ? charged / (1 + GST_RATE) : charged;
        freightEst += ex / (1 + (calcOpts.freightMarkup ?? 10) / 100);
      }
      continue;
    }
    if (SERVICE_LINE.test(l.name || "")) continue;
    const p = findProduct ? findProduct(l) : null;
    if (p && p.cost > 0) { const c = productCosts(p, inv.date); cogs += c.landed * (l.qty || 0); if (c.est) estimated++; } else missing++;
  }
  // Costs typed against this sale (one-off items like custom gym bags, their freight). NZD ex GST.
  // When there are any, lines with no product aren't flagged as missing a cost.
  const direct = r2((inv.directCosts || []).reduce((a, d) => a + (Number(d.amount) || 0), 0));
  if (!back && direct) { cogs += direct; missing = 0; }
  cogs = r2(cogs + freightEst);
  const margin = r2(exGst - cogs);
  return { net, gst, exGst, cogs, missing, estimated, freightEst: r2(freightEst), margin, pct: exGst > 0 ? margin / exGst : 0 };
}

// Payments. Shopify orders arrive paid; your own invoices track deposits and balance.
export function invoicePay(inv, today = todayStr()) {
  const net = r2((inv.total || 0) - (inv.refunded || 0));
  if (!Array.isArray(inv.payments)) return { paid: net, due: 0, state: "paid" };
  const paid = r2(inv.payments.reduce((a, p) => a + (Number(p.amount) || 0), 0));
  const due = r2(Math.max(0, net - paid));
  const overdue = due > 0 && inv.dueDate && inv.dueDate < today;
  return { paid, due, state: due <= 0 ? "paid" : overdue ? "overdue" : paid > 0 ? "part" : "unpaid", daysLate: overdue ? daysBetween(inv.dueDate, today) : 0 };
}

// GST-inclusive sales that count in a period. On payments basis your own invoices
// count as money arrives (deposit in one period, balance in the next).
export function salesInRange(inv, r, s) {
  if (s.basis === "payments" && Array.isArray(inv.payments)) {
    const net = r2((inv.total || 0) - (inv.refunded || 0));
    let got = 0;
    for (const p of inv.payments) if (inRange(p.date, r)) got += Number(p.amount) || 0;
    return got ? r2(Math.min(got, net)) : null;
  }
  return inRange(inv.date, r) ? r2((inv.total || 0) - (inv.refunded || 0)) : null;
}

// ---------- Bills ----------
// Business use %: a mixed trip or a phone used half for the business only claims that share (GST and cost)
export function billCalc(b) {
  const total = r2(b.total);
  const treatment = b.gstTreatment || "standard";
  const pct = Math.min(100, Math.max(0, b.businessPct ?? 100)) / 100;
  const fullGst = treatment === "none" ? 0 : r2(b.gst ?? total * GST_FRACTION);
  return { total, gst: r2(fullGst * pct), exGst: r2((total - fullGst) * pct), treatment, pct };
}

// ---------- Assets: upfront deduction and depreciation ----------
// At or under the write-off amount (Setup; NZ $1,000, AU instant asset write-off): claimed in full.
// Over it: an upfront % the month you buy it if your country has one (NZ Investment Boost 20%,
// new assets from 22 May 2025), then diminishing value on the rest. First tax year counts only
// the months you owned it. Returns { "YYYY-MM": amount } per month, plus a per-tax-year summary.
export const lowValueAsset = () => Number(TAX.lowValueAsset) || 0;
export function assetSchedule(b) {
  const cost = billCalc(b).exGst, months = {}, years = [];
  if (!b.date || cost <= 0) return { cost, months, years, boost: 0 };
  if (cost <= lowValueAsset()) { months[b.date.slice(0, 7)] = cost; years.push({ year: taxYear(b.date).label, claim: cost }); return { cost, months, years, boost: 0, lowValue: true }; }
  const boostPct = Number(TAX.boostPct) || 0;
  const boost = boostPct && b.newAsset !== false && (TAX.country !== "NZ" || b.date >= "2025-05-22") ? r2(cost * boostPct / 100) : 0;
  const rate = (b.deprRate ?? TAX.deprRate ?? 50) / 100;
  let book = cost - boost, [y, m] = b.date.split("-").map(Number), first = true;
  const add = (k, v) => { months[k] = (months[k] || 0) + v; };   // unrounded, so the months add up to the year exactly
  add(b.date.slice(0, 7), boost);
  for (let i = 0; i < 40 && book > 0.5; i++) {
    // Months left in this tax year, counting the purchase month
    const sm = TAX.taxYearStart || 1, left = first ? ((sm - m + 11) % 12) + 1 : 12;
    const dep = r2(book * rate * left / 12);
    const ty = taxYear(`${y}-${pad(m)}-01`);
    years.push({ year: ty.label, claim: r2(dep + (first ? boost : 0)), book: r2(book - dep) });
    for (let j = 0; j < left; j++) { add(`${y}-${pad(m)}`, dep / left); m++; if (m > 12) { m = 1; y++; } }
    book -= dep; first = false;
  }
  return { cost, months, years, boost };
}
export const billCounts = (b) => !b.needsReview && !b.personal;
const billGstDate = (b, s) => (s.basis === "invoice" ? b.date : b.paidDate);

// ---------- GST return (IRD GST101A boxes) ----------
export function gstReturn(key, st) {
  const { invoices, bills, periods, settings: s } = st;
  const find = makeProductFinder(st.products);
  const r = periodRange(key);
  const adj = periods.get(key) || {};
  let b5 = 0, b6 = 0, b11 = 0, importGst = 0, nSales = 0, nBills = 0, cogs = 0, exSales = 0, missing = 0, opex = 0;
  for (const inv of invoices.values()) {
    if (!counts(inv)) continue;
    const gross = salesInRange(inv, r, s);
    if (gross !== null) { b5 += gross; if (inv.zeroRated) b6 += gross; nSales++; }
    if (inRange(inv.date, r)) { const c = invoiceCalc(inv, find); cogs += c.cogs; exSales += c.exGst; missing += c.missing; }
  }
  for (const b of bills.values()) {
    if (!billCounts(b)) continue;
    const c = billCalc(b);
    if (inRange(billGstDate(b, s), r)) {
      nBills++;
      if (c.treatment === "standard") b11 += c.total;
      if (c.treatment === "import") importGst += c.gst;
    }
    if (inRange(b.date, r) && !isStockCat(b.category)) opex += c.exGst;
  }
  b5 = r2(b5); b6 = r2(b6);
  const b7 = r2(b5 - b6), b8 = r2(b7 * GST_FRACTION), b9 = r2(adj.debitAdj || 0), b10 = r2(b8 + b9);
  b11 = r2(b11);
  const b12 = r2(b11 * GST_FRACTION), b13 = r2((adj.creditAdj || 0) + importGst), b14 = r2(b12 + b13);
  const calc = { b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15: r2(b10 - b14) };
  // A return you filed (e.g. from Xero before this app) is the official one for that period:
  // its boxes replace the app's working, which is kept in calc so you can compare.
  const boxes = adj.filedReturn ? filedBoxes(adj.filedReturn) : calc;
  return { key, range: r, ...boxes, calc, fromFiled: !!adj.filedReturn, importGst: r2(importGst),
    nSales, nBills, cogs: r2(cogs), exSales: r2(exSales), margin: r2(exSales - cogs), missing, opex: r2(opex), adj, due: gstDueDate(key) };
}
// Work out every box from the ones typed in off a filed return.
// NZ: boxes 5, 6, 9, 11, 13. BAS and simple: tax on sales (b10) and on purchases (b14) are typed directly.
export function filedBoxes(f) {
  const n = (v) => r2(Number(v) || 0), has = (k) => f[k] !== undefined && f[k] !== null && f[k] !== "";
  const b5 = n(f.b5), b6 = n(f.b6), b7 = r2(b5 - b6), b8 = r2(b7 * GST_FRACTION);
  const b10 = has("b10") ? n(f.b10) : r2(b8 + n(f.b9)), b9 = r2(b10 - b8);
  const b11 = n(f.b11), b12 = r2(b11 * GST_FRACTION);
  const b14 = has("b14") ? n(f.b14) : r2(b12 + n(f.b13)), b13 = r2(b14 - b12);
  return { b5, b6, b7, b8, b9, b10, b11, b12, b13, b14, b15: r2(b10 - b14) };
}

// ---------- Profit and loss ----------
// Month by month for a date range. Sales and costs by invoice/bill date.
export function profitAndLoss(range, st) {
  const find = makeProductFinder(st.products);
  const months = [];
  let [y, m] = range.start.split("-").map(Number);
  while (`${y}-${pad(m)}` <= range.end.slice(0, 7)) { months.push(`${y}-${pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  const row = () => Object.fromEntries(months.map((k) => [k, 0]));
  const sales = row(), cogs = row(), expenses = {}, byProduct = new Map();
  for (const inv of st.invoices.values()) {
    if (!counts(inv) || !inRange(inv.date, range)) continue;
    const k = inv.date.slice(0, 7), c = invoiceCalc(inv, find);
    sales[k] += c.exGst; cogs[k] += c.cogs;
    if (c.net > 0) for (const l of inv.lines || []) {
      if (SERVICE_LINE.test(l.name || "")) continue;
      const p = find(l), key = p ? p.name : l.name;
      const share = c.net ? (l.price * l.qty) / (inv.total || 1) : 0;    // this line's share of the invoice
      const ex = c.exGst * share;
      const e = byProduct.get(key) || { name: key, qty: 0, sales: 0, cost: 0 };
      e.qty += l.qty || 0; e.sales += ex; e.cost += p?.cost ? costAt(p, inv.date) * (l.qty || 0) : 0;
      byProduct.set(key, e);
    }
  }
  for (const b of st.bills.values()) {
    if (!billCounts(b) || isStockCat(b.category) || b.forInvoice) continue;   // linked to a sale: counted in that sale's cost
    if (isAssetCat(b.category)) {
      // Assets: what's claimable each month (Investment Boost, then depreciation), not the price
      for (const [k, v] of Object.entries(assetSchedule(b).months)) if (k in sales) { expenses[DEPRECIATION] = expenses[DEPRECIATION] || row(); expenses[DEPRECIATION][k] += v; }
      continue;
    }
    if (!inRange(b.date, range)) continue;
    const cat = b.category || "Other";
    expenses[cat] = expenses[cat] || row();
    expenses[cat][b.date.slice(0, 7)] += billCalc(b).exGst * (isHalfCat(cat) ? 0.5 : 1);
  }
  const sum = (o) => r2(Object.values(o).reduce((a, v) => a + v, 0));
  const expTotal = row();
  for (const cat of Object.values(expenses)) for (const k of months) expTotal[k] += cat[k];
  const gross = row(), net = row();
  for (const k of months) { gross[k] = sales[k] - cogs[k]; net[k] = gross[k] - expTotal[k]; }
  return {
    months, sales, cogs, gross, expenses, expTotal, net,
    totals: { sales: sum(sales), cogs: sum(cogs), gross: sum(gross), expenses: sum(expTotal), net: sum(net) },
    products: [...byProduct.values()].map((p) => ({ ...p, sales: r2(p.sales), cost: r2(p.cost), margin: r2(p.sales - p.cost) })).sort((a, b) => b.margin - a.margin),
  };
}
export function taxSetAside(dateStr, st) {
  const ty = taxYear(dateStr);
  const pl = profitAndLoss({ start: ty.start, end: dateStr < ty.end ? dateStr : ty.end }, st);
  const profit = pl.totals.net;
  return { ...ty, profit, setAside: r2(Math.max(0, profit) * (st.settings.taxRate || 0) / 100) };
}

// ---------- Stock on hand ----------
// Counted stock + deliveries since the count - sales since the count.
// Without a count date the product isn't tracked yet.
// asOf (optional): stock at the end of that date, e.g. 31 March for your accountant
export function stockOnHand(p, st, asOf = "9999-12-31") {
  if (!p.countDate || p.countDate > asOf) return null;
  let qty = Number(p.countQty) || 0;
  const key = p._id || slug(p.sku || p.name);      // stock moves point at the product id
  for (const mv of st.stockmoves.values()) if (mv.product === key && mv.date > p.countDate && mv.date <= asOf) qty += Number(mv.qty) || 0;
  const find = makeProductFinder(new Map([[key, p]]));
  for (const inv of st.invoices.values()) {
    if (!counts(inv) || inv.status === "refunded" || !(inv.date > p.countDate) || inv.date > asOf) continue;
    for (const l of inv.lines || []) if (find(l)) qty -= Number(l.qty) || 0;
  }
  return qty;
}

// ---------- Bank matching ----------
// Suggest what a bank transaction is: payment for an invoice, a bill being paid,
// a Shopify payout, or an expense like ones you've categorised before.
export function suggestForTxn(t, st, rules) {
  const amt = r2(t.amount), text = `${t.description} ${t.merchant || ""}`.toLowerCase();
  // 0. A matching receipt (same supplier, same amount or same day) beats everything
  if (amt < 0) { const b = matchBill(t, st, amt, text); if (b && b.score >= 5) return b; }
  // 1. Your rules first
  for (const rule of rules) {
    if (rule.match && text.includes(rule.match.toLowerCase()) && (!rule.direction || (rule.direction === "in") === (amt > 0)))
      return { type: rule.action || "expense", rule, category: rule.category, gstTreatment: rule.gstTreatment, supplier: rule.supplier, label: rule.action === "ignore" ? "Not business" : rule.action === "transfer" ? "Transfer" : rule.category };
  }
  // 2. Shopify payouts: the sales are already in from Shopify, so this is just money moving
  if (amt > 0 && /shopify/.test(text)) return { type: "transfer", label: "Shopify payout" };
  if (amt > 0) {
    // 3. A customer paying an invoice (deposit or balance)
    let best = null;
    for (const inv of st.invoices.values()) {
      if (!counts(inv) || !Array.isArray(inv.payments)) continue;
      const p = invoicePay(inv);
      if (p.due <= 0) continue;
      const ref = `${inv.number} ${inv.customer?.name || ""} ${inv.reference || ""}`.toLowerCase();
      const words = ref.split(/\W+/).filter((w) => w.length > 2);
      const nameHit = words.some((w) => text.includes(w));
      const amtHit = Math.abs(p.due - amt) < 0.02 || Math.abs(r2(inv.total / 2) - amt) < 0.02 || amt <= p.due + 0.01;
      const score = (Math.abs(p.due - amt) < 0.02 ? 3 : Math.abs(r2(inv.total / 2) - amt) < 0.02 ? 2 : 0) + (nameHit ? 3 : 0) + (text.includes((inv.number || "").toLowerCase()) ? 4 : 0);
      if (amtHit && score >= 2 && (!best || score > best.score)) best = { type: "invoice", id: inv._id, score, label: `Payment for ${inv.number}` };
    }
    return best;
  }
  // 4. A bill or receipt you already have
  const bill = matchBill(t, st, amt, text);
  if (bill) return bill;
  // 5. Like a transaction you've categorised before
  const key = txnKey(t);
  let prev = null;
  for (const o of st.txns.values()) {
    if (o._id === t._id || !o.category || txnKey(o) !== key) continue;
    if (!prev || o.date > prev.date) prev = o;
  }
  if (prev) return { type: prev.action === "ignore" ? "ignore" : "expense", category: prev.category, gstTreatment: prev.gstTreatment, supplier: prev.supplier, label: prev.category, learned: true };
  return null;
}
// "AMAZON WEB SERVICES 4829 AUCKLAND" and "AMAZON WEB SERVICES 9911" count as the same payee
export const txnKey = (t) => String(t.merchant || t.description || "").toLowerCase().replace(/[0-9]+/g, "").replace(/\s+/g, " ").trim().slice(0, 24);

// ---------- Purchase orders ----------
// po: { number, supplier, currency, date, expected, status: "draft"|"sent"|"part"|"received"|"cancelled",
//       lines: [{ product, name, sku, qty, unit, received }] }
export function poTotals(po) {
  let total = 0, qty = 0, outstanding = 0;
  for (const l of po.lines || []) { total += (Number(l.qty) || 0) * (Number(l.unit) || 0); qty += Number(l.qty) || 0; outstanding += Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0)); }
  return { total: r2(total), qty, outstanding };
}
// Units of a product ordered but not yet received
export function onOrder(productId, st) {
  let n = 0;
  for (const po of st.pos.values()) {
    if (!["sent", "part", "draft"].includes(po.status)) continue;
    for (const l of po.lines || []) if (l.product === productId) n += Math.max(0, (Number(l.qty) || 0) - (Number(l.received) || 0));
  }
  return n;
}

// Find a bill or receipt this payment belongs to: an unpaid bill being paid, or a receipt
// (emailed or snapped) for a charge that's already gone out, like a subscription.
function matchBill(t, st, amt, text) {
  let bill = null;
  for (const b of st.bills.values()) {
    if (b.txn || b.personal || b.source === "bank") continue;          // already matched
    const nameHit = String(b.supplier || "").toLowerCase().split(/\W+/).some((w) => w.length > 2 && text.includes(w));
    const when = b.paidDate || b.date, days = Math.abs(daysBetween(when, t.date));
    const exact = Math.abs(r2(b.total) + amt) < 0.02 && r2(b.total) > 0;
    // Charged in USD/EUR: the bank amount won't match, so go by supplier name and date
    const foreign = b.currency && b.currency !== "NZD" && nameHit && days <= 7;
    const inWindow = b.paidDate ? days <= 10 : days <= 90;
    if (!((exact && inWindow) || foreign)) continue;
    const score = (exact ? 2 : 1) + (nameHit ? 3 : 0) + (days <= 3 ? 1 : 0);
    if (!bill || score > bill.score)
      bill = { type: "bill", id: b._id, score, exact, foreign: !exact && foreign, fromReceipt: !!b.needsReview || !!b.paidDate,
        label: b.needsReview || b.paidDate ? `Receipt from ${b.supplier}` : `Pays ${b.supplier}` };
  }
  return bill;
}
