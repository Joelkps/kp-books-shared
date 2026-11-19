// Reports: profit and loss by month, sales chart, best products, accountant export
import { S, fileUrl } from "../store.js";
import { register, render } from "../app.js";
import { esc, money, moneyShort, pill, icon, shareOrDownload, loadScript, toast } from "../ui.js";
import { todayStr, taxYear, profitAndLoss, MONTHS, r2, taxYearRange } from "../calc.js";
import { accountantPack } from "../pack.js";

const V = { year: null };

// Bar chart of sales ex GST per month, with net profit drawn as a line
function chart(pl) {
  const W = 640, H = 220, padL = 46, padB = 26, padT = 12, n = pl.months.length;
  const vals = pl.months.map((k) => [pl.sales[k], pl.net[k]]);
  const max = Math.max(1, ...vals.flat()), min = Math.min(0, ...vals.map((v) => v[1]));
  const step = niceStep((max - min) / 4);
  const top = Math.ceil(max / step) * step, bot = Math.floor(min / step) * step;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - bot) / (top - bot || 1));
  const bw = (W - padL - 8) / n;
  const ticks = []; for (let v = bot; v <= top + 1e-6; v += step) ticks.push(v);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Sales and net profit by month">
    ${ticks.map((v) => `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end" class="tick">${moneyShort(v)}</text>`).join("")}
    ${pl.months.map((k, i) => `<rect x="${padL + i * bw + bw * 0.18}" y="${y(Math.max(0, pl.sales[k]))}" width="${bw * 0.64}" height="${Math.max(0, y(0) - y(Math.max(0, pl.sales[k])))}" class="bar"><title>${MONTHS[+k.slice(5) - 1]}: sales ${money(pl.sales[k])}, net ${money(pl.net[k])}</title></rect>
      <text x="${padL + i * bw + bw / 2}" y="${H - 8}" text-anchor="middle" class="tick">${MONTHS[+k.slice(5) - 1]}</text>`).join("")}
    <polyline points="${pl.months.map((k, i) => `${padL + i * bw + bw / 2},${y(pl.net[k])}`).join(" ")}" class="line"/>
    ${pl.months.map((k, i) => `<circle cx="${padL + i * bw + bw / 2}" cy="${y(pl.net[k])}" r="3" class="dotp"/>`).join("")}
  </svg>
  <div class="legend small"><span><i class="sw bar"></i>Sales ex GST</span><span><i class="sw line"></i>Net profit</span></div>`;
}
function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) || p * 10; }

function render_() {
  const ty = taxYear(todayStr());
  const start = V.year ?? ty.startYear;
  const range = taxYearRange(start);
  const pl = profitAndLoss(range, S), t = pl.totals;
  const cats = Object.entries(pl.expenses).map(([k, v]) => [k, r2(Object.values(v).reduce((a, x) => a + x, 0))]).sort((a, b) => b[1] - a[1]);
  const cur = pl.months.filter((k) => k <= todayStr().slice(0, 7));
  return `<section class="pv-only"><h2>Reports</h2><div class="empty">Costs and margins are hidden. Tap the eye at the top to show them.</div></section>
  <div class="pv-hide"><section>
    <div class="spread"><h2>Reports</h2>
      <button class="btn primary small-btn" data-action="accountant-pack">${icon("share", 16)} Accountant pack</button>
      <button class="btn small-btn" data-action="receipts-zip">${icon("bills", 16)} Receipts</button>
      <select id="rep-year" data-change="rep-year" aria-label="Tax year">${[0, 1, 2, 3].map((n) => ty.startYear - n).map((y) => `<option value="${y}" ${y === start ? "selected" : ""}>Tax year ${y}/${String(y + 1).slice(2)}</option>`).join("")}</select>
    </div>
    <div class="tiles">
      <div class="tile"><span class="label">Sales ex GST</span><span class="big">${money(t.sales)}</span></div>
      <div class="tile"><span class="label">Gross profit</span><span class="big">${money(t.gross)}</span><span class="small muted">${t.sales ? Math.round((t.gross / t.sales) * 100) + "% margin" : ""}</span></div>
      <div class="tile"><span class="label">Expenses</span><span class="big">${money(t.expenses)}</span></div>
      <div class="tile"><span class="label">Net profit</span><span class="big">${money(t.net)}</span><span class="small muted">Tax at ${S.settings.taxRate}%: ${money(Math.max(0, t.net) * S.settings.taxRate / 100)}</span></div>
    </div>
    <div class="card chart-card">${chart({ ...pl, months: cur.length ? cur : pl.months })}</div>
  </section>
  <section>
    <div class="spread"><h3>Profit and loss</h3><button class="btn small-btn" data-action="rep-export">${icon("share", 16)} CSV</button></div>
    <div class="tablewrap"><table class="pl">
      <thead><tr><th></th>${cur.map((k) => `<th class="n">${MONTHS[+k.slice(5) - 1]}</th>`).join("")}<th class="n">Total</th></tr></thead>
      <tbody>
        ${plRow("Sales ex GST", pl.sales, cur, t.sales)}
        ${plRow("Cost of goods", pl.cogs, cur, t.cogs)}
        ${plRow("Gross profit", pl.gross, cur, t.gross, "total")}
        ${Object.entries(pl.expenses).map(([k, v]) => plRow(esc(k), v, cur, r2(Object.values(v).reduce((a, x) => a + x, 0)), "sub")).join("")}
        ${plRow("Total expenses", pl.expTotal, cur, t.expenses, "total")}
        ${plRow("Net profit", pl.net, cur, t.net, "result")}
      </tbody></table></div>
  </section>
  <section class="two-col">
    <div><h3>Best products by margin</h3>
      ${pl.products.length ? `<div class="list">${pl.products.slice(0, 10).map((p) => `<div class="item static"><span class="t">${esc(p.name)}</span><span class="r">${money(p.margin)}</span><span class="s">${p.qty} sold · ${money(p.sales)} sales${p.cost ? "" : " · no cost recorded"}</span><span class="r small">${p.sales && p.cost ? pill("mute", Math.round((p.margin / p.sales) * 100) + "%") : ""}</span></div>`).join("")}</div>` : `<div class="list"><div class="empty">No sales this year yet.</div></div>`}
    </div>
    <div><h3>Where the money goes</h3>
      ${cats.length ? `<div class="list">${cats.map(([k, v]) => `<div class="item static"><span class="t">${esc(k)}</span><span class="r">${money(v)}</span><span class="s"><span class="bar-mini" style="--w:${Math.round((v / (cats[0][1] || 1)) * 100)}%"></span></span><span></span></div>`).join("")}</div>` : `<div class="list"><div class="empty">No expenses recorded this year.</div></div>`}
    </div>
  </section></div>`;
}
const plRow = (label, obj, months, total, cls = "") => `<tr class="${cls}"><td>${label}</td>${months.map((k) => `<td class="n">${obj[k] ? Math.round(obj[k]).toLocaleString("en-NZ") : "–"}</td>`).join("")}<td class="n">${Math.round(total).toLocaleString("en-NZ")}</td></tr>`;

const actions = {
  // Every receipt for the tax year in one zip: a folder per month, files named
  // "2026-11-10 Noel Leeming $3,600.00.pdf", plus a list of them (receipts.csv)
  "receipts-zip": async (el) => {
    const startYear = V.year ?? taxYear(todayStr()).startYear, { start, end } = taxYearRange(startYear);
    const bills = [...S.bills.values()].filter((b) => b.fileKey && !b.needsReview && b.date >= start && b.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    if (!bills.length) { toast("No receipts saved for that tax year yet."); return; }
    el.disabled = true;
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
      const zip = new window.JSZip(), used = new Set(), list = [["Date", "Supplier", "Category", "Total", "GST", "File"]];
      let n = 0;
      for (const b of bills) {
        toast(`Adding receipt ${++n} of ${bills.length}…`, 60000);
        const res = await fetch(fileUrl(b.fileKey), { credentials: "same-origin" });
        if (!res.ok) continue;
        const ext = (b.fileName || b.fileKey).match(/\.(\w{2,4})$/)?.[1]?.toLowerCase() || (res.headers.get("content-type") || "").split("/")[1] || "pdf";
        let name = `${b.date} ${b.supplier || "Bill"} ${money(b.total)}`.replace(/[\\/:*?"<>|]+/g, "-").trim();
        while (used.has(name)) name += " (2)";
        used.add(name);
        const path = `${MONTHS[+b.date.slice(5, 7) - 1]} ${b.date.slice(0, 4)}/${name}.${ext}`;
        zip.file(path, await res.blob());
        list.push([b.date, b.supplier || "", b.category || "", r2(b.total), r2(b.gst || 0), path]);
      }
      zip.file("receipts.csv", list.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(",")).join("\n"));
      const blob = await zip.generateAsync({ type: "blob" });
      await shareOrDownload(blob, `${S.settings.businessName} receipts ${startYear}-${String(startYear + 1).slice(2)}.zip`);
      toast(`${list.length - 1} receipt${list.length === 2 ? "" : "s"} saved`);
    } catch (e) { console.error(e); toast("Couldn't build the zip. Check your connection and try again."); }
    el.disabled = false;
  },
  "accountant-pack": async (el) => {
    const startYear = V.year ?? taxYear(todayStr()).startYear;
    el.disabled = true;
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
      const { label, sheets } = accountantPack(startYear, S), X = window.XLSX, wb = X.utils.book_new();
      for (const [name, rows] of sheets) {
        const ws = X.utils.aoa_to_sheet(rows);
        ws["!cols"] = (rows[0] || []).map((_, i) => ({ wch: Math.min(48, Math.max(10, ...rows.map((r) => String(r[i] ?? "").length))) }));
        X.utils.book_append_sheet(wb, ws, name);
      }
      const out = X.write(wb, { type: "array", bookType: "xlsx" });
      await shareOrDownload(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${S.settings.businessName} accountant pack ${label.replace("/", "-")}.xlsx`);
    } catch (e) { console.error(e); toast("Couldn't build the file. Check your connection and try again."); }
    el.disabled = false;
  },
  "rep-export": () => {
    const ty = V.year ?? taxYear(todayStr()).startYear;
    const pl = profitAndLoss(taxYearRange(ty), S);
    const rows = [["", ...pl.months, "Total"]];
    const add = (label, o) => rows.push([label, ...pl.months.map((k) => r2(o[k])), r2(Object.values(o).reduce((a, x) => a + x, 0))]);
    add("Sales ex GST", pl.sales); add("Cost of goods", pl.cogs); add("Gross profit", pl.gross);
    for (const [k, v] of Object.entries(pl.expenses)) add(k, v);
    add("Total expenses", pl.expTotal); add("Net profit", pl.net);
    const csv = rows.map((r) => r.map((c) => (/[",]/.test(String(c)) ? `"${c}"` : c)).join(",")).join("\n");
    shareOrDownload(new Blob([csv], { type: "text/csv" }), `Profit and loss ${ty}-${String(ty + 1).slice(2)}.csv`);
  },
};
const changes = { "rep-year": (el) => { V.year = Number(el.value); render(); } };

register("reports", { render: render_, actions, changes });
