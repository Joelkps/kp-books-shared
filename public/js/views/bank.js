// Bank: transactions from Akahu (or a CSV statement), matched to your invoices
// and bills in one tap. Rules and past choices make suggestions smarter over time.
import { S, save, saveMany, remove, api, onLoaded, onChange } from "../store.js";
import { register, render, rerenderKeepFocus } from "../app.js";
import { $, $$, esc, money, pill, icon, openSheet, closeSheet, sheetHead, toast, confirmTap, empty, sheetOpen } from "../ui.js";
import { BILL_CATEGORIES, todayStr, fmtDate, fmtShort, r2, slug, suggestForTxn, txnKey, invoicePay, counts, isQuote, GST_FRACTION, daysBetween, HOME, TAX } from "../calc.js";
import { parseBankCSV, hashId } from "../csv.js";
import { openBillForm } from "./bills.js";

const V = { tab: "new", q: "", shown: 80 };
const rules = () => [...S.rules.values()];

// A tidy supplier name from bank text: "AMAZON WEB SERVICES 4829 AUCKLAND NZ" -> "Amazon Web Services"
const niceName = (t) => (t.merchant || t.description || "").replace(/\b\d[\d\s-]*\b/g, " ").replace(/\b(nz|nzl|auckland|ltd|limited|card|pos|eftpos|visa|debit|purchase)\b/gi, " ")
  .replace(/\s+/g, " ").trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40) || "Bank payment";

function txnRow(t) {
  const sug = t.status === "new" ? suggestForTxn(t, S, rules()) : null;
  const done = t.status === "done";
  const tag = done ? pill("mute", t.action === "ignore" ? "not business" : t.action === "transfer" ? "transfer" : t.link?.kind === "invoice" ? "invoice paid" : t.category || "done") : "";
  return `<div class="txn ${t.amount > 0 ? "in" : ""}">
    <button class="txn-main" data-action="open-txn" data-id="${esc(t._id)}">
      <span class="t">${esc(t.merchant || t.description)}</span>
      <span class="r num ${t.amount > 0 ? "pos" : ""}">${t.amount > 0 ? "+" : ""}${money(t.amount)}</span>
      <span class="s">${fmtShort(t.date)}${t.merchant && t.description !== t.merchant ? " · " + esc(t.description) : ""}</span>
      <span class="r small">${tag}</span>
    </button>
    ${sug ? `<div class="txn-sug"><span class="small">${sug.learned ? "Like before: " : ""}<strong>${esc(sug.label)}</strong></span><button class="btn primary small-btn" data-action="txn-confirm" data-id="${esc(t._id)}">${icon("check", 16)} OK</button></div>` : ""}
  </div>`;
}

function render_() {
  const accts = [...S.bankaccts.values()].sort((a, b) => (b.use ? 1 : 0) - (a.use ? 1 : 0));
  const all = [...S.txns.values()].sort((a, b) => b.date.localeCompare(a.date) || Math.abs(b.amount) - Math.abs(a.amount));
  const fresh = all.filter((t) => t.status === "new");
  const ready = fresh.filter((t) => suggestForTxn(t, S, rules()));
  const q = V.q.toLowerCase();
  let list = V.tab === "new" ? fresh : all.filter((t) => t.status === "done");
  if (q) list = list.filter((t) => `${t.description} ${t.merchant} ${t.category} ${Math.abs(t.amount)}`.toLowerCase().includes(q));
  const bank = S.me?.integrations?.bank;

  return `<section>
    <div class="spread"><h2>Bank</h2><div class="row">
      ${bank ? `<button class="btn small-btn" data-action="bank-sync">${icon("sync", 16)} Sync</button>` : ""}
      <label class="btn file small-btn">${icon("upload", 16)} Statement CSV<input type="file" accept=".csv,text/csv" data-change="bank-csv" id="bank-csv"></label>
    </div></div>
    ${accts.length ? `<div class="accts">${accts.map((a) => `<div class="acct ${a.use ? "" : "off"}">
        <span class="small muted">${esc(a.bank)} ${esc(a.number || "")}</span><strong>${esc(a.name)}</strong>
        <span class="num">${a.balance != null ? money(a.balance) : ""}</span>
        <label class="check small"><input type="checkbox" data-change="acct-use" data-id="${esc(a._id)}" ${a.use ? "checked" : ""}> Use for ${esc(S.settings.businessName)}</label>
      </div>`).join("")}</div>`
      : bank ? `<div class="banner"><p>Tap Sync to bring in your accounts, then switch on the ones this business uses.</p></div>`
      : TAX.country === "NZ" ? `<div class="banner"><p>Connect your bank through Akahu (free) to have transactions arrive by themselves. See Setup. Until then, import a CSV statement from your online banking.</p></div>`
      : `<div class="banner"><p>Download your transactions as a CSV file from your online banking, then click <strong>Statement CSV</strong>. Do it weekly or monthly. Importing the same days twice won't double up.</p></div>`}
    <div class="seg" role="tablist">
      <button role="tab" data-action="bank-tab" data-tab="new" aria-selected="${V.tab === "new"}">To check${fresh.length ? ` (${fresh.length})` : ""}</button>
      <button role="tab" data-action="bank-tab" data-tab="done" aria-selected="${V.tab === "done"}">Done</button>
      <button role="tab" data-action="bank-tab" data-tab="rules" aria-selected="${V.tab === "rules"}">Rules${S.rules.size ? ` (${S.rules.size})` : ""}</button>
    </div>
    ${V.tab === "rules" ? rulesView() : `
      ${V.tab === "new" && ready.length > 1 ? `<div class="banner"><p><strong>${ready.length}</strong> have a suggestion. Check them over, then confirm them all at once.</p><button class="btn primary" data-action="txn-confirm-all">${icon("check", 16)} Confirm ${ready.length}</button></div>` : ""}
      <input type="search" id="bank-q" class="search" placeholder="Search description or amount" value="${esc(V.q)}">
      ${list.length ? `<div class="list txns">${list.slice(0, V.shown).map(txnRow).join("")}</div>`
        : `<div class="list">${empty(V.tab === "new" ? (S.txns.size ? "All caught up. Every transaction is sorted." : "No transactions yet.") : "Nothing here yet.")}</div>`}
      ${list.length > V.shown ? `<button class="btn" data-action="bank-more">Show more</button>` : ""}`}
  </section>`;
}

function rulesView() {
  const list = rules();
  return `<p class="small muted">Rules sort transactions for you. Make one by ticking "Always do this" when you sort a transaction.</p>
    ${list.length ? `<div class="list">${list.map((r) => `<div class="item static"><span class="t">"${esc(r.match)}"${r.direction ? ` · money ${r.direction}` : ""}</span>
      <span class="r"><button class="icon-btn danger" data-action="rule-delete" data-id="${esc(r._id)}" aria-label="Delete rule">${icon("x", 16)}</button></span>
      <span class="s">${r.action === "ignore" ? "Not business" : r.action === "transfer" ? "Transfer" : `${esc(r.category)}${r.gstTreatment === "none" ? ", no GST" : ""}${r.supplier ? ` · ${esc(r.supplier)}` : ""}`}</span>
      <span class="r"><button class="chip-btn" data-action="rule-auto" data-id="${esc(r._id)}" aria-pressed="${!!r.auto}">${r.auto ? "Automatic" : "Ask me"}</button></span></div>`).join("")}</div>`
      : `<div class="list">${empty("No rules yet.")}</div>`}`;
}

// ---------- Applying a choice to a transaction ----------
// choice: {type: "invoice"|"bill"|"expense"|"transfer"|"ignore", id, category, gstTreatment, supplier}
async function applyChoice(t, c, { makeRule = false, auto = false } = {}) {
  const ops = [];
  const done = { ...t, status: "done", action: c.type, sortedAt: new Date().toISOString() };
  if (c.type === "invoice") {
    const inv = S.invoices.get(c.id);
    ops.push({ op: "put", kind: "invoice", id: inv._id, data: { ...inv, payments: [...(inv.payments || []), { date: t.date, amount: r2(t.amount), txn: t._id }] } });
    done.link = { kind: "invoice", id: inv._id };
  } else if (c.type === "bill") {
    const b = S.bills.get(c.id);
    // The bank says what it really cost in NZD (matters for USD/EUR subscriptions)
    const nzd = r2(-t.amount), foreign = b.currency && b.currency !== HOME();
    const fix = foreign || !b.total ? { total: nzd, gst: b.gstTreatment === "none" ? 0 : r2(nzd * GST_FRACTION) } : {};
    ops.push({ op: "put", kind: "bill", id: b._id, data: { ...b, ...fix, paidDate: b.paidDate || t.date, txn: t._id, needsReview: false } });
    done.link = { kind: "bill", id: b._id }; done.category = b.category;
  } else if (c.type === "expense") {
    const total = r2(-t.amount), treat = c.gstTreatment || (BILL_CATEGORIES.find((x) => x.name === c.category)?.noGst ? "none" : "standard");
    const id = `bank-${t._id}`.slice(0, 150);
    ops.push({ op: "put", kind: "bill", id, data: { supplier: c.supplier || niceName(t), date: t.date, paidDate: t.date, total, category: c.category || "Other",
      gstTreatment: treat, gst: treat === "none" ? 0 : r2(total * GST_FRACTION), description: t.description, source: "bank", txn: t._id } });
    Object.assign(done, { link: { kind: "bill", id }, category: c.category, gstTreatment: treat, supplier: c.supplier || niceName(t) });
  }
  ops.push({ op: "put", kind: "txn", id: t._id, data: done });
  if (makeRule) {
    const match = txnKey(t).split(" ").slice(0, 3).join(" ");
    ops.push({ op: "put", kind: "rule", id: "r-" + slug(match + "-" + (t.amount > 0 ? "in" : "out")), data: { match, direction: t.amount > 0 ? "in" : "out", action: c.type === "expense" ? "expense" : c.type, category: c.category || "", gstTreatment: c.gstTreatment || "", supplier: c.supplier || "", auto } });
  }
  await saveMany(ops);
}
async function undo(t) {
  const ops = [];
  if (t.link?.kind === "invoice") { const inv = S.invoices.get(t.link.id); if (inv) ops.push({ op: "put", kind: "invoice", id: inv._id, data: { ...inv, payments: (inv.payments || []).filter((p) => p.txn !== t._id) } }); }
  if (t.link?.kind === "bill") {
    const b = S.bills.get(t.link.id);
    if (b?.source === "bank" && b.txn === t._id) ops.push({ op: "delete", kind: "bill", id: b._id });
    else if (b) ops.push({ op: "put", kind: "bill", id: b._id, data: { ...b, paidDate: "", txn: undefined } });
  }
  const { link, action, category, sortedAt, ...rest } = t;
  ops.push({ op: "put", kind: "txn", id: t._id, data: { ...rest, status: "new" } });
  await saveMany(ops);
}

// ---------- One transaction ----------
function openTxn(id) {
  const t = S.txns.get(id); if (!t) return;
  const sug = t.status === "new" ? suggestForTxn(t, S, rules()) : null;
  const inc = t.amount > 0;
  const head = sheetHead(`${inc ? "+" : ""}${money(t.amount)}`, `${fmtDate(t.date)} · ${esc(t.merchant || t.description)}`);
  if (t.status === "done") {
    const linked = t.link?.kind === "invoice" ? S.invoices.get(t.link.id) : t.link?.kind === "bill" ? S.bills.get(t.link.id) : null;
    openSheet(`${head}<p class="small muted">${esc(t.description)}</p>
      <div class="banner"><p>${t.action === "ignore" ? "Marked as not business." : t.action === "transfer" ? "Marked as a transfer (not income or an expense)." :
        linked ? (t.link.kind === "invoice" ? `Payment for invoice ${esc(linked.number)} (${esc(linked.customer?.name || "")}).` : `Bill from ${esc(linked.supplier)}, ${esc(linked.category)}.`) : "Sorted."}</p></div>
      <div class="row">${linked ? `<button class="btn" data-action="${t.link.kind === "invoice" ? "open-invoice" : "open-bill"}" data-id="${esc(linked._id)}">Open ${t.link.kind}</button>` : ""}
      <button class="btn" data-action="txn-undo" data-id="${esc(id)}">Undo</button></div>`);
    return;
  }
  const owing = [...S.invoices.values()].filter((i) => counts(i) && !isQuote(i) && invoicePay(i).due > 0).sort((a, b) => Math.abs(invoicePay(a).due - t.amount) - Math.abs(invoicePay(b).due - t.amount)).slice(0, 8);
  const unpaid = [...S.bills.values()].filter((b) => !b.paidDate && !b.needsReview).sort((a, b) => Math.abs(a.total + t.amount) - Math.abs(b.total + t.amount)).slice(0, 8);
  const cats = BILL_CATEGORIES.map((c) => `<option ${c.name === (sug?.category || "Other") ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  openSheet(`${head}<p class="small muted">${esc(t.description)}${t.akahuCategory ? ` · ${esc(t.akahuCategory)}` : ""}</p>
    ${sug ? `<div class="banner"><p>Suggested: <strong>${esc(sug.label)}</strong></p><button class="btn primary" data-action="txn-confirm" data-id="${esc(id)}">${icon("check", 16)} Confirm</button></div>` : ""}
    ${inc ? `
      <h3>Customer payment</h3>
      ${owing.length ? `<div class="list">${owing.map((i) => `<button class="item" data-action="txn-pick" data-id="${esc(id)}" data-type="invoice" data-target="${esc(i._id)}"><span class="t">${esc(i.number)} · ${esc(i.customer?.name || "")}</span><span class="r">${money(invoicePay(i).due)} owing</span><span class="s">${fmtShort(i.date)}</span><span></span></button>`).join("")}</div>` : `<p class="small muted">No invoices are owing.</p>`}
      <div class="row"><button class="btn" data-action="txn-pick" data-id="${esc(id)}" data-type="transfer">Transfer or Shopify payout</button><button class="btn" data-action="txn-pick" data-id="${esc(id)}" data-type="ignore">Not business</button></div>
      <p class="small muted">Shopify payouts are transfers: the sales are already counted from each order.</p>`
    : `
      <h3>Expense</h3>
      <form id="txn-expense" data-id="${esc(id)}" class="form">
        <div class="grid2">
          <label class="field"><span>Supplier</span><input id="tx-supplier" value="${esc(sug?.supplier || niceName(t))}"></label>
          <label class="field"><span>Category</span><select id="tx-cat">${cats}</select></label>
        </div>
        <label class="field"><span>GST</span><select id="tx-gst"><option value="standard">Includes NZ GST 15%</option><option value="none" ${sug?.gstTreatment === "none" ? "selected" : ""}>No GST (overseas, bank fees, wages)</option></select></label>
        <label class="check"><input type="checkbox" id="tx-rule"> Always do this for "${esc(txnKey(t).split(" ").slice(0, 3).join(" "))}"</label>
        <label class="check small" id="tx-auto-wrap" hidden><input type="checkbox" id="tx-auto" checked> File it automatically next time, without asking (good for subscriptions)</label>
        <div class="row"><button class="btn primary" type="submit">Save expense</button><button type="button" class="btn" data-action="txn-bill-form" data-id="${esc(id)}">Add details and receipt</button></div>
      </form>
      ${unpaid.length ? `<h3>Or it pays a bill you already have</h3><div class="list">${unpaid.map((b) => `<button class="item" data-action="txn-pick" data-id="${esc(id)}" data-type="bill" data-target="${esc(b._id)}"><span class="t">${esc(b.supplier)}</span><span class="r">${money(b.total)}</span><span class="s">${fmtShort(b.date)} · ${esc(b.category)}</span><span></span></button>`).join("")}</div>` : ""}
      <div class="row"><button class="btn" data-action="txn-pick" data-id="${esc(id)}" data-type="transfer">Transfer between accounts</button><button class="btn" data-action="txn-pick" data-id="${esc(id)}" data-type="ignore">Not business</button></div>`}
  `);
}

const actions = {
  "bank-tab": (el) => { V.tab = el.dataset.tab; render(); },
  "bank-more": () => { V.shown += 80; render(); },
  "open-txn": (el) => openTxn(el.dataset.id),
  "bank-sync": async (el, ev, full = false) => {
    el.disabled = true; toast("Syncing with your bank…", 20000);
    try {
      const r = await api("bank/sync" + (full ? "?full=1" : ""), { method: "POST" });
      const { loadAll } = await import("../store.js"); await loadAll();
      toast(r.chooseAccounts ? "Switch on the accounts this business uses, then sync again." : r.added ? `${r.added} transactions updated` : "Up to date");
      render();
    } finally { el.disabled = false; }
  },
  "txn-confirm": async (el) => {
    const t = S.txns.get(el.dataset.id), sug = suggestForTxn(t, S, rules());
    if (!sug) return;
    await applyChoice(t, sug); closeSheet(); toast(sug.label); render();
  },
  "txn-confirm-all": async (el) => {
    if (!confirmTap(el, "Tap again to confirm all")) return;
    const ready = [...S.txns.values()].filter((t) => t.status === "new").map((t) => [t, suggestForTxn(t, S, rules())]).filter(([, s]) => s);
    // Confirm one at a time so invoice payments don't get counted twice
    let n = 0;
    for (const [t] of ready) { const s = suggestForTxn(S.txns.get(t._id), S, rules()); if (s) { await applyChoice(S.txns.get(t._id), s); n++; } }
    toast(`${n} transactions sorted`); render();
  },
  "txn-pick": async (el) => {
    const t = S.txns.get(el.dataset.id);
    await applyChoice(t, { type: el.dataset.type, id: el.dataset.target });
    closeSheet(); toast("Sorted"); render();
  },
  "txn-undo": async (el) => { await undo(S.txns.get(el.dataset.id)); closeSheet(); toast("Undone"); render(); },
  "txn-bill-form": (el) => {
    const t = S.txns.get(el.dataset.id);
    openBillForm({ supplier: $("#tx-supplier").value, category: $("#tx-cat").value, gstTreatment: $("#tx-gst").value, total: r2(-t.amount),
      date: t.date, paidDate: t.date, description: t.description, source: "bank", txn: t._id });
  },
  "rule-auto": async (el) => { const r = S.rules.get(el.dataset.id); await save("rule", r._id, { ...r, auto: !r.auto }); render(); autoSort(); },
  "rule-delete": async (el) => { await remove("rule", el.dataset.id); toast("Rule deleted"); render(); },
};

const submits = {
  "txn-expense": async (f) => {
    const t = S.txns.get(f.dataset.id);
    await applyChoice(t, { type: "expense", category: $("#tx-cat").value, gstTreatment: $("#tx-gst").value, supplier: $("#tx-supplier").value.trim() }, { makeRule: $("#tx-rule").checked, auto: $("#tx-auto").checked });
    closeSheet(); toast("Expense saved"); render();
  },
};

const changes = {
  "tx-rule": (el) => { $("#tx-auto-wrap").hidden = !el.checked; },
  "acct-use": async (el) => {
    const a = S.bankaccts.get(el.dataset.id);
    await save("bankacct", a._id, { ...a, use: el.checked });
    if (el.checked && S.me?.integrations?.bank) await actions["bank-sync"](el, null, true);
    else render();
  },
  "bank-csv": async (el) => {
    const file = el.files?.[0]; el.value = ""; if (!file) return;
    const name = file.name.replace(/\.csv$/i, "");
    const rows = parseBankCSV(await file.text(), name);
    if (!rows.length) { toast("No transactions found in that file."); return; }
    const ops = [];
    for (const r of rows) {
      const id = await hashId(r.idBase);
      if (S.txns.has(id)) continue;
      ops.push({ op: "put", kind: "txn", id, data: { account: name, date: r.date, description: r.description, amount: r.amount, source: "csv", status: "new" } });
    }
    await saveMany(ops);
    toast(`${ops.length} new transactions${rows.length > ops.length ? `, ${rows.length - ops.length} already here` : ""}`);
    V.tab = "new"; render();
  },
};
const inputs = { "bank-q": (el) => { V.q = el.value; rerenderKeepFocus("bank-q"); } };

register("bank", { render: render_, actions, submits, changes, inputs });

// ---------- Filing things automatically ----------
// Runs when the app opens and whenever new data arrives (bank sync, emailed receipts):
//  1. Bank charges that match a rule set to "Automatic" get filed.
//  2. A bank charge and a receipt that agree (same supplier, same amount, or same day for
//     USD/EUR charges) are matched, and the receipt counts as checked.
//  3. A receipt that arrives after you already filed the bank charge is attached to it
//     instead of becoming a second expense.
let sorting = false;
export async function autoSort() {
  if (sorting || !S.loaded) return;
  sorting = true;
  let n = 0;
  try {
    for (const t0 of [...S.txns.values()]) {
      const t = S.txns.get(t0._id);
      if (t?.status !== "new") continue;
      const sug = suggestForTxn(t, S, rules());
      const sure = (sug?.rule?.auto) || (sug?.type === "bill" && sug.fromReceipt && (sug.exact || sug.foreign) && sug.score >= 5);
      if (sure) { await applyChoice(t, sug); n++; }
    }
    // Receipts that arrived after the bank charge was filed
    const merges = [];
    for (const r of S.bills.values()) {
      if (!r.needsReview || r.txn) continue;
      const words = String(r.supplier || "").toLowerCase().split(/\W+/).filter((w) => w.length > 2);
      const twin = [...S.bills.values()].find((b) => b.source === "bank" && !b.fileKey && b.txn &&
        Math.abs(daysBetween(b.date, r.paidDate || r.date)) <= 10 &&
        (Math.abs(r2(b.total) - r2(r.total)) < 0.02 || (r.currency && r.currency !== HOME() && words.some((w) => `${b.supplier} ${b.description}`.toLowerCase().includes(w)))));
      if (!twin) continue;
      merges.push({ op: "put", kind: "bill", id: twin._id, data: { ...twin, supplier: r.supplier || twin.supplier, reference: r.reference || twin.reference,
        fileKey: r.fileKey, fileName: r.fileName, gstTreatment: r.gstTreatment || twin.gstTreatment,
        gst: (r.gstTreatment || twin.gstTreatment) === "none" ? 0 : r2(twin.total * GST_FRACTION) } }, { op: "delete", kind: "bill", id: r._id });
      n++;
    }
    if (merges.length) await saveMany(merges);
  } catch (e) { console.error("auto filing", e); }
  finally { sorting = false; }
  if (n) { toast(`Filed ${n} automatically`); if (!sheetOpen()) render(); }
}
onLoaded(() => setTimeout(autoSort, 300));
onChange((recs) => { if (recs.some((r) => r.kind === "txn" || r.kind === "bill")) setTimeout(autoSort, 300); });
