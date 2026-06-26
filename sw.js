const CACHE_NAME = 'dakani-pos';
ي
const ASSETS = [
    './',
    './index.html',
    './style.css',
    './license.js',
    './database.js',
    './script.js',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&family=Inter:wght@300;400;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css'
];

// التثبيت
self.addEventListener('install', event => {
    self.skipWaiting();

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(ASSETS))
    );
});

// التفعيل
self.addEventListener('activate', event => {
    event.waitUntil(clients.claim());
});

// استراتيجيتك الذكية: Network First الديناميكية التلقائية
self.addEventListener('fetch', event => {

    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(response => {

                const responseClone = response.clone();

                caches.open(CACHE_NAME)
                    .then(cache => {
                        cache.put(event.request, responseClone);
                    });

                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});
