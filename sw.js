// Overspray's offline worker. It keeps a copy of every file the app loads, so
// the app still opens without a network.
//
// Each deploy bumps the version in version.js, which names a new cache below.
// The browser sees the worker has changed; the app saves, tells it to take
// over, and reloads once.

importScripts('./version.js');
// The scope is in the name: the live site and the test copy (/_lab/overspray)
// share one origin, so one must not clear the other's cache.
const SCOPE = self.registration.scope;
const CACHE = 'overspray-' + self.VERSION + ' ' + SCOPE;

// Kept at install: the page, the version and the icons, so the app can start
// offline straight away. Every path here must exist in the repo, or the
// install fails. Everything else is kept the first time it is fetched.
const START_FILES = [
  './', './index.html', './version.js', './manifest.webmanifest', './icon.svg',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-192-maskable.png', './icons/icon-512-maskable.png',
];

// no skipWaiting here: the page sends SKIP_WAITING once it has saved
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(START_FILES))));

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

// A cache this worker should remove: an older version of this copy of the app,
// or one from before the scope was in the name (no space), or from when the app
// was called Clearcoat.
const stale = (name) => name !== CACHE && (name.startsWith('clearcoat-')
  || (name.startsWith('overspray-') && (!name.includes(' ') || name.endsWith(' ' + SCOPE))));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const name of await caches.keys()) if (stale(name)) await caches.delete(name);
  await self.clients.claim();
})()));

// From the network, keeping a copy; the kept copy when there is no network.
async function fresh(req, opts) {
  try {
    const res = await fetch(req, opts);
    if (res?.ok) (await caches.open(CACHE)).put(req, res.clone());
    return res;
  } catch (err) {
    const kept = await caches.match(req);
    if (!kept) throw err;
    return kept;
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return; // anything else goes straight to the network
  // The app's own files skip the browser's HTTP cache, so a deploy shows on the
  // next reload. Other sites (Google Fonts, the icon search) use it as usual.
  // ponytail: network first costs a round trip per file on every load;
  // precache the app and serve it cache-first if load time ever matters.
  const own = new URL(e.request.url).origin === self.location.origin;
  e.respondWith(fresh(e.request, own ? { cache: 'no-cache' } : undefined));
});
