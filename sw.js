const CACHE_NAME = 'dakani-pos';

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './license.js',
    './database.js',
    './barcode.js',
    './camera-scanner.js',
    './backup.js',
    './script.js',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&family=Inter:wght@300;400;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js'
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
