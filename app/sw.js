// Service worker: guarda la app y los modelos para que funcione sin internet.
// Sube VERSION cada vez que cambies archivos de la app o de los modelos.
const VERSION = 'v3';
const CACHE = `bioplant-${VERSION}`;

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/model-adapter.js',
  './js/history-db.js',
  './js/camera.js',
  './js/icons.js',
  './data/diseases.json',
  './vendor/tf.min.js',
  './fonts/outfit-latin-wght.woff2',
  './fonts/outfit-latin-ext-wght.woff2',
  './icons/logo.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

const MODEL_DIRS = ['./models/filtro-cacao/', './models/estado-cacao/'];

// Lee cada model.json para saber qué shards .bin hay que guardar; así no hay
// que tocar este archivo si el modelo nuevo tiene otro número de shards.
async function modelFiles() {
  const files = [];
  for (const dir of MODEL_DIRS) {
    const res = await fetch(dir + 'model.json', { cache: 'no-cache' });
    const json = await res.json();
    files.push(dir + 'model.json', dir + 'metadata.json');
    for (const group of json.weightsManifest) for (const p of group.paths) files.push(dir + p);
  }
  return files;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll([...SHELL, ...(await modelFiles())]);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('bioplant-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Primero la caché; si no está, red (y se guarda para la próxima vez).
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch (err) {
      if (request.mode === 'navigate') return cache.match('./index.html');
      throw err;
    }
  })());
});
