/**
 * AAC Map — Service Worker
 *
 * To publish a new version: change CACHE to a new name (e.g. 'aac-v2').
 * The browser will detect the changed SW file, install the new worker,
 * and then skipWaiting() activates it immediately. The current AAC session
 * is never force-reloaded; the latest shell appears on the next launch.
 */
const CACHE = 'aac-v25';

const CORE = ['./', './index.html', './ui-theme.css', './icon.svg', './manifest.json'];

// ── Install: pre-cache the shell ──────────────────────────────────────────────
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE).then(cache => cache.addAll(CORE))
    );
    // Activate immediately — don't wait for old tabs to close
    self.skipWaiting();
});

// ── Activate: remove stale caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(k => k.startsWith('aac-') && k !== CACHE).map(k => caches.delete(k))
            ))
            .then(() => self.clients.claim())
    );
});

// ── Fetch ─────────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
    const { request } = event;

    // Only handle GET requests over http(s)
    if (request.method !== 'GET') return;
    if (!request.url.startsWith('http')) return;

    const isLocal = new URL(request.url).origin === self.location.origin;

    if (isLocal) {
        // Network-first for the app's own files — always serves the latest version
        // and falls back to the cache only when offline.
        event.respondWith(
            fetch(request)
                .then(response => {
                    if (response.ok) {
                        const clone = response.clone();
                        caches.open(CACHE).then(c => c.put(request, clone));
                    }
                    return response;
                })
                .catch(() => caches.match(request))
        );
    } else {
        // Cache-first for external CDN resources (Tailwind, Lucide, Google Fonts)
        // — fast loads and offline-safe after first visit.
        event.respondWith(
            caches.match(request).then(cached => {
                if (cached) return cached;
                return fetch(request).then(response => {
                    if (response.ok || response.type === 'opaque') {
                        const clone = response.clone();
                        caches.open(CACHE).then(c => c.put(request, clone));
                    }
                    return response;
                });
            })
        );
    }
});
