self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Intentionally empty and never calls event.respondWith(): every request goes
// straight to the network exactly as if no service worker were installed. The
// listener exists only because PWA installability heuristics look for a fetch
// handler. The previous version called event.respondWith(fetch(event.request)),
// which re-issued every request through the worker for no benefit and put a
// needless hop in front of /assets/* loads.
self.addEventListener("fetch", () => {});
