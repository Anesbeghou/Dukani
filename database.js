/**
 * DAKANI DATABASE ENGINE (IndexedDB Version)
 * Uses IndexedDB for persistence and an in-memory cache for synchronous operations.
 * Tables: products, categories, customers, sales, sale_items, purchases, settings
 */

const DB = (() => {
  const PREFIX = 'dakani_';
  
  // ─── Memory Cache ───────────────────────────────────────────────────────────
  // نحتفظ بالبيانات هنا لكي تبقى الدوال المتزامنة (Sync) تعمل دون مشاكل
  const cache = {
    seeded: [],
    settings: {},
    categories: [],
    products: [],
    customers: [],
    sales: [],
    sale_items: [],
    purchases: []
  };

  // ─── IndexedDB Core ─────────────────────────────────────────────────────────
  const idb = {
    db: null,
    init() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open('DakaniDB', 1);
        req.onupgradeneeded = e => {
          e.target.result.createObjectStore('keyval');
        };
        req.onsuccess = e => {
          this.db = e.target.result;
          resolve();
        };
        req.onerror = e => reject(e.target.error);
      });
    },
    get(key) {
      return new Promise(resolve => {
        try {
          const tx = this.db.transaction('keyval', 'readonly');
          const req = tx.objectStore('keyval').get(key);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(undefined);
        } catch(e) { resolve(undefined); }
      });
    },
    set(key, val) {
      return new Promise(resolve => {
        try {
          const tx = this.db.transaction('keyval', 'readwrite');
          const req = tx.objectStore('keyval').put(val, key);
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        } catch(e) { resolve(); }
      });
    },
    clearAll() {
      return new Promise(resolve => {
        try {
          const tx = this.db.transaction('keyval', 'readwrite');
          const req = tx.objectStore('keyval').clear();
          req.onsuccess = () => resolve();
          req.onerror = () => resolve();
        } catch(e) { resolve(); }
      });
    }
  };

  // ─── Core Helpers ───────────────────────────────────────────────────────────
  const read  = key => cache[key];
  const write = (key, val) => {
    cache[key] = val; // تحديث الذاكرة فوراً للواجهة
    idb.set(PREFIX + key, val); // الحفظ في IndexedDB في الخلفية
  };
  const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now   = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);

  // ─── App Initialization Interceptor ─────────────────────────────────────────
  // هذه الحيلة تؤخر حدث DOMContentLoaded حتى يتم جلب البيانات من IndexedDB
  // لكي يعمل script.js بسلاسة وبدون أي تعديل عليه.
  const originalAddEventListener = document.addEventListener;
  const deferredListeners = [];
  let isReady = false;

  document.addEventListener = function(type, listener, options) {
    if (type === 'DOMContentLoaded' && !isReady) {
      deferredListeners.push(listener);
    } else {
      originalAddEventListener.call(document, type, listener, options);
    }
  };

  async function boot() {
    await idb.init();
    
    // سحب كل البيانات المحفوظة إلى الذاكرة المؤقتة
    const keys = Object.keys(cache);
    for (let k of keys) {
      const val = await idb.get(PREFIX + k);
      if (val !== undefined) cache[k] = val;
    }

    seed(); // تهيئة القيم الافتراضية إذا كانت فارغة
    
    isReady = true;
    document.addEventListener = originalAddEventListener;

    const fire = () => deferredListeners.forEach(fn => fn({type: 'DOMContentLoaded'}));
    if (document.readyState === 'loading') {
      originalAddEventListener.call(document, 'DOMContentLoaded', fire);
    } else {
      fire();
    }
  }
  
  // ─── License Gate ────────────────────────────────────────────────────────────
  // يتحقق من الترخيص قبل تشغيل أي شيء
  // إذا لم يكن مرخصاً → تُعلَّق حدث DOMContentLoaded ولا يعمل التطبيق
  async function bootWithLicenseCheck() {
    await idb.init();
    const keys = Object.keys(cache);
    for (let k of keys) {
      const val = await idb.get(PREFIX + k);
      if (val !== undefined) cache[k] = val;
    }
    seed();
    isReady = true;
    document.addEventListener = originalAddEventListener;

    // التحقق من الترخيص - يحتاج DakaniLicense معرَّف قبل هذا الملف
    if (typeof DakaniLicense !== 'undefined') {
      const licensed = DakaniLicense.gate();
      if (!licensed) {
        // انتظر حتى يدخل التاجر مفتاحه الصحيح
        window.addEventListener('dakani-licensed', () => {
          deferredListeners.forEach(fn => fn({type: 'DOMContentLoaded'}));
        }, { once: true });
        return; // لا تشغّل التطبيق قبل الترخيص
      }
    }

    const fire = () => deferredListeners.forEach(fn => fn({type: 'DOMContentLoaded'}));
    if (document.readyState === 'loading') {
      originalAddEventListener.call(document, 'DOMContentLoaded', fire);
    } else {
      fire();
    }
  }

  boot = bootWithLicenseCheck;
  boot(); // بدء التحميل مع فحص الترخيص

  // ─── Seed defaults ──────────────────────────────────────────────────────────
  function seed() {
    if (!read('seeded').length) {
      const cats = ['مواد غذائية','مشروبات','منظفات','مخبوزات','ألبان','تحلية','أخرى'];
      write('categories', cats.map(n => ({ id: uid(), name: n })));
      write('settings', {
        storeName: 'دكاني', address: '', phone: '',
        currency: 'دج', lowStockThreshold: 5
      });
      write('seeded', [1]);
    }
  }

  // ─── SETTINGS ───────────────────────────────────────────────────────────────
  const Settings = {
    get: () => read('settings') || {},
    save: obj => write('settings', obj)
  };

  // ─── CATEGORIES ─────────────────────────────────────────────────────────────
  const Categories = {
    all:    () => read('categories'),
    add:    name => {
      const cats = read('categories');
      const cat = { id: uid(), name };
      cats.push(cat); write('categories', cats); return cat;
    },
    delete: id => write('categories', read('categories').filter(c => c.id !== id))
  };

  // ─── PRODUCTS ───────────────────────────────────────────────────────────────
  const Products = {
    all:      () => read('products'),
    byId:     id => read('products').find(p => p.id === id),
    byBarcode: bc => read('products').find(p => p.barcode === bc),
    search:   q => {
      q = q.toLowerCase();
      return read('products').filter(p =>
        p.nameAr.toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.barcode || '').includes(q)
      );
    },
    save: data => {
      const list = read('products');
      if (data.id) {
        const i = list.findIndex(p => p.id === data.id);
        if (i > -1) { list[i] = { ...list[i], ...data, updatedAt: now() }; write('products', list); return list[i]; }
      }
      const prod = { ...data, id: uid(), createdAt: now(), updatedAt: now() };
      list.push(prod); write('products', list); return prod;
    },
    adjustStock: (id, delta) => {
      const list = read('products');
      const i = list.findIndex(p => p.id === id);
      if (i > -1) { list[i].stock = Math.max(0, (list[i].stock || 0) + delta); list[i].updatedAt = now(); write('products', list); }
    },
    delete: id => write('products', read('products').filter(p => p.id !== id)),
    lowStock: () => {
      const s = Settings.get();
      return read('products').filter(p => p.stock <= (s.lowStockThreshold || 5));
    }
  };

  // ─── CUSTOMERS ──────────────────────────────────────────────────────────────
  const Customers = {
    all:    () => read('customers'),
    byId:   id => read('customers').find(c => c.id === id),
    save: data => {
      const list = read('customers');
      if (data.id) {
        const i = list.findIndex(c => c.id === data.id);
        if (i > -1) { list[i] = { ...list[i], ...data, updatedAt: now() }; write('customers', list); return list[i]; }
      }
      const cust = { ...data, id: uid(), debt: 0, totalBought: 0, createdAt: now() };
      list.push(cust); write('customers', list); return cust;
    },
    addDebt: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) { list[i].debt = (list[i].debt || 0) + amount; write('customers', list); }
    },
    addTotal: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) { list[i].totalBought = (list[i].totalBought || 0) + amount; write('customers', list); }
    },
    delete: id => write('customers', read('customers').filter(c => c.id !== id))
  };

  // ─── SALES ──────────────────────────────────────────────────────────────────
  const Sales = {
    all:  () => read('sales'),
    byId: id => read('sales').find(s => s.id === id),
    today: () => {
      const t = today();
      return read('sales').filter(s => s.date && s.date.startsWith(t));
    },
    between: (from, to) => read('sales').filter(s => s.date >= from && s.date <= to + 'T23:59:59'),
    create: saleData => {
      const sales = read('sales');
      const items = read('sale_items');
      const sale = {
        id: uid(),
        invoiceNo: 'INV-' + String(sales.length + 1).padStart(5, '0'),
        customerId: saleData.customerId || null,
        customerName: saleData.customerName || 'زبون عام',
        items: saleData.items,
        subtotal: saleData.subtotal,
        discount: saleData.discount || 0,
        total: saleData.total,
        profit: saleData.profit,
        paymentMethod: saleData.paymentMethod || 'cash',
        date: now(),
        createdAt: now()
      };
      sales.push(sale); write('sales', sales);

      // store items flat too for fast querying
      saleData.items.forEach(it => {
        items.push({ ...it, saleId: sale.id, date: sale.date });
        Products.adjustStock(it.productId, -it.qty);
      });
      write('sale_items', items);

      if (saleData.customerId) {
        Customers.addTotal(saleData.customerId, sale.total);
        if (saleData.paymentMethod === 'credit') Customers.addDebt(saleData.customerId, sale.total);
      }
      return sale;
    },
    topProducts: (limit = 5) => {
      const items = read('sale_items');
      const map = {};
      items.forEach(it => {
        if (!map[it.productId]) map[it.productId] = { nameAr: it.nameAr, qty: 0, revenue: 0 };
        map[it.productId].qty += it.qty;
        map[it.productId].revenue += it.total;
      });
      return Object.values(map).sort((a, b) => b.qty - a.qty).slice(0, limit);
    },
    delete: id => {
      const sale = read('sales').find(s => s.id === id);
      if (!sale) return;
      // Restore stock for each item
      (sale.items || []).forEach(it => Products.adjustStock(it.productId, it.qty));
      // Remove flat sale_items
      write('sale_items', read('sale_items').filter(i => i.saleId !== id));
      // Update customer totals if applicable
      if (sale.customerId) {
        const custs = read('customers');
        const ci = custs.findIndex(c => c.id === sale.customerId);
        if (ci >= 0) {
          custs[ci].totalBought = Math.max(0, (custs[ci].totalBought || 0) - sale.total);
          if (sale.paymentMethod === 'credit') custs[ci].debt = Math.max(0, (custs[ci].debt || 0) - sale.total);
          write('customers', custs);
        }
      }
      write('sales', read('sales').filter(s => s.id !== id));
    },
    weeklySales: () => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const daySales = read('sales').filter(s => s.date && s.date.startsWith(ds));
        days.push({
          label: d.toLocaleDateString('ar-DZ', { weekday: 'short' }),
          total: daySales.reduce((a, s) => a + s.total, 0),
          profit: daySales.reduce((a, s) => a + s.profit, 0)
        });
      }
      return days;
    }
  };

  // ─── PURCHASES ──────────────────────────────────────────────────────────────
  const Purchases = {
    all:  () => read('purchases'),
    between: (from, to) => read('purchases').filter(p => p.date >= from && p.date <= to),
    save: data => {
      const list = read('purchases');
      const purchase = { ...data, id: uid(), createdAt: now() };
      list.push(purchase); write('purchases', list);
      Products.adjustStock(data.productId, data.qty);
      return purchase;
    },
    delete: id => {
      const p = read('purchases').find(p => p.id === id);
      if (p) Products.adjustStock(p.productId, -p.qty);
      write('purchases', read('purchases').filter(p => p.id !== id));
    }
  };

  // ─── EXPORT / IMPORT ────────────────────────────────────────────────────────
  function exportData() {
    const data = {
      version: '1.0', exportedAt: now(),
      products: read('products'), categories: read('categories'),
      customers: read('customers'), sales: read('sales'),
      sale_items: read('sale_items'), purchases: read('purchases'),
      settings: Settings.get()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dakani-backup-${today()}.json`;
    a.click();
    if (typeof toast === 'function') toast('تم تصدير البيانات بنجاح / Data exported!', 'success');
  }

  function importData(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.products)   write('products', data.products);
        if (data.categories) write('categories', data.categories);
        if (data.customers)  write('customers', data.customers);
        if (data.sales)      write('sales', data.sales);
        if (data.sale_items) write('sale_items', data.sale_items);
        if (data.purchases)  write('purchases', data.purchases);
        if (data.settings)   write('settings', data.settings);
        if (typeof toast === 'function') toast('تم الاستيراد بنجاح! جارٍ إعادة التحميل... / Import success!', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch { if (typeof toast === 'function') toast('ملف غير صالح / Invalid file', 'error'); }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    idb.clearAll().then(() => {
      location.reload();
    });
  }

  function stats() {
    return {
      products:  read('products').length,
      customers: read('customers').length,
      sales:     read('sales').length,
      purchases: read('purchases').length,
      size:      (new Blob([JSON.stringify(cache)]).size / 1024).toFixed(1) + ' KB'
    };
  }

  return { Settings, Categories, Products, Customers, Sales, Purchases,
           exportData, importData, resetAll, stats, uid, today, now };
})();
