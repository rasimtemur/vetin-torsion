const CACHE_NAME = 'vetin-torsion-v4';
const ASSETS = [
    './index.html',
    './style.css',
    './calc.js',
    './script.js',
    './draw2d.js',
    './io.js',
    './app-api.js',
    './script3d.js',
    './translations.js',
    './vendor/three.min.js',
    './icon.svg',
    './logo.svg',
    './IUC.svg',
    './icon-192.png',
    './icon-512.png',
    './manifest.json'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys => Promise.all(
            keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
        ))
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    if (!event.request.url.startsWith('http')) return;
    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (!response || response.status !== 200 || response.type !== 'basic') return response;
                const clone = response.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

self.addEventListener('message', (event) => {
    // event.data bos gelebilir (baska bir kaynaktan postMessage)
    if (event.data && event.data.action === 'skipWaiting') self.skipWaiting();
});
