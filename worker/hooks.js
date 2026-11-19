// =====================================================================
// kp-hooks: the Shopify order receiver
// The main app sits behind the Cloudflare Access sign-in lock, which Shopify can't get past.
// This tiny Worker sits outside the lock. It only does one thing: take Shopify order
// webhooks, check they're signed with your Shopify key, and save them into the same database.
// Anything else gets a 404.
// =====================================================================

import { shopifyHook } from "./index.js";
import { migrate } from "./db.js";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith("/api/hooks/shopify")) return new Response("Not found", { status: 404 });
    try {
      await migrate(env);
      return await shopifyHook(request, env, path);
    } catch (e) {
      console.error("shopify hook", e);
      return new Response(JSON.stringify({ error: "Server error" }), { status: 500, headers: { "content-type": "application/json" } });
    }
  },
};
