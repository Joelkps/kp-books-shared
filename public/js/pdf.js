// =====================================================================
// Invoice and quote PDFs, drawn with pdf-lib (loaded from a CDN when first needed).
// A4 page; y positions are measured from the top of the page.
// =====================================================================

import { TAX, GST_RATE } from "./calc.js";

// Wording that depends on your country (Setup, Tax & country)
const T = () => {
  const tn = TAX.taxName || "GST", pct = Math.round(GST_RATE * 1000) / 10;
  return {
    tn, pct, cur: TAX.currency || "NZD",
    id: TAX.taxIdLabel === "GST number" ? "GST no." : TAX.taxIdLabel || "Tax no.",
    zero: TAX.country === "AU" ? `${tn}-free export` : `Zero-rated export`,
  };
};

// PNG or JPG logo (JPGs start with FF D8)
const embedImage = (doc, bytes) => { const b = new Uint8Array(bytes); return b[0] === 0xff && b[1] === 0xd8 ? doc.embedJpg(bytes) : doc.embedPng(bytes); };

// ---------- Invoice PDF (pdf-lib) ----------
// buildInvoicePdf(PDFLib, inv, settings, logoDataUrl) -> Uint8Array
// Layout is A4 portrait in points (595 x 842). y values below are measured from the TOP
// of the page; the helpers flip them because PDF coordinates start at the bottom.
export async function buildInvoicePdf(PDFLib, inv, s, logoDataUrl) {
  const quote = inv.type === "quote";
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`${quote ? "Quote" : "Invoice"} ${inv.number}`);
  doc.setAuthor(s.legalName || s.businessName || "");
  let page = doc.addPage([595.28, 841.89]);           // "let": long invoices and T&Cs add pages
  const W = 595.28, H = 841.89, L = 48, R = W - 48;       // page size and side margins
  const reg = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Colours: ink, muted grey, hairline, bush green accent, pale green tint
  const INK = rgb(0.09, 0.12, 0.1), MUTED = rgb(0.42, 0.46, 0.43), LINE = rgb(0.85, 0.87, 0.84);
  const GREEN = rgb(0.17, 0.35, 0.26), TINT = rgb(0.94, 0.96, 0.94), WHITE = rgb(1, 1, 1);

  // Standard PDF fonts only know Western European characters: swap anything else out
  const clean = (t) => String(t ?? "").normalize("NFC")
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
    .replace(/[āĀēĒīĪōŌūŪ]/g, (c) => c.normalize("NFD")[0])
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
  const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(TAX.locale || "en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TX = T();
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = (d) => { if (!d) return "-"; const [y, m, dd] = d.split("-").map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };

  // Drawing helpers (top-based y)
  const text = (t, x, y, o = {}) => {
    const f = o.font || reg, size = o.size || 9, str = clean(t);
    let xx = x;
    if (o.align === "right") xx = x - f.widthOfTextAtSize(str, size);
    if (o.align === "center") xx = x - f.widthOfTextAtSize(str, size) / 2;
    page.drawText(str, { x: xx, y: H - y - size * 0.8, size, font: f, color: o.color || INK, characterSpacing: o.spacing || 0 });
  };
  const wrap = (t, width, f = reg, size = 9) => {
    const out = [];
    for (const para of clean(t).split("\n")) {
      let line = "";
      for (const w of para.split(/\s+/)) {
        const test = line ? line + " " + w : w;
        if (f.widthOfTextAtSize(test, size) > width && line) { out.push(line); line = w; } else line = test;
      }
      out.push(line);
    }
    return out;
  };
  const block = (lines, x, y, o = {}) => { const lh = o.lh || (o.size || 9) * 1.45; lines.forEach((l, i) => text(l, x, y + i * lh, o)); return y + lines.length * lh; };
  const rect = (x, y, w, h, color) => page.drawRectangle({ x, y: H - y - h, width: w, height: h, color });
  const hline = (y, x1 = L, x2 = R, color = LINE, t = 0.6) => page.drawLine({ start: { x: x1, y: H - y }, end: { x: x2, y: H - y }, thickness: t, color });
  const label = (t, x, y, o = {}) => text(t.toUpperCase(), x, y, { size: 6.8, font: bold, color: o.color || MUTED, spacing: 0.9, align: o.align });

  // Footer on every page: the standing note and business details
  const footer = () => {
    if (s.invoiceNote) block(wrap(s.invoiceNote, R - L, reg, 8), L, H - 64, { size: 8, color: MUTED });
    rect(0, H - 34, W, 34, TINT);
    const foot = [s.legalName || s.businessName, s.gstNumber ? `${TX.id} ${s.gstNumber}` : "", s.website].filter(Boolean).join("   |   ");
    text(foot, W / 2, H - 21, { size: 7.5, color: MUTED, align: "center" });
  };
  // Start a fresh page when content gets near the footer; returns the new top y
  const BOTTOM = H - 90;
  const newPage = (title) => {
    footer();
    page = doc.addPage([W, H]);
    rect(0, 0, W, 6, GREEN);
    label(`${quote ? "Quote" : "Invoice"} ${inv.number}${title ? " · " + title : " · continued"}`, L, 30, { color: GREEN });
    return 56;
  };

  // Figures
  const lines = inv.lines || [];
  const total = Number(inv.total) || 0;
  const zero = !!inv.zeroRated;
  const mode = inv.taxMode || (zero ? "zero" : "inclusive");
  const gst = zero ? 0 : inv.gst != null ? Number(inv.gst) : Math.round(total * 3 / 23 * 100) / 100;
  const paid = (inv.payments || []).reduce((a, p) => a + (Number(p.amount) || 0), 0) + (Number(inv.refunded) ? -Number(inv.refunded) : 0);
  const due = Math.max(0, Math.round((total - (inv.payments ? paid : total)) * 100) / 100);   // Shopify orders arrive paid
  const isPaid = !quote && due <= 0.004;

  // ---- Top: green band with logo panel ----
  rect(0, 0, W, 6, GREEN);
  if (logoDataUrl) {
    const png = await embedImage(doc, logoDataUrl);
    const lw = 168, lh = lw * png.height / png.width;
    page.drawImage(png, { x: L - 4, y: H - 40 - lh, width: lw, height: lh });
  } else {
    text(s.businessName || "", L, 46, { size: 16, font: bold });
  }
  label(quote ? "Quote" : "Tax invoice", R, 40, { align: "right", color: GREEN });
  text(inv.number, R, 52, { size: 22, font: bold, align: "right" });

  // ---- Parties: bill to / ship to / from ----
  let y = 112;
  const colW = (R - L - 32) / 3, c1 = L, c2 = L + colW + 16, c3 = L + 2 * (colW + 16);
  const cust = inv.customer || {};
  label("Bill to", c1, y);
  // Addresses typed on several lines keep their lines; one-line addresses split at commas
  const addrLines = (a) => { const t = String(a || ""); return t.includes("\n") ? t.split("\n") : t.split(/,\s*/); };
  const billLines = [cust.name, cust.company, ...addrLines(cust.address), cust.phone, cust.email].filter(Boolean);
  let yb = block(billLines.flatMap((l) => wrap(l, colW)), c1, y + 13);
  const ship = inv.shipTo && (inv.shipTo.address || inv.shipTo.name) ? inv.shipTo : null;
  label("Ship to", c2, y);
  let ys = block((ship ? [ship.name || cust.name, ...addrLines(ship.address)] : ["Same as billing"]).filter(Boolean).flatMap((l) => wrap(l, colW)), c2, y + 13, ship ? {} : { color: MUTED });
  label("From", c3, y);
  const fromLines = [s.legalName || s.businessName, ...addrLines(s.address), s.phone, s.email, s.website].filter(Boolean);
  let yf = block(fromLines.flatMap((l) => wrap(l, colW)), c3, y + 13);
  if (s.gstNumber) { text(`${TX.id} ${s.gstNumber}`, c3, yf + 2, { font: bold, size: 9 }); yf += 15; }
  y = Math.max(yb, ys, yf) + 20;

  // ---- Meta strip: dates, reference, amount due ----
  const stripH = 50;
  rect(L, y, R - L, stripH, TINT);
  const dueW = 150;
  rect(R - dueW, y, dueW, stripH, isPaid ? TINT : GREEN);
  const metas = [[quote ? "Quote date" : "Issue date", date(inv.date)], quote ? ["Valid until", date(inv.dueDate || inv.date)] : ["Due date", isPaid ? "Paid" : date(inv.dueDate || inv.date)], ["Reference", inv.reference || inv.orderName || "-"]];
  const mw = (R - L - dueW) / 3;
  metas.forEach(([k, v], i) => { label(k, L + 14 + i * mw, y + 12); text(wrap(v, mw - 20, bold, 10.5)[0], L + 14 + i * mw, y + 26, { font: bold, size: 10.5 }); });
  label(quote ? `Quote total ${TX.cur}` : isPaid ? `Paid in full ${TX.cur}` : `Amount due ${TX.cur}`, R - 14, y + 12, { align: "right", color: isPaid ? MUTED : WHITE });
  text("$" + money(quote || isPaid ? total : due), R - 14, y + 24, { font: bold, size: 16, align: "right", color: isPaid ? INK : WHITE });
  y += stripH + 26;

  // ---- Line items ----
  const cQty = R - 190, cPrice = R - 95, cAmt = R;
  label("Description", L, y); label("Qty", cQty, y, { align: "right" }); label("Unit price", cPrice, y, { align: "right" }); label("Amount", cAmt, y, { align: "right" });
  // Say how the prices are shown, so customers aren't left guessing
  text(mode === "exclusive" ? `Amounts are ${TX.tn} exclusive` : mode === "zero" ? `${TX.zero}: no ${TX.tn}` : `Amounts include ${TX.tn}`, R, y - 22, { size: 7.5, color: MUTED, align: "right" });
  y += 14; hline(y, L, R, INK, 0.9); y += 9;
  const extra = [];
  if (inv.shipping) extra.push({ name: "Shipping", qty: 1, price: inv.shipping });
  if (inv.discount) extra.push({ name: "Discount", qty: 1, price: -inv.discount });
  for (const l of [...lines, ...extra]) {
    const desc = wrap(l.name, cQty - L - 60, reg, 9.5);
    if (y + 13 * desc.length + 20 > BOTTOM) {
      y = newPage();
      label("Description", L, y); label("Qty", cQty, y, { align: "right" }); label("Unit price", cPrice, y, { align: "right" }); label("Amount", cAmt, y, { align: "right" });
      y += 14; hline(y, L, R, INK, 0.9); y += 9;
    }
    text(desc[0], L, y, { size: 9.5 });
    desc.slice(1).forEach((d, i) => text(d, L, y + 13 * (i + 1), { size: 9.5 }));
    let yy = y + 13 * desc.length;
    if (l.sku) { text(l.sku, L, yy, { size: 7.5, color: MUTED }); yy += 11; }
    text(String(l.qty), cQty, y, { size: 9.5, align: "right" });
    text(money(l.price), cPrice, y, { size: 9.5, align: "right" });
    text(money(l.price * l.qty), cAmt, y, { size: 9.5, align: "right" });
    y = yy + 8; hline(y - 4);
    y += 6;
  }

  // ---- Totals ----
  y += 6;
  if (y + 110 > BOTTOM) y = newPage();
  const totalsTop = y;
  const tL = R - 210;
  const trow = (k, v, o = {}) => { text(k, tL, y, { size: o.size || 9.5, font: o.font, color: o.color }); text(v, R, y, { size: o.size || 9.5, font: o.font || reg, align: "right", color: o.color }); y += (o.size || 9.5) + 9; };
  trow(`Subtotal excl ${TX.tn}`, money(total - gst), { color: MUTED });
  trow(zero ? `${TX.tn} 0% (${TX.zero.toLowerCase()})` : `${TX.tn} ${TX.pct}%`, money(gst), { color: MUTED });
  hline(y - 4, tL, R); y += 4;
  trow(`Total ${TX.cur}`, money(total), { font: bold, size: 11 });
  if (inv.payments && inv.payments.length) {
    for (const p of inv.payments) trow(`Paid ${date(p.date)}`, "-" + money(p.amount), { color: MUTED });
    hline(y - 4, tL, R); y += 4;
    trow("Amount due", "$" + money(due), { font: bold, size: 12, color: isPaid ? INK : GREEN });
  }
  // Message to the customer, left of the totals
  let ml = totalsTop;
  if (inv.message) {
    label("Note", L, ml);
    ml = block(wrap(inv.message, tL - L - 30, reg, 9), L, ml + 13, { size: 9 }) + 8;
  }
  if (isPaid) {
    // PAID stamp, left of the totals (below any note)
    const sx = L, sy = Math.max(ml, y - 58);
    page.drawRectangle({ x: sx, y: H - sy - 34, width: 92, height: 34, borderColor: GREEN, borderWidth: 1.6, rotate: PDFLib.degrees(0) });
    text("PAID", sx + 46, sy + 9, { font: bold, size: 18, color: GREEN, align: "center", spacing: 3 });
  }

  // ---- Payment and terms, anchored to the bottom ----
  y = Math.max(y, ml);
  if (y + 120 > BOTTOM) y = newPage();
  let by = Math.max(y + 24, 640);
  hline(by - 14, L, R, LINE);
  const half = (R - L - 24) / 2;
  if (quote) {
    label("Accepting this quote", L, by);
    block(wrap(`Reply to accept, quoting ${inv.number}. ${mode === "exclusive" ? `${TX.tn} is added at ${TX.pct}%.` : mode === "zero" ? `${TX.zero}, no ${TX.tn}.` : `Prices include ${TX.tn}.`}`, half), L, by + 13, { size: 9 });
  } else if (s.bankAccount && !isPaid) {
    label("Pay by bank transfer", L, by);
    block([s.bankName || s.legalName || s.businessName, s.bankAccount].filter(Boolean), L, by + 13, { font: bold, size: 10 });
    text(`Use ${inv.number} as the reference`, L, by + 43, { color: MUTED, size: 8.5 });
  } else if (isPaid) {
    label("Payment", L, by);
    text("Received with thanks.", L, by + 13, { size: 10 });
  }
  const payTerms = inv.paymentTerms ?? s.paymentTerms;
  if ((payTerms && !isPaid) || inv.terms) {
    label("Terms", L + half + 24, by);
    const ty = block(wrap(!isPaid && payTerms ? payTerms : "", half), L + half + 24, by + 13, { size: 8.5, color: INK });
    if (inv.terms) text("Full terms and conditions on the last page.", L + half + 24, ty + 2, { size: 8, color: MUTED });
  }

  // ---- Terms and conditions: their own page(s) ----
  if (inv.terms) {
    y = newPage("Terms and conditions");
    text("Terms and conditions", L, y, { font: bold, size: 15 }); y += 30;
    for (const para of String(inv.terms).split(/\n/)) {
      // A short line ending without a full stop, or starting with a number, reads as a heading
      const heading = /^\s*(\d+[.)]|[A-Z][^.]{0,60}$)/.test(para) && para.length < 70;
      const rows = wrap(para, R - L, heading ? bold : reg, 8.8);
      for (const row of rows) {
        if (y > BOTTOM) y = newPage("Terms and conditions");
        text(row, L, y, { size: 8.8, font: heading ? bold : reg }); y += 12.5;
      }
      y += para.trim() ? 4 : 2;
    }
  }

  footer();
  return doc.save();
}

// =====================================================================
// Purchase order PDF: what you're ordering from a supplier, in their currency.
// =====================================================================
export async function buildPoPdf(PDFLib, po, s, supplier = {}, logo) {
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.setTitle(`Purchase order ${po.number}`);
  const W = 595.28, H = 841.89, L = 48, R = W - 48, BOTTOM = H - 80;
  let page = doc.addPage([W, H]);
  const reg = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const INK = rgb(0.09, 0.12, 0.1), MUTED = rgb(0.42, 0.46, 0.43), LINE = rgb(0.85, 0.87, 0.84), GREEN = rgb(0.17, 0.35, 0.26), TINT = rgb(0.94, 0.96, 0.94);
  const clean = (t) => String(t ?? "").normalize("NFC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const date = (d) => { if (!d) return "-"; const [y, m, dd] = d.split("-").map(Number); return `${dd} ${MONTHS[m - 1]} ${y}`; };
  const cur = po.currency || "EUR";
  const amt = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString(TAX.locale || "en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const text = (t, x, y, o = {}) => { const f = o.font || reg, size = o.size || 9, str = clean(t); let xx = x;
    if (o.align === "right") xx = x - f.widthOfTextAtSize(str, size);
    page.drawText(str, { x: xx, y: H - y - size * 0.8, size, font: f, color: o.color || INK, characterSpacing: o.spacing || 0 }); };
  const wrap = (t, width, f = reg, size = 9) => { const out = []; for (const para of clean(t).split("\n")) { let line = ""; for (const w of para.split(/\s+/)) { const test = line ? line + " " + w : w; if (f.widthOfTextAtSize(test, size) > width && line) { out.push(line); line = w; } else line = test; } out.push(line); } return out; };
  const block = (lines, x, y, o = {}) => { const lh = (o.size || 9) * 1.45; lines.forEach((l, i) => text(l, x, y + i * lh, o)); return y + lines.length * lh; };
  const rect = (x, y, w, h, color) => page.drawRectangle({ x, y: H - y - h, width: w, height: h, color });
  const hline = (y, x1 = L, x2 = R, color = LINE, t = 0.6) => page.drawLine({ start: { x: x1, y: H - y }, end: { x: x2, y: H - y }, thickness: t, color });
  const label = (t, x, y, o = {}) => text(t.toUpperCase(), x, y, { size: 6.8, font: bold, color: o.color || MUTED, spacing: 0.9, align: o.align });
  const footer = () => { rect(0, H - 34, W, 34, TINT); text([s.legalName || s.businessName, s.website].filter(Boolean).join("   |   "), W / 2 - reg.widthOfTextAtSize(clean([s.legalName || s.businessName, s.website].filter(Boolean).join("   |   ")), 7.5) / 2, H - 21, { size: 7.5, color: MUTED }); };
  const addrLines = (a) => { const t = String(a || ""); return t.includes("\n") ? t.split("\n") : t.split(/,\s*/); };

  rect(0, 0, W, 6, GREEN);
  if (logo) { const png = await embedImage(doc, logo); const lw = 168, lh = lw * png.height / png.width; page.drawImage(png, { x: L - 4, y: H - 40 - lh, width: lw, height: lh }); }
  else text(s.businessName || "", L, 46, { size: 16, font: bold });
  label("Purchase order", R, 40, { align: "right", color: GREEN });
  text(po.number, R, 52, { size: 22, font: bold, align: "right" });

  let y = 112;
  const colW = (R - L - 32) / 3, c1 = L, c2 = L + colW + 16, c3 = L + 2 * (colW + 16);
  label("Supplier", c1, y);
  const y1 = block([supplier.name || po.supplier, supplier.contact ? "Attn: " + supplier.contact : "", ...addrLines(supplier.address), supplier.email].filter(Boolean).flatMap((l) => wrap(l, colW)), c1, y + 13);
  label("Deliver to", c2, y);
  const y2 = block([s.legalName || s.businessName, ...addrLines(po.deliverTo || s.address), s.phone].filter(Boolean).flatMap((l) => wrap(l, colW)), c2, y + 13);
  label("From", c3, y);
  const y3 = block([s.legalName || s.businessName, s.email, s.phone, s.website].filter(Boolean).flatMap((l) => wrap(l, colW)), c3, y + 13);
  y = Math.max(y1, y2, y3) + 20;

  rect(L, y, R - L, 50, TINT);
  [["Order date", date(po.date)], ["Wanted by", date(po.expected)], ["Your reference", po.supplierRef || "-"], ["Currency", cur]].forEach(([k, v], i) => {
    const x = L + 14 + i * ((R - L) / 4); label(k, x, y + 12); text(v, x, y + 26, { font: bold, size: 10.5 });
  });
  y += 76;

  const cCode = L, cDesc = L + 90, cQty = R - 170, cUnit = R - 85;
  const headRow = () => { label("Code", cCode, y); label("Description", cDesc, y); label("Qty", cQty, y, { align: "right" }); label(`List ${cur}`, cUnit, y, { align: "right" }); label(`List total`, R, y, { align: "right" }); y += 14; hline(y, L, R, INK, 0.9); y += 9; };
  headRow();
  for (const l of po.lines || []) {
    const desc = wrap(l.name, cQty - cDesc - 40, reg, 9.5);
    if (y + 13 * desc.length + 16 > BOTTOM) { footer(); page = doc.addPage([W, H]); rect(0, 0, W, 6, GREEN); y = 40; label(`Purchase order ${po.number} continued`, L, y - 14, { color: GREEN }); headRow(); }
    text(l.sku || "", cCode, y, { size: 9, font: bold });
    desc.forEach((d, i) => text(d, cDesc, y + 13 * i, { size: 9.5 }));
    text(String(l.qty), cQty, y, { size: 9.5, align: "right" });
    const lp = Number(l.list ?? l.unit) || 0;
    text(lp ? amt(lp) : "", cUnit, y, { size: 9.5, align: "right" });
    text(lp ? amt(lp * l.qty) : "", R, y, { size: 9.5, align: "right" });
    y += 13 * desc.length + 8; hline(y - 4); y += 6;
  }
  const t = (po.lines || []).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unit) || 0), 0), units = (po.lines || []).reduce((a, l) => a + (Number(l.qty) || 0), 0);
  y += 6;
  if (y + 80 > BOTTOM) { footer(); page = doc.addPage([W, H]); y = 50; }
  const listT = (po.lines || []).reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.list ?? l.unit) || 0), 0);
  text(`${units} units`, R - 210, y, { color: MUTED }); y += 18;
  if (po.discountPct) {
    text("List total", R - 210, y); text(amt(listT), R, y, { align: "right" }); y += 15;
    text(`Less ${po.discountPct}% ${po.volumeDiscount ? "volume " : ""}discount`, R - 210, y); text("-" + amt(listT - t), R, y, { align: "right" }); y += 6;
    hline(y + 4, R - 210, R); y += 12;
  }
  text(`Net total ${cur} (ex VAT)`, R - 210, y, { font: bold, size: 11 }); text(amt(t), R, y, { font: bold, size: 11, align: "right" }); y += 18;
  text("Prices as per your current price list unless shown.", R - 210, y, { size: 7.5, color: MUTED }); y += 26;
  if (po.notes) { label("Notes", L, y); y = block(wrap(po.notes, R - L), L, y + 13, { size: 9 }) + 10; }
  const country = { NZ: "New Zealand", AU: "Australia" }[TAX.country] || s.address?.split("\n").pop() || "";
  if (s.gstNumber) text(`Export to ${country}. Please send a commercial invoice and packing list with the shipment. Our ${TAX.taxIdLabel || "tax number"} is ${s.gstNumber}.`, L, Math.max(y, BOTTOM - 30), { size: 8, color: MUTED });
  footer();
  return doc.save();
}
