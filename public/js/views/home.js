// Home: what you owe, what you're owed, and what needs doing
import { S, localSet } from "../store.js";
import { register, render as rerender } from "../app.js";
import { esc, money, moneyShort, icon, pill } from "../ui.js";
import { todayStr, periodKeyFor, periodLabel, shiftPeriod, gstReturn, gstDueDate, daysBetween, fmtDate, fmtShort,
  invoicePay, invoiceCalc, makeProductFinder, taxSetAside, profitAndLoss, counts, stockOnHand, productCosts, suggestForTxn, r2, taxYear, MONTHS, pad } from "../calc.js";
import { salesRow } from "./sales.js";
import { firstRun } from "./setup.js";

// Stock you're holding, at landed cost (what it cost you to get here)
function stockTile() {
  let value = 0, units = 0, tracked = 0;
  for (const p of S.products.values()) {
    const q = stockOnHand(p, S); if (q == null) continue;
    tracked++; if (q > 0) { units += q; value += q * productCosts(p).landed; }
  }
  return `<a class="tile" href="#products/stock"><span class="label">Stock on hand</span><span class="big pv">${tracked ? money(value) : "–"}</span><span class="small muted">${tracked ? `${units} unit${units === 1 ? "" : "s"} at landed cost` : "Count your stock to see its value"}</span></a>`;
}

// The big number at the top: sales this month, or for the tax year so far (remembered per device)
let heroMode = (() => { try { return localStorage.getItem("kp:heroMode") || "month"; } catch { return "month"; } })();
const lastYear = (d) => { const [y, m, dd] = d.split("-").map(Number); const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate(); return `${y - 1}-${pad(m)}-${pad(Math.min(dd, last))}`; };
const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);

function salesHero(today) {
  const ty = taxYear(today);
  const start = heroMode === "ytd" ? ty.start : today.slice(0, 8) + "01";
  const now = profitAndLoss({ start, end: today }, S).totals;
  // Compare with the same stretch of time a year earlier (fair even halfway through a month)
  const before = profitAndLoss({ start: lastYear(start), end: lastYear(today) }, S).totals;
  const margin = now.sales > 0 ? Math.round((now.gross / now.sales) * 100) : null;
  const change = before.sales > 0 ? Math.round(((now.sales - before.sales) / before.sales) * 100) : null;
  // Last 12 months, for the little chart
  const months = [];
  let [y, m] = today.split("-").map(Number);
  for (let i = 0; i < 12; i++) { months.unshift(`${y}-${pad(m)}`); m--; if (!m) { m = 12; y--; } }
  const twelve = profitAndLoss({ start: months[0] + "-01", end: today }, S);
  const vals = months.map((k) => twelve.sales[k] || 0), max = Math.max(1, ...vals);
  const inPeriod = (k) => (heroMode === "ytd" ? k >= ty.start.slice(0, 7) : k === today.slice(0, 7));
  const W = 240, H = 64, bw = W / 12;
  const bars = `<svg class="spark" viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="Sales ex GST, last 12 months">
    ${months.map((k, i) => { const h = Math.max(vals[i] ? 2 : 0, (vals[i] / max) * H); return `<rect x="${i * bw + 2}" y="${H - h}" width="${bw - 4}" height="${h}" rx="2" class="${inPeriod(k) ? "on" : ""}"><title>${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)}: ${money(vals[i])}</title></rect>`; }).join("")}
    <text x="0" y="${H + 12}" class="tick">${MONTHS[+months[0].slice(5) - 1]}</text><text x="${W}" y="${H + 12}" text-anchor="end" class="tick">${MONTHS[+months[11].slice(5) - 1]}</text>
  </svg>`;
  const label = heroMode === "ytd" ? `Sales, tax year ${ty.label} so far` : `Sales, ${MONTHS[+today.slice(5, 7) - 1]} so far`;
  return `<section class="hero hero-sales">
    <div class="hero-main">
      <div class="seg small-seg" role="group" aria-label="Period">
        <button data-action="hero-mode" data-m="month" aria-selected="${heroMode === "month"}">This month</button>
        <button data-action="hero-mode" data-m="ytd" aria-selected="${heroMode === "ytd"}">Year to date</button>
      </div>
      <span class="label">${label} · ex GST</span>
      <span class="hero-num">${money(now.sales)}</span>
      <span class="small muted">${change == null ? "No sales on record for the same time last year" : `${pill(change >= 0 ? "good" : "bad", `${change >= 0 ? "+" : ""}${change}%`)} vs ${money(before.sales)} same time last year`}</span>
      <span class="small pv-hide">Gross profit <strong>${money(now.gross)}</strong>${margin != null ? ` · ${margin}% margin` : ""} · Net <strong>${money(now.net)}</strong></span>
    </div>
    <a href="#reports" class="spark-link" aria-label="Open reports">${bars}</a>
  </section>`;
}

function render() {
  // A brand new copy of the app: set up the business first
  if (!S.settings.businessName) return firstRun();
  const today = todayStr();
  const key = periodKeyFor(today, S.settings);
  const g = gstReturn(key, S);
  const dleft = daysBetween(today, g.due);
  const tax = taxSetAside(today, S);
  const find = makeProductFinder(S.products);

  // Money owed to you
  const owed = [...S.invoices.values()].filter((i) => counts(i) && invoicePay(i, today).due > 0);
  const owedSum = owed.reduce((a, i) => a + invoicePay(i, today).due, 0);
  const late = owed.filter((i) => invoicePay(i, today).state === "overdue");

  // Bank balance across accounts used by this business
  const accts = [...S.bankaccts.values()].filter((a) => a.use);
  const bal = accts.reduce((a, x) => a + (Number(x.balance) || 0), 0);

  // This month vs last month
  const ym = today.slice(0, 7);
  const prevYm = (() => { let [y, m] = ym.split("-").map(Number); m--; if (!m) { m = 12; y--; } return `${y}-${String(m).padStart(2, "0")}`; })();
  const pl = profitAndLoss({ start: prevYm + "-01", end: today }, S);
  const salesNow = pl.sales[ym] || 0, salesPrev = pl.sales[prevYm] || 0;

  // Needs attention
  const attn = [];
  const newTxns = [...S.txns.values()].filter((t) => t.status === "new");
  if (newTxns.length) {
    const sure = newTxns.filter((t) => suggestForTxn(t, S, [...S.rules.values()])).length;
    attn.push(["warn", `#bank`, `${newTxns.length} bank transaction${newTxns.length > 1 ? "s" : ""} to check${sure ? `, ${sure} ready to confirm in one tap` : ""}`]);
  }
  const review = [...S.bills.values()].filter((b) => b.needsReview);
  if (review.length) attn.push(["warn", "#bills", `${review.length} emailed bill${review.length > 1 ? "s" : ""} to check`]);
  if (late.length) attn.push(["bad", "#sales", `${late.length} overdue invoice${late.length > 1 ? "s" : ""}, ${money(late.reduce((a, i) => a + invoicePay(i, today).due, 0))} owed`]);
  const prevKey = shiftPeriod(key, -1), prevDue = gstDueDate(prevKey), prevG = gstReturn(prevKey, S);
  if (!S.periods.get(prevKey)?.filed && prevG.nSales + prevG.nBills > 0 && daysBetween(prevDue, today) < 60)
    attn.push([today > prevDue ? "bad" : "warn", "#gst", `GST for ${periodLabel(prevKey)} due ${fmtDate(prevDue)}: ${money(Math.abs(prevG.b15))} ${prevG.b15 >= 0 ? "to pay" : "refund"}`]);
  const unpaidBills = [...S.bills.values()].filter((b) => !b.paidDate && !b.needsReview);
  const dueSoon = unpaidBills.filter((b) => b.dueDate && daysBetween(today, b.dueDate) <= 7);
  if (dueSoon.length) attn.push(["warn", "#bills", `${dueSoon.length} bill${dueSoon.length > 1 ? "s" : ""} due within a week`]);
  const missing = [...S.invoices.values()].filter((i) => counts(i) && i.date >= tax.start && invoiceCalc(i, find).missing > 0);
  if (missing.length) attn.push(["warn", "#products", `${missing.length} sale${missing.length > 1 ? "s" : ""} with products missing a cost, so margins look too high`]);
  const low = [...S.products.values()].filter((p) => p.reorderAt != null && p.reorderAt !== "" && (stockOnHand(p, S) ?? Infinity) <= Number(p.reorderAt));
  if (low.length) attn.push(["warn", "#products", `Low stock: ${low.slice(0, 3).map((p) => esc(p.name)).join(", ")}${low.length > 3 ? ` and ${low.length - 3} more` : ""}`]);
  const latePos = [...S.pos.values()].filter((po) => ["sent", "part"].includes(po.status) && po.expected && po.expected < today);
  if (latePos.length) attn.push(["warn", "#products", `${latePos.length} supplier order${latePos.length > 1 ? "s are" : " is"} past the wanted-by date: ${latePos.map((p) => esc(p.number)).join(", ")}`]);
  // Claude costs this month over your budget?
  const ai = S.usage?.ai, budget = S.me?.aiBudget || 10;
  if (ai && ai.usd >= budget) attn.push(["bad", "#setup", `Claude has cost US$${ai.usd.toFixed(2)} this month, over your US$${budget} budget. Check your Anthropic credit.`]);
  else if (ai && ai.usd >= budget * 0.8) attn.push(["warn", "#setup", `Claude has cost US$${ai.usd.toFixed(2)} this month, close to your US$${budget} budget.`]);
  // Close to a free Cloudflare allowance?
  for (const u of S.usage?.items || []) if (u.pct >= 80) attn.push([u.pct >= 95 ? "bad" : "warn", "#setup", `${u.name} is ${u.pct}% of the free allowance. See Setup.`]);
  if (!S.invoices.size) attn.push(["warn", "#sales", "Import your Shopify orders to get started"]);

  const recent = [...S.invoices.values()].filter((i) => i.type !== "quote").sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.number || "").localeCompare(a.number || "")).slice(0, 5);

  return `
  ${salesHero(today)}

  <section class="tiles">
    <a class="tile" href="#bank"><span class="label">In the bank</span><span class="big">${accts.length ? money(bal) : "–"}</span><span class="small muted">${accts.length ? `${accts.length} account${accts.length > 1 ? "s" : ""}` : "Connect your bank in Setup"}</span></a>
    <a class="tile" href="#sales"><span class="label">Owed to you</span><span class="big">${money(owedSum)}</span><span class="small muted">${owed.length ? `${owed.length} invoice${owed.length > 1 ? "s" : ""}${late.length ? `, ${late.length} late` : ""}` : "All paid up"}</span></a>
    <a class="tile" href="#gst"><span class="label">${g.b15 >= 0 ? "GST to pay" : "GST refund"} · ${periodLabel(key)}</span><span class="big ${g.b15 > 0 ? "owe" : ""}">${money(Math.abs(g.b15))}</span><span class="small muted">Due ${fmtShort(g.due)}, ${dleft} day${dleft === 1 ? "" : "s"} away</span></a>
    ${stockTile()}
    <a class="tile" href="#reports"><span class="label">Tax set-aside ${tax.label}</span><span class="big pv">${money(tax.setAside)}</span><span class="small muted"><span class="pv">${S.settings.taxRate}% of ${money(tax.profit)} profit</span></span></a>
  </section>

  <section>
    <h3>Needs attention</h3>
    <div class="list attn">${attn.length ? attn.map(([lvl, href, text]) => `<a href="${href}"><span class="dot ${lvl}"></span><span>${text}</span>${icon("chevron", 16)}</a>`).join("")
      : `<div class="a"><span class="dot good"></span><span>All clear. Nothing needs you right now.</span></div>`}</div>
  </section>

  <section class="quick-row">
    <button class="btn primary" data-action="new-invoice">${icon("plus", 18)} Invoice</button>
    <label class="btn file">${icon("camera", 18)} Snap receipt<input type="file" accept="image/*" capture="environment" data-change="bill-file" id="home-snap"></label>
    <button class="btn" data-action="new-quote">${icon("plus", 18)} Quote</button>
  </section>

  <section>
    <div class="spread"><h3>Latest sales</h3><a href="#sales" class="small">All sales</a></div>
    ${recent.length ? `<div class="list">${recent.map(salesRow).join("")}</div>` : `<div class="list"><div class="empty">No sales yet. Import your Shopify orders from the Sales tab.</div></div>`}
  </section>`;
}

const actions = { "hero-mode": (el) => { heroMode = el.dataset.m; try { localStorage.setItem("kp:heroMode", heroMode); } catch {} rerender(); } };
register("home", { render, actions });
