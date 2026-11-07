/* Kijabe Queue PWA — network-first so every open gets the latest app */
const CACHE = "kijabe-queue-v2";
const PRECACHE = [
  "/",
  "/manifest.webmanifest",
  "/favicon.png",
  "/brand/kijabe-logo.png",
  "/brand/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Live API / auth — never cache
  if (url.pathname.startsWith("/api/") || url.pathname.includes("supabase")) return;

  // HTML & app shell: network first (always up to date), cache only as offline fallback
  const isDoc = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  const isAsset = /\.(js|css|png|jpe?g|svg|webp|webmanifest|woff2?|ico)$/i.test(url.pathname);

  if (isDoc || isAsset || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || (isDoc ? caches.match("/") : undefined))),
    );
  }
});
