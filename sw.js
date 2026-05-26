/* pocket service worker: cache the app shell for a more app-like phone/PWA launch. */

const CACHE_NAME = "pocket-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./phone.css",
  "./topbar.css",
  "./manifest.json",
  "./js/pocket-state.js",
  "./js/pocket-data.js",
  "./js/pocket-storage.js",
  "./js/pocket-import.js",
  "./js/pocket-editor-copy.js",
  "./js/pocket-history-status.js",
  "./js/pocket-tree-actions.js",
  "./js/pocket-render.js",
  "./js/pocket-io-browser.js",
  "./js/pocket-crypto.js",
  "./js/pocket-phone-mode.js",
  "./js/pocket-phone-tap.js",
  "./js/pocket-overlays-init.js",
  "./js/pocket-phone-menu.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached || caches.match("./index.html")))
  );
});
