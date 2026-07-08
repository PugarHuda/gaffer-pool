// Minimal service worker: makes Gaffer installable. Network-first for everything
// so the app always updates; old caches are purged on activate. The app shell
// is NOT pre-cached (avoids serving a stale UI). API calls always pass through.
const SHELL = "gaffer-shell-v1";
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((k) => k !== SHELL && caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.pathname.startsWith("/api/")) return; // always live
  // Network-first; fall back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then((r) => { caches.open(SHELL).then((c) => c.put(e.request, r.clone())).catch(() => {}); return r; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
