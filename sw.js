/**
 * GridFlowAAC service worker.
 *
 * Shell updates use a versioned cache. Selected/static assets use a separate,
 * bounded cache that survives shell updates so an AAC board does not lose its
 * symbols merely because a new app release was installed.
 */
const SHELL_CACHE = 'aac-shell-v30';
const ASSET_CACHE = 'aac-assets-v1';
const MAX_ASSET_ENTRIES = 400;

const CORE = [
    './',
    './index.html',
    './ui-theme.css',
    './icon.svg',
    './icon-192.png',
    './icon-512.png',
    './apple-touch-icon.png',
    './manifest.json'
];
const OPTIONAL_SHELL = [
    'https://cdn.tailwindcss.com',
    'https://unpkg.com/lucide@0.460.0',
    'https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Poppins:wght@400;500;600;700&display=swap'
];

async function cacheOptionalShell(cache) {
    await Promise.allSettled(OPTIONAL_SHELL.map(async url => {
        const response = await fetch(url);
        if (response.ok || response.type === 'opaque') await cache.put(url, response);
    }));
}

async function trimCache(cache, maxEntries) {
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    await Promise.all(keys.slice(0, keys.length - maxEntries).map(key => cache.delete(key)));
}

self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(CORE);
        // CDN failures must not block installation; system fonts and the
        // already-authored CSS remain usable as a degraded fallback.
        await cacheOptionalShell(cache);
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(keys
            .filter(key =>
                (key.startsWith('aac-shell-') && key !== SHELL_CACHE)
                || /^aac-v\d+$/.test(key)
            )
            .map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});

async function matchNamedCache(cacheName, request) {
    try {
        const cache = await caches.open(cacheName);
        return await cache.match(request);
    } catch (_) {
        return undefined;
    }
}

async function matchLocalFallback(request) {
    const cached = await matchNamedCache(SHELL_CACHE, request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
        return await matchNamedCache(SHELL_CACHE, './index.html');
    }
    return undefined;
}

async function networkFirstLocal(request) {
    let response;
    try {
        response = await fetch(request);
    } catch (networkError) {
        const fallback = await matchLocalFallback(request);
        if (fallback) return fallback;
        throw networkError;
    }

    if (response.ok) {
        try {
            const shell = await caches.open(SHELL_CACHE);
            await shell.put(request, response.clone());
        } catch (_) {
            // A usable network response must not be lost to a cache failure.
        }
        return response;
    }

    const fallback = await matchLocalFallback(request);
    return fallback || response;
}

async function cacheFirstAsset(request) {
    const shellMatch = await matchNamedCache(SHELL_CACHE, request);
    if (shellMatch) return shellMatch;

    const assetMatch = await matchNamedCache(ASSET_CACHE, request);
    if (assetMatch) return assetMatch;

    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
        try {
            const assets = await caches.open(ASSET_CACHE);
            await assets.put(request, response.clone());
            await trimCache(assets, MAX_ASSET_ENTRIES);
        } catch (_) {
            // A usable network response must not be lost to a cache failure.
        }
    }
    return response;
}

self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET' || !request.url.startsWith('http')) return;

    const url = new URL(request.url);
    if (url.origin === self.location.origin) {
        event.respondWith(networkFirstLocal(request));
        return;
    }

    // Cache presentation assets, not API/search responses. This keeps the
    // runtime cache bounded and preserves selected symbol images offline.
    if (['image', 'font', 'script', 'style'].includes(request.destination)) {
        event.respondWith(cacheFirstAsset(request));
    }
});
