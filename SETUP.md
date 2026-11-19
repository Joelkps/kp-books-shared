# KP Books: setup guide

About an hour, once. Do it on a laptop. After that, the app runs by itself and updates with one click.

**What you end up with:** your own app at `https://kp-books.<your-name>.workers.dev`. Only your email can sign in, it installs on your phone like a normal app, and Claude reads your bills and receipts for you.

**Running cost**
- Cloudflare: free. R2 storage asks for a card, but a small business stays inside the free allowance.
- Claude reading bills: about 1 to 2 cents each, prepaid. US$10 of credit lasts months.
- Optional: a .com for emailing bills in, about US$11 a year.

Steps 1 to 9 get you running. Steps 10 to 12 are optional extras.

---

## 1. Make three accounts

- **GitHub**, github.com: stores your copy of the app. Free.
- **Cloudflare**, dash.cloudflare.com/sign-up: runs the app. Free.
- **Anthropic Console**, console.anthropic.com: lets Claude read your bills. Pay as you go. This is separate from any Claude chat subscription, and its credit is separate too.

## 2. Get your own copy of the app

1. Accept the GitHub invite you were sent (check your email), then open the **kp-books** repository it links to.
2. Click **Fork** (top right). Set **Repository name** to `kp-books`, keep yourself as the owner, then click **Create fork**.

You now have your own copy at `github.com/<you>/kp-books`. Everything below uses **your** copy.

## 3. Create the database and file storage

In the Cloudflare dashboard:

1. Left menu: **Storage & databases**, then **D1 SQL database**, then **Create**. Name it `kp-books`, then **Create**.
2. Copy the **Database ID** (a long code like `3f2a9c…`).
3. In **your** GitHub copy, click `wrangler.jsonc`, then the **pencil** (Edit). Replace `PASTE-YOUR-DATABASE-ID-HERE` with the ID.
4. While you're in there, put your email in `"ALLOWED_EMAILS": ""`, like `"ALLOWED_EMAILS": "you@yourbusiness.com.au"`.
5. Click **Commit changes**, then **Commit changes** again.
6. Back in Cloudflare: **Storage & databases**, then **R2 object storage**. Switch R2 on (add a card if asked), then **Create bucket** named `kp-books-files`.

## 4. Put the app online

1. Cloudflare: **Workers & Pages**, then **Create application**, then **Import a repository**. Click **Continue with GitHub** and allow access to your `kp-books` copy.
2. Pick **kp-books**. On **Set up your application**:
   - **Project name:** `kp-books` (exactly)
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy`
   - **Enable Preview builds:** turn **off**
   - **Protect with Cloudflare Access:** leave off (step 5 does it properly)
3. Click **Deploy** and wait for the green tick (about a minute).

The app is online but shows nothing yet. It refuses to load any data until step 5 is done, so nothing is exposed.

## 5. Lock it to your email

1. Cloudflare: **Workers & Pages**, then **kp-books**. Click the **Access** tab in the top row. On older screens it's **Settings**, then **Domains & Routes**, then **Enable Cloudflare Access** next to the `workers.dev` address.
2. Turn Access **on** for the Worker's URLs and save. The default rule lets in only people on your Cloudflare account, which is just you.
3. Cloudflare usually shows two values when you turn it on. Copy both:
   - the **team domain**, like `https://yourname.cloudflareaccess.com`
   - the **AUD** tag, a long code

   If you missed them, here's where to find them again:
   - **AUD:** **Zero Trust**, then **Access** (or **Access controls**), then **Applications**. Open the kp-books one; the AUD tag is in its details.
   - **Team domain:** **Zero Trust**, then **Settings**. It's listed next to your team name.
4. In your GitHub copy, edit `wrangler.jsonc` again. Paste them between the quotes on `"TEAM_DOMAIN": ""` and `"POLICY_AUD": ""`, then click **Commit changes**. Cloudflare updates the app by itself in about a minute.
5. In **Zero Trust**, then **Access**, then **Applications**, open the kp-books application, then **Edit**:
   - Set **Session duration** to **1 month** so you're not signing in every day. It may be on the **Additional settings** tab.
   - Click **Save**.

## 6. Let Claude read your bills

1. console.anthropic.com: **Billing**, then add US$10 of credit.
2. **API keys**, then **Create key**. Name it `kp-books` and copy it. It's only shown once.
3. Cloudflare: **Workers & Pages**, then **kp-books**, then **Settings**. Find **Variables and Secrets** near the top. Don't use the one under **Build**.
4. Click **+ Add**. **Type:** Secret. **Name:** `ANTHROPIC_API_KEY`. **Value:** paste the key. Click **Deploy**.

Never paste the key into a chat or an email. It only goes into Cloudflare.

## 7. Open the app and set up your business

1. Go to `https://kp-books.<your-name>.workers.dev`. Cloudflare emails you a sign-in code.
2. The **Welcome to KP Books** screen opens. Fill in:
   - your business name, legal name, ABN (or GST number), address, bank account (BSB and account number in Australia)
   - **What the business does**, one line. Claude uses it to read your bills well.
   - **Country**: picking **Australia** fills in GST 10%, quarterly BAS (G1, 1A, 1B), ATO due dates, a July tax year and AUD. Change anything that's different for you. For example, monthly BAS: set **Returns every** to **month**.
3. Click **Start using KP Books**.
4. Optional: **Setup**, then **Add logo** (PNG or JPG) to put it on your invoices.

## 8. Install it on your phone

- **iPhone:** open the address in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** open it in Chrome, tap **⋮**, then **Install app**.

## 9. Bring in your bank transactions

Australian banks don't have a free feed for this app, so you import a statement:

1. In your online banking (CommBank, NAB, ANZ, Westpac and most others), export transactions as **CSV**.
2. In the app: **Bank**, then **Statement CSV**, then pick the file.
3. The app matches payments to your invoices and bills, and remembers how you code everything else. Do it weekly or monthly. Importing the same days twice doesn't double up.

(New Zealand: the Akahu bank feed works automatically. Ask for those steps.)

---

## Optional extras

### 10. Shopify orders arrive by themselves

The app is locked to you, so Shopify sends orders to a tiny second app, **kp-hooks**, that only accepts orders signed with your Shopify key.

1. In GitHub, edit `wrangler.hooks.jsonc` and paste the same database ID as in step 3. Commit.
2. Cloudflare: **Workers & Pages**, then **Create application**, then **Import a repository**, then **kp-books** again:
   - **Project name:** `kp-hooks`
   - **Build command:** empty
   - **Deploy command:** `npx wrangler deploy -c wrangler.hooks.jsonc`
   - **Enable Preview builds:** off
   - Click **Deploy**.
3. In the app: **Setup**. Copy the **Shopify webhook address**.
4. Shopify admin: **Settings**, then **Notifications**, then **Webhooks**, then **Create webhook**. Make three: **Order payment**, **Order update** and **Order cancellation**. Each one uses Format **JSON**, your address, and version **Latest**.
5. Under the webhook list, copy the **signing secret** (clipboard icon).
6. Cloudflare: **kp-hooks** (not kp-books), then **Settings**, then **Variables and Secrets**, then **+ Add**. Secret `SHOPIFY_WEBHOOK_SECRET`, paste, **Deploy**.
7. Test: in Shopify, click **⋯** on Order payment, then **Send test notification**. A test order appears in **Sales**. Delete it.
8. Past orders: Shopify **Orders**, then **Export**, then **CSV for Excel**. In the app: **Sales**, then **Import sales**.

### 11. Email bills in

1. Cloudflare: **Domain Registration**, then **Register Domains**. Buy a cheap .com, like `yourbizbooks.com`. Verify your email when asked.
2. Open the domain, then **Email**, then **Email Routing**, then **Get started**, then **Add records and enable**. Skip any destination address.
3. **Routing rules**, then **Create address**: `bills`, **Send to a Worker**, `kp-books`, **Save**.
4. In GitHub, edit `wrangler.jsonc`: put your email(s) in `"EMAIL_ALLOWED_SENDERS"`. Only these can send bills in, and everything else bounces. Commit.
5. Email a receipt to `bills@yourbizbooks.com`. It shows up under **Bills**, then **To check**, already read.
6. Optional: in Gmail, create a filter **From** your suppliers, then **Forward it to** the bills address.

### 12. Getting updates

When the app is improved, you'll be told. Then:
1. Open your copy on GitHub. It says "This branch is X commits behind".
2. Click **Sync fork**, then **Update branch**.
3. Cloudflare updates the app by itself in a minute. On your phone, close and reopen the app.

If GitHub says there's a conflict in `wrangler.jsonc`, keep your version of that file. It holds your own settings.

---

## Good to know

- **Tax settings** are in **Setup**, under **Country and tax**: GST rate, how often you file, when periods end, due dates, cash or accrual basis, tax year, income tax set-aside %, asset write-off amount and depreciation. Australian presets are a starting point (for example, the instant asset write-off amount changes between years), so check them with your accountant.
- **Filed returns:** for a BAS lodged before you used the app, open **GST**, go back to that quarter, click **Enter filed figures** and type G1, G2, 1A and 1B. The app then shows the official figures for that quarter.
- **Your accountant:** **Reports**, then **Accountant pack** gives one Excel file for the year. **Receipts** downloads every receipt as a zip.
- **Backups:** made every Sunday night. **Setup**, then **Download backup** any time.
- **Hide margins:** the eye button at the top hides costs and margins when you're showing someone the app.

This app isn't tax advice. Have your accountant check your setup and first return.

## If something goes wrong

- **"Login isn't set up yet":** step 5 isn't finished. Check `TEAM_DOMAIN` and `POLICY_AUD` in `wrangler.jsonc`.
- **Claude doesn't read bills:** the key went under **Build** variables instead of **Variables and Secrets**, or the Console has no credit.
- **A setting you changed in the Cloudflare dashboard disappeared:** plain settings live in `wrangler.jsonc`. Only secrets (keys) go in the dashboard.
- **The phone says it can't install:** open the address in Safari (iPhone) or Chrome (Android), sign in first, then install.
