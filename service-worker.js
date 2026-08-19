/* OneTap Counter — service worker
   Offline-first app with reliable updates. */

const CACHE_NAME = "onetap-cache-v7";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const request = event.request;

  // Always try the network first for navigations and app files.
  // This prevents an old deployed version from being stuck in cache.
  const isAppFile =
    request.mode === "navigate" ||
    request.url.endsWith("/index.html") ||
    request.url.endsWith("/style.css") ||
    request.url.endsWith("/script.js") ||
    request.url.endsWith("/manifest.json");

  if (isAppFile) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then((cache) => cache.put(request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match(request)
          .then((cached) => cached || caches.match("./index.html")))
    );
    return;
  }

  // Other resources use cache first.
  event.respondWith(
    caches.match(request)
      .then((cached) => {
        if (cached) return cached;

        return fetch(request)
          .then((response) => {
            if (
              response &&
              response.ok &&
              request.url.startsWith(self.location.origin)
            ) {
              const clone = response.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(request, clone))
                .catch(() => {});
            }
            return response;
          })
          .catch(() => Response.error());
      })
  );
});
