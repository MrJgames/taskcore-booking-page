const CACHE_NAME = "taskcore-v13-20260821-service-card";
const STATIC_ASSETS = ["./", "./index.html", "./styles.css?v=20260821-1", "./public-stats.js?v=20260816-1", "./script.js?v=20260820-1", "./manifest.json?v=20260818-1", "./assets/taskcore-logo.png", "./assets/coachella-valley-map.svg", "./favicon.ico?v=20260818-1", "./assets/icons/taskcore-favicon-16.png?v=20260818-1", "./assets/icons/taskcore-favicon-32.png?v=20260818-1", "./assets/icons/taskcore-favicon-48.png?v=20260818-1", "./assets/icons/taskcore-apple-touch-icon.png?v=20260818-1", "./assets/icons/taskcore-icon-192.png", "./assets/icons/taskcore-icon-512.png", "./assets/icons/taskcore-icon-maskable-512.png"];

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
