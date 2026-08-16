const CACHE_NAME = 'dakani-pos-v12-p2p-sync';

const ASSETS = [
    './',
    './index.html',
    './style.css',
    './i18n.js',
    './security-utils.js',
    './license.js',
    './database.js',
    './barcode.js',
    './camera-scanner.js',
    './backup.js',
    './cloud-folder-sync.js',
    './csv-import.js',
    './product-image-import.js',
    './supplier-invoice-import.js',
    './script.js',
    './accounts.js',
    './keyboard-shortcuts.js',
    './cashbox.js',
    './ai-insights.js',
    './online-sync.js',
    './icon-192.png',
    './icon-512.png',
    'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&family=Inter:wght@300;400;600;700&display=swap',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css',
    'https://cdn.jsdelivr.net/npm/chart.js',
    'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
    'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js',
    'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js',
    'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js',
    'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js'
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
    event.waitUntil(
        caches.keys()
            .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
            .then(() => clients.claim())
    );
});

// استراتيجيتك الذكية: Network First الديناميكية التلقائية
self.addEventListener('fetch', event => {

    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request)
            .then(response => {

                // لا نخزّن استجابات الأخطاء (404/500...) من نفس الموقع، لأن تخزينها
                // كان سيجعل الصفحة "تعلق" على نسخة معطوبة عند العمل بدون إنترنت لاحقاً.
                // نستثني الاستجابات "opaque" (type === 'opaque') لأنها طبيعية لطلبات
                // CDN عبر النطاقات الخارجية (لا يمكن قراءة status لها، وهذا متوقع).
                const isCacheable = response.type === 'opaque' || response.ok;
                if (isCacheable) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME)
                        .then(cache => {
                            cache.put(event.request, responseClone);
                        });
                }

                return response;
            })
            .catch(() => {
                return caches.match(event.request);
            })
    );
});