// ---------- Reading bills and supplier invoices with Claude ----------
// Files are sent straight to Anthropic's API (PDFs and photos both work).
// Your API key stays on the server; the app never sees it.

import { kvGet, kvSet } from "./db.js";

// ---------- What Claude costs ----------
// US$ per million tokens, from Anthropic's price list (Nov 2026). Change them in
// wrangler.jsonc (AI_PRICES) if Anthropic's prices change.
const DEFAULT_PRICES = {
  "claude-haiku-5-5": { in: 0.10, out: 0.50, longIn: 0.50, longOut: 2.50, longFrom: 100000 },
  "claude-sonnet-5-5": { in: 2.00, out: 10.00, longIn: 4.00, longOut: 15.00, longFrom: 200000 },
};
export function costOf(env, model, usage) {
  let prices = DEFAULT_PRICES;
  try { if (env.AI_PRICES) prices = { ...prices, ...JSON.parse(env.AI_PRICES) }; } catch {}
  const p = prices[model] || prices["claude-sonnet-5-5"];
  const inTok = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  const long = inTok > (p.longFrom || Infinity);
  return (inTok * (long ? p.longIn : p.in) + (usage.output_tokens || 0) * (long ? p.longOut : p.out)) / 1e6;
}
// Add to this month's running total (kept in the database, per NZ month)
async function recordSpend(env, model, usage, mode) {
  try {
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }).slice(0, 7);
    const key = `ai-spend:${month}`;
    const cur = JSON.parse((await kvGet(env, key)) || '{"usd":0,"docs":0}');
    cur.usd = Math.round((cur.usd + costOf(env, model, usage)) * 10000) / 10000;
    cur.docs += 1; cur[mode || "bill"] = (cur[mode || "bill"] || 0) + 1;
    await kvSet(env, key, JSON.stringify(cur));
  } catch (e) { console.error("recording AI spend", e); }
}
export async function aiSpend(env) {
  const month = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }).slice(0, 7);
  const cur = JSON.parse((await kvGet(env, `ai-spend:${month}`)) || '{"usd":0,"docs":0}');
  return { month, ...cur };
}

export const BILL_CATEGORIES = [
  "Stock purchases", "Inbound freight (stock)", "Customs duty (stock)", "Outbound shipping & couriers",
  "Shopify & payment fees", "Advertising & marketing", "Software & subscriptions", "Packaging",
  "Vehicle & travel", "Phone & internet", "Rent & utilities", "Accounting & legal", "Bank fees", "Equipment",
  "Entertainment (50%)", "Asset (over $1,000)", "Other",
];

const toBase64 = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

// The answer should be one JSON object. Accept it with or without a code fence or a stray sentence.
export function parseJson(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) try { return JSON.parse(fence[1]); } catch {}
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("Claude's answer wasn't readable");
}

// ---------- Who's asking: from the business's own Setup ----------
// ctx = { country, currency, gstRate, taxName, about } — about is "what the business does" in Setup.
const COUNTRY = { NZ: "New Zealand", AU: "Australia" };
function who(ctx = {}) {
  const country = COUNTRY[ctx.country] || ctx.countryName || "";
  const rate = ctx.gstRate ?? 15, tn = ctx.taxName || "GST", cur = ctx.currency || "NZD";
  const about = ctx.about ? ` It ${ctx.about.replace(/^\s*(we|it)\s+/i, "").replace(/\.$/, "")}.` : "";
  return { country, rate, tn, cur, line: `a small${country ? " " + country : ""} business (registered for ${tn} at ${rate}%, its own currency ${cur}).${about}` };
}

function billPrompt(today, ctx) {
  const w = who(ctx), loc = w.country ? w.country + " " : "";
  const assetOver = Math.round((Number(ctx?.lowValueAsset) || 1000) * (1 + w.rate / 100));
  return `You read supplier bills and receipts for ${w.line} Today is ${today}.
Reply with ONLY a JSON object:
{"supplier": string, "reference": string, "date": "YYYY-MM-DD" (invoice date), "dueDate": "YYYY-MM-DD" or null,
 "description": string (short, what was bought), "currency": "${w.cur}" or other ISO code,
 "total": number (grand total in that currency, incl any ${w.tn}), "gst": number (${loc}${w.tn} shown, 0 if none),
 "gstTreatment": "standard" (${loc}${w.tn} charged) | "none" (no ${loc}${w.tn}, e.g. overseas supplier, ${w.tn}-free or not registered) | "import" (a customs/import entry where the ${w.tn} is import ${w.tn}),
 "category": one of: ${BILL_CATEGORIES.join(" | ")},
 "paidDate": "YYYY-MM-DD" or null (only if it clearly shows it was paid), "supplierGstNumber": string or "",
 "relatedTo": string (for freight, courier or job-specific bills: the consignee or delivery name, delivery town, and any customer order or invoice numbers shown, e.g. "Smith Ltd, Petone, PO INV-0006"; "" if none),
 "note": string (anything unclear, else "")}
Category tips: a single piece of equipment, computer, tool or vehicle costing over ${w.cur} ${assetOver.toLocaleString("en")} incl ${w.tn} is "Asset (over $1,000)"; cheaper ones are "Equipment".
Client meals, drinks, functions and gifts of food or drink are "Entertainment (50%)"; your own meals while travelling are "Vehicle & travel".
Flights, hotels, taxis, rental cars and fuel are "Vehicle & travel". International flights and overseas hotels have no ${loc}${w.tn}: gstTreatment "none".`;
}

function supplierPrompt(today, ctx) {
  const w = who(ctx);
  return `You read supplier invoices for ${w.line}
List EVERY item line. Reply with ONLY a JSON object:
{"supplier": string, "invoiceNumber": string, "date": "YYYY-MM-DD", "currency": ISO code like "EUR",
 "lines": [{"name": string (full product name as written, including size/model/variant), "sku": string (product/article code, "" if none),
            "qty": number, "unitPrice": number (per unit, before VAT/tax), "kind": "product" | "freight" | "other"}],
 "freight": number (freight/shipping/packing not already listed as a line, 0 if none), "total": number, "note": string}
Keep lines in invoice order. Freight, packing and handling lines are kind "freight". Discounts are kind "other" with a negative price.`;
}

function priceListPrompt(today, ctx) {
  const w = who(ctx);
  return `You read supplier price lists for ${w.line}
List EVERY product in the price list. Reply with ONLY a JSON object:
{"supplier": string, "currency": ISO code like "EUR", "effectiveDate": "YYYY-MM-DD" or null,
 "items": [{"name": string (full product name, include size/power/colour/variant),
            "sku": string (the supplier's product/article code, "" if none), "ean": string (EAN/barcode, "" if none),
            "listPrice": number (the list / dealer / trade price per unit before VAT, e.g. a "List price, VAT 0%" column), 
            "rrp": number or null (recommended retail price if shown, before VAT if the list says so),
            "group": string (section or model family heading it sits under, "" if none)}],
 "note": string (name the columns you used for listPrice and rrp, and anything unclear)}
Skip headings, specification text (dimensions, weights), totals and blank rows. Each product code is its own item.`;
}

// Send the document to Claude and collect the answer. Streaming keeps long
// price lists (hundreds of lines) from timing out.
// file: { bytes: ArrayBuffer, type: "application/pdf" | "image/jpeg" ... } or text: string
export async function readDocument(env, { mode, file, text, today, ctx }) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("Reading documents isn't set up. Add your Anthropic API key (setup guide step 7).");
  const content = [];
  if (file) {
    const type = (file.type || "").toLowerCase();
    if (type === "application/pdf") content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: toBase64(file.bytes) } });
    else if (/^image\/(jpeg|png|gif|webp)$/.test(type)) content.push({ type: "image", source: { type: "base64", media_type: type, data: toBase64(file.bytes) } });
    else {
      text = new TextDecoder().decode(file.bytes);
      // Web pages and emails: strip the markup. CSV and plain text keep their rows.
      if (/html|message/.test(type) || /<html|<body/i.test(text)) text = text.replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/[ \t]+/g, " ");
    }
  }
  if (text) content.push({ type: "text", text: "Document text:\n" + String(text).slice(0, 400000) });
  const prompts = { supplier: supplierPrompt, pricelist: priceListPrompt };
  content.push({ type: "text", text: (prompts[mode] || billPrompt)(today, ctx) });

  const big = mode === "supplier" || mode === "pricelist";
  const model = big ? (env.AI_MODEL_SMART || "claude-sonnet-5-5") : (env.AI_MODEL_FAST || "claude-haiku-5-5");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: mode === "pricelist" ? 48000 : big ? 16000 : 2000, stream: true, messages: [{ role: "user", content }] }),
  });
  if (!res.ok) { const body = await res.json().catch(() => ({})); throw new Error(body?.error?.message || `Anthropic API error ${res.status}`); }
  let out = "", usage = {};
  if ((res.headers.get("content-type") || "").includes("event-stream")) {
    // Server-sent events: add up the text pieces as they arrive
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        let ev; try { ev = JSON.parse(line.slice(5)); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") out += ev.delta.text;
        if (ev.type === "message_start" && ev.message?.usage) usage = { ...ev.message.usage };
        if (ev.type === "message_delta" && ev.usage) usage = { ...usage, ...ev.usage };
        if (ev.type === "error") throw new Error(ev.error?.message || "Anthropic API error");
      }
    }
  } else {
    const body = await res.json();
    out = (body.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    usage = body.usage || {};
  }
  await recordSpend(env, model, usage, mode);
  return parseJson(out);
}
