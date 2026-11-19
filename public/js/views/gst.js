// GST: your 2-monthly return in IRD box order, ready to type into myIR
import { S, save } from "../store.js";
import { register, render } from "../app.js";
import { esc, money, pill, icon, copyText, toast, shareOrDownload, openSheet, closeSheet, sheetHead, $ } from "../ui.js";
import { todayStr, periodKeyFor, periodLabel, shiftPeriod, gstReturn, fmtDate, daysBetween, r2, num, invoiceCalc, billCalc, counts, billCounts, salesInRange, inRange, makeProductFinder, filedBoxes, TAX, GST_RATE } from "../calc.js";

const V = { key: null };

function render_() {
  const key = (V.key ||= periodKeyFor(todayStr(), S.settings));
  const g = gstReturn(key, S), filed = g.adj.filed, dleft = daysBetween(todayStr(), g.due);
  // With a filed return entered, each row also shows the app's own working and any difference
  const diff = (box) => { if (!g.fromFiled || box == null) return ""; const d = r2(g["b" + box] - g.calc["b" + box]); return `<div class="gst-cmp small muted">app ${money(g.calc["b" + box])}</div>${Math.abs(d) >= 0.01 ? `<div class="gst-cmp small warn-text">${d > 0 ? "+" : "−"}${money(Math.abs(d))}</div>` : ""}`; };
  const row = (box, label, val, cls = "", hint = "", key = box) => `<tr class="${cls}"><td class="box">${box}</td><td>${label}${hint ? `<div class="small muted">${hint}</div>` : ""}</td><td class="n">${money(val)}${diff(key)}</td></tr>`;
  // A box you can type an adjustment into (unless a filed return is showing)
  const adjRow = (r, g) => g.fromFiled ? row(r.box, r.label, r.val, r.cls, "", r.key)
    : `<tr><td class="box">${r.box}</td><td>${r.label}<div class="small muted">${r.hint}</div></td><td class="n"><input type="number" step="0.01" inputmode="decimal" id="${r.input}" data-change="gst-adj" data-field="${r.field}" value="${g.adj[r.field] || ""}" placeholder="0.00">${r.total != null ? `<div class="small muted">Total ${money(r.total)}</div>` : ""}</td></tr>`;
  // Recent periods at a glance
  const hist = [-1, -2, -3, -4, -5].map((n) => shiftPeriod(periodKeyFor(todayStr(), S.settings), n)).map((k) => ({ k, g: gstReturn(k, S) }));
  return `<section>
    <div class="spread">
      <div class="row"><button class="icon-btn" data-action="gst-prev" aria-label="Previous period">${icon("back")}</button><h2>${periodLabel(key)}</h2><button class="icon-btn" data-action="gst-next" aria-label="Next period">${icon("chevron")}</button></div>
      ${filed ? pill("good", "filed " + fmtDate(g.adj.filedDate)) : pill(dleft < 0 ? "bad" : "warn", `due ${fmtDate(g.due)}`)}
    </div>
    <div class="hero slim"><div class="hero-main"><span class="label">${g.b15 >= 0 ? `${TAX.taxName} to pay` : `${TAX.taxName} refund due`}</span><span class="hero-num ${g.b15 > 0 ? "owe" : ""}">${money(Math.abs(g.b15))}</span>
      <span class="small muted">${S.settings.basis === "payments" ? "Payments basis" : "Invoice basis"} · ${g.nSales} sales, ${g.nBills} bills${!filed && dleft >= 0 ? ` · ${dleft} days to file` : ""}</span></div></div>
    ${g.fromFiled ? `<div class="banner"><p class="small">Showing the return as filed${g.adj.filedReturn.source ? ` (${esc(g.adj.filedReturn.source)})` : ""}. Small grey figures are the app's own working from the sales and bills in it.</p></div>` : ""}
    <div class="tablewrap"><table class="gst">
      ${returnRows(g).map((r) => r.input ? adjRow(r, g) : row(r.box, r.label, r.val, r.cls, r.hint, r.key)).join("")}
    </table></div>
    <div class="row">
      ${filed ? `<button class="btn" data-action="gst-unfile">Mark as not filed</button>` : `<button class="btn primary" data-action="gst-file">${icon("check", 16)} Mark as filed</button>`}
      <button class="btn" data-action="gst-filed-form">${g.fromFiled ? "Change filed figures" : "Enter filed figures"}</button>
      <button class="btn" data-action="gst-copy">Copy figures</button>
      <button class="btn" data-action="gst-export">${icon("share", 16)} Workpapers CSV</button>
      ${TAX.country === "NZ" ? `<a class="btn" href="https://myir.ird.govt.nz/" target="_blank" rel="noopener">Open myIR</a>` : TAX.country === "AU" ? `<a class="btn" href="https://www.ato.gov.au/online-services" target="_blank" rel="noopener">Open ATO online</a>` : ""}
    </div>
    <p class="small muted">Check imports with your accountant on your first return. Figures come from what's recorded here.</p>
  </section>
  <section>
    <h3>Earlier periods</h3>
    <div class="list">${hist.map(({ k, g }) => `<button class="item" data-action="gst-go" data-k="${k}"><span class="t">${periodLabel(k)}</span><span class="r">${money(g.b15)}</span>
      <span class="s">${g.nSales} sales · ${g.nBills} bills</span><span class="r small">${S.periods.get(k)?.filed ? pill("good", "filed") : g.nSales + g.nBills ? pill("warn", "not filed") : ""}</span></button>`).join("")}</div>
  </section>`;
}

// A CSV of every sale and bill in the period, for your records or your accountant
function workpapers(key) {
  const g = gstReturn(key, S), r = g.range, find = makeProductFinder(S.products);
  const cell = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const out = [["Type", "Date", "Number / Ref", "Name", "Category", "Counted in period (incl GST)", "GST", "GST treatment", "Paid date"]];
  for (const inv of [...S.invoices.values()].filter(counts).sort((a, b) => a.date.localeCompare(b.date))) {
    const amt = salesInRange(inv, r, S.settings); if (amt === null) continue;
    out.push(["Sale", inv.date, inv.number, inv.customer?.name, "Sales", amt, inv.zeroRated ? 0 : r2(amt * 3 / 23), inv.zeroRated ? "zero-rated" : "standard", (inv.payments || []).map((p) => p.date).join(" ")]);
  }
  for (const b of [...S.bills.values()].filter(billCounts).sort((a, b) => a.date.localeCompare(b.date))) {
    const d = S.settings.basis === "invoice" ? b.date : b.paidDate; if (!inRange(d, r)) continue;
    const c = billCalc(b);
    out.push(["Bill", b.date, b.reference, b.supplier, b.category, c.total, c.gst, c.treatment, b.paidDate || ""]);
  }
  out.push([]);
  for (const n of [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]) out.push(["Box " + n, "", "", "", "", g["b" + n]]);
  return out.map((row) => row.map(cell).join(",")).join("\n");
}

// ---------- The return's boxes, in the order your tax office's form uses ----------
// Every format is worked out from the same figures (b5...b15, IRD numbering inside the app).
const frac = () => (Math.abs(GST_RATE - 0.15) < 1e-9 ? "3/23" : Math.abs(GST_RATE - 0.1) < 1e-9 ? "1/11" : `${Math.round(GST_RATE * 1000) / 10}/${Math.round((1 + GST_RATE) * 1000) / 10}`);
function returnRows(g) {
  const tn = TAX.taxName, tc = TAX.country;
  if (TAX.returnFormat === "bas") return [
    { box: "G1", key: 5, label: `Total sales (incl ${tn})`, val: g.b5 },
    { box: "G2", key: 6, label: "Export sales", val: g.b6, hint: `${tn}-free exports, included in G1` },
    { box: "", key: 8, label: `${tn} on sales (G1 less G2, × ${frac()})`, val: g.b8 },
    { box: "", key: 9, label: "Adjustments to 1A", input: "adj-debit", field: "debitAdj", val: g.b9, hint: "Increasing adjustments, e.g. bad debts recovered" },
    { box: "1A", key: 10, label: `${tn} on sales`, val: g.b10, cls: "total" },
    { box: "", key: 11, label: `Purchases (incl ${tn})`, val: g.b11, hint: `Bills with ${tn}. Overseas bills and import entries are left out` },
    { box: "", key: 12, label: `${tn} on purchases (× ${frac()})`, val: g.b12 },
    { box: "", key: 13, label: "Adjustments to 1B", input: "adj-credit", field: "creditAdj", val: g.b13, total: g.b13, hint: `Includes ${money(g.importGst)} ${tn} paid on imports` },
    { box: "1B", key: 14, label: `${tn} on purchases`, val: g.b14, cls: "total" },
    { box: "", key: 15, label: g.b15 >= 0 ? `${tn} to pay (1A less 1B)` : `${tn} refund (1A less 1B)`, val: Math.abs(g.b15), cls: "result" },
  ];
  if (TAX.returnFormat === "simple") return [
    { box: "", key: 5, label: `Sales (incl ${tn})`, val: g.b5 },
    { box: "", key: 6, label: `Sales with no ${tn} (exports)`, val: g.b6 },
    { box: "", key: 9, label: "Adjustments", input: "adj-debit", field: "debitAdj", val: g.b9, hint: "Added to tax on sales" },
    { box: "", key: 10, label: `${tn} on sales`, val: g.b10, cls: "total" },
    { box: "", key: 11, label: `Purchases (incl ${tn})`, val: g.b11 },
    { box: "", key: 13, label: "Adjustments", input: "adj-credit", field: "creditAdj", val: g.b13, total: g.b13, hint: `Added to tax on purchases. Includes ${money(g.importGst)} paid on imports` },
    { box: "", key: 14, label: `${tn} on purchases`, val: g.b14, cls: "total" },
    { box: "", key: 15, label: g.b15 >= 0 ? `${tn} to pay` : `${tn} refund`, val: Math.abs(g.b15), cls: "result" },
  ];
  return [
    { box: 5, key: 5, label: "Total sales and income (incl GST)", val: g.b5 },
    { box: 6, key: 6, label: "Zero-rated supplies", val: g.b6, hint: "Exports with no GST charged" },
    { box: 7, key: 7, label: "Box 5 minus box 6", val: g.b7 },
    { box: 8, key: 8, label: `GST on sales (box 7 × ${frac()})`, val: g.b8 },
    { box: 9, key: 9, label: "Debit adjustments", input: "adj-debit", field: "debitAdj", val: g.b9, hint: "Stock taken for private use, bad debts recovered" },
    { box: 10, key: 10, label: "Total GST collected", val: g.b10, cls: "total" },
    { box: 11, key: 11, label: "Purchases and expenses (incl GST)", val: g.b11, hint: `Bills with ${tc === "NZ" ? "NZ " : ""}GST. Overseas bills and Customs entries are left out` },
    { box: 12, key: 12, label: `GST on purchases (box 11 × ${frac()})`, val: g.b12 },
    { box: 13, key: 13, label: "Credit adjustments", input: "adj-credit", field: "creditAdj", val: g.b13, total: g.b13, hint: `Includes ${money(g.importGst)} GST paid to Customs` },
    { box: 14, key: 14, label: "Total GST credit", val: g.b14, cls: "total" },
    { box: 15, key: 15, label: g.b15 >= 0 ? "GST to pay" : "GST refund", val: Math.abs(g.b15), cls: "result" },
  ];
}

// Enter the figures off a return you've already filed (Xero, myIR). Type boxes 5, 6, 9, 11, 13;
// the rest work themselves out. Box 15 must match what you filed, as a check.
// Which boxes you type for each format (the rest work themselves out)
const FILED_FIELDS = {
  nz: [[5, "Box 5 · Total sales and income (incl GST)"], [6, "Box 6 · Zero-rated supplies"], [9, "Box 9 · Debit adjustments"], [11, "Box 11 · Purchases and expenses (incl GST)"], [13, "Box 13 · Credit adjustments"]],
  bas: [[5, "G1 · Total sales"], [6, "G2 · Export sales"], [10, "1A · GST on sales"], [14, "1B · GST on purchases"]],
  simple: [[5, "Sales (incl tax)"], [6, "Sales with no tax (exports)"], [10, "Tax on sales"], [11, "Purchases (incl tax)"], [14, "Tax on purchases"]],
};
const filedFields = () => FILED_FIELDS[TAX.returnFormat] || FILED_FIELDS.nz;
function filedForm() {
  const g = gstReturn(V.key, S), f = g.adj.filedReturn || {};
  const box = ([b, label]) => `<label class="field"><span>${label}</span><input id="fr-${b}" type="number" step="0.01" inputmode="decimal" value="${f["b" + b] ?? ""}" placeholder="${g.calc["b" + b].toFixed(2)}"></label>`;
  const net = TAX.returnFormat === "nz" ? "Box 15 as filed (to check)" : TAX.returnFormat === "bas" ? "Net amount, 1A less 1B (to check)" : "Net amount (to check)";
  openSheet(`${sheetHead("Filed return", periodLabel(V.key))}
    <form id="filed-form" class="form">
      <p class="small muted">Type the figures exactly as filed. Grey numbers are what the app works out.</p>
      ${filedFields().map(box).join("")}
      <div class="grid2">
        <label class="field"><span>${net}</span><input id="fr-15" type="number" step="0.01" inputmode="decimal" value="${f.b15 ?? ""}" placeholder="refund as negative"></label>
        <label class="field"><span>Filed on</span><input id="fr-date" type="date" value="${esc(g.adj.filedDate || "")}"></label>
      </div>
      <label class="field"><span>Where it was filed</span><input id="fr-src" value="${esc(f.source || (TAX.country === "AU" ? "ATO" : TAX.country === "NZ" ? "myIR" : ""))}"></label>
      <p class="small" id="fr-check"></p>
      <button class="btn primary wide" type="submit">Save filed return</button>
      ${g.fromFiled ? `<button class="btn wide danger" type="button" data-action="gst-filed-clear">Remove filed figures (use the app's working)</button>` : ""}
    </form>`);
  frCheck();
}
// The boxes typed in the form
const typedFiled = () => Object.fromEntries(filedFields().map(([b]) => [`b${b}`, $("#fr-" + b).value === "" ? (b === 10 || b === 14 ? undefined : 0) : r2(num($("#fr-" + b).value))]));
function frCheck() {
  const el = $("#fr-check"); if (!el) return;
  const calc = filedBoxes(typedFiled()), typed = $("#fr-15").value;
  el.innerHTML = typed === "" ? `It works out at <strong>${money(calc.b15)}</strong>${calc.b15 < 0 ? " refund" : ""}.`
    : Math.abs(r2(num(typed) - calc.b15)) < 0.02 ? `<span class="good-text">Matches: ${money(calc.b15)}.</span>`
    : `<span class="warn-text">It works out at ${money(calc.b15)}, not ${money(num(typed))}. Check the boxes.</span>`;
}

const savePeriod = (patch) => { const cur = S.periods.get(V.key) || {}; return save("period", V.key, { ...cur, ...patch }); };
const actions = {
  "gst-prev": () => { V.key = shiftPeriod(V.key, -1); render(); },
  "gst-next": () => { V.key = shiftPeriod(V.key, 1); render(); },
  "gst-go": (el) => { V.key = el.dataset.k; render(); window.scrollTo(0, 0); },
  "gst-file": async () => { await savePeriod({ filed: true, filedDate: todayStr(), filedAmount: gstReturn(V.key, S).b15 }); toast("Marked as filed"); render(); },
  "gst-filed-form": () => filedForm(),
  "gst-filed-clear": async () => { const cur = { ...(S.periods.get(V.key) || {}) }; delete cur.filedReturn; await save("period", V.key, cur); closeSheet(); toast("Back to the app's working"); render(); },
  "gst-unfile": async () => { await savePeriod({ filed: false, filedDate: "" }); render(); },
  "gst-copy": () => { const g = gstReturn(V.key, S); copyText(`${TAX.taxName} ${periodLabel(V.key)}\n` + returnRows(g).filter((r) => r.box !== "" || r.cls === "result").map((r) => `${r.box ? (typeof r.box === "number" ? "Box " + r.box : r.box) + " " : ""}${r.label}: ${r.val.toFixed(2)}`).join("\n")); },
  "gst-export": () => shareOrDownload(new Blob([workpapers(V.key)], { type: "text/csv" }), `GST ${periodLabel(V.key).replace("–", "-")}.csv`),
};
const changes = { "gst-adj": async (el) => { await savePeriod({ [el.dataset.field]: r2(num(el.value)) }); render(); } };
const inputs = Object.fromEntries([5, 6, 9, 10, 11, 13, 14, 15].map((b) => ["fr-" + b, frCheck]));
const submits = {
  "filed-form": async () => {
    const typed = typedFiled(), boxes = filedBoxes(typed);
    if ($("#fr-15").value !== "" && Math.abs(r2(num($("#fr-15").value) - boxes.b15)) >= 0.02) { toast("The net amount doesn't match the other boxes. Check them first."); return; }
    const date = $("#fr-date").value || todayStr();
    await savePeriod({ filedReturn: { ...Object.fromEntries(Object.entries(typed).filter(([, x]) => x !== undefined)), b15: boxes.b15, source: $("#fr-src").value.trim() }, filed: true, filedDate: date, filedAmount: boxes.b15 });
    closeSheet(); toast(`Filed return saved for ${periodLabel(V.key)}`); render();
  },
};

register("gst", { render: render_, actions, changes, inputs, submits });
