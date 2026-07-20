/* Debt Free — service worker
 * Offline support only. No tracking, no analytics, no network beacons.
 * Strategy: cache-first, versioned cache. Bump CACHE_VERSION on every deploy.
 */
const CACHE_VERSION = "debt-free-v2";

/* Same-origin app shell — must all succeed or the SW will not install. */
const CORE_ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
  "/favicon.ico"
];

/* Third-party assets the app already loads. Cached opportunistically:
 * a failure here must never break installation or the app. */
const OPTIONAL_ASSETS = [
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"
];

/* Hosts we are allowed to runtime-cache (already used by the app). */
const RUNTIME_HOSTS = [
  "cdnjs.cloudflare.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // Core assets: required.
      await cache.addAll(CORE_ASSETS);
      // Optional assets: best effort, never fatal.
      await Promise.allSettled(
        OPTIONAL_ASSETS.map(async (url) => {
          const res = await fetch(url, { mode: "cors", credentials: "omit" });
          if (res && res.ok) await cache.put(url, res.clone());
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const cacheable = sameOrigin || RUNTIME_HOSTS.includes(url.hostname);
  if (!cacheable) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);

      // 1. Cache first.
      const cached = await cache.match(req, { ignoreSearch: sameOrigin });
      if (cached) return cached;

      // 2. Network, and cache what we get back.
      try {
        const res = await fetch(req);
        if (res && res.ok && res.type !== "opaque") {
          cache.put(req, res.clone());
        }
        return res;
      } catch (err) {
        // 3. Offline fallback: any navigation resolves to the app shell.
        if (req.mode === "navigate") {
          const shell = await cache.match("/index.html");
          if (shell) return shell;
        }
        throw err;
      }
    })()
  );
});
