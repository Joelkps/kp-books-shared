// ---------- Login check ----------
// Cloudflare Access sits in front of the app and makes you sign in (email code).
// It then adds a signed token (JWT) to every request. We check that token here too,
// so nobody can reach the API by going around Access.

let jwksCache = { at: 0, keys: [] };

const b64urlToBytes = (s) => {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(teamDomain) {
  // Access rotates its signing keys, so fetch them and keep them for an hour
  if (Date.now() - jwksCache.at < 3600_000 && jwksCache.keys.length) return jwksCache.keys;
  const res = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("Could not load Access keys");
  const { keys } = await res.json();
  jwksCache = { at: Date.now(), keys };
  return keys;
}

// Returns the signed-in email, or throws
export async function verifyAccess(request, env) {
  if (env.DEV_NO_AUTH === "1") return "dev@localhost";       // local testing only
  const team = (env.TEAM_DOMAIN || "").replace(/\/$/, "");
  if (!team || !env.POLICY_AUD) throw new Error("Login isn't set up yet. Add TEAM_DOMAIN and POLICY_AUD (setup guide step 5).");

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) throw new Error("Not signed in");
  const [h, p, sig] = token.split(".");
  const header = b64urlToJson(h), payload = b64urlToJson(p);

  const jwk = (await getKeys(team)).find((k) => k.kid === header.kid);
  if (!jwk) { jwksCache.at = 0; throw new Error("Unknown signing key"); }
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error("Bad signature");

  const now = Date.now() / 1000;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (payload.iss !== team) throw new Error("Wrong issuer");
  if (!aud.includes(env.POLICY_AUD)) throw new Error("Wrong audience");
  if (payload.exp && payload.exp < now) throw new Error("Session expired");

  const email = String(payload.email || "").toLowerCase();
  const allowed = (env.ALLOWED_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(email)) throw new Error("This email isn't allowed in");
  return email || "signed-in user";
}

// Shopify signs each webhook with your store's webhook key (HMAC-SHA256, base64)
export async function verifyShopify(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, rawBody));
  const expected = btoa(String.fromCharCode(...mac));
  // constant-time compare
  if (expected.length !== hmacHeader.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ hmacHeader.charCodeAt(i);
  return diff === 0;
}
