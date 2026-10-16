// Nurture service worker: offline shell (ARCHITECTURE §9).
//
//  - install: precache EVERY shipped file with cache: 'reload', so a new
//    worker never re-caches a stale HTTP-cached copy of the old release.
//    tests/sw-assets.test.js fails if a file under js/, css/, fonts/ or
//    icons/ is missing here (or listed but missing on disk).
//  - fonts + icons: cache-first (immutable; filenames change when they do).
//  - HTML / JS / CSS / manifest: network-first with a short timeout, so a
//    deploy reaches people on the next load, and the cached copy serves
//    offline (or on hospital wifi that never answers).
//  - Same-origin only. The app makes no third-party requests, so the worker
//    never touches anything cross-origin.
const CACHE_NAME = 'nurture-v2.0.0-dev';
const NETWORK_TIMEOUT_MS = 4000;

const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/base.css',
  './css/components.css',
  './css/sheets/diaper.css',
  './css/sheets/event.css',
  './css/sheets/feed.css',
  './css/sheets/memory.css',
  './css/sheets/pump.css',
  './css/sheets/quicklog.css',
  './css/sheets/sleep.css',
  './css/sheets/stash.css',
  './css/tokens.css',
  './css/views/memories.css',
  './css/views/onboarding.css',
  './css/views/report.css',
  './css/views/settings.css',
  './css/views/stash.css',
  './css/views/timeline.css',
  './css/views/today.css',
  './fonts/OFL-Fraunces.txt',
  './fonts/OFL-Nunito.txt',
  './fonts/fraunces-soft-latin-italic-400.woff2',
  './fonts/fraunces-soft-latin-wght-opsz.woff2',
  './fonts/nunito-latin-wght.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon.svg',
  './js/app.js',
  './js/theme-boot.js',
  './js/core/audio.js',
  './js/core/backup.js',
  './js/core/db.js',
  './js/core/ics.js',
  './js/core/migrate.js',
  './js/core/persist.js',
  './js/core/photos.js',
  './js/core/reminders.js',
  './js/core/settings.js',
  './js/core/stash.js',
  './js/core/store.js',
  './js/core/time.js',
  './js/core/units.js',
  './js/domain/inventory.js',
  './js/domain/safety.js',
  './js/domain/sleep.js',
  './js/domain/trends.js',
  './js/sheets/diaper.js',
  './js/sheets/event.js',
  './js/sheets/feed.js',
  './js/sheets/memory.js',
  './js/sheets/pump.js',
  './js/sheets/quickLog.js',
  './js/sheets/sleep.js',
  './js/sheets/stash.js',
  './js/ui/confirm.js',
  './js/ui/format.js',
  './js/ui/html.js',
  './js/ui/icons.js',
  './js/ui/livePill.js',
  './js/ui/router.js',
  './js/ui/sheet.js',
  './js/ui/toast.js',
  './js/views/memories.js',
  './js/views/onboarding.js',
  './js/views/report.js',
  './js/views/settings.js',
  './js/views/stash.js',
  './js/views/timeline.js',
  './js/views/today.js',
];

const CACHE_FIRST = /\/(fonts|icons)\//;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function cachePut(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') return;
  const copy = response.clone();
  caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  cachePut(request, response);
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('network timeout')), NETWORK_TIMEOUT_MS)),
    ]);
    cachePut(request, response);
    return response;
  } catch (err) {
    const cached = (await caches.match(request, { ignoreSearch: request.mode === 'navigate' }))
      || (fallbackUrl && await caches.match(fallbackUrl));
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never handle cross-origin
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './index.html'));
    return;
  }
  event.respondWith(CACHE_FIRST.test(url.pathname) ? cacheFirst(request) : networkFirst(request));
});

// Local pump reminder notifications (core/reminders.js): focus the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) if ('focus' in client) return client.focus();
      return self.clients.openWindow ? self.clients.openWindow('./') : undefined;
    }),
  );
});
