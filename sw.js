/**
 * Keet Service Worker
 * Story 3.1: Offline-first caching strategy
 * 
 * Strategy:
 * - App shell (HTML, CSS, JS): Cache-first, update in background
 * - Model files: Cache-first (large files, rarely change)
 * - API/Dynamic: Network-first with fallback
 * - Cross-origin isolation headers injected for SharedArrayBuffer / WebGPU support
 */

const CACHE_NAME = 'keet-v2';
const MODEL_CACHE = 'keet-models-v1';

// Base path from SW script URL (works at / and /keet/ on GitHub Pages)
const BASE = (() => {
    const path = self.location.pathname;
    const i = path.lastIndexOf('/');
    return i >= 0 ? path.slice(0, i + 1) : '/';
})();

// App shell files to pre-cache (base-relative)
const APP_SHELL = [
    BASE,
    BASE + 'index.html',
    BASE + 'manifest.json',
];

// Model file patterns (cached on-demand)
const MODEL_PATTERNS = [
    /\.onnx\.data$/,
    /\.onnx$/,
    /\.bin$/,
    /vocab\.txt$/,
    /tokenizer\.json$/,
];

/**
 * Add Cross-Origin Isolation headers to a response.
 * This enables SharedArrayBuffer and WebGPU on static hosts (e.g. GitHub Pages)
 * that don't allow custom response headers.
 * Equivalent to what coi-serviceworker.js does in the parakeet.js demo.
 */
function addCOIHeaders(response) {
    if (response.status === 0) {
        return response;
    }
    const newHeaders = new Headers(response.headers);
    newHeaders.set("Cross-Origin-Embedder-Policy", "require-corp");
    newHeaders.set("Cross-Origin-Resource-Policy", "cross-origin");
    newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");
    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: newHeaders,
    });
}

// Install event - pre-cache app shell
self.addEventListener('install', (event) => {
    console.log('[SW] Installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Pre-caching app shell');
                return cache.addAll(APP_SHELL);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean old caches
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating...');
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME && name !== MODEL_CACHE)
                        .map((name) => {
                            console.log('[SW] Deleting old cache:', name);
                            return caches.delete(name);
                        })
                );
            })
            .then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache or network, inject COI headers
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // Skip chrome-extension and other non-http(s) requests
    if (!url.protocol.startsWith('http')) return;

    // Check if this is a model file
    const isModelFile = MODEL_PATTERNS.some((pattern) => pattern.test(url.pathname));

    if (isModelFile) {
        // Model files: Cache-first (they're large and rarely change)
        event.respondWith(
            caches.open(MODEL_CACHE)
                .then((cache) => {
                    return cache.match(event.request)
                        .then((cached) => {
                            if (cached) {
                                console.log('[SW] Model from cache:', url.pathname);
                                return cached;
                            }
                            console.log('[SW] Fetching model:', url.pathname);
                            return fetch(event.request)
                                .then((response) => {
                                    if (response.ok) {
                                        cache.put(event.request, response.clone());
                                    }
                                    return response;
                                });
                        });
                })
        );
        return;
    }

    // App shell: Cache-first with network fallback + COI headers
    if (url.origin === self.location.origin) {
        event.respondWith(
            caches.match(event.request)
                .then((cached) => {
                    const fetchPromise = fetch(event.request)
                        .then((response) => {
                            if (response.ok) {
                                const responseClone = response.clone();
                                caches.open(CACHE_NAME)
                                    .then((cache) => cache.put(event.request, responseClone));
                            }
                            return addCOIHeaders(response);
                        })
                        .catch(() => cached);

                    return cached ? addCOIHeaders(cached) : fetchPromise;
                })
        );
        return;
    }

    // External resources: Network-first + COI headers
    event.respondWith(
        fetch(event.request)
            .then((response) => addCOIHeaders(response))
            .catch(() => caches.match(event.request))
    );
});

// Message handler for cache management
self.addEventListener('message', (event) => {
    if (event.data.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }

    if (event.data.type === 'CLEAR_MODEL_CACHE') {
        caches.delete(MODEL_CACHE)
            .then(() => {
                console.log('[SW] Model cache cleared');
                event.ports[0].postMessage({ success: true });
            });
    }
});
