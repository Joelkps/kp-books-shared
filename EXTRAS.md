# KP Books: optional extras

Only do these once the main setup (SETUP.md) is working. Each one can be done on its own, any time.

---

## Getting updates (2 minutes)

When you're told there's a new version of the app:

1. Go to **github.com** and open your **kp-books** copy.
2. Near the top you'll see "This branch is … commits behind". Click **Sync fork**, then **Update branch**.
3. Wait 2 minutes. Cloudflare updates the app by itself.
4. On your phone, close the app and open it again.

If GitHub mentions a **conflict** in `wrangler.jsonc`, choose to keep **your** version. That file holds your own settings.

Your data is never touched by an update.

---

## Email bills straight into the app (15 minutes)

You get an email address, like `bills@yourbizbooks.com`. Anything you send or forward to it shows up in the app, already read by Claude.

**You need:** a cheap .com bought through Cloudflare (about US$11 a year). It's only for this, and your normal email doesn't change.

1. **Buy the domain**
   1. Cloudflare left menu: **Domain Registration**, then **Register Domains**.
   2. Search for a name, like `yourbizbooks.com`, and buy it.
   3. Check your email for a message from Cloudflare and click the link to verify. Do this, or the domain stops working after 14 days.
2. **Turn on email for it**
   1. Click the new domain. In the left menu, click **Email**, then **Email Routing**.
   2. Click **Get started**. When it shows records to add, click **Add records and enable**.
   3. If it asks for a destination address, click **Skip**.
3. **Make the bills address**
   1. Click the **Routing rules** tab, then **Create address**.
   2. **Custom address:** `bills`
   3. **Action:** **Send to a Worker**
   4. **Destination:** `kp-books`
   5. Click **Save**.
4. **Say who's allowed to send bills in**
   1. GitHub: open your **kp-books** copy, then **wrangler.jsonc**, then the **pencil ✏️**.
   2. Find `"EMAIL_ALLOWED_SENDERS": "",` and put your email address(es) between the quote marks, with a comma between each one:
      ```
      "EMAIL_ALLOWED_SENDERS": "you@yourbusiness.com.au,you@gmail.com",
      ```
   3. Click **Commit changes** twice.

   Email from anyone else bounces, so strangers can't fill up your app.
5. **Test it:** email a receipt (PDF or photo) from your email to `bills@yourbizbooks.com`. Within a minute it's in the app under **Bills**, then **To check**.

**Forward supplier bills automatically (Gmail)**
1. Gmail: **⚙️**, then **See all settings**, then **Forwarding and POP/IMAP**, then **Add a forwarding address**. Type `bills@yourbizbooks.com`, then **Next**, then **Proceed**.
2. Google sends a code. It appears in the app under **Bills**, then **To check**. Open it, copy the code into Gmail, and click **Verify**. Then delete that entry in the app.
3. Gmail: **Filters and Blocked Addresses**, then **Create a new filter**. In **From**, type your suppliers' email domains with OR between them, like:
   ```
   xero.com OR officeworks.com.au OR telstra.com
   ```
4. Click **Create filter**, tick **Forward it to**, pick the bills address, then click **Create filter**.

---

## Shopify orders arrive by themselves (20 minutes)

Only if you sell on Shopify. Your app is locked to you, so Shopify sends orders to a tiny second app called **kp-hooks**, which only accepts orders signed by your shop.

1. **Point kp-hooks at your database**
   1. GitHub: open your **kp-books** copy, then **wrangler.hooks.jsonc**, then the **pencil ✏️**.
   2. Replace **PASTE-YOUR-DATABASE-ID-HERE** with your **Database ID** (the same one as in setup step 3, from your notes card).
   3. Click **Commit changes** twice.
2. **Put kp-hooks online**
   1. Cloudflare: **Workers & Pages**, then **Create application**, then **Import a repository**, then pick **kp-books** (yes, the same one).
   2. Fill in **exactly**:
      - **Project name:** `kp-hooks`
      - **Build command:** leave empty
      - **Deploy command:** `npx wrangler deploy -c wrangler.hooks.jsonc`
      - **Enable Preview builds:** turn **off**
      - **Protect with Cloudflare Access:** leave **off**
   3. Click **Deploy** and wait for the green tick.
3. **Get the address:** in the app, go to **Setup** and click **Copy** next to **Shopify webhook address**.
4. **Tell Shopify**
   1. Shopify admin: **Settings** (bottom left), then **Notifications**, then **Webhooks** (near the bottom).
   2. Click **Create webhook**:
      - **Event:** Order payment
      - **Format:** JSON
      - **URL:** paste the address
      - **Webhook API version:** Latest
      - Click **Save**.
   3. Do the same twice more, with the events **Order update** and **Order cancellation**.
5. **Copy Shopify's key:** under the list of webhooks, in **Signing secret**, click the **clipboard icon**.
6. **Give the key to kp-hooks**
   1. Cloudflare: **Workers & Pages**, then **kp-hooks** (not kp-books), then **Settings**, then **Variables and Secrets**, then **+ Add**.
   2. **Type:** Secret. **Variable name:** `SHOPIFY_WEBHOOK_SECRET`. **Value:** paste.
   3. Click **Deploy**.
7. **Test it:** in Shopify, next to **Order payment**, click **⋯**, then **Send test notification**. A test order appears in the app under **Sales**. Open it and delete it.
8. **Past orders:** Shopify **Orders**, then **Export**, choose a date range and **CSV for Excel**. In the app, go to **Sales**, then **Import sales**, and pick the file.

---

## Handy settings (any time, in Setup)

- **Country and tax:** GST rate, how often you do BAS, cash or accrual, tax year, income tax set-aside %, asset write-off amount and depreciation.
- **Logo:** goes on invoices, quotes and purchase orders.
- **Invoice numbering, payment terms, and quote and invoice T&Cs:** the T&Cs are a starting point, so have them checked.
- **Hide margins:** the eye button at the top of the app hides costs and margins when you're showing someone the app.
- **Backups:** made every Sunday night. **Download backup** gives you a copy any time.
