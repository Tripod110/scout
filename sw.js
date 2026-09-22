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

const VERSION = 16;
const CACHE = 'scout-v' + VERSION;

const SHELL = [
  './', 'index.html',
  'style.css?v=16',
  'config.js?v=16', 'params.js?v=16', 'store.js?v=16', 'ui.js?v=16', 'sync.js?v=16', 'push.js?v=16',
  'onboard.js?v=16', 'today.js?v=16', 'app.js?v=16',
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
    /* cache:'no-store' so the network-first path can't be satisfied by the
       browser's own HTTP cache. index.html is the one file that must never be
       stale — it carries the ?v=N references that pin every other asset — and
       a conditional revalidation is cheap on a file this small.

       Belt and braces rather than a fix for an observed bug: the stale load
       that prompted this turned out to be the dev server being down, which is
       the cache fallback working correctly. */
    e.respondWith(
      fetch(req.url, { cache: 'no-store' })
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

/* ---------- push ----------
   iOS allows no silent pushes: every message must result in a visible
   notification or the subscription is revoked. So there is no branch here that
   chooses not to show one. */

self.addEventListener('push', e => {
  let data = {};
  try { data = e.data ? e.data.json() : {}; } catch { /* fall through to defaults */ }
  e.waitUntil(self.registration.showNotification(data.title || 'Scout', {
    body: data.body || 'Time for a toilet break.',
    icon: 'icons/icon-192.png',
    badge: 'icons/icon-192.png',
    tag: data.tag || 'scout',
    renotify: false
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.includes(self.registration.scope)) return c.focus();
    }
    return self.clients.openWindow(self.registration.scope);
  })());
});
