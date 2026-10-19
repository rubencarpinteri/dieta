// Offline support: the app shell is cached; Open Food Facts calls always go to the network.
const CACHE = 'dieta-v24';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'src/styles.css', 'src/app.js', 'src/store.js', 'vendor/preact-htm.js', 'data/products.json',
  'src/lib/additives.js', 'src/lib/nutriscore.js', 'src/lib/scoring.js', 'src/lib/targets.js', 'src/lib/units.js',
  'src/lib/recipes.js', 'src/lib/planner.js', 'src/lib/shopping.js', 'src/lib/off.js', 'src/lib/fitdays.js', 'src/icons.js', 'src/lib/presets.js', 'src/sync.js', 'src/firebase-config.js', 'icons/icon.svg', 'icons/icon-180.png',
];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
));

// Network first for our own files (so updates arrive), cache as fallback when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
