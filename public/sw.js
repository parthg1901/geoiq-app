/* Geonaut service worker — offline shell, cached data/flags, cached Wikimedia photos. */
const VERSION = 'v10';
const SHELL = `geonaut-shell-${VERSION}`;
const STATIC = `geonaut-static-${VERSION}`;
const PHOTOS = `geonaut-photos-${VERSION}`;
const PHOTO_MAX = 300;
const PRECACHE = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  const keep = new Set([SHELL, STATIC, PHOTOS]);
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !keep.has(k)).map((k) => caches.delete(k)))) // this origin only holds our caches
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(PHOTOS);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok || res.type === 'opaque') {
        cache.put(req, res.clone()).then(() => trim(PHOTOS, PHOTO_MAX));
      }
      return res;
    })
    .catch(() => hit);
  if (hit) { event.waitUntil(net); return hit; }
  return net;
}

async function networkFirstNav(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/index.html', res.clone());
    return res;
  } catch {
    return (await cache.match('/index.html')) || (await cache.match('/')) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (req.mode === 'navigate') { event.respondWith(networkFirstNav(req)); return; }

  if (url.hostname === 'upload.wikimedia.org') { event.respondWith(staleWhileRevalidate(event)); return; }

  if (url.origin === self.location.origin) {
    const p = url.pathname;
    if (p.startsWith('/data/') || p.startsWith('/flags/') || p.startsWith('/assets/') || /\.(woff2?|ttf)$/.test(p) || p.startsWith('/icon')) {
      event.respondWith(cacheFirst(req));
    }
  }
});
