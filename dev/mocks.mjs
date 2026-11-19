// Fake Anthropic and Akahu responses for local testing
export const realFetch = globalThis.fetch;
export function installMocks() {
globalThis.fetch = async (url, init) => {
  url = String(url);
  if (url.startsWith("https://api.anthropic.com")) {
    const body = JSON.parse(init.body);
    const isSupplier = JSON.stringify(body).includes("List EVERY item line");
    const isPriceList = JSON.stringify(body).includes("List EVERY product in the price list");
    const out = isPriceList
      ? { supplier: "Narvi Oy", currency: "EUR", effectiveDate: "2026-11-01", note: "Used List price, VAT 0%.", items: [
          { name: "Narvi NS 4.5kW", sku: "NS45", listPrice: 551.25, rrp: 990, group: "Electric heaters" },
          { name: "Narvi NS 6kW", sku: "NS6", listPrice: 465, rrp: 1050, group: "Electric heaters" },
          { name: "Narvi Ultra 9kW", sku: "NU9", listPrice: 1250, rrp: 2900, group: "Electric heaters" },
          { name: "Narvi Saunasetti bucket", sku: "NB1", listPrice: 30, rrp: 69, group: "Accessories" },
          { name: "Narvi Velvet 20kW", sku: "NV20", ean: "6430011234567", listPrice: 2100, rrp: 4800, group: "Wood heaters" },
          { name: "Narvi sauna ladle", sku: "NL1", listPrice: 12, rrp: 29, group: "Accessories" }] }
      : isSupplier
      ? { supplier: "Narvi Oy", invoiceNumber: "N-2231", date: "2026-10-02", currency: "EUR", lines: [{ name: "Narvi NS 4.5kW", sku: "NS45", qty: 4, unitPrice: 420, kind: "product" }, { name: "Narvi sauna bucket", sku: "NB1", qty: 10, unitPrice: 30, kind: "product" }, { name: "Freight", sku: "", qty: 1, unitPrice: 300, kind: "freight" }], freight: 0, total: 1980 }
      : { supplier: "NZ Post", reference: "INV-889", date: "2026-10-20", currency: "NZD", total: 57.5, gst: 7.5, gstTreatment: "standard", category: "Outbound shipping & couriers", paidDate: null, note: "" };
    const answer = "```json\n" + JSON.stringify(out) + "\n```";
    if (body.stream) {
      // Stream it in small pieces, like the real API
      const pieces = answer.match(/[\s\S]{1,40}/g);
      const sse = [`event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":4000,"output_tokens":1}}}\n\n`, ...pieces.map((t) => `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: t } })}\n\n`), `event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":600}}\n\n`, `event: message_stop\ndata: {"type":"message_stop"}\n\n`].join("");
      return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text: answer }] }), { status: 200 });
  }
  if (url.startsWith("https://api.akahu.io/v1/accounts")) return Response.json({ success: true, items: [
    { _id: "acc_biz", name: "Kauri Point Sauna Ltd", formatted_account: "12-3034-0246360-50", connection: { name: "ASB" }, balance: { current: 15234.5, available: 15234.5 } },
    { _id: "acc_personal", name: "Everyday", formatted_account: "12-3034-0000000-00", connection: { name: "ASB" }, balance: { current: 900 } }] });
  if (url.startsWith("https://api.akahu.io/v1/transactions")) return Response.json({ success: true, items: [
    { _id: "tx1", _account: "acc_biz", date: "2026-10-21T00:00:00Z", description: "NZ POST 0012 AUCKLAND", amount: -57.5, type: "EFTPOS" },
    { _id: "tx2", _account: "acc_biz", date: "2026-10-22T00:00:00Z", description: "SHOPIFY PAYMENTS", amount: 4211.2, type: "CREDIT" },
    { _id: "tx3", _account: "acc_personal", date: "2026-10-22T00:00:00Z", description: "COUNTDOWN", amount: -88, type: "EFTPOS" }], cursor: { next: null } });
  if (url.startsWith("https://api.akahu.io/v1/refresh")) return Response.json({ success: true });
  return realFetch(url, init);
};

}
