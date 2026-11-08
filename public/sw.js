// Benchzy service worker.
// Scope, stated honestly: it caches what a visitor's browser has actually
// loaded from this site, nothing more. Pages are network-first with a
// cached fallback (so a page you have visited can open again offline).
// Engine assets (the background-removal model pieces, the WASM runtimes,
// the PDF/OCR/image engines) are cache-first, so a returning device does
// not download them again. It never sees the visitor's files: file jobs
// run in page memory and no request carries them.
const CACHE = 'benchzy-v1';
const ENGINE_PREFIXES = ['/models/', '/ort/', '/codecs/', '/pdfjs/', '/tesseract/'];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => hit);
  return hit || fresh;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(networkFirst(e.request));
    return;
  }
  if (ENGINE_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
  e.respondWith(staleWhileRevalidate(e.request));
});
