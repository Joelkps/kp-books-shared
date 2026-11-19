// Checks for the maths and the server. Run: npm test
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeEnv, serve } from "./server.mjs";
import worker from "../worker/index.js";
import * as C from "../public/js/calc.js";
import { accountantPack } from "../public/js/pack.js";
import { parseMime } from "../worker/email.js";
import { parseBankCSV } from "../public/js/csv.js";

let passed = 0;
const test = async (name, fn) => { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.log("  FAIL " + name + "\n       " + (e.message + "\n" + (e.stack.split("\n").find((l) => l.includes("test.mjs")) || "")).split("\n").slice(0, 8).join("\n       ")); process.exitCode = 1; } };

import { installMocks, realFetch } from "./mocks.mjs";
installMocks();

console.log("Maths");
const st = () => ({ settings: { ...C.DEFAULT_SETTINGS }, invoices: new Map(), bills: new Map(), products: new Map(), periods: new Map(), txns: new Map(), stockmoves: new Map(), rules: new Map(), contacts: new Map() });

await test("GST periods: even months, due dates incl Nov and Mar exceptions", () => {
  C.applyTaxSettings({ periodEnds: "even" });                       // settings from before tax setup existed
  assert.equal(C.periodKeyFor("2026-11-03"), "2026-12");
  assert.equal(C.periodLabel("2026-12"), "Nov–Dec 2026");
  assert.equal(C.gstDueDate("2026-12"), "2027-01-28");
  assert.equal(C.gstDueDate("2026-10"), "2026-11-28");
  assert.equal(C.gstDueDate("2027-02"), "2027-03-28");
  assert.equal(C.shiftPeriod("2026-02", -1), "2025-12");
  C.applyTaxSettings({ periodEnds: "odd" });
  assert.equal(C.periodKeyFor("2026-11-03"), "2026-11");
  assert.equal(C.gstDueDate("2026-11"), "2027-01-15");
  assert.equal(C.gstDueDate("2027-03"), "2027-05-07");
  assert.equal(C.taxYear("2026-11-03").label, "2026/27");
  // Kauri Point after the Nov 2026 update: country added, odd periods kept
  C.applyTaxSettings({ country: "NZ", periodEnds: "odd" });
  assert.equal(C.periodKeyFor("2026-11-03"), "2026-11"); assert.equal(C.gstDueDate("2026-11"), "2027-01-15"); assert.equal(C.GST_RATE, 0.15);
  // ...and once saved from the new Setup screen (periodMonths 2, anchor 11)
  C.applyTaxSettings({ country: "NZ", periodEnds: "odd", periodMonths: 2, periodAnchor: 11 });
  assert.equal(C.periodKeyFor("2026-10-03"), "2026-11");
  C.applyTaxSettings({ periodEnds: "even" });
});

await test("Australia: 10% GST, quarterly BAS, ATO due dates, July tax year, AUD", () => { try {
  C.applyTaxSettings({ country: "AU" });
  assert.equal(C.GST_RATE, 0.1); assert.equal(C.r2(C.GST_FRACTION * 110), 10);
  assert.equal(C.HOME(), "AUD");
  assert.equal(C.periodKeyFor("2026-11-03"), "2026-12");
  assert.equal(C.periodLabel("2026-12"), "Oct–Dec 2026");
  assert.equal(C.gstDueDate("2026-12"), "2027-02-28");               // December quarter: 28 February
  assert.equal(C.gstDueDate("2026-09"), "2026-10-28");
  assert.equal(C.shiftPeriod("2026-12", 1), "2027-03");
  const ty = C.taxYear("2026-11-03");
  assert.equal(ty.start, "2026-07-01"); assert.equal(ty.end, "2027-06-30"); assert.equal(ty.label, "2026/27");
  assert.equal(C.taxYear("2026-05-03").start, "2025-07-01");
  // Monthly BAS: 21st of the next month
  C.applyTaxSettings({ country: "AU", periodMonths: 1 });
  assert.equal(C.periodLabel("2026-11"), "Nov 2026"); assert.equal(C.gstDueDate("2026-11"), "2026-12-21");
  // Overrides: own rate and a set number of days
  C.applyTaxSettings({ country: "OTHER", gstRate: 20, periodMonths: 3, periodAnchor: 3, dueRule: "days", gstDueDays: 30, taxYearStart: 1 });
  assert.equal(C.GST_RATE, 0.2); assert.equal(C.gstDueDate("2026-12"), "2027-01-30"); assert.equal(C.taxYear("2026-11-03").label, "2026");
  // GST on a sale follows the rate; assets follow the write-off amount
  C.applyTaxSettings({ country: "AU" });
  const S = st();
  S.invoices.set("a", { _id: "a", source: "shopify", number: "1", date: "2026-11-10", total: 1100, lines: [] });
  const g = C.gstReturn(C.periodKeyFor("2026-11-10"), S);
  assert.equal(g.b5, 1100); assert.equal(g.b10, 100);
  assert.equal(C.assetSchedule({ date: "2026-11-10", total: 11000, gstTreatment: "standard" }).lowValue, true);   // under AU $20,000 write-off
  // BAS filed figures: G1, G2, 1A, 1B typed directly
  const f = C.filedBoxes({ b5: 11000, b6: 0, b10: 1000, b14: 400 });
  assert.equal(f.b15, 600); assert.equal(f.b13, 400);
} finally { C.applyTaxSettings({ periodEnds: "even" }); } });

await test("GST return: sales, zero-rated exports, NZ bills, Customs GST, payments basis deposits", () => {
  const S = st();
  S.invoices.set("a", { _id: "a", source: "shopify", date: "2026-11-05", total: 4600, lines: [] });
  S.invoices.set("b", { _id: "b", source: "shopify", date: "2026-11-06", total: 500, zeroRated: true, lines: [] });
  // Manual invoice: deposit in Sep–Oct, balance in Nov–Dec
  S.invoices.set("c", { _id: "c", source: "manual", date: "2026-10-28", total: 2300, payments: [{ date: "2026-10-29", amount: 1150 }, { date: "2026-11-10", amount: 1150 }], lines: [] });
  S.invoices.set("q", { _id: "q", type: "quote", date: "2026-11-01", total: 99999, lines: [] });
  S.bills.set("x", { _id: "x", date: "2026-11-01", paidDate: "2026-11-02", total: 115, gstTreatment: "standard", category: "Packaging" });
  S.bills.set("y", { _id: "y", date: "2026-11-01", paidDate: "2026-11-02", total: 900, gst: 800, gstTreatment: "import", category: "Customs duty (stock)" });
  S.bills.set("z", { _id: "z", date: "2026-11-01", paidDate: "", total: 230, gstTreatment: "standard", category: "Other" });           // unpaid: not claimed on payments basis
  S.bills.set("r", { _id: "r", date: "2026-11-01", paidDate: "2026-11-01", total: 999, gstTreatment: "standard", needsReview: true });  // not checked yet
  const g = C.gstReturn("2026-12", S);
  assert.equal(g.b5, 4600 + 500 + 1150);
  assert.equal(g.b6, 500);
  assert.equal(g.b8, C.r2((4600 + 1150) * 3 / 23));
  assert.equal(g.b11, 115);
  assert.equal(g.b13, 800);
  assert.equal(g.b15, C.r2(g.b8 - 15 - 800));
  assert.equal(C.gstReturn("2026-10", S).b5, 1150);
  S.settings.basis = "invoice";
  assert.equal(C.gstReturn("2026-12", S).b11, 115 + 230);
  assert.equal(C.gstReturn("2026-10", S).b5, 2300);
});

await test("Margins, service lines and stock on hand", () => {
  const S = st();
  S.products.set("ns45", { _id: "ns45", name: "Narvi NS 4.5kW", sku: "NS45", cost: 900, countQty: 5, countDate: "2026-10-01" });
  S.invoices.set("i", { _id: "i", date: "2026-10-05", total: 2399, lines: [{ qty: 1, name: "Narvi NS 4.5kW", sku: "NS45", price: 1349 }, { qty: 1, name: "International Freight", price: 1050 }] });
  S.invoices.set("old", { _id: "old", date: "2026-09-05", total: 1349, lines: [{ qty: 1, name: "Narvi NS 4.5kW", sku: "NS45", price: 1349 }] });
  S.stockmoves.set("m", { product: "ns45", qty: 4, date: "2026-10-10" });
  const c = C.invoiceCalc(S.invoices.get("i"), C.makeProductFinder(S.products));
  assert.equal(c.missing, 0); assert.equal(c.cogs, 1730.04);   // heater 900 + freight 1050 incl GST at a 10% markup (830.04)
  assert.equal(C.stockOnHand(S.products.get("ns45"), S), 5 - 1 + 4);
});

await test("Payments: deposit, overdue, paid", () => {
  const inv = { total: 1000, dueDate: "2026-10-01", payments: [{ date: "2026-09-20", amount: 500 }] };
  assert.deepEqual(C.invoicePay(inv, "2026-10-05").state, "overdue");
  assert.equal(C.invoicePay(inv, "2026-10-05").daysLate, 4);
  assert.equal(C.invoicePay({ ...inv, payments: [...inv.payments, { amount: 500 }] }, "2026-10-05").state, "paid");
  assert.equal(C.invoicePay({ total: 50 }).state, "paid");   // Shopify orders
});

await test("Bank suggestions: invoice payment, bill payment, Shopify payout, rule, learned", () => {
  const S = st();
  S.invoices.set("i", { _id: "i", number: "INV-0016", customer: { name: "John Cahill" }, total: 2649, payments: [], lines: [] });
  S.bills.set("b", { _id: "b", supplier: "Mainfreight", date: "2026-10-01", total: 345, category: "Inbound freight (stock)" });
  assert.equal(C.suggestForTxn({ amount: 1324.5, description: "J CAHILL INV-0016", date: "2026-10-03" }, S, []).type, "invoice");
  assert.equal(C.suggestForTxn({ amount: -345, description: "MAINFREIGHT LTD", date: "2026-10-04" }, S, []).type, "bill");
  assert.equal(C.suggestForTxn({ amount: 900, description: "SHOPIFY PAYMENTS", date: "2026-10-04" }, S, []).type, "transfer");
  assert.equal(C.suggestForTxn({ amount: -20, description: "GOOGLE WORKSPACE 123", date: "2026-10-04" }, S, [{ match: "google", action: "expense", category: "Software & subscriptions" }]).category, "Software & subscriptions");
  S.txns.set("t0", { _id: "t0", description: "META ADS 4821", amount: -50, date: "2026-09-01", category: "Advertising & marketing", status: "done" });
  const s2 = C.suggestForTxn({ _id: "t1", description: "META ADS 9911", amount: -80, date: "2026-10-01" }, S, []);
  assert.equal(s2.category, "Advertising & marketing"); assert.ok(s2.learned);
});

await test("Freight lines: costed from your usual markup until a freight bill is linked", () => {
  const S = st();
  // Xero-style invoice, GST exclusive: heater 1000 + freight 220 ex GST
  const inv = { date: "2026-08-11", taxMode: "exclusive", total: 1403, lines: [{ qty: 1, name: "Install kit", price: 1000 }, { qty: 1, name: "Freight to Wanaka", price: 220 }],
    lineCosts: { [C.lineKey({ name: "Install kit" })]: { unit: 700 } } };
  let c = C.invoiceCalc(inv, C.makeProductFinder(S.products));
  assert.equal(c.cogs, 900);                    // 700 + 220/1.10
  assert.equal(c.freightEst, 200);
  C.calcOpts.freightMarkup = 0;
  assert.equal(C.invoiceCalc(inv, C.makeProductFinder(S.products)).cogs, 920);
  C.calcOpts.freightMarkup = 10;
  // GST-inclusive invoice: 230 incl = 200 ex, cost 181.82
  assert.equal(C.invoiceCalc({ ...inv, taxMode: "inclusive", total: 1230, lines: [{ ...inv.lines[1], price: 230 }], lineCosts: {} }, () => null).cogs, 181.82);
  // Real freight bill linked: replaces the estimate
  c = C.invoiceCalc({ ...inv, directCosts: [{ name: "Mainfreight 123", amount: 187.5, bill: "b1", freight: true }] }, C.makeProductFinder(S.products));
  assert.equal(c.cogs, 887.5); assert.equal(c.freightEst, 0);
});

await test("Assets, business use % and entertainment", () => {
  // $3,600 laptop in November: 20% Investment Boost, then 50% DV for 5 months (Nov to Mar)
  const laptop = { _id: "lap", date: "2026-11-10", total: 3600, gstTreatment: "standard", category: "Asset (over $1,000)", deprRate: 50, paidDate: "2026-11-10" };
  const sch = C.assetSchedule(laptop);
  assert.equal(sch.cost, 3130.43); assert.equal(sch.boost, 626.09);
  assert.equal(sch.years[0].year, "2026/27"); assert.equal(sch.years[0].claim, 1147.83);
  assert.equal(sch.years[1].claim, 991.3);
  // Cheap one: claimed in full
  assert.equal(C.assetSchedule({ ...laptop, total: 1100 }).years[0].claim, 956.52);
  const S = st();
  S.bills.set("lap", laptop);
  S.bills.set("trip", { _id: "trip", date: "2026-11-12", total: 4000, gstTreatment: "none", category: "Vehicle & travel", businessPct: 50, paidDate: "2026-11-12" });
  S.bills.set("ent", { _id: "ent", date: "2026-11-13", total: 230, gstTreatment: "standard", category: "Entertainment (50%)", paidDate: "2026-11-13" });
  const pl = C.profitAndLoss({ start: "2026-04-01", end: "2027-03-31" }, S);
  assert.equal(C.r2(pl.expenses[C.DEPRECIATION]["2026-11"]), 730.44);
  assert.equal(C.r2(Object.values(pl.expenses[C.DEPRECIATION]).reduce((a, v) => a + v, 0)), 1147.83);
  assert.equal(pl.expenses["Vehicle & travel"]["2026-11"], 2000);
  assert.equal(pl.expenses["Entertainment (50%)"]["2026-11"], 100);
  // GST: laptop claimed in full, entertainment in full, half-business bill only half
  assert.equal(C.billCalc(laptop).gst, 469.57);
  assert.equal(C.billCalc({ total: 115, gstTreatment: "standard", businessPct: 50 }).gst, 7.5);
});

await test("Accountant pack: sales, expenses, assets, debtors and stock at 31 March, GST returns", () => {
  const S = st();
  S.products.set("ns45", { _id: "ns45", name: "Narvi NS 4.5kW", sku: "NS45", cost: 900, costHistory: [{ from: "2000-01-01", exFreight: 800, freight: 100, landed: 900 }], countQty: 5, countDate: "2026-04-01" });
  S.invoices.set("a", { _id: "a", type: "invoice", number: "INV-1", date: "2026-08-28", total: 2300, taxMode: "inclusive", customer: { name: "CAS" }, lines: [{ qty: 2, name: "Narvi NS 4.5kW", sku: "NS45", price: 1150 }], payments: [{ date: "2026-08-30", amount: 1150 }] });
  S.invoices.set("b", { _id: "b", source: "shopify", number: "KP-1001", date: "2027-04-02", total: 1150, lines: [{ qty: 1, name: "Narvi NS 4.5kW", sku: "NS45", price: 1150 }] });
  S.bills.set("lap", { _id: "lap", date: "2026-11-10", total: 3600, gstTreatment: "standard", category: "Asset (over $1,000)", deprRate: 50, paidDate: "2026-11-10", supplier: "Noel Leeming" });
  S.bills.set("ads", { _id: "ads", date: "2026-09-01", total: 115, gstTreatment: "standard", category: "Advertising & marketing", paidDate: "2026-09-01", supplier: "Meta" });
  const { label, sheets } = accountantPack(2026, S), sh = Object.fromEntries(sheets);
  assert.equal(label, "2026/27");
  assert.deepEqual(Object.keys(sh), ["Summary", "Profit and loss", "Sales", "Expenses", "Assets", "Owed at 31 Mar", "Stock at 31 Mar", "GST returns"]);
  assert.equal(sh.Sales.length, 2);                                   // header + the one sale in the year (April 2027 sale excluded)
  assert.equal(sh.Sales[1][11], 1150);                                // half still owing at 31 March
  assert.equal(sh["Owed at 31 Mar"][1][5], 1150);
  assert.equal(sh.Expenses.find((r) => r[1] === "Noel Leeming")[10], 0);     // asset not in P&L as an expense
  assert.equal(sh.Assets[1][6], 1147.83); assert.equal(sh.Assets[1][7], 1982.6);
  const stockRow = sh["Stock at 31 Mar"].find((r) => r[1] === "NS45");
  assert.equal(stockRow[2], 3); assert.equal(stockRow[4], 2700);       // 5 counted - 2 sold, before the April 2027 sale
  assert.equal(sh["GST returns"][0][0], "Period"); assert.ok(sh["GST returns"].length >= 7);
  const sum = Object.fromEntries(sh.Summary.filter((r) => r.length === 2));
  assert.equal(sum["Owed to you at 31 Mar"], 1150); assert.equal(sum["Stock on hand at 31 Mar (landed cost)"], 2700);
});

const { FIXES } = await import("../worker/fixes.js");
if (FIXES["2026-11-gst-filed"]) await test("One-off data fix: odd GST periods and the three filed returns, once only", async () => {
  const fx = makeEnv({});
  const db = await import("../worker/db.js");
  // An existing business on even periods, with Jul already entered by hand
  await fx.DB.batch(db.SCHEMA.map((q) => fx.DB.prepare(q)));
  await fx.DB.prepare(`INSERT INTO records VALUES ('kp','settings','main',?1,'2026-01-01',0)`).bind(JSON.stringify({ businessName: "KP", periodEnds: "even" })).run();
  await fx.DB.prepare(`INSERT INTO records VALUES ('kp','period','2026-07',?1,'2026-01-01',0)`).bind(JSON.stringify({ filed: true, filedReturn: { b5: 1, b15: 1 } })).run();
  db.resetForTests();
  await db.migrate(fx);
  db.resetForTests(); await db.migrate(fx);                                           // second start-up: no change
  const rec = async (k, i) => JSON.parse((await fx.DB.prepare(`SELECT data FROM records WHERE biz='kp' AND kind=?1 AND id=?2`).bind(k, i).first()).data);
  assert.equal((await rec("settings", "main")).periodEnds, "odd");
  assert.equal((await rec("settings", "main")).businessName, "KP");
  assert.ok((await rec("period", "2026-05")).filedReturn); assert.ok((await rec("period", "2026-09")).filedReturn);
  assert.equal((await rec("period", "2026-07")).filedReturn.b5, 1);                 // hand-entered one left alone
  assert.ok(await db.kvGet(fx, "fix:2026-11-gst-filed"));
  db.resetForTests();                                                                  // let the main test database set itself up
});

await test("Filed GST return replaces the app's working for that period", () => {
  const S = st();
  S.invoices.set("a", { _id: "a", source: "shopify", number: "KP-1", date: "2026-09-10", total: 1150, lines: [] });
  const key = C.periodKeyFor("2026-09-10", S.settings);
  assert.equal(C.gstReturn(key, S).b5, 1150);
  S.periods.set(key, { filed: true, filedDate: "2026-10-28", filedReturn: { b5: 23000, b6: 2000, b9: 0, b11: 11500, b13: 300 } });
  const g = C.gstReturn(key, S);
  assert.equal(g.fromFiled, true); assert.equal(g.b5, 23000); assert.equal(g.b8, 2739.13);
  assert.equal(g.b12, 1500); assert.equal(g.b14, 1800); assert.equal(g.b15, 939.13);
  assert.equal(g.calc.b5, 1150);   // the app's own working is still there to compare
});

await test("Imports never merge two different supplier codes that share a name", () => {
  const m = new Map([["903003", { _id: "903003", name: "Narvi Saana 6.8kW", sku: "903003" }]]);
  assert.equal(C.makeProductFinder(m, { strict: true })({ sku: "903103", name: "Narvi Saana 6.8kW" }), null);
  assert.equal(C.makeProductFinder(m)({ sku: "SHOP-SAANA", name: "Narvi Saana 6.8kW" })._id, "903003");   // sales still match by name
  assert.equal(C.makeProductFinder(m, { strict: true })({ sku: "", name: "narvi saana 6.8 kw" })._id, "903003");
  m.get("903003").aliases = ["903103"];
  assert.equal(C.makeProductFinder(m, { strict: true })({ sku: "903103", name: "x" })._id, "903003");
});

await test("Supplier invoice costs beat price-list estimates", () => {
  const S = st();
  // Price list first (an estimate), then the real supplier invoices from earlier in the year
  let p = { _id: "u", name: "Ultra", sku: "NU9", listDate: "2026-11-01" };
  Object.assign(p, C.withNewCost(p, { exFreight: 3000, freight: 300, landed: 3300 }, "2026-11-01", "pricelist"));
  const f = () => C.makeProductFinder(S.products);
  S.products.set("u", p);
  const sale = (d) => ({ date: d, total: 5750, lines: [{ qty: 1, name: "Ultra", sku: "NU9", price: 5750 }] });
  let c = C.invoiceCalc(sale("2026-08-10"), f());
  assert.equal(c.cogs, 3300); assert.equal(c.estimated, 1);
  Object.assign(p, C.withNewCost(p, { exFreight: 2600, freight: 250, landed: 2850 }, "2026-06-15", "invoice"));
  Object.assign(p, C.withNewCost(p, { exFreight: 2700, freight: 280, landed: 2980 }, "2026-09-20", "invoice"));
  c = C.invoiceCalc(sale("2026-08-10"), f()); assert.equal(c.cogs, 2850); assert.equal(c.estimated, 0);
  // After the price list date, the real invoice cost still applies, not the list estimate
  assert.equal(C.invoiceCalc(sale("2026-11-05"), f()).cogs, 2980);
  assert.equal(C.invoiceCalc(sale("2026-03-01"), f()).cogs, 2850);   // before any invoice: earliest real cost
  // A later price list on the same day as a real cost doesn't overwrite it
  Object.assign(p, C.withNewCost(p, { exFreight: 1, freight: 0, landed: 1 }, "2026-09-20", "pricelist"));
  assert.equal(C.invoiceCalc(sale("2026-10-01"), f()).cogs, 2980);
  // Older entries with no source tag: the one on the list date counts as the estimate
  const legacy = { listDate: "2026-11-01", cost: 3300, costHistory: [{ from: "2026-11-01", exFreight: 3000, freight: 300, landed: 3300 }, { from: "2026-07-01", exFreight: 2500, freight: 200, landed: 2700 }] };
  assert.equal(C.productCosts(legacy, "2026-11-08").landed, 2700);
});

await test("Cost history: old sales keep the old cost, new sales use the new one", () => {
  const S = st();
  const p = { _id: "h", name: "Heater", sku: "H", cost: 1000, calc: { eur: 500, fx: 2, freight: 0 } };
  Object.assign(p, C.withNewCost(p, { exFreight: 1100, freight: 0, landed: 1100 }, "2026-11-01"));
  S.products.set("h", p);
  S.invoices.set("old", { _id: "old", date: "2026-10-20", total: 2300, lines: [{ qty: 1, name: "Heater", sku: "H", price: 2300 }] });
  S.invoices.set("new", { _id: "new", date: "2026-11-02", total: 2300, lines: [{ qty: 1, name: "Heater", sku: "H", price: 2300 }] });
  const f = C.makeProductFinder(S.products);
  assert.equal(C.invoiceCalc(S.invoices.get("old"), f).cogs, 1000);
  assert.equal(C.invoiceCalc(S.invoices.get("new"), f).cogs, 1100);
  assert.equal(p.cost, 1100);
});

await test("Purchase orders: totals and units on order", () => {
  const S = st(); S.pos = new Map();
  S.pos.set("po-1", { _id: "po-1", status: "part", lines: [{ product: "h", qty: 4, unit: 500, received: 1 }, { product: "s", qty: 10, unit: 12 }] });
  S.pos.set("po-2", { _id: "po-2", status: "received", lines: [{ product: "h", qty: 9, unit: 500, received: 9 }] });
  assert.deepEqual(C.poTotals(S.pos.get("po-1")), { total: 2120, qty: 14, outstanding: 13 });
  assert.equal(C.onOrder("h", S), 3);
});

await test("Subscriptions: receipts match bank charges (NZD exact, USD by name and date), beat rules", () => {
  const S = st();
  S.bills.set("g", { _id: "g", supplier: "Google", date: "2026-11-01", paidDate: "2026-11-01", total: 32.4, currency: "NZD", gstTreatment: "standard", needsReview: true, source: "email" });
  S.bills.set("c", { _id: "c", supplier: "Anthropic", date: "2026-11-02", paidDate: "2026-11-02", total: 0, originalTotal: 20, currency: "USD", gstTreatment: "none", needsReview: true, source: "email" });
  const rules = [{ match: "google", action: "expense", category: "Software & subscriptions", auto: true }];
  const g = C.suggestForTxn({ _id: "t1", amount: -32.4, description: "GOOGLE*WORKSPACE KAURIPOI", date: "2026-11-02" }, S, rules);
  assert.equal(g.type, "bill"); assert.equal(g.id, "g"); assert.ok(g.exact && g.fromReceipt);
  const c = C.suggestForTxn({ _id: "t2", amount: -34.87, description: "ANTHROPIC SAN FRANCISCO", date: "2026-11-03" }, S, []);
  assert.equal(c.type, "bill"); assert.equal(c.id, "c"); assert.ok(c.foreign);
  // A different month's charge doesn't grab this month's receipt
  const old = C.suggestForTxn({ _id: "t3", amount: -34.87, description: "ANTHROPIC SAN FRANCISCO", date: "2026-10-03" }, S, []);
  assert.notEqual(old?.id, "c");
});

await test("Profit and loss by month and tax set-aside", () => {
  const S = st();
  S.products.set("p", { _id: "p", name: "Heater", sku: "H", cost: 1000 });
  S.invoices.set("i", { _id: "i", date: "2026-06-10", total: 2300, lines: [{ qty: 1, name: "Heater", sku: "H", price: 2300 }] });
  S.bills.set("b", { _id: "b", date: "2026-06-11", total: 230, gstTreatment: "standard", category: "Advertising & marketing" });
  S.bills.set("s", { _id: "s", date: "2026-06-11", total: 5000, gstTreatment: "none", category: "Stock purchases" });
  const pl = C.profitAndLoss({ start: "2026-04-01", end: "2027-03-31" }, S);
  assert.equal(pl.totals.sales, 2000); assert.equal(pl.totals.cogs, 1000); assert.equal(pl.totals.expenses, 200); assert.equal(pl.totals.net, 800);
  assert.equal(C.taxSetAside("2026-11-03", S).setAside, 224);
});

await test("Bank CSV: Australian statements (CommBank no header, Westpac narrative)", () => {
  const cba = parseBankCSV(`20/11/2026,"-45.50","EFTPOS COFFEE CO SYDNEY","+1234.56"\n21/11/2026,"+1100.00","TRANSFER FROM SMITH PTY LTD","+2334.56"`, "Biz");
  assert.equal(cba.length, 2); assert.equal(cba[0].date, "2026-11-20"); assert.equal(cba[0].amount, -45.5); assert.match(cba[1].description, /SMITH PTY/);
  const wbc = parseBankCSV(`Bank Account,Date,Narrative,Debit Amount,Credit Amount,Balance,Categories,Serial\n032000123456,22/11/2026,DEPOSIT ONLINE INV 12,,550.00,2884.56,DEP,`, "Biz");
  assert.equal(wbc[0].amount, 550); assert.match(wbc[0].description, /INV 12/);
});

await test("Bank CSV: ASB-style and ANZ-style statements", () => {
  const asb = `Created date / time : 3 November 2026\nBank 12; Branch 3034\n\nDate,Unique Id,Tran Type,Cheque Number,Payee,Memo,Amount\n2026/10/21,2026102101,D/C,,NZ POST,0012 AUCKLAND,-57.50\n2026/10/22,2026102201,D/C,,SHOPIFY,PAYMENTS,4211.20\n`;
  const r = parseBankCSV(asb, "ASB");
  assert.equal(r.length, 2); assert.equal(r[0].date, "2026-10-21"); assert.equal(r[0].amount, -57.5); assert.match(r[0].description, /NZ POST/);
  const anz = `Type,Details,Particulars,Code,Reference,Amount,Date,ForeignCurrencyAmount,ConversionCharge\nEft-Pos,Mitre 10,4835,,,-23.10,21/10/2026,,\n`;
  const r2 = parseBankCSV(anz, "ANZ");
  assert.equal(r2[0].date, "2026-10-21"); assert.equal(r2[0].amount, -23.1);
});

console.log("Server");
const env = makeEnv({ ANTHROPIC_API_KEY: "test", AKAHU_APP_TOKEN: "app", AKAHU_USER_TOKEN: "user", EMAIL_ALLOWED_SENDERS: "southeyjoel@gmail.com, @nzpost.co.nz" });
const server = await serve(env, 8799);
const base = "http://localhost:8799";
const j = (r) => r.json();
const call = (path, init = {}) => realFetch(base + path, { ...init, headers: { "content-type": "application/json", ...(init.headers || {}) } });

await test("me, save, load, changes, delete", async () => {
  const me = await call("/api/me?biz=kp").then(j);
  assert.equal(me.integrations.ai, true);
  await call("/api/rec/settings/main?biz=kp", { method: "PUT", body: JSON.stringify(C.DEFAULT_SETTINGS) });
  const r = await call("/api/rec/invoice/manual-16?biz=kp", { method: "PUT", body: JSON.stringify({ number: "INV-0016", total: 100 }) }).then(j);
  const d = await call("/api/data?biz=kp").then(j);
  assert.equal(d.records.find((x) => x.id === "manual-16").data.number, "INV-0016");
  const ch = await call("/api/changes?biz=kp&since=" + encodeURIComponent(d.stamp)).then(j);
  assert.equal(ch.records.length, 0);
  await call("/api/rec/invoice/manual-16?biz=kp", { method: "DELETE" });
  const ch2 = await call("/api/changes?biz=kp&since=" + encodeURIComponent(d.stamp)).then(j);
  assert.equal(ch2.records[0].deleted, true);
  assert.equal((await call("/api/rec/nope/x?biz=kp", { method: "PUT", body: "{}" })).status, 400);
});

await test("Shopify webhook: signed order becomes an invoice, bad signature refused", async () => {
  const order = { id: 1, name: "#1042", order_number: 1042, financial_status: "paid", processed_at: "2026-11-02T14:03:22+13:00", email: "jo@example.nz", total_price: "4780.00", total_tax: "623.48", total_discounts: "0.00",
    currency: "NZD", total_shipping_price_set: { shop_money: { amount: "0.00" } }, billing_address: { name: "Jo Bloggs", address1: "1 Rd", city: "Auckland", country: "New Zealand", country_code: "NZ" },
    line_items: [{ quantity: 1, title: "Narvi Ultra", variant_title: "9kW", sku: "NU9", price: "4590.00" }, { quantity: 2, title: "Stones", sku: "ST", price: "95.00" }], refunds: [] };
  const raw = JSON.stringify(order);
  const sig = crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
  const ok = await realFetch(base + "/api/hooks/shopify/kp", { method: "POST", body: raw, headers: { "x-shopify-hmac-sha256": sig, "x-shopify-topic": "orders/paid" } });
  assert.equal(ok.status, 200);
  const bad = await realFetch(base + "/api/hooks/shopify/kp", { method: "POST", body: raw, headers: { "x-shopify-hmac-sha256": "nope" } });
  assert.equal(bad.status, 401);
  const d = await call("/api/data?biz=kp").then(j);
  const inv = d.records.find((x) => x.id === "shopify-1042").data;
  assert.equal(inv.number, "WEB-1042"); assert.equal(inv.date, "2026-11-02"); assert.equal(inv.total, 4780); assert.equal(inv.lines[0].name, "Narvi Ultra - 9kW"); assert.equal(inv.zeroRated, false);
});

await test("kp-hooks receiver (outside the sign-in lock) saves signed orders into the same database", async () => {
  const hooks = (await import("../worker/hooks.js")).default;
  const order = { id: 2, name: "#1043", order_number: 1043, financial_status: "paid", processed_at: "2026-11-08T10:00:00+13:00", total_price: "125.00", total_tax: "16.30", currency: "NZD",
    billing_address: { name: "Sam", country_code: "NZ" }, line_items: [{ quantity: 1, title: "Stones", sku: "ST", price: "125.00" }], refunds: [] };
  const raw = JSON.stringify(order), sig = crypto.createHmac("sha256", "test-secret").update(raw).digest("base64");
  const hookEnv = { DB: env.DB, DEFAULT_BIZ: "kp", SHOPIFY_WEBHOOK_SECRET: "test-secret" };
  const ok = await hooks.fetch(new Request("https://kp-hooks.x.workers.dev/api/hooks/shopify/kp", { method: "POST", body: raw, headers: { "x-shopify-hmac-sha256": sig } }), hookEnv);
  assert.equal(ok.status, 200);
  assert.equal((await hooks.fetch(new Request("https://kp-hooks.x.workers.dev/api/hooks/shopify/kp", { method: "POST", body: raw, headers: { "x-shopify-hmac-sha256": "bad" } }), hookEnv)).status, 401);
  assert.equal((await hooks.fetch(new Request("https://kp-hooks.x.workers.dev/api/data?biz=kp"), hookEnv)).status, 404);
  const d = await call("/api/data?biz=kp").then(j);
  assert.ok(d.records.find((x) => x.id === "shopify-1043"));
  const me = await call("/api/me?biz=kp").then(j);
  assert.equal(me.integrations.shopify, true); assert.ok(me.shopifyLast);
});

await test("Files, AI bill read, supplier read", async () => {
  const up = await realFetch(base + "/api/files?biz=kp&name=bill.pdf", { method: "POST", body: new Uint8Array([37, 80, 68, 70, 1, 2, 3]), headers: { "content-type": "application/pdf" } }).then(j);
  assert.match(up.key, /^kp\//);
  const dl = await realFetch(base + "/api/files/" + encodeURIComponent(up.key) + "?biz=kp");
  assert.equal(dl.headers.get("content-type"), "application/pdf");
  const bill = await call("/api/ai/read?biz=kp", { method: "POST", body: JSON.stringify({ mode: "bill", fileKey: up.key }) }).then(j);
  assert.equal(bill.supplier, "NZ Post");
  const sup = await call("/api/ai/read?biz=kp", { method: "POST", body: JSON.stringify({ mode: "supplier", fileKey: up.key }) }).then(j);
  assert.equal(sup.lines.length, 3);
  const plist = await call("/api/ai/read?biz=kp", { method: "POST", body: JSON.stringify({ mode: "pricelist", text: "Code,Name,Dealer EUR\nNS45,Narvi NS 4.5kW,441" }) }).then(j);
  assert.equal(plist.items.length, 6); assert.equal(plist.items[0].listPrice, 551.25);
  assert.equal((await realFetch(base + "/api/files/" + encodeURIComponent("other/x") + "?biz=kp")).status, 404);
});

await test("Bank sync pulls only accounts switched on", async () => {
  let r = await call("/api/bank/sync?biz=kp", { method: "POST" }).then(j);
  assert.equal(r.accounts, 2);
  const d = await call("/api/data?biz=kp").then(j);
  const accts = d.records.filter((x) => x.kind === "bankacct");
  assert.equal(accts.find((a) => a.id === "acc_biz").data.use, true);
  assert.equal(accts.find((a) => a.id === "acc_personal").data.use, false);
  const tx = d.records.filter((x) => x.kind === "txn");
  assert.deepEqual(tx.map((t) => t.id).sort(), ["tx1", "tx2"]);
  // Your choices survive the next sync
  await call("/api/rec/txn/tx1?biz=kp", { method: "PUT", body: JSON.stringify({ ...tx.find((t) => t.id === "tx1").data, status: "done", category: "Packaging" }) });
  await call("/api/bank/sync?biz=kp&full=1", { method: "POST" });
  const d2 = await call("/api/data?biz=kp").then(j);
  assert.equal(d2.records.find((x) => x.id === "tx1").data.status, "done");
});

await test("Only your senders can email bills in", async () => {
  const { senderAllowed } = await import("../worker/email.js");
  const list = "southeyjoel@gmail.com, @kauripointsauna.co.nz";
  assert.equal(senderAllowed("southeyjoel@gmail.com", list), true);
  assert.equal(senderAllowed("southeyjoel+caf_=bills=kpbooks.com@gmail.com", list), true);     // Gmail auto-forward
  assert.equal(senderAllowed("Joel <SouthEyJoel@Gmail.com>", list), true);
  assert.equal(senderAllowed("info@kauripointsauna.co.nz", list), true);
  assert.equal(senderAllowed("southeyjoel@gmail.com.evil.io", list), false);
  assert.equal(senderAllowed("southeyjoel@evil.com", list), false);
  assert.equal(senderAllowed("spam@kauripointsauna.co.nz.evil.io", list), false);
  assert.equal(senderAllowed("anyone@gmail.com", list), false);
  assert.equal(senderAllowed("forwarding-noreply@google.com", list), true);
  assert.equal(senderAllowed("someone@x.com", ""), false);                                        // nothing listed: nobody
  let rejected = "";
  await worker.email({ from: "stranger@x.com", to: "bills@kpbooks.com", raw: new Blob(["Subject: hi\r\n\r\nhi"]).stream(), setReject(r) { rejected = r; } }, env, {});
  assert.equal(rejected, "Sender not allowed");
});

await test("Emailed bill becomes a bill to check", async () => {
  const pdf = Buffer.from("%PDF-1.4 " + "x".repeat(3000)).toString("base64").replace(/(.{76})/g, "$1\r\n");
  const raw = `From: NZ Post <billing@nzpost.co.nz>\r\nTo: bills@kauripointsauna.co.nz\r\nSubject: Your invoice INV-889\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: multipart/alternative; boundary="b2"\r\n\r\n--b2\r\nContent-Type: text/plain\r\n\r\nPlease find attached.\r\n--b2--\r\n--b1\r\nContent-Type: application/pdf; name="INV-889.pdf"\r\nContent-Disposition: attachment; filename="INV-889.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n${pdf}\r\n--b1--\r\n`;
  const m = parseMime(raw);
  assert.equal(m.files.length, 1); assert.equal(m.files[0].type, "application/pdf"); assert.match(m.text, /attached/);
  await worker.email({ from: "billing@nzpost.co.nz", to: "bills@kauripointsauna.co.nz", raw: new Blob([raw]).stream(), setReject() {} }, env, {});
  const d = await call("/api/data?biz=kp").then(j);
  const b = d.records.find((x) => x.kind === "bill" && x.data.source === "email").data;
  assert.equal(b.needsReview, true); assert.equal(b.supplier, "NZ Post"); assert.equal(b.total, 57.5); assert.match(b.fileKey, /^kp\/inbox\//);
});

await test("Backup and restore, scheduled run", async () => {
  const bk = await call("/api/backup?biz=kp").then(j);
  assert.ok(bk.records.length > 3);
  const r = await call("/api/restore?biz=icebath", { method: "POST", body: JSON.stringify(bk) }).then(j);
  assert.equal(r.restored, bk.records.length);
  await worker.scheduled({ scheduledTime: Date.parse("2026-11-07T12:30:00Z") /* Sunday 1:30am NZ */ }, env, { waitUntil: (p) => p });
  await new Promise((r) => setTimeout(r, 200));
  const list = await call("/api/backups?biz=kp").then(j);
  assert.equal(list.items.length, 1);
});

await test("Free plan usage: file storage and database measured against the allowances", async () => {
  const u = await call("/api/usage?biz=kp&fresh=1").then(j);
  assert.equal(u.items.length, 2);
  assert.ok(u.items[0].used > 0 && u.items[0].limit === 10 * 1024 ** 3);
  assert.ok(u.items[1].used > 0 && u.worst < 1);
  // Claude reads so far have been counted (fake answers report 4,000 tokens in, 600 out)
  assert.ok(u.ai.docs >= 3 && u.ai.usd > 0, JSON.stringify(u.ai));
  const { costOf } = await import("../worker/ai.js");
  assert.equal(Math.round(costOf({}, "claude-haiku-5-5", { input_tokens: 4000, output_tokens: 600 }) * 1e6) / 1e6, 0.0007);
  assert.equal(Math.round(costOf({}, "claude-sonnet-5-5", { input_tokens: 4000, output_tokens: 600 }) * 1e6) / 1e6, 0.014);
  const again = await call("/api/usage?biz=kp").then(j);
  assert.equal(again.checkedAt, u.checkedAt);   // cached
});

await test("Login is required when Access isn't bypassed", async () => {
  const res = await worker.fetch(new Request("http://x/api/data"), { ...env, DEV_NO_AUTH: "0", TEAM_DOMAIN: "https://kp.cloudflareaccess.com", POLICY_AUD: "aud" }, {});
  assert.equal(res.status, 401);
});

await test("Access sign-in token: valid accepted, wrong audience and tampering refused", async () => {
  const { verifyAccess } = await import("../worker/auth.js");
  const kp = await crypto.webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = { ...(await crypto.webcrypto.subtle.exportKey("jwk", kp.publicKey)), kid: "k1", alg: "RS256" };
  const team = "https://kp.cloudflareaccess.com";
  const prev = globalThis.fetch;
  globalThis.fetch = async (u, i) => String(u) === team + "/cdn-cgi/access/certs" ? Response.json({ keys: [jwk] }) : prev(u, i);
  const b64u = (b) => Buffer.from(b).toString("base64url");
  const sign = async (payload) => {
    const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1" })), p = b64u(JSON.stringify(payload));
    const sig = await crypto.webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", kp.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64u(new Uint8Array(sig))}`;
  };
  const e = { TEAM_DOMAIN: team, POLICY_AUD: "aud1", ALLOWED_EMAILS: "joel@example.nz" };
  const req = (t) => new Request("http://x/api/me", { headers: { "cf-access-jwt-assertion": t } });
  const good = await sign({ iss: team, aud: ["aud1"], email: "Joel@example.nz", exp: Date.now() / 1000 + 600 });
  assert.equal(await verifyAccess(req(good), e), "joel@example.nz");
  await assert.rejects(verifyAccess(req(await sign({ iss: team, aud: ["other"], email: "joel@example.nz", exp: Date.now() / 1000 + 600 })), e));
  await assert.rejects(verifyAccess(req(await sign({ iss: team, aud: ["aud1"], email: "someone@else.com", exp: Date.now() / 1000 + 600 })), e));
  const [h, , s] = good.split(".");
  await assert.rejects(verifyAccess(req(`${h}.${b64u(JSON.stringify({ iss: team, aud: ["aud1"], email: "joel@example.nz" }))}.${s}`), e));
  globalThis.fetch = prev;
});

server.close();
console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
