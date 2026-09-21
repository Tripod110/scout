/* Scout service worker.
 *
 * Split by request type, because the two goals genuinely conflict:
 *
 *   - Navigations (HTML) are NETWORK-FIRST. index.html carries the ?v=N asset
 *     references, so it is the one file that must never be stale — serving an
 *     old copy pins the entire app to an old version.
 *   - Versioned assets (?v=N) are CACHE-FIRST. Their URL changes whenever the
 *     content does, so a cache hit is always correct, and a cold start on bad
 *     signal doesn't wait on the network before it can paint.
 *
 * BUMP THE VERSION IN BOTH PLACES. `node tools/release.mjs` does it and refuses
 * to let them drift; doing it by hand is how a release silently ships nothing.
 */

const VERSION = 6;
const CACHE = 'scout-v' + VERSION;

const SHELL = [
  './', 'index.html',
  'style.css?v=6',
  'params.js?v=6', 'store.js?v=6', 'ui.js?v=6',
  'onboard.js?v=6', 'today.js?v=6', 'app.js?v=6',
  'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/icon-maskable-512.png'
];

self.addEventListener('install', e => {
  // cache:'reload' bypasses the browser's HTTP cache, so the SW stores genuinely
  // fresh copies — otherwise a stale HTTP-cached file gets re-saved under the
  // new cache name and the update never actually lands.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u =>
        fetch(new Request(u, { cache: 'reload' }))
          .then(r => r.ok ? c.put(u, r) : null)
          .catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(r => {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put('index.html', copy)).catch(() => {});
          return r;
        })
        .catch(() => caches.match('index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  if (url.search.includes('v=')) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return r;
      }))
    );
    return;
  }

  e.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
