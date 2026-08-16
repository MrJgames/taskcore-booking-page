const CACHE_NAME = "taskcore-v3-20260815-booking";
const STATIC_ASSETS = ["./", "./index.html", "./styles.css?v=20260730-1", "./script.js?v=20260730-1", "./booking.js?v=20260815-1", "./booking-flow-core.mjs", "./config.js?v=20260720-4", "./manifest.json", "./assets/favicon.svg", "./assets/icons/icon-192.png", "./assets/icons/icon-512.png", "./assets/icons/icon-maskable-512.png", "./assets/icons/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.includes("/api/") || url.hostname.includes("square")) return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone(); caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)); return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./index.html"))));
});
