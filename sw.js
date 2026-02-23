// Service Worker — Cache app shell only, NOT PDFs
const CACHE_NAME = 'mangacloud-v1';
const SHELL_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json'
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
// - App shell: cache-first
// - GitHub API / PDF downloads: network-only (never cache)
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Never cache GitHub API calls or PDF data
    if (url.hostname === 'api.github.com' || url.pathname.endsWith('.pdf')) {
        event.respondWith(fetch(event.request));
        return;
    }

    // Cache-first for app shell assets
    event.respondWith(
        caches.match(event.request).then(cached => cached || fetch(event.request))
    );
});
