// IMPORTANTE: cada vez que cambies cualquier archivo de la app, sube este número
// (v7 -> v8 ...). Con Cache-First, es la única forma de que los usuarios reciban
// la versión nueva.
const CACHE = 'kegel-cache-v7';

// Todo lo que la app necesita para funcionar sin internet.
const FILES = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './fonts/inter-latin.woff2',
  './fonts/jetbrains-mono-latin.woff2',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// Instalación: guarda todos los archivos en caché desde la primera carga.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

// Activación: borra cachés de versiones anteriores y toma control de inmediato.
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Cache-First: responde desde la caché; solo va a la red si el archivo no está.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(cached => {
      if (cached) return cached;

      return fetch(req)
        .then(res => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Sin internet y sin caché: si es una navegación, muestra la app.
          if (req.mode === 'navigate') return caches.match('./index.html');
          return Response.error();
        });
    })
  );
});
