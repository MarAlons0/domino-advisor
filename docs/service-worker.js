// Update CACHE_NAME whenever the app version bumps (keep in sync with index.html and translations.js)
const CACHE_NAME = '7fichas-v1.0.1';

const CORE_ASSETS = [
    './',
    './css/styles.css',
    './js/main.js',
    './img/genin-advising.png',
    './img/genin-celebrating.png',
    './img/genin-questioning.png',
    './img/genin-thinking.png',
    './icons/icon.svg',
    './manifest.json'
];

// Install: pre-cache core assets
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: delete old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Fetch: cache-first with network fallback; cache successful responses
self.addEventListener('fetch', event => {
    const { request } = event;

    // Skip non-GET and cross-origin requests
    if (request.method !== 'GET') return;
    if (!request.url.startsWith(self.location.origin)) return;

    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            return fetch(request).then(response => {
                // Only cache valid responses
                if (!response || response.status !== 200 || response.type !== 'basic') {
                    return response;
                }
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(request, responseToCache));
                return response;
            });
        })
    );
});
