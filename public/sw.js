// Service worker: makes Roomy work offline once it has been opened.
//
// - Pages (navigations) are network-first, so a new version is picked up as
//   soon as there is a connection, with the cached copy as the fallback.
// - Everything else from this site is cache-first. Vite gives built files a
//   content hash in their names, so a cached file never goes stale.
// Paths are relative so it works from a sub-folder (e.g. GitHub Pages).

const CACHE = 'roomy-v1';
const SHELL = ['./', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key.startsWith('roomy-') && key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) {
        return;
    }
    event.respondWith(request.mode === 'navigate' ? networkFirst(request) : cacheFirst(request));
});

async function networkFirst(request) {
    const cache = await caches.open(CACHE);
    try {
        const response = await fetch(request);
        if (response.ok) {
            await cache.put('./', response.clone());
        }
        return response;
    } catch (err) {
        const cached = await cache.match('./');
        if (cached) {
            return cached;
        }
        throw err;
    }
}

async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request);
    if (cached) {
        return cached;
    }
    const response = await fetch(request);
    if (response.ok) {
        await cache.put(request, response.clone());
    }
    return response;
}
