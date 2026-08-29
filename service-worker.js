const CACHE_NAME = "taskcore-v19-20260829-connect-icons";
const STATIC_ASSETS = ["./", "./index.html", "./privacy.html", "./connect/", "./connect/index.html", "./connect/connect.css?v=20260829-2", "./styles.css?v=20260821-4", "./public-stats.js?v=20260816-1", "./consent.js?v=20260821-2", "./script.js?v=20260821-3", "./manifest.json?v=20260818-1", "./assets/taskcore-logo.png", "./assets/coachella-valley-map.svg", "./assets/social/facebook-logo-primary.png", "./assets/social/instagram-glyph-white.svg", "./favicon.ico?v=20260818-1", "./assets/icons/taskcore-favicon-16.png?v=20260818-1", "./assets/icons/taskcore-favicon-32.png?v=20260818-1", "./assets/icons/taskcore-favicon-48.png?v=20260818-1", "./assets/icons/taskcore-apple-touch-icon.png?v=20260818-1", "./assets/icons/taskcore-icon-192.png", "./assets/icons/taskcore-icon-512.png", "./assets/icons/taskcore-icon-maskable-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.includes("/api/") ||
    url.pathname.endsWith("/config.js")
  ) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
