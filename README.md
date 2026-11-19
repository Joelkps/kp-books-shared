# KP Books

Small-business books that run on your own Cloudflare account: invoices and quotes, bills read by Claude, bank matching, stock and costs, GST/BAS returns, reports and an accountant pack. Works for New Zealand and Australia out of the box, and anywhere else with your own tax settings.

**Setting it up?** Follow [SETUP.md](SETUP.md). About an hour, once.

**Your data is yours.** It lives only in your Cloudflare account. Nobody else, including whoever shared this app with you, can see it.

## What's where

| Folder / file | What it does |
|---|---|
| `public/` | The app you see. Plain HTML, CSS and JavaScript, no build step |
| `public/js/calc.js` | All the money maths: tax settings and country presets, GST periods and returns, margins, payments, stock, P&L |
| `public/js/views/` | One file per screen: home, sales, bills, bank, products, gst, reports, setup |
| `public/js/pdf.js` | The invoice, quote and purchase order PDF layout |
| `worker/index.js` | The server: API, scheduled bank sync and backups, bill emails |
| `worker/ai.js` | The instructions Claude follows to read bills, supplier invoices and price lists |
| `worker/hooks.js` | Optional Shopify order receiver (kp-hooks) |
| `worker/fixes.js` | One-off data fixes for your copy (empty to start) |
| `wrangler.jsonc` | Cloudflare settings: the few lines you fill in are marked ← |
| `dev/` | Tests and a local copy of the server (not deployed) |

## Testing changes on your computer (optional)

You need Node.js 22+.

```
npm test          # checks the tax maths and the server
npm run dev       # runs the app at http://localhost:8787 with no login
```
