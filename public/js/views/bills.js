// Bills and expenses: snap or upload, Claude reads it, you check and save
import { S, save, remove, api, uploadFile, fileUrl } from "../store.js";
import { register, render, rerenderKeepFocus } from "../app.js";
import { $, esc, money, pill, icon, openSheet, closeSheet, sheetHead, toast, confirmTap, empty, sheetOpen } from "../ui.js";
import { BILL_CATEGORIES, todayStr, fmtDate, fmtShort, r2, num, slug, billCalc, isStockCat, GST_FRACTION, daysBetween, isAssetCat, assetSchedule, HOME, TAX, lowValueAsset } from "../calc.js";

const V = { tab: "all", q: "", shown: 60 };
let draft = null;           // the bill being checked in the form

export function billRow(b) {
  const c = billCalc(b);
  const gstNote = c.treatment === "none" ? "no GST" : c.treatment === "import" ? "import GST" : `GST ${money(c.gst)}`;
  const state = b.needsReview ? pill("warn", "check") : b.paidDate ? pill("good", "paid") : b.dueDate && b.dueDate < todayStr() ? pill("bad", "overdue") : pill("warn", b.dueDate ? "due " + fmtShort(b.dueDate) : "unpaid");
  return `<button class="item" data-action="open-bill" data-id="${esc(b._id)}">
    <span class="t">${esc(b.supplier || "Supplier")}${b.example ? " " + pill("warn", "example") : ""}</span>
    <span class="r">${money(c.total)}</span>
    <span class="s">${fmtShort(b.date)} · ${esc(b.category || "Other")} · ${gstNote}${b.fileKey ? "" : ` · <span class="warn-text">no receipt</span>`}${b.dupOf ? ` · <span class="warn-text">possible duplicate</span>` : ""}</span>
    <span class="r small">${state}</span></button>`;
}

function render_() {
  const all = [...S.bills.values()].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const review = all.filter((b) => b.needsReview), unpaid = all.filter((b) => !b.paidDate && !b.needsReview);
  const q = V.q.toLowerCase();
  const noReceipt = all.filter((b) => !b.fileKey && !b.needsReview && !b.example);
  let list = V.tab === "review" ? review : V.tab === "unpaid" ? unpaid : V.tab === "noreceipt" ? noReceipt : all;
  if (q) list = list.filter((b) => `${b.supplier} ${b.reference} ${b.description} ${b.category} ${b.total}`.toLowerCase().includes(q));
  const unpaidSum = unpaid.reduce((a, b) => a + r2(b.total), 0);
  return `<section>
    <div class="spread"><h2>Bills</h2><div class="row">
      <label class="btn file small-btn">${icon("camera", 16)} Snap<input type="file" accept="image/*" capture="environment" data-change="bill-file" id="bills-snap"></label>
      <label class="btn primary file small-btn">${icon("upload", 16)} Upload<input type="file" multiple accept="image/*,application/pdf,.eml,.txt,.html" data-change="bill-file" id="bills-upload"></label>
    </div></div>
    <div class="drop" id="bill-drop">Drop bill PDFs or photos here, as many as you like. Claude reads the supplier, date, total and GST.${S.me?.integrations?.ai ? "" : " <strong>Connect Claude first (setup guide step 7: your Anthropic key in Cloudflare) to switch this on.</strong>"}</div>
    <div class="seg" role="tablist">
      <button role="tab" data-action="bills-tab" data-tab="all" aria-selected="${V.tab === "all"}">All</button>
      <button role="tab" data-action="bills-tab" data-tab="review" aria-selected="${V.tab === "review"}">To check${review.length ? ` (${review.length})` : ""}</button>
      <button role="tab" data-action="bills-tab" data-tab="unpaid" aria-selected="${V.tab === "unpaid"}">Unpaid${unpaid.length ? ` ${money(unpaidSum)}` : ""}</button>
      ${noReceipt.length || V.tab === "noreceipt" ? `<button role="tab" data-action="bills-tab" data-tab="noreceipt" aria-selected="${V.tab === "noreceipt"}">No receipt (${noReceipt.length})</button>` : ""}
    </div>
    <input type="search" id="bills-q" class="search" placeholder="Search supplier, category, amount" value="${esc(V.q)}">
    ${list.length ? `<div class="list">${list.slice(0, V.shown).map(billRow).join("")}</div>`
      : `<div class="list">${empty(q ? "No bills match." : V.tab === "review" ? "Nothing to check. Bills you email in land here first." : "No bills yet. Snap a receipt, upload a PDF, or create them from bank transactions.")}</div>`}
    ${list.length > V.shown ? `<button class="btn" data-action="bills-more">Show more</button>` : ""}
    <button class="btn" data-action="bill-manual">${icon("plus", 16)} Type in an expense</button>
  </section>`;
}

// ---------- The bill form ----------
const isQuoteDoc = (i) => i.type === "quote";
// Which sale is this bill for? Looks for one of your invoice or order numbers, then a customer name,
// in what Claude read (delivery name, references, description). Only recent sales (last 120 days before the bill).
function guessSale(d) {
  const text = `${d.relatedTo || ""} ${d.reference || ""} ${d.description || ""}`.toLowerCase();
  if (text.trim().length < 3) return null;
  const recent = [...S.invoices.values()].filter((i) => !isQuoteDoc(i) && i.date && (!d.date || (i.date <= d.date && daysBetween(i.date, d.date) <= 120)));
  const byNumber = recent.find((i) => [i.number, i.orderName].filter(Boolean).some((n) => new RegExp(`(^|[^a-z0-9])${String(n).toLowerCase().replace(/[^a-z0-9-]/g, "")}($|[^0-9])`).test(text.replace(/#/g, ""))));
  if (byNumber) return byNumber;
  const words = (n) => String(n || "").toLowerCase().replace(/\b(ltd|limited|the|nz)\b/g, "").split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const hits = recent.map((i) => { const w = words(i.customer?.company || i.customer?.name); return { i, n: w.length && w.every((x) => text.includes(x)) ? w.length : 0 }; })
    .filter((x) => x.n).sort((a, b) => b.n - a.n || (b.i.date || "").localeCompare(a.i.date || ""));
  return hits[0]?.i || null;
}
const invLabel = (i) => i ? `${i.number} · ${i.customer?.name || ""}` : "";
const invFromLabel = (t) => { t = String(t || "").trim(); if (!t) return null; const n = t.split(" · ")[0].trim().toLowerCase(); return [...S.invoices.values()].find((i) => !isQuoteDoc(i) && String(i.number || "").toLowerCase() === n) || null; };
// Put this bill on a sale as a cost (or take it off the old one)
async function linkBillToSale(billId, bill, oldInvId, newInv) {
  const amount = r2((Number(bill.total) || 0) - (Number(bill.gst) || 0));
  if (oldInvId && oldInvId !== newInv?._id && S.invoices.has(oldInvId)) {
    const { _id, ...o } = S.invoices.get(oldInvId); o.directCosts = (o.directCosts || []).filter((d) => d.bill !== billId); await save("invoice", _id, o);
  }
  if (newInv) {
    const { _id, ...o } = S.invoices.get(newInv._id);
    const freight = /freight|courier|shipping/i.test(`${bill.category} ${bill.description} ${bill.supplier}`) || /Outbound shipping/.test(bill.category || "");
    o.directCosts = [...(o.directCosts || []).filter((d) => d.bill !== billId), { name: `${bill.supplier}${bill.reference ? " " + bill.reference : ""}`, amount, date: bill.date, bill: billId, freight }];
    await save("invoice", _id, o);
  }
}
export function openBillForm(d) {
  draft = d;
  const cats = BILL_CATEGORIES.map((c) => `<option ${c.name === (d.category || "Other") ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const t = d.gstTreatment || "standard";
  const suppliers = [...new Set([...S.bills.values()].map((b) => b.supplier).filter(Boolean))].sort();
  openSheet(`${sheetHead(d._id ? (d.needsReview ? "Check this bill" : "Edit bill") : "New bill")}
    ${d.fileKey ? `<p class="small"><a href="${fileUrl(d.fileKey)}" target="_blank" rel="noopener">${icon("bills", 16)} Open ${esc(d.fileName || "file")}</a></p>` : ""}
    ${d.aiNote ? `<div class="banner"><p class="small">${esc(d.aiNote)}</p></div>` : ""}
    ${d.dupOf && S.bills.has(d.dupOf) ? `<div class="banner warn"><p class="small">This looks like a bill you already have (${esc(S.bills.get(d.dupOf).supplier)}, ${money(S.bills.get(d.dupOf).total)}, ${fmtDate(S.bills.get(d.dupOf).date)}). Delete it if it's the same one.</p></div>` : ""}
    ${d.emailFrom ? `<p class="small muted">Emailed by ${esc(d.emailFrom)}${d.emailSubject ? `: ${esc(d.emailSubject)}` : ""}</p>` : ""}
    <form id="bill-form" class="form">
      <div class="grid2">
        <label class="field"><span>Supplier</span><input id="b-supplier" value="${esc(d.supplier)}" list="supplier-names" required></label>
        <label class="field"><span>Category</span><select id="b-cat">${cats}</select></label>
        <label class="field"><span>Total ${HOME()} incl ${TAX.taxName}</span><input id="b-total" type="number" step="0.01" inputmode="decimal" value="${d.total || d.total === 0 ? d.total : ""}" required></label>
        <label class="field"><span>Invoice date</span><input id="b-date" type="date" value="${esc(d.date || todayStr())}" required></label>
      </div>
      <datalist id="supplier-names">${suppliers.map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
      ${d.currency && d.currency !== HOME() ? `<p class="small muted">Original amount ${esc(d.currency)} ${esc(d.originalTotal)}. Enter what it cost you in ${HOME()}.</p>` : ""}
      <div class="grid2">
        <label class="field"><span>GST</span><select id="b-treat">
          <option value="standard" ${t === "standard" ? "selected" : ""}>NZ GST 15%</option>
          <option value="none" ${t === "none" ? "selected" : ""}>No GST</option>
          <option value="import" ${t === "import" ? "selected" : ""}>Customs import GST</option></select></label>
        <label class="field"><span>GST amount</span><input id="b-gst" type="number" step="0.01" inputmode="decimal" value="${d.gst ?? ""}"></label>
      </div>
      <div class="grid2">
        <label class="field"><span>Business use %</span><input id="b-pct" type="number" step="1" min="0" max="100" inputmode="numeric" value="${d.businessPct ?? 100}"></label>
        <p class="small muted" style="align-self:end">Less than 100 for part-personal costs, e.g. a trip with holiday days: claim the business days' share.</p>
      </div>
      <div class="card" id="b-asset" ${isAssetCat(d.category) ? "" : "hidden"}>
        <span class="label">Asset</span>
        <div class="grid2">
          <label class="field"><span>Depreciation rate % (diminishing value)</span><input id="b-rate" type="number" step="0.5" min="0" max="100" value="${d.deprRate ?? TAX.deprRate ?? 50}"></label>
          ${Number(TAX.boostPct) ? `<label class="check" style="align-self:end"><input type="checkbox" id="b-new" ${d.newAsset === false ? "" : "checked"}> Brand new (${TAX.boostPct}% ${TAX.country === "NZ" ? "Investment Boost" : "upfront deduction"})</label>` : `<input type="hidden" id="b-new" value="">`}
        </div>
        <p class="small muted">${TAX.country === "NZ" ? "Laptops and computers 50%. Check others with IRD's rate finder (ird.govt.nz/rate-finder)." : TAX.country === "AU" ? "Check rates with the ATO's depreciation tools (ato.gov.au)." : "Check the rate with your tax office or accountant."} Up to ${money(lowValueAsset())} ex ${TAX.taxName} is claimed in full.</p>
        <div id="b-sched" class="small"></div>
      </div>
      <details ${d.reference || d.description || d.dueDate ? "open" : ""}><summary>Reference, description, due date</summary>
        <div class="grid2">
          <label class="field"><span>Reference / invoice no.</span><input id="b-ref" value="${esc(d.reference)}"></label>
          <label class="field"><span>Due date</span><input id="b-due" type="date" value="${esc(d.dueDate)}"></label>
        </div>
        <label class="field"><span>Description</span><input id="b-desc" value="${esc(d.description)}"></label>
      </details>
      <div class="card">
        <label class="check"><input type="checkbox" id="b-paid" ${d.paidDate ? "checked" : ""}> Paid</label>
        <label class="field" id="b-paid-wrap" ${d.paidDate ? "" : "hidden"}><span>Date paid</span><input id="b-paiddate" type="date" value="${esc(d.paidDate || todayStr())}"></label>
        ${d.txn ? `<p class="small muted">Linked to a bank payment on ${fmtDate(S.txns.get(d.txn)?.date)}.</p>` : ""}
      </div>
      <div class="card">
        <label class="field"><span>Cost of a particular sale? (e.g. freight for one customer)</span>
          ${!d.forInvoice && guessSale(d) ? `<div class="banner"><p class="small">Looks like it's for <strong>${esc(invLabel(guessSale(d)))}</strong>${d.relatedTo ? ` (bill mentions "${esc(d.relatedTo)}")` : ""}.</p><button type="button" class="btn small-btn" data-action="bill-use-sale" data-label="${esc(invLabel(guessSale(d)))}">Link it</button></div>` : ""}
          <input id="b-forinv" list="b-invoices" value="${esc(d.forInvoice ? invLabel(S.invoices.get(d.forInvoice)) : "")}" placeholder="Type the invoice number or customer"></label>
        <datalist id="b-invoices">${[...S.invoices.values()].filter((i) => !isQuoteDoc(i)).sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 300).map((i) => `<option value="${esc(invLabel(i))}">`).join("")}</datalist>
        <p class="small muted">Linked bills become that sale's real cost (ex GST) and replace the freight estimate. They're not counted again as a running expense.</p>
      </div>
      ${!d.fileKey ? `<label class="btn file">${icon("upload", 16)} Attach the bill<input type="file" accept="image/*,application/pdf" data-change="bill-attach" id="b-attach"></label>` : ""}
      <p class="small muted" id="b-hint">${isStockCat(d.category) ? "Stock costs count through product cost, not as a running expense." : ""}</p>
      <button class="btn primary wide" type="submit">${d.needsReview ? "Looks right, save" : "Save bill"}</button>
      ${d._id ? `<button type="button" class="btn danger" data-action="delete-bill" data-id="${esc(d._id)}">Delete</button>` : ""}
      <p class="status" id="bill-status"></p>
    </form>`);
  syncGst(false); showSchedule();
}
// What you can claim each tax year for an asset
function showSchedule() {
  const box = $("#b-sched"); if (!box || $("#b-asset").hidden) return;
  const tot = num($("#b-total").value), t = $("#b-treat").value;
  const sch = assetSchedule({ date: $("#b-date").value, total: tot, gstTreatment: t, gst: t === "none" ? 0 : ($("#b-gst").value === "" ? tot * GST_FRACTION : num($("#b-gst").value)),
    businessPct: num($("#b-pct").value), deprRate: num($("#b-rate").value), newAsset: $("#b-new").checked });
  if (!sch.years.length) { box.innerHTML = ""; return; }
  box.innerHTML = sch.lowValue ? `<p>Under $1,000 ex GST, so the full ${money(sch.cost)} is claimed this year.</p>`
    : `<div class="list flat">${sch.years.slice(0, 4).map((y, i) => `<div class="item static"><span class="t">Tax year ${esc(y.year)}</span><span class="r num">${money(y.claim)}</span><span class="s">${i === 0 && sch.boost ? `incl ${money(sch.boost)} Investment Boost · ` : ""}value left ${money(y.book)}</span><span></span></div>`).join("")}</div>`;
}
function syncGst(force) {
  const t = $("#b-treat")?.value, tot = num($("#b-total")?.value), g = $("#b-gst"); if (!g) return;
  if (t === "none") { g.value = "0"; g.disabled = true; return; }
  g.disabled = false;
  if (t === "standard" && (force || g.value === "")) g.value = tot ? r2(tot * GST_FRACTION).toFixed(2) : "";
}

// Merge what Claude read into the draft
function applyAi(d, o) {
  if (!o || typeof o !== "object") return d;
  const out = { ...d, supplier: String(o.supplier || ""), reference: String(o.reference || ""), description: String(o.description || "") };
  if (/^\d{4}-\d{2}-\d{2}$/.test(o.date || "")) out.date = o.date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(o.dueDate || "")) out.dueDate = o.dueDate;
  if (BILL_CATEGORIES.some((c) => c.name === o.category)) out.category = o.category;
  if (["standard", "none", "import"].includes(o.gstTreatment)) out.gstTreatment = o.gstTreatment;
  out.currency = String(o.currency || HOME()).toUpperCase();
  if (out.currency === HOME()) { out.total = r2(num(o.total)); out.gst = out.gstTreatment === "none" ? 0 : r2(num(o.gst) || out.total * GST_FRACTION); }
  else { out.originalTotal = num(o.total); out.total = ""; out.gst = out.gstTreatment === "none" ? 0 : ""; }
  if (/^\d{4}-\d{2}-\d{2}$/.test(o.paidDate || "")) out.paidDate = o.paidDate;
  out.relatedTo = String(o.relatedTo || "");
  out.aiNote = (o.note ? o.note + " " : "") + "Read by Claude. Check the figures before saving.";
  return codeLikeLastTime(out);
}
// Same supplier as before? Code it the way you saved their last bill.
// Loose match, so "Meta Platforms Ireland Ltd" and "META PLATFORMS IRELAND" count as the same.
const supKey = (s) => String(s || "").toLowerCase().replace(/\b(ltd|limited|inc|llc|pty|nz|co|the)\b/g, "").replace(/[^a-z0-9]+/g, "");
function codeLikeLastTime(d) {
  const k = supKey(d.supplier); if (!k) return d;
  const prev = [...S.bills.values()].filter((b) => b._id !== d._id && !b.needsReview && supKey(b.supplier) === k).sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
  if (!prev) return d;
  const changed = prev.category !== d.category;
  return { ...d, category: prev.category, gstTreatment: prev.gstTreatment || d.gstTreatment,
    aiNote: `${d.aiNote || ""}${changed ? ` Coded as ${prev.category}, like your last bill from ${prev.supplier}.` : ""}`.trim() };
}

// Phones take huge photos. Shrink to 1600px so uploads are quick and reading is cheap.
async function shrinkImage(file) {
  if (!file.type.startsWith("image/") || file.size < 900_000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch { return file; }
}

export async function handleBillFile(file, base = {}) {
  if (!file) return;
  file = await shrinkImage(file);
  const d = { date: todayStr(), category: "Other", gstTreatment: "standard", fileName: file.name, ...base };
  openSheet(`${sheetHead("Reading bill")}<div class="reading"><div class="spinner"></div><p>Uploading and reading ${esc(file.name)}…</p></div>`);
  try {
    d.fileKey = await uploadFile(file);
    if (!S.me?.integrations?.ai) { openBillForm({ ...d, aiNote: "Connect Claude (setup guide step 7) and it will fill this in for you." }); return; }
    const out = await api("ai/read", { method: "POST", body: { mode: "bill", fileKey: d.fileKey } });
    if (sheetOpen()) openBillForm(applyAi(d, out));
  } catch (e) {
    if (sheetOpen()) openBillForm({ ...d, aiNote: `Couldn't read it automatically (${e.message}). Fill in the details below.` });
  }
}

const actions = {
  "bills-tab": (el) => { V.tab = el.dataset.tab; render(); },
  "bills-more": () => { V.shown += 60; render(); },
  "open-bill": (el) => { const b = S.bills.get(el.dataset.id); if (b) openBillForm(b.needsReview ? codeLikeLastTime({ ...b }) : { ...b }); },
  "bill-use-sale": (el) => { $("#b-forinv").value = el.dataset.label; el.closest(".banner")?.remove(); },
  "bill-manual": () => openBillForm({ date: todayStr(), category: "Other", gstTreatment: "standard" }),
  "delete-bill": async (el) => { if (!confirmTap(el, "Tap again to delete")) return; const b = S.bills.get(el.dataset.id); if (b?.forInvoice) await linkBillToSale(el.dataset.id, b, b.forInvoice, null); await remove("bill", el.dataset.id); closeSheet(); toast("Bill deleted"); render(); },
};

const submits = {
  "bill-form": async () => {
    const d = draft || {};
    const treat = $("#b-treat").value, total = r2(num($("#b-total").value));
    const bill = {
      ...d, needsReview: false, aiNote: undefined, dupOf: undefined,
      supplier: $("#b-supplier").value.trim(), reference: $("#b-ref").value.trim(), date: $("#b-date").value, dueDate: $("#b-due").value,
      category: $("#b-cat").value, description: $("#b-desc").value.trim(), total, gstTreatment: treat,
      gst: treat === "none" ? 0 : r2($("#b-gst").value === "" ? total * GST_FRACTION : num($("#b-gst").value)),
      paidDate: $("#b-paid").checked ? $("#b-paiddate").value : "",
      businessPct: Math.min(100, Math.max(0, num($("#b-pct").value || 100))),
      ...(isAssetCat($("#b-cat").value) ? { deprRate: num($("#b-rate").value), newAsset: $("#b-new").checked } : {}),
    };
    delete bill.file;
    const id = d._id || `${bill.date}-${slug(bill.supplier)}-${Math.random().toString(36).slice(2, 7)}`;
    // Cost of a particular sale?
    const forText = $("#b-forinv").value.trim(), inv = invFromLabel(forText);
    if (forText && !inv) { toast("Pick the invoice from the list, or clear that box."); return; }
    const oldFor = d.forInvoice || null;
    if (inv) bill.forInvoice = inv._id; else delete bill.forInvoice;
    await save("bill", id, bill);
    if (inv || oldFor) await linkBillToSale(id, bill, oldFor, inv);
    // If this bill came from a bank transaction, mark that transaction as done
    if (d.txn && S.txns.has(d.txn)) { const t = S.txns.get(d.txn); await save("txn", t._id, { ...t, status: "done", link: { kind: "bill", id }, category: bill.category, supplier: bill.supplier, gstTreatment: treat }); }
    draft = null; closeSheet(); toast("Bill saved"); render();
  },
};

const changes = {
  "bill-file": async (el) => { const files = [...(el.files || [])]; el.value = ""; if (files.length === 1) await handleBillFile(files[0]); else if (files.length) await readMany(files); },
  "bill-attach": async (el) => {
    const f = el.files?.[0]; el.value = ""; if (!f) return;
    $("#bill-status").textContent = "Uploading…";
    draft.fileKey = await uploadFile(await shrinkImage(f)); draft.fileName = f.name;
    $("#bill-status").textContent = "Attached " + f.name;
  },
  "b-treat": () => { syncGst(true); showSchedule(); },
  "b-new": () => showSchedule(),
  "b-paid": (el) => { $("#b-paid-wrap").hidden = !el.checked; },
  "b-cat": (el) => {
    $("#b-hint").textContent = isStockCat(el.value) ? "Stock costs count through product cost, not as a running expense." : /Entertainment/.test(el.value) ? "Half of entertainment is deductible. The GST is claimed in full." : "";
    $("#b-asset").hidden = !isAssetCat(el.value); showSchedule();
  },
};
const inputs = {
  "bills-q": (el) => { V.q = el.value; rerenderKeepFocus("bills-q"); },
  "b-total": () => { if ($("#b-treat")?.value === "standard") syncGst(true); showSchedule(); },
  "b-pct": () => showSchedule(), "b-rate": () => showSchedule(), "b-gst": () => showSchedule(), "b-date": () => showSchedule(),
};

// Drag and drop bills onto the Bills screen (desktop)
document.addEventListener("dragover", (e) => { if (e.target.closest?.("#bill-drop")) { e.preventDefault(); e.target.closest("#bill-drop").classList.add("over"); } });
document.addEventListener("dragleave", (e) => e.target.closest?.("#bill-drop")?.classList.remove("over"));
document.addEventListener("drop", async (e) => {
  const zone = e.target.closest?.("#bill-drop"); if (!zone) return;
  e.preventDefault(); zone.classList.remove("over");
  const files = [...(e.dataTransfer?.files || [])];
  if (files.length === 1) return handleBillFile(files[0]);
  if (files.length) await readMany(files);
});

// Several at once: read each (three at a time) and save them under "To check".
// A receipt that looks like one you already have (same supplier, amount and date) is flagged.
async function readMany(files) {
  let done = 0, added = 0, dups = 0;
  const one = async (f) => {
    try {
      const small = await shrinkImage(f), fileKey = await uploadFile(small);
      const out = S.me?.integrations?.ai ? await api("ai/read", { method: "POST", body: { mode: "bill", fileKey } }) : {};
      const d = applyAi({ date: todayStr(), category: "Other", gstTreatment: "standard", fileKey, fileName: f.name }, out);
      const twin = [...S.bills.values()].find((b) => b.supplier && supKey(b.supplier) === supKey(d.supplier) && Math.abs((Number(b.total) || 0) - (Number(d.total) || 0)) < 0.01 && b.date === d.date);
      if (twin) dups++;
      await save("bill", `${d.date}-${slug(d.supplier || "bill")}-${Math.random().toString(36).slice(2, 7)}`, { ...d, needsReview: true, total: d.total || 0, ...(twin ? { dupOf: twin._id } : {}) });
      added++;
    } catch (err) { toast(`${f.name}: ${err.message}`); }
    toast(`Read ${++done} of ${files.length}…`, 60000);
  };
  toast(`Reading ${files.length} receipts…`, 60000);
  const queue = [...files];
  await Promise.all([0, 1, 2].map(async () => { while (queue.length) await one(queue.shift()); }));
  toast(`${added} added to "To check"${dups ? `. ${dups} look like ones you already have.` : ""}`); V.tab = "review"; render();
}

register("bills", { render: render_, actions, submits, changes, inputs });
