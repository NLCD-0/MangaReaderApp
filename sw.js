// Service Worker — Cache app shell only, NOT PDFs
const CACHE_NAME = 'mangacloud-v2';
const SHELL_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './ao3_icon.png'
];

// Install — cache the app shell
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_ASSETS))
    );
    self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// Fetch strategy:
// - App shell: stale-while-revalidate (fast load + background update)
// - GitHub API / PDF downloads: network-only (never cache)
// - CDN assets (pdf.js, fonts): cache-first
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Never cache GitHub API calls or PDF data
    if (url.hostname === 'api.github.com' || url.pathname.endsWith('.pdf')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first for CDN assets (pdf.js, fonts)
    if (url.hostname === 'cdnjs.cloudflare.com' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
        event.respondWith(
            caches.match(event.request).then(cached => {
                if (cached) return cached;
                return fetch(event.request).then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                    }
                    return response;
                });
            })
        );
        return;
    }

    // Stale-while-revalidate for app shell
    event.respondWith(
        caches.match(event.request).then(cached => {
            const fetchPromise = fetch(event.request).then(response => {
                if (response.ok) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            }).catch(() => cached);

            return cached || fetchPromise;
        })
    );
});
