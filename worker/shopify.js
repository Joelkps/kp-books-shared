// ---------- Shopify orders → invoices ----------
// Shopify sends a webhook when an order is paid, updated or cancelled.
// We turn it into the same invoice shape the CSV import makes, so both paths agree.

const num = (v) => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
const r2 = (n) => Math.round(n * 100) / 100;
export const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9._~:@+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120) || "x";

const addr = (a) => a ? [a.address1, a.address2, a.city, a.province, a.zip, a.country].filter(Boolean).join("\n") : "";

// Returns { id, data } or null when the order isn't one to record (unpaid, pending)
export function orderToInvoice(o, settings = {}) {
  const fin = String(o.financial_status || "").toLowerCase();
  const cancelled = !!o.cancelled_at;
  if (!["paid", "partially_refunded", "refunded", "partially_paid"].includes(fin) && !cancelled) return null;

  const orderNo = String(o.order_number ?? o.name ?? "").replace(/^#/, "");
  const country = String(o.shipping_address?.country_code || o.billing_address?.country_code || "").toUpperCase();
  const taxes = num(o.total_tax);
  // Refunds: add up successful refund transactions
  let refunded = 0;
  for (const rf of o.refunds || []) for (const t of rf.transactions || []) if (t.kind === "refund" && t.status !== "failure") refunded += num(t.amount);
  // Shopify gives times in the shop's timezone (+13:00), so the first 10 characters are the NZ date
  const date = String(o.processed_at || o.created_at || "").slice(0, 10);
  const b = o.billing_address || {}, s = o.shipping_address || null;

  return {
    id: "shopify-" + slug(orderNo),
    data: {
      type: "invoice", source: "shopify", orderName: o.name || "#" + orderNo, shopifyId: o.id,
      number: (settings.invoicePrefix ?? "WEB-") + orderNo,
      date,
      status: cancelled ? "cancelled" : fin === "refunded" ? "refunded" : "paid",
      customer: {
        name: b.name || [o.customer?.first_name, o.customer?.last_name].filter(Boolean).join(" ") || s?.name || "",
        company: b.company || "", email: o.email || o.customer?.email || "", phone: b.phone || o.phone || "",
        address: addr(b),
      },
      shipTo: s && addr(s) !== addr(b) ? { name: s.name || "", address: addr(s) } : null,
      country,
      zeroRated: taxes === 0 && !!country && country !== "NZ",
      lines: (o.line_items || []).map((l) => ({
        qty: num(l.quantity) || 1,
        name: [l.title, l.variant_title].filter(Boolean).join(" - "),
        price: num(l.price), sku: l.sku || "",
      })),
      shipping: num(o.total_shipping_price_set?.shop_money?.amount ?? (o.shipping_lines || []).reduce((a, x) => a + num(x.price), 0)),
      discount: num(o.total_discounts),
      total: num(o.total_price),
      taxes, refunded: r2(refunded),
      currency: o.currency || "NZD",
      importedAt: new Date().toISOString(),
    },
  };
}
