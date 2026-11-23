# KP Books: setup guide

Welcome! This gets your own copy of KP Books running. Your data stays in your own accounts, and nobody else can see it.

- **Time:** about an hour. Do it in one go if you can.
- **Use a laptop or computer**, not your phone. You install it on your phone at the end.
- **Go in order.** Don't skip ahead.
- **Stuck?** Take a screenshot of the screen and send it to whoever shared this with you.

---

## Before you start: a notes card

Open a blank note (Notes app, Word, or paper). As you go, you'll copy 4 things into it. Set it up like this now:

```
1. Database ID:
2. Team domain:
3. AUD code:
4. My app address:
```

---

## Step 1. Make 3 accounts (15 minutes)

Make each account with your **business email**. Write down your passwords somewhere safe.

**1a. GitHub** (where the app's files live)
1. Go to **github.com**
2. Click **Sign up** (top right) and follow the steps.

**1b. Cloudflare** (runs the app on the internet)
1. Go to **dash.cloudflare.com/sign-up**
2. Sign up. If it asks what you want to do, click **Skip** or close it.

**1c. Anthropic Console** (lets Claude read your bills and receipts)
1. Go to **console.anthropic.com**
2. Sign up.
3. In the left menu, click **Billing**. Add **US$10** of credit. This lasts months, because each bill costs about 1 or 2 cents.

Even if you already pay for Claude, this is a separate account with separate credit.

✅ **Done when:** you can log in to all three.

---

## Step 2. Get your own copy of the app (2 minutes)

1. Open the link you were sent: **github.com/Joelkps/kp-books-shared**
2. Make sure you're logged in to GitHub.
3. Near the top right, click the **Fork** button.
4. On the next page, in **Repository name**, type: `kp-books`
5. Click the green **Create fork** button.

✅ **Done when:** you see a page titled **your-name / kp-books**. That's your own copy. Keep this tab open.

---

## Step 3. Make your database (5 minutes)

**3a. Create it**
1. Go to **dash.cloudflare.com** and log in.
2. In the left menu, click **Storage & databases**, then **D1 SQL database**.
3. Click **Create** (blue button).
4. In **Name**, type: `kp-books`
5. Click **Create**.
6. You'll see a **Database ID**: a long code of letters and numbers. Click the copy icon next to it and **paste it into your notes card as #1**.

**3b. Make file storage** (for bill photos and PDFs)
1. In the left menu, click **Storage & databases**, then **R2 object storage**.
2. If it asks you to switch R2 on, do it. It may ask for a card. You won't be charged at small-business size.
3. Click **Create bucket**.
4. In **Bucket name**, type: `kp-books-files`
5. Click **Create bucket**.

✅ **Done when:** you have the Database ID in your notes.

---

## Step 4. Put your details into the app (5 minutes)

1. Go back to your GitHub tab (**your-name / kp-books**).
2. In the list of files, click **wrangler.jsonc**.
3. Click the **pencil icon ✏️** (top right of the file) to edit it.
4. Find this line:
   ```
   "database_id": "PASTE-YOUR-DATABASE-ID-HERE"
   ```
   Select only the words **PASTE-YOUR-DATABASE-ID-HERE** and paste your **Database ID (#1)** over them. Keep the quote marks `"` on both sides.
5. Find this line:
   ```
   "ALLOWED_EMAILS": "",
   ```
   Click between the two quote marks and type your email, so it looks like:
   ```
   "ALLOWED_EMAILS": "you@yourbusiness.com.au",
   ```
6. Click the green **Commit changes** button (top right). A box pops up. Click **Commit changes** again.

✅ **Done when:** the file shows your Database ID and email.

Don't change anything else in this file.

---

## Step 5. Put the app online (5 minutes)

1. Go to **dash.cloudflare.com**.
2. In the left menu, click **Workers & Pages**.
3. Click **Create application** (or **Create**).
4. Choose **Import a repository**.
5. Click **Continue with GitHub**, and allow Cloudflare to see your **kp-books** copy.
6. Pick **kp-books** from the list.
7. On the **Set up your application** page, fill it in **exactly** like this:
   - **Project name:** `kp-books`
   - **Build command:** leave it empty
   - **Deploy command:** `npx wrangler deploy`
   - **Enable Preview builds:** click it so it turns **off** (grey)
   - **Protect with Cloudflare Access:** leave it **off**
8. Click **Deploy**.
9. Wait for a **green tick ✅**. It takes about 1 minute.

On the page that opens, you'll see an address ending in **.workers.dev**, like `kp-books.yourname.workers.dev`. **Write it in your notes as #4.**

If you open it now it won't work yet. That's normal: it stays locked until step 6.

---

## Step 6. Lock the app so only you can get in (10 minutes)

This is the most fiddly step. Go slowly.

**6a. Turn on the lock**
1. In Cloudflare, go to **Workers & Pages**, then click **kp-books**.
2. Along the top there's a row of tabs. Click **Access**.
   (If there's no Access tab: click **Settings**, then **Domains & Routes**, then next to the `.workers.dev` address click **Enable Cloudflare Access**.)
3. Switch Access **on** and click **Save** (or **Enable**).

**6b. Copy two codes**

When you switch it on, Cloudflare usually shows two codes. Copy them into your notes:
- **Team domain**, like `https://something.cloudflareaccess.com`: **#2**
- **AUD** (a very long code): **#3**

If you didn't see them, find them here:
- **#2 Team domain:** left menu, **Zero Trust**, then **Settings**. It's next to your team name. Copy the whole thing, starting `https://`
- **#3 AUD:** left menu, **Zero Trust**, then **Access** (or **Access controls**), then **Applications**. Click the **kp-books** one. Look for **Application Audience (AUD) Tag** and copy it.

**6c. Put the codes in the app**
1. Go back to GitHub, open **wrangler.jsonc**, then click the **pencil ✏️**.
2. Find `"TEAM_DOMAIN": "",` and paste **#2** between the quote marks.
3. Find `"POLICY_AUD": "",` and paste **#3** between the quote marks.

   They should look like:
   ```
   "TEAM_DOMAIN": "https://something.cloudflareaccess.com",
   "POLICY_AUD": "4f8a...a very long code...",
   ```
4. Click **Commit changes**, then **Commit changes** again.
5. Wait 2 minutes. Cloudflare updates the app by itself.

**6d. Stay signed in for a month**
1. Cloudflare left menu: **Zero Trust**, then **Access**, then **Applications**.
2. Click the **kp-books** application, then **Edit** (or **Configure**).
3. Find **Session duration** (it may be on the **Additional settings** tab) and pick **1 month**.
4. Click **Save**.

✅ **Done when:** you open your app address (**#4**) in a private or incognito window and get a Cloudflare sign-in page asking for your email.

---

## Step 7. Let Claude read your bills (5 minutes)

1. Go to **console.anthropic.com**.
2. In the left menu, click **API keys**, then **Create key**.
3. Name it `kp-books` and click **Create**.
4. **Copy the key now.** It's only shown once. Don't put it in your notes, an email or a chat.
5. Go to Cloudflare: **Workers & Pages**, then **kp-books**, then the **Settings** tab.
6. Find **Variables and Secrets**. It's near the **top** of Settings. Don't use the one lower down under **Build**.
7. Click **+ Add**, then fill it in:
   - **Type:** Secret
   - **Variable name:** `ANTHROPIC_API_KEY`
   - **Value:** paste the key
8. Click **Deploy** (or **Add variable and deploy**).

✅ **Done when:** `ANTHROPIC_API_KEY` shows in the list, with its value hidden.

---

## Step 8. Open the app and set up your business (10 minutes)

1. Go to your app address (**#4**).
2. Type your email. Cloudflare emails you a code, so type it in.
3. You'll see **Welcome to KP Books**. Fill in:
   - **Trading name** and **Legal name on invoices**
   - **ABN**
   - **Address**, **email** and **phone** for your invoices
   - **What the business does**: one line, like `builds and sells saunas in Sydney`. Claude uses it to read your bills properly.
   - **Bank account name** and **BSB and account number**, which go on your invoices
4. Under **Country and tax**, pick **Australia**. It fills in everything for you: 10% GST, BAS every 3 months, ATO due dates and a July tax year.
   - If you do BAS **monthly**, change **Returns every** to **month**.
   - If you're on **accrual** GST (most small businesses are on cash), change the basis.
   - Not sure? Leave it, and ask your accountant later. You can change it any time in **Setup**.
5. Click **Start using KP Books**.
6. Optional: go to **Setup**, then **Add logo**, to put your logo on invoices.

✅ **Done when:** you see the Home screen with your business name at the top.

---

## Step 9. Put it on your phone (2 minutes)

**iPhone**
1. Open **Safari** (it must be Safari) and go to your app address (**#4**).
2. Sign in.
3. Tap the **Share** button (square with an arrow), then **Add to Home Screen**, then **Add**.

**Android**
1. Open **Chrome** and go to your app address.
2. Sign in.
3. Tap **⋮** (top right), then **Install app** (or **Add to Home screen**).

🎉 **You're set up.**

---

## Using it

- **Bank transactions:** in your online banking, download your transactions as a **CSV file**. In the app, go to **Bank**, then **Statement CSV**, and pick the file. Do this weekly or monthly. The app matches payments to your invoices and bills, and learns as you go.
- **Bills and receipts:** go to **Bills**, then **Upload**, or **Snap receipt** on your phone. Claude reads them for you. Check the figures and save.
- **Invoices and quotes:** tap **+ New** at the top.
- **BAS time:** go to **More**, then **GST**. It shows G1, 1A and 1B ready to copy into ATO online services.
- **Your accountant:** go to **Reports**, then **Accountant pack**, for one Excel file covering the year.

This app isn't tax advice. Have your accountant check your tax settings and your first BAS.

## Optional extras

See **[EXTRAS.md](EXTRAS.md)** when you're ready for: Shopify orders arriving by themselves, emailing bills straight into the app, and getting updates.

## If something's not right

| What you see | What to do |
|---|---|
| "Login isn't set up yet" | Step 6c isn't done, or a code has a typo. Check `TEAM_DOMAIN` and `POLICY_AUD` in wrangler.jsonc. |
| The deploy in step 5 failed (red cross) | Check step 4: the Database ID must be inside the quote marks with no spaces. |
| Claude doesn't read bills | Step 7: the key must be under **Variables and Secrets** at the top, not **Build**. Check your Anthropic credit too. |
| Your phone says it can't install | Use Safari (iPhone) or Chrome (Android), and sign in first. |
| Anything else | Screenshot it and send it to whoever shared this app with you. |
