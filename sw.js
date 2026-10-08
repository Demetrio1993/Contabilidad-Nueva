// Service worker: permite instalar la app y, si no hay internet, abrir la
// última versión guardada. Siempre intenta primero la red para que las
// actualizaciones lleguen. No guarda nada de Supabase ni de otros sitios.
const CACHE = 'contabilidad-v6';
const ARCHIVOS = ['./', 'index.html', 'styles.css', 'app.js', 'lib.js', 'terceros.js',
                  'transacciones.js', 'ocr.js', 'config.js', 'manifest.json',
                  'icon-192.png', 'icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.allSettled(ARCHIVOS.map((a) => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || caches.match('index.html')))
  );
});
