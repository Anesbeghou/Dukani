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
    purchases: [],
    suppliers: [],
    debt_payments: [],
    supplier_payments: [],
    stock_adjustments: [],
    returns: [],
    held_sales: [],
    undo_log: []
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

  // ─── سجل التراجع (Undo Log) ─────────────────────────────────────────────────
  // يحتفظ بآخر العمليات القابلة للتراجع (بيع، مرتجع، شراء، تسوية مخزون) حتى
  // يمكن للمستخدم التراجع عن آخر خطأ بشري بضغطة زر. نحتفظ بحد أقصى 20 عملية.
  const UNDO_MAX = 20;
  function _pushUndo(type, id, label) {
    const log = read('undo_log') || [];
    log.unshift({ type, id, label, at: now() });
    write('undo_log', log.slice(0, UNDO_MAX));
  }

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
      const cats = ['مواد غذائية','مشروبات','منظفات','مخبوزات','ألبان','تحلية','بالميزان','أخرى'];
      write('categories', cats.map(n => ({ id: uid(), name: n })));
      write('settings', {
        storeName: 'دكاني', address: '', phone: '',
        currency: 'دج', lowStockThreshold: 5,
        expiryWarningDays: 15,
        logo: '', thankYouMessage: 'شكراً لتعاملكم معنا 🙏',
        language: 'ar',
        alertLowStock: true, alertExpired: true, alertExpiringSoon: true,
        alertCustomerDebt: true, alertSupplierDebt: true
      });
      write('seeded', [1]);
    }
    ensureWeightCategory();
    ensureExpirySettings();
    ensureCustomerTierSettings();
    ensureLanguageSetting();
    ensureNotificationSettings();
  }

  // ─── Migration: ensure language موجودة لدى المستخدمين القدامى ─────────────
  function ensureLanguageSetting() {
    const s = read('settings') || {};
    if (s.language === undefined) {
      s.language = 'ar';
      write('settings', s);
    }
  }

  // ─── Migration: ensure بالميزان category exists ────────────────────────────
  function ensureWeightCategory() {
    const cats = read('categories');
    if (!cats.find(c => c.name === 'بالميزان')) {
      cats.push({ id: uid(), name: 'بالميزان' });
      write('categories', cats);
    }
  }

  // ─── Migration: ensure expiryWarningDays موجود لدى المستخدمين القدامى ──────
  function ensureExpirySettings() {
    const s = read('settings') || {};
    if (s.expiryWarningDays === undefined) {
      s.expiryWarningDays = 15;
      write('settings', s);
    }
  }

  // ─── Migration: ensure حدود تصنيف الزبائن موجودة لدى المستخدمين القدامى ────
  function ensureCustomerTierSettings() {
    const s = read('settings') || {};
    let changed = false;
    if (s.custTierSilver === undefined) { s.custTierSilver = 5000;  changed = true; }
    if (s.custTierGold   === undefined) { s.custTierGold   = 20000; changed = true; }
    if (s.custTierVip    === undefined) { s.custTierVip    = 50000; changed = true; }
    if (changed) write('settings', s);
  }

  // ─── Migration: ensure إعدادات تخصيص التنبيهات موجودة لدى المستخدمين القدامى ─
  // كل نوع تنبيه مستقل بمفتاح خاص به، ليتمكن التاجر من إظهار/إخفاء كل نوع
  // على حدة من صفحة الإعدادات دون التأثير على البقية.
  function ensureNotificationSettings() {
    const s = read('settings') || {};
    let changed = false;
    if (s.alertLowStock     === undefined) { s.alertLowStock     = true; changed = true; }
    if (s.alertExpired      === undefined) { s.alertExpired      = true; changed = true; }
    if (s.alertExpiringSoon === undefined) { s.alertExpiringSoon = true; changed = true; }
    if (s.alertCustomerDebt === undefined) { s.alertCustomerDebt = true; changed = true; }
    if (s.alertSupplierDebt === undefined) { s.alertSupplierDebt = true; changed = true; }
    if (changed) write('settings', s);
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
    delete: id => {
      const cat = read('categories').find(c => c.id === id);
      if (cat && cat.name === 'بالميزان') return; // صنف محمي — لا يُحذف
      write('categories', read('categories').filter(c => c.id !== id));
    }
  };

  // ─── PRODUCTS ───────────────────────────────────────────────────────────────
  const Products = {
    all:      () => read('products'),
    byId:     id => read('products').find(p => p.id === id),
    // بحث عن منتج بالباركود — يبحث أولاً في باركود المنتج الرئيسي، ثم في باركود كل
    // متغيّر (Variant) تابع له. عند تطابق باركود متغيّر، تُرجَع نسخة من المنتج مع
    // خاصية إضافية _matchedVariant تشير إلى المتغيّر المطابق (لا تُخزَّن، للعرض فقط).
    byBarcode: bc => {
      if (!bc) return undefined;
      const list = read('products');
      const direct = list.find(p => p.barcode === bc);
      if (direct) return direct;
      for (const p of list) {
        if (!Array.isArray(p.variants)) continue;
        const v = p.variants.find(v => v.barcode && v.barcode === bc);
        if (v) return { ...p, _matchedVariant: v };
      }
      return undefined;
    },
    search:   q => {
      q = q.toLowerCase();
      return read('products').filter(p =>
        p.nameAr.toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.barcode || '').includes(q) ||
        (Array.isArray(p.variants) && p.variants.some(v => (v.barcode || '').includes(q) || (v.name || '').toLowerCase().includes(q)))
      );
    },

    // ─── المتغيّرات (Variants) ──────────────────────────────────────────────
    // منتج بدون variants (أو variants=[]) يعمل تماماً كما كان من قبل (متوافق تراجعياً).
    hasVariants: p => Array.isArray(p && p.variants) && p.variants.length > 0,
    // إجمالي المخزون: مجموع مخزون كل المتغيّرات إن وُجدت، وإلا مخزون المنتج نفسه
    totalStock: p => {
      if (!p) return 0;
      if (Array.isArray(p.variants) && p.variants.length) {
        return p.variants.reduce((s, v) => s + (parseFloat(v.stock) || 0), 0);
      }
      return p.stock || 0;
    },
    // سعر البيع الفعلي حسب المتغيّر (إن حُدِّد سعر خاص به) أو سعر المنتج الافتراضي
    effectiveSellPrice: (p, variantId) => {
      if (variantId && Array.isArray(p.variants)) {
        const v = p.variants.find(v => v.id === variantId);
        if (v) return (v.sellPrice !== '' && v.sellPrice != null) ? parseFloat(v.sellPrice) : (p.sellPrice || 0);
      }
      return p.sellPrice || 0;
    },
    effectiveBuyPrice: (p, variantId) => {
      if (variantId && Array.isArray(p.variants)) {
        const v = p.variants.find(v => v.id === variantId);
        if (v) return (v.buyPrice !== '' && v.buyPrice != null) ? parseFloat(v.buyPrice) : (p.buyPrice || 0);
      }
      return p.buyPrice || 0;
    },
    variantStock: (p, variantId) => {
      if (variantId && Array.isArray(p.variants)) {
        const v = p.variants.find(v => v.id === variantId);
        if (v) return parseFloat(v.stock) || 0;
      }
      return p.stock || 0;
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
    // variantId اختياري: إن مُرِّر ووُجد ضمن variants المنتج، يُعدَّل مخزون ذلك
    // المتغيّر فقط (بدون المساس بمخزون المنتج الرئيسي). غير ذلك يعمل كما كان دائماً.
    adjustStock: (id, delta, variantId) => {
      const list = read('products');
      const i = list.findIndex(p => p.id === id);
      if (i === -1) return;
      if (variantId && Array.isArray(list[i].variants)) {
        const vi = list[i].variants.findIndex(v => v.id === variantId);
        if (vi > -1) {
          list[i].variants[vi].stock = Math.max(0, (parseFloat(list[i].variants[vi].stock) || 0) + delta);
          list[i].updatedAt = now();
          write('products', list);
          return;
        }
      }
      list[i].stock = Math.max(0, (list[i].stock || 0) + delta);
      list[i].updatedAt = now();
      write('products', list);
    },
    delete: id => write('products', read('products').filter(p => p.id !== id)),
    // ملاحظة: المنتجات ذات المتغيّرات (Variants) تُستثنى من هذا التنبيه لأن مخزونها
    // موزَّع على كل متغيّر على حدة وليس على p.stock — تفادياً لتنبيهات مضلِّلة.
    // يمكن مراجعة مخزون كل متغيّر من داخل صفحة المنتجات مباشرة.
    lowStock: () => {
      const s = Settings.get();
      return read('products').filter(p => !Products.hasVariants(p) && p.stock <= (s.lowStockThreshold || 5));
    },

    // ─── تواريخ الصلاحية ────────────────────────────────────────────────────
    // عدد الأيام المتبقية حتى الانتهاء (سالب = منتهي الصلاحية بالفعل، null = لا يوجد تاريخ)
    daysToExpiry: p => {
      if (!p || !p.expiryDate) return null;
      const exp = new Date(p.expiryDate + 'T00:00:00');
      if (isNaN(exp.getTime())) return null;
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      return Math.round((exp - today0) / 86400000);
    },
    // المنتجات المنتهية الصلاحية فعلياً (مرتبة من الأقدم انتهاءً)
    expired: () => {
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      return read('products')
        .filter(p => p.expiryDate && new Date(p.expiryDate + 'T00:00:00') < today0)
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    },
    // المنتجات القريبة من الانتهاء (خلال عدد الأيام المحدد في الإعدادات أو المُمرَّر يدوياً)
    expiringSoon: days => {
      const s = Settings.get();
      const warnDays = days != null ? days : (s.expiryWarningDays || 15);
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const limit = new Date(today0); limit.setDate(limit.getDate() + warnDays);
      return read('products')
        .filter(p => {
          if (!p.expiryDate) return false;
          const exp = new Date(p.expiryDate + 'T00:00:00');
          return exp >= today0 && exp <= limit;
        })
        .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
    },

    // ─── المخزون الراكد / الميت (Dead Stock) ───────────────────────────────
    // منتجات لا تزال بالمخزون لكن لم تُبَع منذ "days" يوماً (أو لم تُبَع إطلاقاً منذ إضافتها)
    // تُرتَّب النتائج حسب قيمة رأس المال المجمّد (الكمية × سعر التكلفة) تنازلياً
    //
    // المُعامل opts يقبل صيغتين (متوافق تماماً مع الاستدعاء القديم deadStock(30)):
    //   - رقم: عدد الأيام منذ آخر بيع (السلوك الافتراضي/القديم — لا يزال يعمل كما هو)
    //   - كائن { sinceDate: 'YYYY-MM-DD' }: يُرجع فقط المنتجات التي لم تُبَع منذ ذلك
    //     التاريخ المحدد يدوياً (أو لم تُبَع إطلاقاً)، بدل الاعتماد على عدد أيام نسبي لليوم الحالي
    deadStock: (opts) => {
      let threshold = 30;
      let sinceDate = null;
      if (opts && typeof opts === 'object') {
        if (opts.sinceDate) sinceDate = opts.sinceDate;
        else threshold = opts.days || 30;
      } else {
        threshold = opts || 30;
      }
      const today0 = new Date(); today0.setHours(0, 0, 0, 0);
      const items = read('sale_items');

      // آخر تاريخ بيع لكل منتج
      const lastSaleMap = {};
      items.forEach(it => {
        const d = (it.date || '').slice(0, 10);
        if (!d || !it.productId) return;
        if (!lastSaleMap[it.productId] || d > lastSaleMap[it.productId]) lastSaleMap[it.productId] = d;
      });

      return read('products')
        .filter(p => (p.stock || 0) > 0)
        .map(p => {
          const lastSale = lastSaleMap[p.id] || null;
          let daysIdle;
          if (lastSale) {
            daysIdle = Math.round((today0 - new Date(lastSale + 'T00:00:00')) / 86400000);
          } else {
            const created = p.createdAt ? p.createdAt.slice(0, 10) : null;
            daysIdle = created
              ? Math.round((today0 - new Date(created + 'T00:00:00')) / 86400000)
              : threshold; // لا يوجد تاريخ إنشاء (بيانات قديمة) → اعتبره مؤهلاً بالحد الأدنى
          }
          return {
            id: p.id,
            nameAr: p.nameAr,
            unit: p.unit || '',
            category: p.category || '',
            stock: p.stock || 0,
            buyPrice: p.buyPrice || 0,
            tiedValue: Math.round((p.stock || 0) * (p.buyPrice || 0) * 100) / 100,
            lastSaleDate: lastSale,
            daysIdle,
            neverSold: !lastSale
          };
        })
        .filter(p => sinceDate ? (p.neverSold || p.lastSaleDate <= sinceDate) : p.daysIdle >= threshold)
        .sort((a, b) => b.tiedValue - a.tiedValue);
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
      const cust = { ...data, id: uid(), debt: 0, debtProfit: 0, totalBought: 0, createdAt: now() };
      list.push(cust); write('customers', list); return cust;
    },
    addDebt: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) { list[i].debt = (list[i].debt || 0) + amount; write('customers', list); }
    },
    // ─── الربح المعلَّق (غير المحصَّل) المرتبط بديون هذا الزبون ───────────────
    // يُستخدم لتأجيل احتساب ربح البيع الآجل حتى يُسدَّد الدين فعلياً، حتى يبقى
    // الربح المعروض في لوحة التحكم والتقارير "صافياً" ولا يتضمّن أرباحاً وهمية
    // عن مبالغ لم تُقبَض بعد. delta يمكن أن تكون موجبة (إضافة عند بيع آجل جديد)
    // أو سالبة (خصم عند تحصيل جزء من الدين) — والنتيجة لا تنزل أبداً تحت الصفر.
    adjustDebtProfit: (id, delta) => {
      if (!delta) return;
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) {
        list[i].debtProfit = Math.max(0, (list[i].debtProfit || 0) + delta);
        write('customers', list);
      }
    },
    addTotal: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) {
        list[i].totalBought   = (list[i].totalBought || 0) + amount;
        list[i].purchaseCount = (list[i].purchaseCount || 0) + 1; // لأجل تصنيف/ترقية الزبائن حسب عدد مرات الشراء
        write('customers', list);
      }
    },
    payDebt: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) {
        list[i].debt = Math.max(0, (list[i].debt || 0) - amount);
        list[i].lastPayment = now();
        write('customers', list);
      }
    },
    delete: id => write('customers', read('customers').filter(c => c.id !== id)),
    // الزبائن المدينون (لديهم دين مستحق) — مرتبون من الأكبر دَيناً
    debtors: () => read('customers').filter(c => (c.debt || 0) > 0).sort((a, b) => (b.debt || 0) - (a.debt || 0))
  };

  // ─── DEBT PAYMENTS ──────────────────────────────────────────────────────────
  const DebtPayments = {
    all:        ()  => read('debt_payments'),
    byCustomer: id  => read('debt_payments').filter(p => p.customerId === id),
    add: (customerId, amount, note, date) => {
      const c = Customers.byId(customerId);
      if (!c) return null;
      const maxPay = c.debt || 0;
      const paid   = Math.min(amount, maxPay);   // لا يتجاوز الدين الفعلي

      // ─── الربح المُحصَّل الآن من هذا السداد ────────────────────────────────
      // ⚠️ الربح لا يُحسب وقت البيع الآجل، بل فقط عند تحصيل الدين فعلياً، حتى
      // يبقى الربح المعروض "صافياً" ولا يتضمّن أرباحاً وهمية عن مبالغ لم تُقبَض.
      // نحسب الربح المُحصَّل بشكل تناسبي: (المبلغ المسدَّد ÷ الدين الكلي قبل
      // السداد) × الربح المعلَّق الكلي لهذا الزبون. هذا يوزّع الربح بعدالة على
      // كل دفعة جزئية دون الحاجة لربط كل دفعة بفاتورة بعينها.
      const debtBefore     = c.debt || 0;
      const pendingProfit  = c.debtProfit || 0;
      const profitRecognized = debtBefore > 0 ? (pendingProfit * (paid / debtBefore)) : 0;

      const list   = read('debt_payments');
      const payment = {
        id: uid(), customerId,
        customerName: c.name,
        amount: paid,
        profit: profitRecognized,
        note:   note || '',
        date:   date || now(),
        createdAt: now()
      };
      list.push(payment);
      write('debt_payments', list);
      Customers.payDebt(customerId, paid);
      Customers.adjustDebtProfit(customerId, -profitRecognized);
      return payment;
    },
    delete: id => {
      const p = read('debt_payments').find(p => p.id === id);
      if (!p) return;
      // إلغاء السداد — يُعيد الدين للزبون + يُعيد الربح المعلَّق المقابل له
      // (بحيث لا يبقى محتسَباً كربح "محصَّل" بعد إلغاء عملية التحصيل)
      const list = read('customers');
      const i    = list.findIndex(c => c.id === p.customerId);
      if (i > -1) { list[i].debt = (list[i].debt || 0) + p.amount; write('customers', list); }
      Customers.adjustDebtProfit(p.customerId, p.profit || 0);
      write('debt_payments', read('debt_payments').filter(d => d.id !== id));
    }
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
      const paymentMethod = saleData.paymentMethod || 'cash';
      // المبلغ الآجل (الذي يُضاف كدين) — إن لم يُحدَّد صراحة، استنتجه من طريقة الدفع الكاملة
      const creditAmount = saleData.creditAmount != null
        ? saleData.creditAmount
        : (paymentMethod === 'credit' ? saleData.total : 0);
      const cashAmount = saleData.cashAmount != null
        ? saleData.cashAmount
        : (saleData.total - creditAmount);

      // ─── تقسيم الربح: نقدي (محقَّق فوراً) مقابل آجل (معلَّق حتى يُسدَّد الدين) ──
      // إن أرسل المتصل (checkout) الربح الآجل بدقة (بناءً على منتجات كل قسم من
      // السلة) نستخدمه كما هو. وإلا (لأي مصدر آخر مستقبلاً) نقدّره تناسبياً حسب
      // نسبة المبلغ الآجل من إجمالي الفاتورة — كحل احتياطي فقط.
      const creditProfit = saleData.creditProfit != null
        ? saleData.creditProfit
        : (creditAmount > 0 && saleData.total > 0 ? (saleData.profit * (creditAmount / saleData.total)) : 0);
      const cashProfit = saleData.cashProfit != null
        ? saleData.cashProfit
        : (saleData.profit - creditProfit);

      const sale = {
        id: uid(),
        invoiceNo: 'INV-' + String(sales.length + 1).padStart(5, '0'),
        customerId: saleData.customerId || null,
        customerName: saleData.customerName || 'زبون عام',
        items: saleData.items,
        subtotal: saleData.subtotal,
        discount: saleData.discount || 0,
        itemsDiscountTotal: saleData.itemsDiscountTotal || 0,
        total: saleData.total,
        profit: saleData.profit,     // الربح الكلي للفاتورة (مرجعي/إعلامي فقط)
        cashProfit,                  // الربح المحقَّق فوراً (الجزء النقدي/بالبطاقة)
        creditProfit,                // الربح المعلَّق (الجزء الآجل) حتى يُسدَّد الدين
        paymentMethod,
        cashAmount,
        creditAmount,
        date: now(),
        createdAt: now()
      };
      sales.push(sale); write('sales', sales);

      // store items flat too for fast querying
      saleData.items.forEach(it => {
        items.push({ ...it, saleId: sale.id, date: sale.date });
        Products.adjustStock(it.productId, -it.qty, it.variantId);
      });
      write('sale_items', items);

      if (saleData.customerId) {
        Customers.addTotal(saleData.customerId, sale.total);
        if (creditAmount > 0) {
          Customers.addDebt(saleData.customerId, creditAmount);
          // إضافة الربح الآجل إلى "الربح المعلَّق" لهذا الزبون — لن يُحتسب ضمن
          // الأرباح الفعلية إلا عند تسديد الدين (جزئياً أو كلياً) لاحقاً
          Customers.adjustDebtProfit(saleData.customerId, creditProfit);
        }
      }
      _pushUndo('sale', sale.id, `فاتورة بيع ${sale.invoiceNo}`);
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
      (sale.items || []).forEach(it => Products.adjustStock(it.productId, it.qty, it.variantId));
      // Remove flat sale_items
      write('sale_items', read('sale_items').filter(i => i.saleId !== id));
      // Update customer totals if applicable
      if (sale.customerId) {
        const custs = read('customers');
        const ci = custs.findIndex(c => c.id === sale.customerId);
        if (ci >= 0) {
          custs[ci].totalBought   = Math.max(0, (custs[ci].totalBought || 0) - sale.total);
          custs[ci].purchaseCount = Math.max(0, (custs[ci].purchaseCount || 0) - 1);
          const debtToRemove = sale.creditAmount != null
            ? sale.creditAmount
            : (sale.paymentMethod === 'credit' ? sale.total : 0);
          if (debtToRemove > 0) custs[ci].debt = Math.max(0, (custs[ci].debt || 0) - debtToRemove);
          write('customers', custs);
          // إزالة الربح المعلَّق المقابل لهذه الفاتورة (إن وُجد) من رصيد الزبون؛
          // ⚠️ إن كان جزء من الدين قد سُدِّد سابقاً، فقد يكون جزء من هذا الربح
          // قد احتُسب فعلاً كمُحصَّل — لذا لا ننزل أبداً تحت الصفر (Math.max داخل
          // adjustDebtProfit) تفادياً لأي رقم سالب غير منطقي.
          const creditProfitToRemove = sale.creditProfit != null ? sale.creditProfit : 0;
          if (creditProfitToRemove > 0) Customers.adjustDebtProfit(sale.customerId, -creditProfitToRemove);
        }
      }
      write('sales', read('sales').filter(s => s.id !== id));
    },
    weeklySales: () => {
      const days = [];
      const payments = read('debt_payments');
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const daySales = read('sales').filter(s => s.date && s.date.startsWith(ds));
        // الربح المحصَّل هذا اليوم = ربح المبيعات النقدية اليوم + ربح الديون
        // المُحصَّلة اليوم (بغضّ النظر عن تاريخ الفاتورة الأصلية للدين)
        const dayDebtProfit = payments
          .filter(p => p.date && p.date.startsWith(ds))
          .reduce((a, p) => a + (p.profit || 0), 0);
        days.push({
          label: d.toLocaleDateString('ar-DZ', { weekday: 'short' }),
          total: daySales.reduce((a, s) => a + s.total, 0),
          profit: daySales.reduce((a, s) => a + Sales.netProfit(s), 0) + dayDebtProfit
        });
      }
      return days;
    },
    // ─── الربح الصافي المحقَّق فعلياً لفاتورة واحدة (يستثني الجزء الآجل غير المُسدَّد) ─
    // متوافق مع الفواتير القديمة (قبل هذا التحديث) التي لا تحتوي على cashProfit:
    // تُعتبر أرباحها محقَّقة بالكامل كما كانت (لا يمكن إعادة تقسيمها بأثر رجعي).
    netProfit: sale => (typeof sale.cashProfit === 'number' ? sale.cashProfit : (sale.profit || 0))
  };

  // ─── SUPPLIERS ──────────────────────────────────────────────
  const Suppliers = {
    all:   () => read('suppliers'),
    byId:  id  => read('suppliers').find(s => s.id === id),
    byName: n  => read('suppliers').find(s => s.name === n),
    save: data => {
      const list = read('suppliers');
      if (data.id) {
        const i = list.findIndex(s => s.id === data.id);
        if (i > -1) {
          list[i] = { ...list[i], ...data, updatedAt: now() };
          write('suppliers', list); return list[i];
        }
      }
      const supp = {
        ...data, id: uid(),
        totalPurchased: 0, orderCount: 0, balance: data.balance || 0,
        createdAt: now(), updatedAt: now()
      };
      list.push(supp); write('suppliers', list); return supp;
    },
    // ─── الرصيد المستحق للمورد (سجل المدفوعات) ─────────────────────────────
    // balance = المبلغ الذي لا يزال يتوجّب دفعه لهذا المورد. مستقل تماماً عن
    // سجل المشتريات، حتى يمكن استخدامه لأي مستحق مالي (فاتورة، دفعة مقدّمة، ...)
    addBalance: (id, amount) => {
      const list = read('suppliers');
      const i    = list.findIndex(s => s.id === id);
      if (i > -1) {
        list[i].balance = (list[i].balance || 0) + amount;
        write('suppliers', list);
      }
    },
    reduceBalance: (id, amount) => {
      const list = read('suppliers');
      const i    = list.findIndex(s => s.id === id);
      if (i > -1) {
        list[i].balance = Math.max(0, (list[i].balance || 0) - amount);
        list[i].lastPayment = now();
        write('suppliers', list);
      }
    },
    // يُحدَّث تلقائياً عند حفظ مشترى
    updateStats: (id, amount) => {
      const list = read('suppliers');
      const i    = list.findIndex(s => s.id === id);
      if (i > -1) {
        list[i].totalPurchased = (list[i].totalPurchased || 0) + amount;
        list[i].orderCount     = (list[i].orderCount     || 0) + 1;
        list[i].lastOrder      = now();
        write('suppliers', list);
      }
    },
    revertStats: (id, amount) => {
      const list = read('suppliers');
      const i    = list.findIndex(s => s.id === id);
      if (i > -1) {
        list[i].totalPurchased = Math.max(0, (list[i].totalPurchased || 0) - amount);
        list[i].orderCount     = Math.max(0, (list[i].orderCount     || 0) - 1);
        write('suppliers', list);
      }
    },
    delete: id => write('suppliers', read('suppliers').filter(s => s.id !== id)),
    // الموردون الذين لديهم رصيد مستحق (مبلغ لم يُدفع لهم بعد) — مرتبون من الأكبر
    debtors: () => read('suppliers').filter(s => (s.balance || 0) > 0).sort((a, b) => (b.balance || 0) - (a.balance || 0))
  };

  // ─── SUPPLIER PAYMENTS (سجل المدفوعات للموردين) ────────────────────────────
  // سجل مالي شامل للدفعات الصادرة للموردين — مستقل عن سجل المشتريات، لتتبّع كل
  // ما يُدفع للمورد من مستحقات (سواء ناتجة عن مشتريات آجلة أو ديون سابقة أو أي
  // مستحق آخر تم تسجيله يدوياً عبر رصيد المورد).
  const SupplierPayments = {
    all:        ()  => read('supplier_payments'),
    bySupplier: id  => read('supplier_payments').filter(p => p.supplierId === id),
    // تسجيل دفعة صادرة لمورد — تُنقص من المبلغ المستحق له (بحد أقصى المستحق نفسه)
    add: (supplierId, amount, note, date) => {
      const s = Suppliers.byId(supplierId);
      if (!s) return null;
      const maxPay = s.balance || 0;
      const paid   = Math.min(amount, maxPay); // لا يتجاوز المستحق الفعلي
      const list   = read('supplier_payments');
      const payment = {
        id: uid(), supplierId,
        supplierName: s.name,
        amount: paid,
        note:   note || '',
        date:   date || now(),
        createdAt: now()
      };
      list.push(payment);
      write('supplier_payments', list);
      Suppliers.reduceBalance(supplierId, paid);
      return payment;
    },
    delete: id => {
      const p = read('supplier_payments').find(p => p.id === id);
      if (!p) return;
      // إلغاء الدفعة — يُعيد المبلغ إلى المستحق للمورد
      Suppliers.addBalance(p.supplierId, p.amount);
      write('supplier_payments', read('supplier_payments').filter(x => x.id !== id));
    }
  };

  // ─── PURCHASES ──────────────────────────────────────────────────────────────
  const Purchases = {
    all:  () => read('purchases'),
    between: (from, to) => read('purchases').filter(p => p.date >= from && p.date <= to),
    // ─── سجل أسعار الشراء التاريخية لمنتج معيّن ──────────────────────────────
    // يُرجع كل عمليات الشراء الخاصة بهذا المنتج مرتّبة من الأقدم إلى الأحدث
    // (يشمل المورد وسعر الوحدة والكمية) — يُستخدم لعرض تطوّر سعر الشراء عبر الزمن
    // ومقارنته بين الموردين. لا يُنشئ أي بيانات جديدة، فقط يقرأ من purchases الموجودة.
    byProduct: productId => {
      return read('purchases')
        .filter(p => p.productId === productId)
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
    },
    // إحصائيات سريعة لسعر شراء منتج عبر تاريخه (أقل/أعلى/متوسط/آخر سعر)
    priceStats: productId => {
      const hist = Purchases.byProduct(productId);
      if (!hist.length) return null;
      const prices = hist.map(p => parseFloat(p.unitPrice) || 0);
      const last = hist[hist.length - 1];
      const first = hist[0];
      return {
        count:   hist.length,
        last:    prices[prices.length - 1],
        lastDate: last.date,
        first:   prices[0],
        firstDate: first.date,
        min:     Math.min(...prices),
        max:     Math.max(...prices),
        avg:     prices.reduce((a, b) => a + b, 0) / prices.length
      };
    },
    save: data => {
      const list = read('purchases');
      const purchase = { ...data, id: uid(), createdAt: now() };
      list.push(purchase); write('purchases', list);
      Products.adjustStock(data.productId, data.qty);
      // تحديث إحصائيات المورد
      if (data.supplierId) Suppliers.updateStats(data.supplierId, data.qty * data.unitPrice);
      const prod = Products.byId(data.productId);
      _pushUndo('purchase', purchase.id, `مشترى ${prod ? prod.nameAr : ''}`);
      return purchase;
    },
    delete: id => {
      const p = read('purchases').find(p => p.id === id);
      if (p) {
        Products.adjustStock(p.productId, -p.qty);
        if (p.supplierId) Suppliers.revertStats(p.supplierId, p.qty * p.unitPrice);
      }
      write('purchases', read('purchases').filter(p => p.id !== id));
    },
    // تعديل مشترى موجود: نتراجع أولاً عن أثر المشترى القديم (المخزون + إحصائيات المورد)
    // ثم نطبّق أثر البيانات الجديدة، حتى لو تغيّر المنتج أو المورد أو الكمية
    update: (id, data) => {
      const list = read('purchases');
      const i = list.findIndex(p => p.id === id);
      if (i === -1) return null;
      const old = list[i];

      // التراجع عن أثر المشترى القديم
      Products.adjustStock(old.productId, -old.qty);
      if (old.supplierId) Suppliers.revertStats(old.supplierId, old.qty * old.unitPrice);

      // تطبيق أثر البيانات الجديدة
      const updated = { ...old, ...data, id: old.id, createdAt: old.createdAt, updatedAt: now() };
      list[i] = updated;
      write('purchases', list);

      Products.adjustStock(updated.productId, updated.qty);
      if (updated.supplierId) Suppliers.updateStats(updated.supplierId, updated.qty * updated.unitPrice);

      return updated;
    }
  };

  // ─── STOCK ADJUSTMENTS (جرد يدوي / تسوية المخزون) ──────────────────────────
  const StockAdjustments = {
    all: () => read('stock_adjustments'),
    add: (productId, newQty, reason, note) => {
      const list    = read('products');
      const i       = list.findIndex(p => p.id === productId);
      if (i < 0) return null;
      const oldQty    = list[i].stock || 0;
      const delta     = newQty - oldQty;
      const buyPrice  = list[i].buyPrice || 0;
      list[i].stock   = newQty;
      list[i].updatedAt = now();

      // إذا كان سبب التسوية انتهاء الصلاحية وأصبح الرصيد صفراً، نزيل تاريخ الصلاحية
      // حتى لا تتكرر التنبيهات لمخزون تم التخلص منه فعلياً
      if (reason === 'انتهاء الصلاحية' && newQty === 0) {
        list[i].expiryDate = '';
      }
      write('products', list);

      // القيمة المالية الدقيقة للخسارة = الكمية الناقصة × سعر التكلفة (فقط عند النقصان)
      const costImpact = delta < 0 ? Math.round(Math.abs(delta) * buyPrice * 100) / 100 : 0;

      const adj = {
        id: uid(),
        productId,
        productName: list[i].nameAr,
        unit: list[i].unit || '',
        oldQty,
        newQty,
        delta,
        costImpact,
        reason: reason || 'جرد يدوي',
        note:   note   || '',
        date:   now(),
        createdAt: now()
      };
      const adjs = read('stock_adjustments');
      adjs.unshift(adj);
      write('stock_adjustments', adjs);
      _pushUndo('stock_adjustment', adj.id, `تسوية مخزون ${adj.productName}`);
      return adj;
    },
    // حذف تسوية مخزون (تُستخدم من قبل نظام التراجع) — تعيد المخزون إلى قيمته
    // السابقة (oldQty) قبل هذه التسوية، وتحذف السجل من القائمة
    delete: id => {
      const list = read('stock_adjustments');
      const adj = list.find(a => a.id === id);
      if (!adj) return;
      const prods = read('products');
      const pi = prods.findIndex(p => p.id === adj.productId);
      if (pi > -1) {
        prods[pi].stock = adj.oldQty;
        prods[pi].updatedAt = now();
        write('products', prods);
      }
      write('stock_adjustments', list.filter(a => a.id !== id));
    },
    clear: () => write('stock_adjustments', []),
    // إجمالي قيمة الخسائر المالية خلال فترة زمنية (لتقارير الخسائر)
    totalLoss: (from, to) => {
      return read('stock_adjustments')
        .filter(a => (a.costImpact || 0) > 0 && (!from || a.date >= from) && (!to || a.date <= to))
        .reduce((s, a) => s + a.costImpact, 0);
    },
    // إجمالي خسائر انتهاء الصلاحية تحديداً
    expiryLoss: (from, to) => {
      return read('stock_adjustments')
        .filter(a => a.reason === 'انتهاء الصلاحية' && (!from || a.date >= from) && (!to || a.date <= to))
        .reduce((s, a) => s + (a.costImpact || 0), 0);
    }
  };

  // ─── RETURNS (مرتجعات) ──────────────────────────────────────────────────────
  const Returns = {
    all:     () => read('returns'),
    byId:    id => read('returns').find(r => r.id === id),
    bySale:  saleId => read('returns').filter(r => r.saleId === saleId),

    // إنشاء مرتجع جديد
    // items: [{ productId, nameAr, qty, price, total, restoreStock }]
    create: (data) => {
      const list    = read('returns');
      const returns = read('returns');

      const ret = {
        id:            uid(),
        returnNo:      'RET-' + String(list.length + 1).padStart(5, '0'),
        saleId:        data.saleId        || null,
        invoiceNo:     data.invoiceNo     || '',
        customerId:    data.customerId    || null,
        customerName:  data.customerName  || 'زبون عام',
        items:         data.items         || [],
        totalRefund:   data.totalRefund   || 0,
        reason:        data.reason        || '',
        refundMethod:  data.refundMethod  || 'cash',   // cash | credit_note
        date:          now(),
        createdAt:     now()
      };

      // إعادة المخزون للمنتجات المُرتجعة
      ret.items.forEach(it => {
        if (it.restoreStock !== false) {
          Products.adjustStock(it.productId, it.qty, it.variantId);
        }
      });

      // إذا كان الزبون مسجلاً وطريقة الاسترداد نقدية → اخصم من totalBought
      if (ret.customerId) {
        const custs = read('customers');
        const ci = custs.findIndex(c => c.id === ret.customerId);
        if (ci >= 0) {
          custs[ci].totalBought = Math.max(0, (custs[ci].totalBought || 0) - ret.totalRefund);
          // إذا كانت الفاتورة الأصلية آجلة → خصم الدين أيضاً
          if (data.originalPaymentMethod === 'credit') {
            custs[ci].debt = Math.max(0, (custs[ci].debt || 0) - ret.totalRefund);
          }
          write('customers', custs);
        }
      }

      list.push(ret);
      write('returns', list);
      _pushUndo('return', ret.id, `مرتجع ${ret.returnNo}`);
      return ret;
    },

    // حذف مرتجع (يعكس المخزون)
    delete: id => {
      const ret = read('returns').find(r => r.id === id);
      if (!ret) return;
      // إعادة المخزون للوضع السابق
      ret.items.forEach(it => {
        if (it.restoreStock !== false) Products.adjustStock(it.productId, -it.qty, it.variantId);
      });
      // إعادة totalBought للزبون
      if (ret.customerId) {
        const custs = read('customers');
        const ci = custs.findIndex(c => c.id === ret.customerId);
        if (ci >= 0) {
          custs[ci].totalBought = (custs[ci].totalBought || 0) + ret.totalRefund;
          write('customers', custs);
        }
      }
      write('returns', read('returns').filter(r => r.id !== id));
    },

    // إحصائيات سريعة
    stats: () => {
      const all = read('returns');
      return {
        count:       all.length,
        totalRefund: all.reduce((a, r) => a + r.totalRefund, 0)
      };
    }
  };

  // ─── HELD SALES (تعليق الفاتورة — حفظ مؤقت للرجوع إليه لاحقاً) ─────────────
  const HeldSales = {
    all:  () => read('held_sales'),
    byId: id => read('held_sales').find(h => h.id === id),

    // data: { note, customerId, customerName, items, discount, received,
    //         paymentMethod, subtotal, total }
    add: (data) => {
      const list = read('held_sales');
      const held = {
        id:           uid(),
        note:         data.note        || '',
        customerId:   data.customerId  || null,
        customerName: data.customerName || 'زبون عام',
        items:        data.items       || [],
        discount:     data.discount    || 0,
        received:     data.received    != null ? data.received : null,
        paymentMethod: data.paymentMethod || 'cash',
        subtotal:     data.subtotal    || 0,
        total:        data.total       || 0,
        itemCount:    (data.items || []).reduce((a, it) => a + (it.qty || 0), 0),
        createdAt:    now()
      };
      list.unshift(held);
      write('held_sales', list);
      return held;
    },

    delete: id => {
      write('held_sales', read('held_sales').filter(h => h.id !== id));
    },

    clear: () => write('held_sales', []),

    count: () => read('held_sales').length
  };

  // ─── قراءة/كتابة بيانات صفحة "المصاريف والصندوق" (localStorage - cashbox.js) ─
  // هذه البيانات ليست جزءاً من IndexedDB (محفوظة بشكل مستقل عبر cashbox.js
  // لتجنّب أي تعارض مع فتح قاعدة DakaniDB)، لكن نُدرجها هنا فقط عند التصدير/
  // الاستيراد حتى تنتقل مع بقية بيانات المتجر عند تغيير الجهاز، دون أي تغيير
  // على طريقة تخزينها الأصلية أو على عمل cashbox.js نفسه.
  const CASHBOX_LS_KEYS = ['dakani_cbx_expenses', 'dakani_cbx_capital', 'dakani_cbx_shifts', 'dakani_cbx_moves'];
  function _readCashboxLocalStorage() {
    const out = {};
    CASHBOX_LS_KEYS.forEach(k => {
      try { out[k] = JSON.parse(localStorage.getItem(k) || '[]'); }
      catch (e) { out[k] = []; }
    });
    return out;
  }
  function _writeCashboxLocalStorage(obj) {
    if (!obj) return;
    CASHBOX_LS_KEYS.forEach(k => {
      if (obj[k] !== undefined) {
        try { localStorage.setItem(k, JSON.stringify(obj[k])); } catch (e) {}
      }
    });
  }

  function exportData() {
    const data = {
      version: '1.0', exportedAt: now(),
      products: read('products'), categories: read('categories'),
      customers: read('customers'), sales: read('sales'),
      sale_items: read('sale_items'), purchases: read('purchases'),
      suppliers: read('suppliers'),
      debt_payments: read('debt_payments'),
      supplier_payments: read('supplier_payments'),
      stock_adjustments: read('stock_adjustments'),
      returns:           read('returns'),
      held_sales:        read('held_sales'),
      settings: Settings.get(),
      // بيانات المصاريف والصندوق (رأس المال، المناوبات، الإيداعات/السحوبات)
      cashbox: _readCashboxLocalStorage()
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
        const knownKeys = ['products','categories','customers','sales','sale_items',
          'purchases','suppliers','debt_payments','supplier_payments','stock_adjustments','returns','settings','cashbox'];
        const hasData = knownKeys.some(k => data && data[k] !== undefined);
        if (!hasData) {
          if (typeof toast === 'function') toast('هذا الملف ليس نسخة بيانات دكاني صالحة / Not a valid Dakani backup file', 'error');
          return;
        }
        if (data.products)   write('products', data.products);
        if (data.categories) write('categories', data.categories);
        if (data.customers)  write('customers', data.customers);
        if (data.sales)      write('sales', data.sales);
        if (data.sale_items) write('sale_items', data.sale_items);
        if (data.purchases)  write('purchases', data.purchases);
        if (data.suppliers)          write('suppliers',          data.suppliers);
        if (data.debt_payments)      write('debt_payments',      data.debt_payments);
        if (data.supplier_payments)  write('supplier_payments',  data.supplier_payments);
        if (data.stock_adjustments)  write('stock_adjustments',  data.stock_adjustments);
        if (data.returns)            write('returns',            data.returns);
        if (data.held_sales)         write('held_sales',         data.held_sales);
        if (data.settings)      write('settings',      data.settings);
        if (data.cashbox)       _writeCashboxLocalStorage(data.cashbox);
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
      suppliers: read('suppliers').length,
      supplierPayments: read('supplier_payments').length,
      size:      (new Blob([JSON.stringify(cache)]).size / 1024).toFixed(1) + ' KB'
    };
  }

  // ─── UNDO MANAGER (زر التراجع عن آخر عملية) ─────────────────────────────────
  // يتراجع عن آخر عملية مُسجَّلة في undo_log مهما كان نوعها (بيع، مرتجع، شراء،
  // تسوية مخزون)، ويعكس كل آثارها (المخزون، حسابات الزبون/المورد) عبر دوال
  // delete/revert الموجودة أصلاً لكل نوع.
  const UndoManager = {
    all:  () => read('undo_log') || [],
    // آخر عملية قابلة للتراجع (أو null إن لم توجد)
    peek: () => (read('undo_log') || [])[0] || null,
    // تنفيذ التراجع عن آخر عملية. يُرجع { ok, undone } أو { ok:false, reason }
    undoLast: () => {
      const log = read('undo_log') || [];
      const last = log[0];
      if (!last) return { ok: false, reason: 'لا توجد عملية للتراجع عنها' };
      try {
        switch (last.type) {
          case 'sale':             Sales.delete(last.id); break;
          case 'return':           Returns.delete(last.id); break;
          case 'purchase':         Purchases.delete(last.id); break;
          case 'stock_adjustment': StockAdjustments.delete(last.id); break;
          default: return { ok: false, reason: 'نوع عملية غير معروف' };
        }
      } catch (e) {
        return { ok: false, reason: 'تعذّر التراجع عن هذه العملية' };
      }
      write('undo_log', log.slice(1));
      return { ok: true, undone: last };
    },
    clear: () => write('undo_log', []),
    // يُستخدم عندما يحذف المستخدم عملية يدوياً من صفحتها الخاصة (مثلاً حذف
    // فاتورة من صفحة الفواتير) حتى لا يبقى سجل تراجع يشير لعملية لم تعد موجودة
    invalidate: (type, id) => {
      write('undo_log', (read('undo_log') || []).filter(o => !(o.type === type && o.id === id)));
    }
  };

  return { Settings, Categories, Products, Suppliers, Customers,
           DebtPayments, SupplierPayments, Sales, Purchases, StockAdjustments, Returns, HeldSales,
           UndoManager,
           exportData, importData, resetAll, stats, uid, today, now };
})();