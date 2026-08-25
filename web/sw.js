/**
 * Offline support.
 *
 * The promise is that the game works with the network off, so the shell is
 * cached on install and served cache-first. Cache-first (not
 * network-first) because none of these files change between deploys without
 * the version below changing too — and a puzzle that stalls on a slow
 * connection has broken its promise even if it eventually loads.
 */

const VERSION = 'blockfall-v1';

const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/base.css',
  'styles/skins.css',
  'src/main.js',
  'src/i18n.js',
  'src/strings.gen.js',
  'src/core/engine.js',
  'src/core/pieces.js',
  'src/core/rng.js',
  'src/core/storage.js',
  'src/ui/board.js',
  'src/ui/drag.js',
  'assets/icons/favicon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll is all-or-nothing; a single 404 would leave no cache at all.
      .then((cache) => Promise.allSettled(SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  // Same-origin only: there is nothing third-party to cache, by design.
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => caches.match('index.html'));
    })
  );
});
