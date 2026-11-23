// Service worker: keeps a copy of the app's screens so it opens instantly and
// still loads on a weak signal. Your data always comes fresh from the server.
const CACHE = "kp-books-v32";   // bump this when you change files, to refresh phones
const SHELL = ["/", "/index.html", "/css/app.css", "/js/main.js", "/js/app.js", "/js/store.js", "/js/ui.js", "/js/calc.js", "/js/pdf.js", "/js/csv.js", "/js/pack.js",
  "/js/views/home.js", "/js/views/sales.js", "/js/views/bills.js", "/js/views/bank.js", "/js/views/products.js", "/js/views/gst.js", "/js/views/reports.js", "/js/views/setup.js", "/js/views/orders.js",
  "/manifest.webmanifest", "/icons/icon-192.png"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;
  // Network first (so updates show straight away), cached copy if offline
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((r) => r || caches.match("/index.html"))));
});
