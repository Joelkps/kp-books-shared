// Accountant pack: the year's figures as sheets (rows of cells), ready to write to Excel.
// Pure data, no screen code, so it can be tested on its own.
import { todayStr, profitAndLoss, r2, invoiceCalc, makeProductFinder, counts, billCalc, billCounts, isAssetCat, isStockCat, assetSchedule,
  stockOnHand, productCosts, gstReturn, periodKeyFor, periodLabel, shiftPeriod, inRange, DEPRECIATION, taxYearRange, TAX, periodRange } from "./calc.js";

// ---------- Accountant pack ----------
// One Excel file with everything an accountant needs for the year's tax return:
// summary, P&L by month, every sale, every expense, assets, who owed you at 31 March,
// stock at 31 March, and each GST return.
export function accountantPack(startYear, st) {
  const ty = taxYearRange(startYear), range = { start: ty.start, end: ty.end }, end = range.end, label = ty.label;
  // Year-end wording, e.g. "31 Mar" (NZ) or "30 Jun" (AU)
  const [, em, ed] = end.split("-").map(Number), MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const YE = `${ed} ${MON[em - 1]}`, tn = TAX.taxName;
  const find = makeProductFinder(st.products), pl = profitAndLoss(range, st), t = pl.totals, s = st.settings;
  const sumv = (o) => r2(Object.values(o || {}).reduce((a, v) => a + v, 0));

  // Sales
  const sales = [["Date", "Number", "Customer", "Source", "Status", "Total incl GST", "GST", "Sales ex GST", "Cost of goods", "Gross profit", `Paid by ${YE}`, `Owing at ${YE}`, "Lines"]];
  let owingTotal = 0;
  const owing = [["Date", "Number", "Customer", "Total incl GST", `Paid by ${YE}`, `Owing at ${YE}`]];
  for (const inv of [...st.invoices.values()].filter((i) => i.type !== "quote" && inRange(i.date, range)).sort((a, b) => (a.date || "").localeCompare(b.date || ""))) {
    const c = invoiceCalc(inv, find), live = counts(inv);
    const net = r2((inv.total || 0) - (inv.refunded || 0));
    const paid = Array.isArray(inv.payments) ? r2(inv.payments.filter((p) => p.date <= end).reduce((a, p) => a + (Number(p.amount) || 0), 0)) : net;
    const due = live ? r2(Math.max(0, net - paid)) : 0;
    sales.push([inv.date, inv.number, inv.customer?.name || "", inv.source || "manual", inv.status || "", live ? net : 0, live ? c.gst : 0, live ? c.exGst : 0, live ? c.cogs : 0, live ? c.margin : 0, live ? paid : 0, due,
      (inv.lines || []).map((l) => `${l.qty} x ${l.name}`).join("; ")]);
    if (due > 0) { owing.push([inv.date, inv.number, inv.customer?.name || "", net, paid, due]); owingTotal += due; }
  }
  // Invoices from earlier years still owing at 31 March
  for (const inv of st.invoices.values()) {
    if (inv.type === "quote" || !counts(inv) || !inv.date || inv.date >= range.start || !Array.isArray(inv.payments)) continue;
    const net = r2((inv.total || 0) - (inv.refunded || 0)), paid = r2(inv.payments.filter((p) => p.date <= end).reduce((a, p) => a + (Number(p.amount) || 0), 0));
    if (net - paid > 0.005) { owing.push([inv.date, inv.number, inv.customer?.name || "", net, paid, r2(net - paid)]); owingTotal += net - paid; }
  }

  // Expenses
  const exp = [["Date", "Supplier", "Reference", "Category", "Description", "Total", "GST treatment", "GST claimed", "Business use %", "Ex GST (business share)", "In profit and loss", "Paid", "Note"]];
  for (const b of [...st.bills.values()].filter((b) => billCounts(b) && inRange(b.date, range)).sort((a, b) => (a.date || "").localeCompare(b.date || ""))) {
    const c = billCalc(b), half = /Entertainment/.test(b.category || "");
    const inPl = isStockCat(b.category) || b.forInvoice || isAssetCat(b.category) ? 0 : r2(c.exGst * (half ? 0.5 : 1));
    const note = isStockCat(b.category) ? "Stock: in cost of goods" : b.forInvoice ? `Cost of sale ${st.invoices.get(b.forInvoice)?.number || ""}` : isAssetCat(b.category) ? "Asset: see Assets" : half ? "50% deductible" : "";
    exp.push([b.date, b.supplier || "", b.reference || "", b.category || "", b.description || "", r2(b.total), c.treatment, c.gst, Math.round(c.pct * 100), c.exGst, inPl, b.paidDate || "", note]);
  }

  // Assets (everything bought up to 31 March, with this year's claim)
  const assets = [["Bought", "Supplier", "Description", "Cost ex GST (business share)", "Depreciation rate % DV", TAX.country === "NZ" ? "Investment Boost" : "Upfront deduction", `Claimed ${label}`, `Value at ${YE}`]];
  for (const b of [...st.bills.values()].filter((b) => billCounts(b) && isAssetCat(b.category) && b.date <= end).sort((a, b) => a.date.localeCompare(b.date))) {
    const sch = assetSchedule(b), yr = sch.years.find((y) => y.year === label);
    assets.push([b.date, b.supplier || "", b.description || "", sch.cost, sch.lowValue ? "written off" : b.deprRate ?? 50, b.date >= range.start ? sch.boost : 0, yr ? yr.claim : 0, yr ? yr.book ?? 0 : (sch.years.at(-1)?.book ?? 0)]);
  }

  // Stock at 31 March, valued at landed cost
  const stock = [["Product", "SKU", `Units at ${YE}`, "Landed cost each", "Value"]];
  let stockValue = 0, untracked = 0;
  for (const p of [...st.products.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""))) {
    const q = stockOnHand(p, st, end);
    if (q == null) { untracked++; continue; }
    if (!q) continue;
    const each = productCosts(p, end).landed, v = r2(q * each); stockValue += v;
    stock.push([p.name, p.sku || "", q, each, v]);
  }
  stock.push(["Total", "", "", "", r2(stockValue)]);
  if (untracked) stock.push([`${untracked} products not tracked for stock at ${YE}. Count them if you hold any.`]);

  // GST returns for the year
  // Column names in your tax office's terms (IRD boxes, BAS labels or plain words)
  const heads = TAX.returnFormat === "bas"
    ? ["G1 Total sales", "G2 Export sales", `1A ${tn} on sales`, `Purchases incl ${tn}`, `1B ${tn} on purchases`, "Net to pay (refund if negative)"]
    : TAX.returnFormat === "simple"
    ? [`Sales incl ${tn}`, `Sales with no ${tn}`, `${tn} on sales`, `Purchases incl ${tn}`, `${tn} on purchases`, "Net to pay (refund if negative)"]
    : ["Box 5 Total sales incl GST", "Box 6 Zero-rated", "Box 10 GST collected", "Box 11 Purchases incl GST", "Box 14 Total GST credit", "Box 15 GST to pay (refund if negative)"];
  const gst = [["Period", ...heads]];
  let key = periodKeyFor(range.start, s);
  for (let i = 0; i < 13; i++) {
    if (periodRange(key).start > range.end) break;      // periods touching this tax year (the first and last can straddle it)
    const g = gstReturn(key, st);
    gst.push([periodLabel(key), g.b5, g.b6, g.b10, g.b11, g.b14, g.b15]);
    key = shiftPeriod(key, 1);
  }

  const plRows = [["", ...pl.months, "Total"]];
  const add = (l, o) => plRows.push([l, ...pl.months.map((k) => r2(o[k] || 0)), sumv(o)]);
  add("Sales ex GST", pl.sales); add("Cost of goods", pl.cogs); add("Gross profit", pl.gross);
  for (const [k, v] of Object.entries(pl.expenses)) add(k, v);
  add("Total expenses", pl.expTotal); add("Net profit", pl.net);

  const summary = [
    [`${s.legalName || s.businessName} · accountant pack, tax year ${label} (${range.start} to ${range.end})`],
    [TAX.taxIdLabel, s.gstNumber || ""], [`${tn} basis`, s.basis === "invoice" ? "Invoice" : "Payments"], ["Exported", todayStr()], [],
    ["Sales ex GST", t.sales], ["Cost of goods sold (landed cost of what was sold)", t.cogs], ["Gross profit", t.gross],
    ["Expenses (incl depreciation, entertainment at 50%)", t.expenses], [`  of which ${DEPRECIATION}`, sumv(pl.expenses[DEPRECIATION])], ["Net profit before tax", t.net], [],
    [`Owed to you at ${YE}`, r2(owingTotal)], [`Stock on hand at ${YE} (landed cost)`, r2(stockValue)], [],
    ["Notes"],
    ["Sales are counted on invoice date. Shopify orders arrive paid. Freight lines without a linked bill are costed at a " + (s.freightMarkup ?? 10) + "% markup."],
    ["Stock purchases, inbound freight and duty go through cost of goods, not expenses. Assets over $1,000 are depreciated (diminishing value) with Investment Boost where new."],
    ["Every receipt is stored in the app. Ask for any you want to see."],
  ];
  return { label, sheets: [["Summary", summary], ["Profit and loss", plRows], ["Sales", sales], ["Expenses", exp], ["Assets", assets], [`Owed at ${YE}`, owing], [`Stock at ${YE}`, stock], [`${tn} returns`, gst]] };
}

