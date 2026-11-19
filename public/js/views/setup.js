// Setup: business details, connections, businesses, backups and activity
import { S, saveSettings, api, loadAll, localSet, fileUrl, uploadFile } from "../store.js";
import { register, render } from "../app.js";
import { $, $$, esc, icon, toast, copyText, shareOrDownload, openSheet, sheetHead, closeSheet, pill } from "../ui.js";
import { num, DEFAULT_SETTINGS, slug, TAX, COUNTRY_PRESETS, taxConfig, MONTHS } from "../calc.js";

// ---------- Tax & country ----------
// One set of fields, used here and on the first-run screen. Picking a country fills in its
// usual values; change any of them to suit.
const NUM_FIELDS = ["taxRate", "nextManual", "dueDays", "quoteDays", "freightMarkup", "gstRate", "periodMonths", "periodAnchor", "gstDueDays", "taxYearStart", "boostPct", "lowValueAsset", "deprRate"];
const opt = (v, label, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${esc(label)}</option>`;
const monthOpts = (cur) => MONTHS.map((m, i) => opt(i + 1, m, cur)).join("");
export function taxFields(s) {
  const c = taxConfig(s), country = s.country || "NZ";
  return `<div class="grid3">
      <label class="field"><span>Country</span><select name="country" id="tx-country" data-change="tax-country">
        ${opt("NZ", "New Zealand", country)}${opt("AU", "Australia", country)}${opt("OTHER", "Somewhere else (set it yourself)", country)}</select></label>
      <label class="field"><span>Currency</span><input name="currency" id="tx-currency" value="${esc(c.currency)}" maxlength="3"></label>
      <label class="field"><span>Time zone</span><input name="timeZone" id="tx-timeZone" value="${esc(c.timeZone)}" list="tz-list"></label>
      <label class="field"><span>Tax name</span><input name="taxName" id="tx-taxName" value="${esc(c.taxName)}" placeholder="GST"></label>
      <label class="field"><span>Tax rate %</span><input name="gstRate" id="tx-gstRate" type="number" step="0.1" min="0" max="50" value="${esc(c.gstRate)}"></label>
      <label class="field"><span>Your tax number is called</span><input name="taxIdLabel" id="tx-taxIdLabel" value="${esc(c.taxIdLabel)}" placeholder="GST number, ABN"></label>
      <label class="field"><span>Return format</span><select name="returnFormat" id="tx-returnFormat">
        ${opt("nz", "NZ GST return (IRD boxes 5–15)", c.returnFormat)}${opt("bas", "Australian BAS (G1, 1A, 1B)", c.returnFormat)}${opt("simple", "Simple summary", c.returnFormat)}</select></label>
      <label class="field"><span>Returns every</span><select name="periodMonths" id="tx-periodMonths">
        ${opt(1, "month", c.periodMonths)}${opt(2, "2 months", c.periodMonths)}${opt(3, "3 months (quarterly)", c.periodMonths)}${opt(6, "6 months", c.periodMonths)}${opt(12, "year", c.periodMonths)}</select></label>
      <label class="field"><span>A period ends in</span><select name="periodAnchor" id="tx-periodAnchor">${monthOpts(c.periodAnchor)}</select></label>
      <label class="field"><span>Return due</span><select name="dueRule" id="tx-dueRule">
        ${opt("nz", "IRD dates (NZ)", c.dueRule)}${opt("au", "ATO BAS dates (AU)", c.dueRule)}${opt("days", "A set number of days after", c.dueRule)}</select></label>
      <label class="field"><span>Days after the period (if set)</span><input name="gstDueDays" id="tx-dueDays" type="number" min="0" value="${esc(s.gstDueDays ?? c.dueDays)}"></label>
      <label class="field"><span>${esc(c.taxName)} basis</span><select name="basis" id="set-basis">
        ${opt("payments", "Payments (cash) basis", s.basis !== "invoice" ? "payments" : "")}${opt("invoice", "Invoice (accrual) basis", s.basis === "invoice" ? "invoice" : "")}</select></label>
      <label class="field"><span>Income tax year starts</span><select name="taxYearStart" id="tx-taxYearStart">${monthOpts(c.taxYearStart)}</select></label>
      <label class="field"><span>Income tax set-aside %</span><input name="taxRate" id="set-tax" type="number" step="0.5" min="0" max="60" value="${esc(s.taxRate ?? (COUNTRY_PRESETS[country] || COUNTRY_PRESETS.NZ).taxRate)}"></label>
      <label class="field"><span>Write off assets up to (ex tax)</span><input name="lowValueAsset" id="tx-lowValueAsset" type="number" step="1" min="0" value="${esc(c.lowValueAsset)}"></label>
      <label class="field"><span>Upfront deduction on new assets %</span><input name="boostPct" id="tx-boostPct" type="number" step="1" min="0" max="100" value="${esc(c.boostPct)}"></label>
      <label class="field"><span>Usual depreciation rate % (DV)</span><input name="deprRate" id="tx-deprRate" type="number" step="0.5" min="0" max="100" value="${esc(c.deprRate)}"></label>
    </div>
    <datalist id="tz-list">${["Pacific/Auckland", "Australia/Sydney", "Australia/Melbourne", "Australia/Brisbane", "Australia/Adelaide", "Australia/Perth", "Australia/Hobart", "Australia/Darwin", "Europe/London", "America/New_York", "UTC"].map((z) => `<option value="${z}">`).join("")}</datalist>
    <p class="small muted">Picking a country fills these in with its usual settings (NZ: 15% GST, IRD return, April tax year, 20% Investment Boost; Australia: 10% GST, quarterly BAS, July tax year). Change anything to suit, and check with your accountant.</p>`;
}
// Fill the tax fields from a country's usual settings
function applyPreset(country) {
  const p = COUNTRY_PRESETS[country]; if (!p) return;
  const set = (id, v) => { const el = $("#" + id); if (el && v !== undefined) el.value = v; };
  for (const k of ["currency", "timeZone", "taxName", "gstRate", "taxIdLabel", "returnFormat", "periodMonths", "periodAnchor", "dueRule", "taxYearStart", "lowValueAsset", "boostPct", "deprRate"]) set("tx-" + k, p[k]);
  set("tx-dueDays", p.dueDays); set("set-tax", p.taxRate);
  const idl = $("#set-gst-label"); if (idl) idl.textContent = p.taxIdLabel;
  const bl = $("#set-bank-label"); if (bl) bl.textContent = p.bankLabel;
}
// Business details (shared with the first-run screen)
export function businessFields(s) {
  const c = taxConfig(s);
  return `<div class="grid2">
      <label class="field"><span>Trading name</span><input name="businessName" id="set-name" value="${esc(s.businessName)}" required></label>
      <label class="field"><span>Legal name on invoices</span><input name="legalName" id="set-legal" value="${esc(s.legalName)}"></label>
      <label class="field"><span id="set-gst-label">${esc(c.taxIdLabel)}</span><input name="gstNumber" id="set-gst" value="${esc(s.gstNumber)}"></label>
      <label class="field"><span>Website</span><input name="website" id="set-web" value="${esc(s.website)}"></label>
      <label class="field"><span>Email on invoices</span><input name="email" id="set-email" type="email" value="${esc(s.email)}"></label>
      <label class="field"><span>Phone on invoices</span><input name="phone" id="set-phone" value="${esc(s.phone)}"></label>
    </div>
    <label class="field"><span>Address on invoices</span><textarea name="address" id="set-addr" rows="3">${esc(s.address)}</textarea></label>
    <label class="field"><span>What the business does (one line, helps Claude read your bills)</span><input name="about" id="set-about" value="${esc(s.about || "")}" placeholder="e.g. sells outdoor furniture online and to builders"></label>
    <div class="grid2">
      <label class="field"><span>Bank account name</span><input name="bankName" id="set-bankname" value="${esc(s.bankName)}"></label>
      <label class="field"><span id="set-bank-label">${esc(c.bankLabel)}</span><input name="bankAccount" id="set-bank" value="${esc(s.bankAccount)}"></label>
    </div>
    <div class="row logo-row">
      ${s.logoKey ? `<img src="${esc(fileUrl(s.logoKey))}" alt="Your logo" class="logo-preview">` : `<span class="small muted">No logo yet. It goes on your invoices, quotes and orders.</span>`}
      <label class="btn file small-btn">${icon("upload", 16)} ${s.logoKey ? "Change logo" : "Add logo"}<input type="file" accept="image/png,image/jpeg" data-change="logo-file" id="logo-file"></label>
    </div>`;
}
const readSettingsForm = (f) => {
  const d = Object.fromEntries(new FormData(f));
  for (const k of NUM_FIELDS) if (k in d) d[k] = num(d[k]);
  return d;
};

// ---------- First-run screen: shown until the business has a name ----------
export function firstRun() {
  const s = S.settings;
  return `<section class="first-run">
    <h2>Welcome to KP Books</h2>
    <p class="muted">Set up your business. Everything here can be changed later in Setup.</p>
    <form id="first-run-form" class="form card">
      <span class="label">Your business</span>
      ${businessFields(s)}
      <span class="label">Country and tax</span>
      ${taxFields(s)}
      <button class="btn primary wide" type="submit">Start using KP Books</button>
    </form>
  </section>`;
}

function render_() {
  const s = S.settings, i = S.me?.integrations || {};
  const status = (on, text) => `<div class="item static"><span class="t">${text}</span><span class="r">${on ? pill("good", "on") : pill("mute", "off")}</span><span></span><span></span></div>`;
  return `<section>
    <h2>Setup</h2>
    <div class="card">
      <span class="label">Connections</span>
      <div class="list flat">
        ${status(i.shopify, "Shopify orders arrive live" + (S.me?.shopifyLast ? ` <span class="small muted">· last ${esc(new Date(S.me.shopifyLast).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" }))}</span>` : ""))}
        ${status(i.bank, "Bank feed (Akahu)")}
        ${status(i.ai, "Claude reads bills and supplier invoices")}
      </div>
      <p class="small muted">Shopify webhook address for this business:</p>
      <div class="row"><code class="mono small break">${esc(S.me?.webhookUrl || "")}</code><button class="btn small-btn" data-action="copy-hook">Copy</button></div>
      <p class="small muted">Turn connections on with the keys in the setup guide. They live in your Cloudflare dashboard, never in the app.</p>
    </div>
  </section>
  <section>
    <form id="settings-form" class="form card">
      <span class="label">Business</span>
      ${businessFields(s)}
      <span class="label">Invoices</span>
      <label class="field"><span>Payment terms</span><textarea name="paymentTerms" id="set-terms" rows="3">${esc(s.paymentTerms)}</textarea></label>
      <label class="field"><span>Note at the bottom of every page</span><input name="invoiceNote" id="set-note" value="${esc(s.invoiceNote)}"></label>
      <label class="field"><span>Standard quote T&amp;Cs (a short line with no full stop prints as a heading)</span><textarea name="quoteTerms" id="set-qterms" rows="8">${esc(s.quoteTerms)}</textarea></label>
      <label class="field"><span>Standard invoice T&amp;Cs</span><textarea name="invoiceTerms" id="set-iterms" rows="8">${esc(s.invoiceTerms)}</textarea></label>
      <p class="small muted">These fill in new quotes and invoices. You can change them on any one before sending. The starter wording is a guide only, so have it checked for your business.</p>
      <div class="grid3">
        <label class="field"><span>Shopify prefix</span><input name="invoicePrefix" id="set-prefix" value="${esc(s.invoicePrefix)}"></label>
        <label class="field"><span>Invoice prefix</span><input name="manualPrefix" id="set-mprefix" value="${esc(s.manualPrefix)}"></label>
        <label class="field"><span>Next invoice no.</span><input name="nextManual" id="set-next" type="number" min="1" value="${esc(s.nextManual)}"></label>
        <label class="field"><span>Quote prefix</span><input name="quotePrefix" id="set-qprefix" value="${esc(s.quotePrefix)}"></label>
        <label class="field"><span>Days until due</span><input name="dueDays" id="set-due" type="number" min="0" value="${esc(s.dueDays)}"></label>
        <label class="field"><span>Quotes valid for (days)</span><input name="quoteDays" id="set-qdays" type="number" min="1" value="${esc(s.quoteDays)}"></label>
      </div>
      <span class="label">Country and tax</span>
      ${taxFields(s)}
      <label class="field"><span>Your usual markup on freight you charge %</span><input name="freightMarkup" id="set-frmu" type="number" step="0.5" min="0" value="${esc(s.freightMarkup ?? 10)}"></label>
      <label class="field"><span>Bring in bank transactions from</span><input name="bankFrom" id="set-bankfrom" type="date" value="${esc(s.bankFrom || "")}"></label>
      <button class="btn primary wide" type="submit">Save setup</button>
    </form>
  </section>
  <section>
    <div class="card">
      <span class="label">Businesses</span>
      <p class="small muted">Keep a second set of books, like the ice bath brand, completely separate.</p>
      <div class="row"><select id="biz-switch" data-change="biz-switch" aria-label="Business">
        ${(S.me?.businesses?.length ? S.me.businesses : [{ id: S.biz, name: s.businessName }]).map((b) => `<option value="${esc(b.id)}" ${b.id === S.biz ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
        </select><button class="btn" data-action="new-biz">${icon("plus", 16)} Add a business</button></div>
    </div>
  </section>
  <section>
    <div class="card">
      <span class="label">Backups</span>
      <p class="small muted">A backup is made every Sunday night and the last 26 are kept. You can also download everything now. Keep records for at least 7 years (NZ) or 5 years (Australia).</p>
      <div class="row">
        <button class="btn" data-action="backup-now">${icon("share", 16)} Download backup</button>
        <button class="btn" data-action="backup-list">Saved backups</button>
        <label class="btn file">${icon("upload", 16)} Restore<input type="file" accept="application/json,.json" data-change="restore-file" id="restore-file"></label>
      </div>
    </div>
  </section>
  <section>
    <div class="card">
      <span class="label">Free plan usage</span>
      ${S.usage ? S.usage.items.map((u) => `<div class="usage"><div class="spread small"><span>${esc(u.name)}</span><span class="num">${fmtBytes(u.used)} of ${fmtBytes(u.limit)}</span></div>
        <div class="meter"><span class="${u.pct >= 95 ? "bad" : u.pct >= 80 ? "warn" : ""}" style="width:${Math.max(1, Math.min(100, u.pct))}%"></span></div></div>`).join("") +
        (S.usage.ai ? `<div class="usage"><div class="spread small"><span>Claude reading documents, ${new Date(S.usage.ai.month + "-15").toLocaleDateString("en-NZ", { month: "long" })}</span><span class="num">US$${S.usage.ai.usd.toFixed(2)} of US$${S.me?.aiBudget || 10}</span></div>
          <div class="meter"><span class="${S.usage.ai.usd >= (S.me?.aiBudget || 10) ? "bad" : S.usage.ai.usd >= (S.me?.aiBudget || 10) * 0.8 ? "warn" : ""}" style="width:${Math.max(1, Math.min(100, (S.usage.ai.usd / (S.me?.aiBudget || 10)) * 100))}%"></span></div>
          <p class="small muted">${S.usage.ai.docs} document${S.usage.ai.docs === 1 ? "" : "s"} read this month. An estimate from Anthropic's prices; your Anthropic account shows the exact amount.</p></div>` : "") +
        `<p class="small muted">Checked ${new Date(S.usage.checkedAt).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })}. You'll get a warning on Home at 80%. <button class="link-btn" data-action="usage-refresh">Check now</button></p>`
        : `<p class="small muted">Checking…</p>`}
    </div>
  </section>
  <section>
    <div class="card">
      <span class="label">Install on your phone</span>
      <p class="small">iPhone: open this page in Safari, tap Share, then Add to Home Screen. Android: tap the menu in Chrome, then Install app.</p>
    </div>
    <div class="row"><button class="btn" data-action="activity">Activity log</button><span class="small muted">Signed in as ${esc(S.me?.email || "")}</span></div>
  </section>`;
}

const fmtBytes = (b) => (b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + " GB" : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB");
const actions = {
  "usage-refresh": async () => { S.usage = await api("usage?fresh=1"); render(); },
  "copy-hook": () => copyText(S.me?.webhookUrl || ""),
  "new-biz": () => openSheet(`${sheetHead("Add a business")}
    <form id="biz-form" class="form">
      <label class="field"><span>Business name</span><input id="nb-name" required autofocus placeholder="e.g. KP Plunge"></label>
      <label class="field"><span>Short id (letters and dashes)</span><input id="nb-id" required pattern="[a-z0-9-]{2,32}" placeholder="icebath"></label>
      <p class="small muted">Shopify webhooks for this business use its id in the address. Emailed bills go to bills+id@ your domain.</p>
      <button class="btn primary" type="submit">Create and switch</button>
    </form>`),
  "backup-now": async () => {
    const data = await api("backup");
    await shareOrDownload(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }), `${S.settings.businessName} backup ${new Date().toISOString().slice(0, 10)}.json`);
  },
  "backup-list": async () => {
    const { items } = await api("backups");
    openSheet(`${sheetHead("Saved backups")}${items.length ? `<div class="list">${items.map((b) => `<a class="item link" href="${fileUrl(b.key)}" download><span class="t">${esc(b.key.split("/").pop())}</span><span class="r small">${Math.round(b.size / 1024)} KB</span><span></span><span></span></a>`).join("")}</div>` : `<div class="empty">The first one is made this Sunday night.</div>`}`);
  },
  "activity": async () => {
    const { items } = await api("audit");
    openSheet(`${sheetHead("Activity")}<div class="list">${items.map((a) => `<div class="item static"><span class="t">${esc(a.action)} ${esc(a.kind)}</span><span class="r small muted">${new Date(a.ts).toLocaleString("en-NZ", { dateStyle: "medium", timeStyle: "short" })}</span><span class="s">${esc(a.summary || a.id)}</span><span class="r small muted">${esc(a.who)}</span></div>`).join("") || `<div class="empty">Nothing yet.</div>`}</div>`, { wide: true });
  },
};
const submits = {
  "settings-form": async (f) => {
    await saveSettings(readSettingsForm(f)); toast("Setup saved"); render();
  },
  "first-run-form": async (f) => {
    await saveSettings({ ...readSettingsForm(f), setupDone: true }); toast("All set. Welcome!"); location.hash = "home"; render();
  },
  "biz-form": async () => {
    const id = slug($("#nb-id").value).replace(/[^a-z0-9-]/g, "").slice(0, 32), name = $("#nb-name").value.trim();
    if (id.length < 2) { toast("Pick a short id, like icebath"); return; }
    S.biz = id; localSet("biz", id);
    // A new business starts blank except its name, and the same country as this one
    await saveSettings({ ...DEFAULT_SETTINGS, businessName: name, legalName: name, bankName: name, country: S.settings.country || "NZ" });
    await loadAll(); closeSheet(); toast(`Switched to ${name}`); location.hash = "setup"; render();
  },
};
const changes = {
  "tax-country": (el) => applyPreset(el.value),
  // Your logo: stored with your files, used on invoices, quotes, orders and the sidebar
  "logo-file": async (el) => {
    const f = el.files?.[0]; el.value = ""; if (!f) return;
    if (!/image\/(png|jpeg)/.test(f.type)) { toast("Use a PNG or JPG for the logo."); return; }
    const logoKey = await uploadFile(f);
    // Keep anything typed on the screen so far
    const form = el.closest("form"), typed = form ? readSettingsForm(form) : {};
    await saveSettings({ ...typed, logoKey }); toast("Logo saved"); render();
  },
  "restore-file": async (el) => {
    const f = el.files?.[0]; el.value = ""; if (!f) return;
    const data = JSON.parse(await f.text());
    if (data.app !== "kp-books" || !Array.isArray(data.records)) { toast("That isn't a backup from this app."); return; }
    const r = await api("restore", { method: "POST", body: data });
    await loadAll(); toast(`Restored ${r.restored} records`); render();
  },
};

register("setup", { render: render_, actions, submits, changes });
