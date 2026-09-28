const VERSION = "13.1.3";
const STATIC_CACHE = `lipfty-static-v${VERSION}`;
const RUNTIME_CACHE = `lipfty-runtime-v${VERSION}`;
const APP_SHELL = [
  "./", "./index.html", "./offline.html", "./css/style.css", "./css/lipfty8-layout.css",
  "./js/app.js", "./js/rules.js", "./manifest.json", "./package.json",
  "./release.json", "./build-info.json", "./Lipfty-Rules.pdf",
  "./icons/lipfty-96.png", "./icons/lipfty-128.png", "./icons/lipfty-144.png", "./icons/lipfty-152.png",
  "./icons/lipfty-180.png", "./icons/lipfty-192.png", "./icons/lipfty-384.png", "./icons/lipfty-512.png",
  "./icons/lipfty-maskable-192.png", "./icons/lipfty-maskable-512.png"
];

self.addEventListener("install", event => {
  // Stay waiting until the user explicitly chooses Update.
  event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => ![STATIC_CACHE, RUNTIME_CACHE].includes(key))
          .map(key => caches.delete(key))
      )
    ),
    self.clients.claim()
  ]));
});

self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigation is network-first so reopening the PWA discovers the latest shell.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then(cache => cache.put("./index.html", copy));
          return response;
        })
        .catch(async () => (await caches.match("./index.html")) || caches.match("./offline.html"))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;

  // JS/CSS/JSON are network-first so a new GitHub Pages deployment is not
  // hidden indefinitely behind an old cached copy.
  const isCoreAsset = /\.(?:js|css|json)$/.test(url.pathname);
  if (isCoreAsset) {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(response => {
          if (response.ok) {
            caches.open(STATIC_CACHE).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Images, the printable rules and other static assets remain cache-first with background refresh.
  event.respondWith(
    caches.match(request).then(cached => {
      const update = fetch(request)
        .then(response => {
          if (response.ok) {
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || update;
    })
  );
});
