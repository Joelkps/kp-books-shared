// ---------- Forward bills by email (optional) ----------
// With Cloudflare Email Routing, mail sent to e.g. bills@yourdomain.com arrives here.
// Each PDF or photo attachment becomes a bill waiting for your review, already read by Claude.
// No attachment? The email text itself is read (many suppliers put the invoice in the body).

import { putMany, bizSettings, bizToday, aiContext } from "./db.js";
import { readDocument } from "./ai.js";

// --- A small MIME reader: enough for normal emails with attachments ---
function splitHeaders(part) {
  const i = part.search(/\r?\n\r?\n/);
  const head = i < 0 ? part : part.slice(0, i), body = i < 0 ? "" : part.slice(i).replace(/^\r?\n\r?\n/, "");
  const headers = {};
  for (const line of head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)) {
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (m) headers[m[1].toLowerCase()] = m[2];
  }
  return { headers, body };
}
const param = (h, name) => (h || "").match(new RegExp(`${name}\\*?=\\s*"?([^";]+)"?`, "i"))?.[1];
function decodeBody(body, enc) {
  enc = (enc || "").toLowerCase();
  if (enc === "base64") { const bin = atob(body.replace(/\s+/g, "")); return Uint8Array.from(bin, (c) => c.charCodeAt(0)); }
  if (enc === "quoted-printable") {
    const s = body.replace(/=\r?\n/g, "");
    const out = []; for (let i = 0; i < s.length; i++) {
      if (s[i] === "=" && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else out.push(s.charCodeAt(i) & 0xff);
    }
    return new Uint8Array(out);
  }
  return Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
}
// Walks nested multipart sections and collects attachments + the text body
export function parseMime(raw) {
  const out = { subject: "", from: "", text: "", files: [] };
  const walk = (part, top) => {
    const { headers, body } = splitHeaders(part);
    if (top) { out.subject = headers.subject || ""; out.from = headers.from || ""; }
    const ctype = headers["content-type"] || "text/plain";
    const boundary = param(ctype, "boundary");
    if (/^multipart\//i.test(ctype) && boundary) {
      for (const sub of body.split("--" + boundary).slice(1)) { if (sub.startsWith("--")) break; walk(sub.replace(/^\r?\n/, ""), false); }
      return;
    }
    const type = ctype.split(";")[0].trim().toLowerCase();
    const name = param(headers["content-disposition"], "filename") || param(ctype, "name");
    const bytes = decodeBody(body, headers["content-transfer-encoding"]);
    if (name || /^(application\/pdf|image\/)/.test(type)) out.files.push({ name: name || "attachment", type: type === "application/octet-stream" && /\.pdf$/i.test(name || "") ? "application/pdf" : type, bytes });
    else if (type === "text/plain" && !out.text) out.text = new TextDecoder().decode(bytes);
    else if (type === "text/html" && !out.text) out.text = new TextDecoder().decode(bytes).replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  };
  walk(raw, true);
  return out;
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });

// Does this sender match one of yours? Exact address, ignoring any "+tag" Gmail adds when it
// forwards (joel+caf_=bills=x.com@gmail.com is still joel@gmail.com). "@yourdomain.co.nz" allows a whole domain.
// Google's forwarding-confirmation sender is always allowed so you can set forwarding up.
export function senderAllowed(from, list) {
  const addr = String(from || "").toLowerCase().match(/[^\s<>"]+@[^\s<>"]+/)?.[0] || "";
  const [local, domain] = addr.split("@");
  if (!domain) return false;
  if (addr === "forwarding-noreply@google.com") return true;
  const allowed = String(list || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  if (!allowed.length) return false;                      // nothing listed: bounce everything (safe default)
  const base = local.split("+")[0];
  return allowed.some((a) => a.startsWith("@") ? domain === a.slice(1) : a === `${base}@${domain}`);
}

export async function handleEmail(message, env) {
  // bills@ goes to the main business; bills+icebath@ goes to the business with id "icebath"
  const to = String(message.to || "");
  const biz = (to.match(/\+([a-z0-9-]+)@/i)?.[1] || env.DEFAULT_BIZ || "kp").toLowerCase();
  // Only addresses you list in EMAIL_ALLOWED_SENDERS can send bills in. Anyone else is bounced,
  // so strangers can't fill your Bills or use up your Claude budget.
  if (!senderAllowed(message.from, env.EMAIL_ALLOWED_SENDERS)) { message.setReject("Sender not allowed"); return; }

  const raw = await new Response(message.raw).text();       // MIME is 7-bit safe, so text is fine
  const mail = parseMime(raw);

  // Gmail (and Outlook) send a confirmation code when you set up forwarding.
  // Show it in Bills > To check so you can copy it, rather than reading it as a bill.
  if (/forwarding-noreply@google\.com|forwarding|confirm/i.test(`${message.from} ${mail.subject}`) && /forward/i.test(`${mail.subject} ${mail.text}`) && !mail.files.length) {
    await putMany(env, biz, [{ kind: "bill", id: `email-confirm-${Date.now()}`, data: {
      needsReview: true, source: "email", supplier: "Email forwarding confirmation", emailFrom: mail.from, emailSubject: mail.subject,
      date: today(), total: 0, category: "Other", gstTreatment: "none", description: "Not a bill. Copy the code, then delete this.",
      aiNote: mail.text.replace(/\s+/g, " ").slice(0, 600) } }], "email " + mail.from, "email-in");
    return;
  }
  const usable = mail.files.filter((f) => /^(application\/pdf|image\/(jpeg|png|gif|webp))$/.test(f.type) && f.bytes.length > 2000);
  const docs = usable.length ? usable : [{ name: "email.txt", type: "text/plain", bytes: new TextEncoder().encode(`Subject: ${mail.subject}\nFrom: ${mail.from}\n\n${mail.text}`) }];

  const writes = [];
  for (const f of docs.slice(0, 5)) {
    const key = `${biz}/inbox/${today()}/${crypto.randomUUID()}-${f.name.replace(/[^\w.-]+/g, "_")}`;
    await env.FILES.put(key, f.bytes, { httpMetadata: { contentType: f.type } });
    let read = {}, note = "";
    try { const bs = await bizSettings(env, biz); read = await readDocument(env, { mode: "bill", file: { bytes: f.bytes, type: f.type }, today: bizToday(bs), ctx: aiContext(bs) }); }
    catch (e) { note = "Couldn't read automatically: " + e.message; }
    writes.push({ kind: "bill", id: `email-${Date.now()}-${writes.length}`, data: {
      needsReview: true, source: "email", emailFrom: mail.from, emailSubject: mail.subject,
      supplier: read.supplier || mail.from.replace(/<.*>/, "").trim(), reference: read.reference || "",
      date: read.date || today(), dueDate: read.dueDate || "", description: read.description || mail.subject, relatedTo: read.relatedTo || "",
      currency: (read.currency || "NZD").toUpperCase(), total: read.currency && read.currency !== "NZD" ? 0 : Number(read.total) || 0,
      originalTotal: Number(read.total) || 0, gst: Number(read.gst) || 0, gstTreatment: read.gstTreatment || "standard",
      category: read.category || "Other", paidDate: read.paidDate || "", fileKey: key, fileName: f.name,
      aiNote: [read.note, note].filter(Boolean).join(" "),
    } });
  }
  await putMany(env, biz, writes, "email " + mail.from, "email-in");
}
