// CSV reading: Shopify order exports and bank statement exports

export function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
    else if (c !== "\r") f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

// NZ bank exports all differ a little. This finds the header row and the date,
// amount (or debit/credit) and description columns by name.
export function parseBankCSV(text, accountName) {
  const rows = parseCSV(text);
  let hi = rows.findIndex((r) => r.some((c) => /^date$|transaction date|^processed date/i.test(c.trim())) && r.some((c) => /amount|debit|credit|deposit|withdrawal/i.test(c)));
  let head;
  if (hi < 0) {
    // No header row (CommBank, ANZ Australia): date, amount, description[, balance]
    const looksDated = (r) => /^\s*\d{1,2}[-/ ]\d{1,2}[-/ ]\d{2,4}\s*$|^\s*\d{4}-\d{2}-\d{2}\s*$/.test(r[0] || "") && /^\s*[+\-]?\$?[\d,]+(\.\d+)?\s*$/.test(r[1] || "");
    const first = rows.findIndex(looksDated);
    if (first < 0) throw new Error("Couldn't find Date and Amount columns in that file.");
    hi = first - 1; head = ["date", "amount", "description", "balance"];
  } else head = rows[hi].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => (n instanceof RegExp ? n.test(h) : h === n)));
  const iDate = col("date", "transaction date", "processed date", /date/);
  const iAmt = col("amount", /^amount/);
  const iDr = col("debit", "withdrawals", /debit|withdrawal/), iCr = col("credit", "deposits", /credit|deposit/);
  const descCols = ["payee", "description", "details", "particulars", "code", "reference", "memo", "other party", "transaction details", "narrative", "merchant name", "transaction description", "tran type", "type"]
    .map((n) => head.indexOf(n)).filter((i) => i >= 0);
  const parseDate = (s) => {
    s = s.trim();
    let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = s.match(/^(\d{1,2})[-/ ](\d{1,2}|[A-Za-z]{3})[-/ ](\d{2,4})/);
    if (m) {
      const mon = isNaN(m[2]) ? "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(m[2].toLowerCase()) / 3 + 1 : Number(m[2]);
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${y}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    return "";
  };
  const n = (s) => { const v = parseFloat(String(s || "").replace(/[^0-9.\-]/g, "")); return isFinite(v) ? v : 0; };
  const out = [], seen = new Map();
  for (const r of rows.slice(hi + 1)) {
    const date = parseDate(r[iDate] || ""); if (!date) continue;
    const amount = iAmt >= 0 ? n(r[iAmt]) : n(r[iCr]) - Math.abs(n(r[iDr]));
    if (!amount) continue;
    const description = descCols.map((i) => (r[i] || "").trim()).filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(" ").replace(/\s+/g, " ");
    // Same date, amount and text twice in one day is possible, so number repeats
    const base = `${accountName}|${date}|${amount}|${description}`;
    const k = (seen.get(base) || 0) + 1; seen.set(base, k);
    out.push({ date, amount, description, idBase: base + "|" + k });
  }
  return out;
}

// Short stable id from text (for bank lines imported from CSV)
export async function hashId(text) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return "csv-" + [...new Uint8Array(buf)].slice(0, 10).map((b) => b.toString(16).padStart(2, "0")).join("");
}
