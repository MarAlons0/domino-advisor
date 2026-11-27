// Update CACHE_NAME whenever the app version bumps (keep in sync with index.html and translations.js)
const CACHE_NAME = '7fichas-v1.22.4';

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
            // 'reload' skips the browser's HTTP cache (Pages sends max-age=600), so a new
            // version never pre-caches files left over from the previous one.
            .then(cache => cache.addAll(CORE_ASSETS.map(url => new Request(url, { cache: 'reload' }))))
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

// Fetch strategy:
//  - Navigations (the HTML document): NETWORK-FIRST, so returning users always get
//    the latest app shell on the first load; fall back to the cached shell offline.
//  - Other assets (CSS/JS/images): cache-first for speed. Only main.js and styles.css
//    carry ?v=; the other modules rely on CACHE_NAME changing every release (old caches
//    are dropped on activate) and on index.html reloading once when this worker takes over.
//  - Both retry a server hiccup (below).

// One file the server fails to send stops the app from starting (GitHub Pages has
// answered 503 for a module right after a deploy), so a 5xx or no answer at all is
// tried again, twice, after a short wait. The last answer is used as it is.
const RETRY_DELAYS_MS = [400, 1200];

async function fetchWithRetry(request, init) {
    for (let attempt = 0; ; attempt++) {
        const last = attempt >= RETRY_DELAYS_MS.length;
        try {
            const response = await fetch(request, init);
            if (response.status < 500 || last) return response;
        } catch (err) {
            if (last) throw err;
        }
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
}

self.addEventListener('fetch', event => {
    const { request } = event;

    // Skip non-GET and cross-origin requests
    if (request.method !== 'GET') return;
    if (!request.url.startsWith(self.location.origin)) return;

    // Network-first for navigation requests (the root document).
    if (request.mode === 'navigate') {
        const cachedShell = () => caches.match(request).then(cached => cached || caches.match('./'));
        event.respondWith(
            fetchWithRetry(request)
                .then(response => {
                    // Still a server error: the cached app beats an error page.
                    if (response.status >= 500) return cachedShell().then(cached => cached || response);
                    if (response.status === 200 && response.type === 'basic') {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
                    }
                    return response;
                })
                .catch(cachedShell)
        );
        return;
    }

    // Cache-first with network fallback for everything else; cache successful responses.
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            // 'no-cache' revalidates with the server instead of trusting the HTTP cache.
            return fetchWithRetry(request, { cache: 'no-cache' }).then(response => {
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
