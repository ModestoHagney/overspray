// Overspray service worker: versioned cache, so the app opens offline.
//
// On every deploy the version in version.js is bumped. It names a new cache
// here; the app sees the new worker, saves, and reloads itself once to take it.

importScripts('./version.js');
const CACHE = 'overspray-' + self.VERSION;

// The app's page and the icons. Every path here must exist in the repo, or
// the worker fails to install. The rest of the app is not listed: it is
// fetched fresh and kept as it goes, see below.
const PRECACHE = [
  './',
  './index.html',
  './version.js',
  './manifest.webmanifest',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-192-maskable.png',
  './icons/icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  // no skipWaiting here: the page asks for it (the SKIP_WAITING message
  // below) once it has saved
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => (n.startsWith('overspray-') || n.startsWith('clearcoat-')) && n !== CACHE) // clearcoat-: what the app was called before
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// from the network, kept as it is fetched; the kept copy when there is no network
async function fresh(req, opts) {
  try {
    const res = await fetch(req, opts);
    if (res && res.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept non-GET

  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    // Everything the app loads comes fresh from the network, so a deploy
    // shows up on the next reload; each file is kept as it is fetched, and
    // the kept copy is used when there is no network.
    // ponytail: network first costs a round trip per file on every load;
    // precache the app and serve it cache-first if load time ever matters.
    event.respondWith(fresh(req, { cache: 'no-cache' }));
  } else {
    // cross-origin (Google Fonts, the icon search): the same, never precached
    event.respondWith(fresh(req));
  }
});
