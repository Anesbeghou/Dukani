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
    undo_log: [],
    tombstones: {}   // شواهد الحذف: {جدول: {معرّف: وقت الحذف}} — لنقل الحذف للأجهزة الأخرى
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
  // ─── تتبّع التغييرات لأجل المزامنة (ختم زمني تلقائي) ───────────────────────
  // أي تعديل على منتج/زبون/مورد (دين، رصيد، مخزون...) يُختم تلقائياً بـ updatedAt
  // حتى تعرف المزامنة أن السجل تغيّر وأيّ نسخة هي الأحدث. نفس الشيء للإعدادات
  // لكن لكل مفتاح على حدة (_ts) حتى لا تطغى إعدادات جهاز على إعدادات آخر.
  const SYNC_MUTABLE = ['products', 'customers', 'suppliers'];
  const _sigs = {};            // table -> Map(id -> بصمة المحتوى)
  let _settingsSig = {};       // مفتاح الإعداد -> قيمته JSON
  let _tracking = false;       // لا نختم شيئاً قبل اكتمال الإقلاع (حتى لا تُختم القيم الافتراضية)
  let _remoteApply = false;    // أثناء دمج بيانات قادمة من جهاز آخر نحافظ على ختمها الأصلي

  // ─── عدّادات الحقول التراكمية (ديون، أرصدة، مخزون) ──────────────────────────
  // المشكلة: لو عدّل جهازان نفس الزبون/المنتج في اللحظة نفسها فاختيار "الأحدث" يُضيّع
  // أحد التعديلين (دين 1000 ← +200 على جهاز و+300 على آخر = 1500 وليس 1300 أو 1200).
  // الحل: لكل حقل تراكمي نحتفظ بعدّاد لكل جهاز {b: الأساس، p: ما زاده كل جهاز، n: ما أنقصه}
  //   القيمة = b + Σp − Σn
  // ودمج جهازين = أخذ الأكبر لكل خانة (max) — وهذا آمن ضد التكرار والتأخير وتبدّل
  // الترتيب (دمج نفس الرسالة مرتين لا يزيد شيئاً). كل تعديل محلي (بأي طريقة: بيع، سداد،
  // جرد، تعديل يدوي) يُلتقط تلقائياً لأن القيمة المخزّنة تختلف عن قيمة العدّاد.
  const PN_FIELDS = {
    customers: ['debt', 'debtProfit', 'totalBought'],
    suppliers: ['balance', 'totalPurchased', 'orderCount'],
    products:  ['stock']
  };
  const _pnLast = {};   // table -> Map(id -> _pn): حماية إن استُبدل السجل كاملاً دون عدّاداته
  let _pnDevCache = null;
  // معرّف عشوائي لكل تثبيت (لا نستخدم معرّف الترخيص: قد يتطابق بين جهازين من نفس الطراز،
  // وتطابق المعرّف يعني أن عدّادي الجهازين يتصادمان في نفس الخانة فيضيع تعديل أحدهما)
  function _pnDev() {
    if (_pnDevCache) return _pnDevCache;
    try {
      _pnDevCache = localStorage.getItem('dakani_pn_dev');
      if (!_pnDevCache) {
        _pnDevCache = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
        localStorage.setItem('dakani_pn_dev', _pnDevCache);
      }
    } catch (e) { _pnDevCache = 'd' + Math.random().toString(36).slice(2, 12); }
    return _pnDevCache;
  }
  const _r6 = x => Math.round(x * 1e6) / 1e6;
  const _isNum = v => typeof v === 'number' && isFinite(v);
  function _pnVals(table, it) {
    const o = {};
    for (const f of PN_FIELDS[table]) if (_isNum(it[f])) o[f] = it[f];
    if (table === 'products' && Array.isArray(it.variants)) {
      for (const v of it.variants) if (v && v.id !== undefined && _isNum(v.stock)) o['v:' + v.id] = v.stock;
    }
    return o;
  }
  function _pnSetVal(table, it, key, val) {
    if (key.startsWith('v:')) {
      if (!Array.isArray(it.variants)) return;
      const v = it.variants.find(x => x && String(x.id) === key.slice(2));
      if (v && _isNum(v.stock)) v.stock = val;
    } else if (it[key] === undefined || _isNum(it[key])) it[key] = val;
  }
  function _pnImplied(c) {
    let v = c.b;
    for (const d in c.p) v += c.p[d];
    for (const d in c.n) v -= c.n[d];
    return _r6(v);
  }
  // يضمن وجود عدّاد لكل حقل رقمي (الأساس = القيمة الحالية)
  function _pnEnsure(table, it, t) {
    const vals = _pnVals(table, it);
    let pn = it._pn;
    if (!pn || typeof pn !== 'object') {
      const keep = _pnLast[table] && _pnLast[table].get(it.id);
      pn = keep || {};
      it._pn = pn;
    }
    for (const k in vals) if (!pn[k]) pn[k] = { b: vals[k], bAt: t, p: {}, n: {} };
    return pn;
  }
  // يلتقط أي تغيير محلي في الحقول التراكمية ويسجّله في خانة هذا الجهاز
  function _pnAbsorb(table, it, t) {
    const pn = _pnEnsure(table, it, t);
    const vals = _pnVals(table, it);
    const dev = _pnDev();
    for (const k in vals) {
      const c = pn[k];
      const diff = _r6(vals[k] - _pnImplied(c));
      if (Math.abs(diff) > 1e-6) {
        if (diff > 0) c.p[dev] = _r6((c.p[dev] || 0) + diff);
        else c.n[dev] = _r6((c.n[dev] || 0) - diff);
      }
    }
    (_pnLast[table] || (_pnLast[table] = new Map())).set(it.id, pn);
  }
  function _pnMergeCounter(a, b) {
    // الأساس: الأحدث تهيئةً، وعند التساوي الأكبر قيمة — نفس الاختيار على كل الأجهزة
    let base = a;
    if (b.bAt > a.bAt || (b.bAt === a.bAt && b.b > a.b)) base = b;
    const m = { b: base.b, bAt: base.bAt, p: {}, n: {} };
    for (const side of ['p', 'n']) {
      const x = a[side] || {}, y = b[side] || {};
      new Set([...Object.keys(x), ...Object.keys(y)]).forEach(d => { m[side][d] = Math.max(x[d] || 0, y[d] || 0); });
    }
    return m;
  }

  // ─── ختم كل حقل على حدة (_ft) ───────────────────────────────────────────────
  // حتى لا يُلغي تعديلُ حقلٍ على جهاز (مثل دين زبون) تعديلَ حقلٍ آخر على جهاز ثانٍ
  // (مثل تغيير اسمه): كل حقل غير تراكمي يحمل وقت آخر تعديل له، وعند الدمج يفوز الأحدث
  // في كل حقل بمفرده. (متغيّرات المنتج تُقارَن بدون أرقام مخزونها لأنها تراكمية.)
  const _FT_SKIP = ['_pn', '_ft', 'updatedAt', 'image', 'id'];
  function _fieldJson(k, v) {
    if (k === 'variants' && Array.isArray(v)) {
      return JSON.stringify(v.map(x => {
        if (!x || typeof x !== 'object' || !_isNum(x.stock)) return x;
        const c = Object.assign({}, x); delete c.stock; return c;
      }));
    }
    return JSON.stringify(v);
  }
  function _ftStamp(table, it, prevSig, t) {
    let prevObj;
    try { prevObj = JSON.parse(prevSig); } catch (e) { return; }
    const acc = PN_FIELDS[table];
    new Set([...Object.keys(prevObj), ...Object.keys(it)]).forEach(k => {
      if (_FT_SKIP.includes(k) || acc.includes(k)) return;
      if (_fieldJson(k, prevObj[k]) !== _fieldJson(k, it[k])) { (it._ft || (it._ft = {}))[k] = t; }
    });
  }

  function _sigOf(it) {
    const o = Object.assign({}, it);
    delete o.image; delete o.updatedAt; delete o._pn; delete o._ft;
    return JSON.stringify(o);
  }
  function _settingsSnapshot(s) {
    const o = {};
    for (const k in (s || {})) { if (k !== '_ts') o[k] = JSON.stringify(s[k]); }
    return o;
  }
  function _trackChanges(key, val) {
    if (!_tracking) return;
    try {
      if (SYNC_MUTABLE.includes(key) && Array.isArray(val)) {
        const prev = _sigs[key], next = new Map(), t = now();
        for (const it of val) {
          if (!it || it.id === undefined) continue;
          if (PN_FIELDS[key]) {
            if (!_remoteApply) _pnAbsorb(key, it, t);
            else if (it._pn) (_pnLast[key] || (_pnLast[key] = new Map())).set(it.id, it._pn);
          }
          const sg = _sigOf(it);
          next.set(it.id, sg);
          if (!_remoteApply && prev && prev.get(it.id) !== sg) {
            it.updatedAt = t;
            if (PN_FIELDS[key]) _ftStamp(key, it, prev.get(it.id), t);
          }
        }
        _sigs[key] = next;
      } else if (key === 'settings' && val && typeof val === 'object') {
        const snap = _settingsSnapshot(val);
        if (!_remoteApply) {
          const prevTs = (cache.settings && cache.settings._ts) || {};
          const ts = Object.assign({}, prevTs, val._ts || {});
          const t = now();
          for (const k in snap) { if (_settingsSig[k] !== snap[k]) ts[k] = t; }
          val._ts = ts;
        }
        _settingsSig = snap;
      }
    } catch (e) { /* التتبّع لا يجب أن يمنع الحفظ أبداً */ }
  }

  // ─── تتبّع الحذف (شواهد حذف) ──────────────────────────────────────────────
  // عند اختفاء سجل من أي جدول متزامن نسجّل "شاهد حذف" بوقته، فيُرسَل لبقية الأجهزة
  // وتحذف السجل عندها أيضاً. لا نسجّل شيئاً أثناء: الإقلاع، دمج بيانات قادمة من جهاز
  // آخر، استيراد نسخة احتياطية. وإن عاد سجل محذوف (استعادة) نُلغي الشاهد ونختمه بالأحدث.
  const SYNC_TABLES_ALL = ['products', 'categories', 'customers', 'sales', 'sale_items',
    'purchases', 'suppliers', 'debt_payments', 'supplier_payments',
    'stock_adjustments', 'returns', 'held_sales'];
  const BULK_CLEAR_OK = ['held_sales', 'stock_adjustments']; // جداول يُسمح فيها بمسح جماعي مقصود
  const TOMB_MAX_AGE_DAYS = 120;
  const _idMaps = {};          // table -> Map(id -> اسم التصنيف أو '')
  let _noTomb = false;         // أثناء الاستيراد لا نسجّل حذفاً

  function _trackDeletes(key, val) {
    if (!_tracking || !SYNC_TABLES_ALL.includes(key) || !Array.isArray(val)) return;
    try {
      const prev = _idMaps[key];
      const next = new Map();
      for (const it of val) {
        if (it && it.id !== undefined) next.set(it.id, key === 'categories' ? (it.name || '') : '');
      }
      if (prev && !_remoteApply) {
        const store = cache.tombstones || (cache.tombstones = {});
        const tm = store[key] || (store[key] = {});
        const t = now();
        let touched = false;
        const removed = [];
        prev.forEach((label, id) => { if (!next.has(id)) removed.push([id, label]); });
        // حماية: مسح جماعي ضخم غير معتاد (خلل محتمل) لا يتحوّل لحذف يعمّ كل الفريق
        const suspicious = removed.length > 50 && removed.length > prev.size * 0.5 && !BULK_CLEAR_OK.includes(key);
        if (!_noTomb && !suspicious) {
          removed.forEach(([id, label]) => {
            tm[String(id)] = t;
            if (key === 'categories' && label) tm['name:' + label] = t;
            touched = true;
          });
        }
        // سجل عاد للظهور بعد حذفه → نلغي الشاهد ونختم السجل بوقت جديد ليقبله الآخرون
        if (Object.keys(tm).length) {
          for (const it of val) {
            if (!it || it.id === undefined || prev.has(it.id)) continue;
            const k1 = String(it.id), k2 = key === 'categories' ? 'name:' + (it.name || '') : null;
            if (tm[k1] || (k2 && tm[k2])) {
              delete tm[k1]; if (k2) delete tm[k2];
              it.updatedAt = t; touched = true;
            }
          }
        }
        if (touched) idb.set(PREFIX + 'tombstones', store);
      }
      _idMaps[key] = next;
    } catch (e) { /* لا نمنع الحفظ أبداً */ }
  }

  const write = (key, val) => {
    _trackChanges(key, val);
    _trackDeletes(key, val);
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
    _initSyncTracking();
    
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
    _initSyncTracking();
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
        const vs = p.variants.reduce((s, v) => s + (parseFloat(v.stock) || 0), 0);
        // sellBase: يُسمح ببيع المنتج الأساسي نفسه إلى جانب متغيّراته (مخزونه المستقل p.stock)
        return vs + (p.sellBase ? (parseFloat(p.stock) || 0) : 0);
      }
      return p.stock || 0;
    },
    // ─── سعر الشراء المعلَّق (منتج أضافه موظف بدون سعر شراء) ─────────────────
    pendingCost: () => read('products').filter(p => p.needsCost),
    // يُدخله المدير لاحقاً: يحفظ سعر الشراء ويُعيد احتساب أرباح كل المبيعات السابقة
    // لهذا المنتج التي كانت معلَّقة (costPending) فتدخل كل الأرقام في التقارير والبطاقات.
    setCost: (id, buyPrice, variantBuys) => {
      const list = read('products');
      const i = list.findIndex(p => p.id === id);
      if (i === -1) return null;
      list[i].buyPrice = Math.max(0, parseFloat(buyPrice) || 0);
      if (variantBuys && Array.isArray(list[i].variants)) {
        list[i].variants.forEach(v => {
          if (variantBuys[v.id] !== undefined && variantBuys[v.id] !== '') v.buyPrice = parseFloat(variantBuys[v.id]) || 0;
        });
      }
      if (list[i].buyPrice > 0) list[i].needsCost = false;
      list[i].updatedAt = now();
      write('products', list);
      if (!list[i].needsCost) Sales.resolvePendingCost(id);
      return list[i];
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
        sellerId:   saleData.sellerId   || null,   // من باع (مدير أو موظف)
        sellerName: saleData.sellerName || '',
        sellerRole: saleData.sellerRole || '',
        hasPendingCost: (saleData.items || []).some(it => it.costPending),
        paymentMethod,
        cashAmount,
        creditAmount,
        date: now(),
        createdAt: now()
      };
      sales.push(sale); write('sales', sales);

      // store items flat too for fast querying
      saleData.items.forEach((it, idx) => {
        items.push({ ...it, id: sale.id + '#' + idx, saleId: sale.id, date: sale.date });
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
        // الأرقام الصافية (بعد المرتجعات) من المحرّك المركزي عند توفّره
        const F = (typeof DakaniFin !== 'undefined') ? DakaniFin.compute(ds, ds) : null;
        days.push({
          label: d.toLocaleDateString('ar-DZ', { weekday: 'short' }),
          total: F ? F.netSales : daySales.reduce((a, s) => a + s.total, 0),
          profit: F ? F.profitRealized : daySales.reduce((a, s) => a + Sales.netProfit(s), 0) + dayDebtProfit
        });
      }
      return days;
    },
    // ─── الربح الصافي المحقَّق فعلياً لفاتورة واحدة (يستثني الجزء الآجل غير المُسدَّد) ─
    // متوافق مع الفواتير القديمة (قبل هذا التحديث) التي لا تحتوي على cashProfit:
    // تُعتبر أرباحها محقَّقة بالكامل كما كانت (لا يمكن إعادة تقسيمها بأثر رجعي).
    netProfit: sale => (typeof sale.cashProfit === 'number' ? sale.cashProfit : (sale.profit || 0)),

    // ─── إعادة احتساب الأرباح بعد أن يُدخل المدير سعر الشراء الناقص لمنتج ────────
    // تمرّ على كل الفواتير التي فيها بنود costPending لهذا المنتج وتصحّح: سعر الشراء
    // والربح في البند (المضمَّن والمسطَّح)، ثم ربح الفاتورة (نقدي/آجل)، ثم الربح المعلَّق
    // على الزبون (للجزء الآجل). تُرجع عدد الفواتير المُصحَّحة.
    resolvePendingCost: productId => {
      const prod = Products.byId(productId);
      if (!prod) return 0;
      const sales = read('sales');
      const flat  = read('sale_items');
      let fixed = 0;
      sales.forEach(sale => {
        let touched = false;
        (sale.items || []).forEach((it, idx) => {
          if (!it.costPending || it.productId !== productId) return;
          const bp = Products.effectiveBuyPrice(prod, it.variantId);
          const d  = Math.min(100, Math.max(0, parseFloat(it.discount) || 0));
          const eff = (it.price || 0) * (1 - d / 100);
          it.buyPrice = bp;
          it.profit = (eff - bp) * it.qty;
          it.costPending = false;
          touched = true;
          const f = flat.find(x => x.id === sale.id + '#' + idx);
          if (f) { f.buyPrice = bp; f.profit = it.profit; f.costPending = false; }
        });
        if (!touched) return;
        fixed++;
        const k = 1 - (sale.discount || 0) / 100;
        // الربح = إيراد البند بعد خصم الفاتورة − تكلفته (البنود المعلَّقة بلا ربح)
        const sumProfit = arr => arr.reduce((a, it) => a + (it.costPending ? 0 : ((it.total || 0) * k - (it.buyPrice || 0) * (it.qty || 0))), 0);
        const newCredit = sumProfit((sale.items || []).filter(it => (it.payType || 'cash') === 'credit'));
        const newCash   = sumProfit((sale.items || []).filter(it => (it.payType || 'cash') !== 'credit'));
        const oldCredit = sale.creditProfit || 0;
        sale.profit = newCredit + newCash;
        sale.cashProfit = newCash;
        sale.creditProfit = newCredit;
        sale.hasPendingCost = (sale.items || []).some(it => it.costPending);
        if (sale.customerId && newCredit !== oldCredit) Customers.adjustDebtProfit(sale.customerId, newCredit - oldCredit);
      });
      if (fixed) { write('sales', sales); write('sale_items', flat); }
      // المرتجعات المرتبطة بهذا المنتج التي سُجّلت قبل معرفة التكلفة: صحّح تكلفتها
      const rets = read('returns'); let retTouched = false;
      rets.forEach(r => {
        let t = false;
        (r.items || []).forEach(ri => {
          if (!ri.costPending || ri.productId !== productId) return;
          ri.buyPrice = Products.effectiveBuyPrice(prod, ri.variantId); ri.costPending = false; t = true;
        });
        if (t) {
          r.cost = +(r.items.reduce((a, ri) => a + (ri.buyPrice || 0) * (ri.qty || 0), 0)).toFixed(2);
          r.creditCost = +(r.items.filter(ri => (ri.payType || 'cash') === 'credit').reduce((a, ri) => a + (ri.buyPrice || 0) * (ri.qty || 0), 0)).toFixed(2);
          retTouched = true;
        }
      });
      if (retTouched) write('returns', rets);
      return fixed;
    }
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
    // تعديل مباشر للرصيد بإشارة (+/−) دون المساس بتاريخ آخر دفعة — يُستخدم للمشتريات الآجلة
    adjustBalance: (id, delta) => {
      if (!delta) return;
      const list = read('suppliers');
      const i    = list.findIndex(s => s.id === id);
      if (i > -1) {
        list[i].balance = Math.max(0, (list[i].balance || 0) + delta);
        list[i].updatedAt = now();
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
    // الجزء الآجل (غير المدفوع) من مشترى: 0 إن لم يكن هناك مورد أو كان الدفع نقدياً
    creditPortion: p => {
      if (!p || !p.supplierId) return 0;
      const total = (p.qty || 0) * (p.unitPrice || 0);
      if (p.paymentType === 'credit') return total;
      if (p.paymentType === 'partial') return Math.max(0, Math.min(total, total - (parseFloat(p.paidAmount) || 0)));
      return 0;
    },
    save: data => {
      const list = read('purchases');
      const purchase = { ...data, id: uid(), createdAt: now() };
      purchase.creditAmount = Purchases.creditPortion(purchase);
      list.push(purchase); write('purchases', list);
      Products.adjustStock(data.productId, data.qty);
      // الشراء بالدين: يُضاف الجزء غير المدفوع إلى المستحق للمورد
      if (purchase.creditAmount > 0) Suppliers.adjustBalance(data.supplierId, purchase.creditAmount);
      // منتج أضافه موظف بلا سعر شراء: أول مشترى يحدّد سعره ويُعيد احتساب أرباحه
      const pp = Products.byId(data.productId);
      if (pp && pp.needsCost && (data.unitPrice || 0) > 0) Products.setCost(data.productId, data.unitPrice);
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
        const oldCredit = p.creditAmount != null ? p.creditAmount : Purchases.creditPortion(p);
        if (oldCredit > 0 && p.supplierId) Suppliers.adjustBalance(p.supplierId, -oldCredit);
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
      const oldCredit = old.creditAmount != null ? old.creditAmount : Purchases.creditPortion(old);
      if (oldCredit > 0 && old.supplierId) Suppliers.adjustBalance(old.supplierId, -oldCredit);

      // تطبيق أثر البيانات الجديدة
      const updated = { ...old, ...data, id: old.id, createdAt: old.createdAt, updatedAt: now() };
      updated.creditAmount = Purchases.creditPortion(updated);
      list[i] = updated;
      write('purchases', list);
      if (updated.creditAmount > 0) Suppliers.adjustBalance(updated.supplierId, updated.creditAmount);

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
        // نعكس الفرق فقط (وليس oldQty) حتى لا نمحو حركات بيع/شراء حدثت بعد التسوية
        prods[pi].stock = Math.max(0, (prods[pi].stock || 0) - (adj.delta || 0));
        prods[pi].updatedAt = now();
        write('products', prods);
      }
      write('stock_adjustments', list.filter(a => a.id !== id));
    },
    // تعديل تسوية محفوظة (الكمية الجديدة/السبب/الملاحظة). تُعاد حركة المخزون بالفرق فقط،
    // وتُحدَّث القيمة المالية للخسارة وفق الكمية الجديدة.
    update: (id, patch) => {
      const adjs = read('stock_adjustments');
      const ai = adjs.findIndex(a => a.id === id);
      if (ai < 0) return null;
      const adj = adjs[ai];
      const prods = read('products');
      const pi = prods.findIndex(p => p.id === adj.productId);
      if (patch.newQty !== undefined && patch.newQty !== '' && !isNaN(parseFloat(patch.newQty))) {
        const newQty = Math.max(0, parseFloat(patch.newQty));
        if (pi > -1) {
          prods[pi].stock = Math.max(0, (prods[pi].stock || 0) + (newQty - adj.newQty));
          prods[pi].updatedAt = now();
          if (adj.reason === 'انتهاء الصلاحية' && newQty === 0) prods[pi].expiryDate = '';
          write('products', prods);
        }
        adj.newQty = newQty;
        adj.delta = newQty - adj.oldQty;
        const bp = pi > -1 ? (prods[pi].buyPrice || 0) : 0;
        adj.costImpact = adj.delta < 0 ? Math.round(Math.abs(adj.delta) * bp * 100) / 100 : 0;
      }
      if (patch.reason !== undefined) adj.reason = patch.reason || adj.reason;
      if (patch.note !== undefined) adj.note = patch.note;
      adj.updatedAt = now();
      adjs[ai] = adj;
      write('stock_adjustments', adjs);
      return adj;
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
        originalPaymentMethod: data.originalPaymentMethod || null,
        sellerId:      data.sellerId      || null,   // من سجّل المرتجع
        sellerName:    data.sellerName    || '',
        date:          now(),
        createdAt:     now()
      };

      // ─── المحاسبة الحقيقية للمرتجع: التكلفة + الجزء الآجل ──────────────────────
      // cost        = تكلفة البضاعة المُرتجعة (سعر الشراء × الكمية) — تُخصم من تكلفة المبيعات
      // creditRefund = جزء الاسترداد الذي كان ديناً على الزبون (بنود آجلة) → يُنقص دينه
      // creditCost   = تكلفة هذا الجزء → يُنقص "الربح المعلَّق" بدل الربح المحقَّق
      // المرتجع لا يُحسب كربح ولا كمبيعات: يُطرح من المبيعات ومن الربح في كل التقارير.
      let cost = 0, creditRefund = 0, creditCost = 0;
      ret.items.forEach(it => {
        const prod = it.productId ? Products.byId(it.productId) : null;
        let bp = (typeof it.buyPrice === 'number') ? it.buyPrice : (prod ? Products.effectiveBuyPrice(prod, it.variantId) : 0);
        // منتج بلا سعر شراء بعد: لا ربح مفقود في هذا المرتجع (كان بيعه بلا ربح محتسب)
        if (prod && prod.needsCost && !(bp > 0)) { bp = it.qty ? (it.total || 0) / it.qty : 0; it.costPending = true; }
        it.buyPrice = bp;
        const lineCost = bp * (it.qty || 0);
        cost += lineCost;
        const isCredit = it.payType ? it.payType === 'credit' : data.originalPaymentMethod === 'credit';
        if (isCredit && ret.customerId) { creditRefund += (it.total || 0); creditCost += lineCost; }
      });
      ret.cost = +cost.toFixed(2);
      ret.creditRefund = +creditRefund.toFixed(2);
      ret.creditCost = +creditCost.toFixed(2);

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
          // الجزء الآجل من المرتجع يُنقص دين الزبون (بحد أقصى دينه الحالي)، ويُنقص معه الربح المعلَّق
          const debtBefore = custs[ci].debt || 0;
          const debtCut = Math.min(debtBefore, ret.creditRefund || 0);
          custs[ci].debt = Math.max(0, debtBefore - debtCut);
          ret.debtReduced = +debtCut.toFixed(2);
          const pendCut = debtCut > 0 && (ret.creditRefund || 0) > 0
            ? Math.max(0, (ret.creditRefund - ret.creditCost)) * (debtCut / ret.creditRefund) : 0;
          ret.debtProfitReduced = +Math.min(pendCut, custs[ci].debtProfit || 0).toFixed(2);
          custs[ci].debtProfit = Math.max(0, (custs[ci].debtProfit || 0) - ret.debtProfitReduced);
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
          // إلغاء المرتجع يُعيد الدين والربح المعلَّق اللذين أُنقصا عند إنشائه
          custs[ci].debt = (custs[ci].debt || 0) + (ret.debtReduced || 0);
          custs[ci].debtProfit = (custs[ci].debtProfit || 0) + (ret.debtProfitReduced || 0);
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
  const CASHBOX_LS_KEYS = ['dakani_cbx_expenses', 'dakani_cbx_capital', 'dakani_cbx_shifts', 'dakani_cbx_moves', 'dakani_cbx_income'];
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
    a.download = `dukani-backup-${today()}.json`;
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
          if (typeof toast === 'function') toast('هذا الملف ليس نسخة بيانات دكاني صالحة / Not a valid Dukani backup file', 'error');
          return;
        }
        _noTomb = true; window.__dkNoTomb = true; // الاستعادة لا تُعدّ حذفاً
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
        _noTomb = false; window.__dkNoTomb = false;
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


  // ─── SYNC API (مزامنة الفريق عبر online-sync.js) ───────────────────────────
  // كل الدمج يتم عبر ذاكرة التطبيق نفسها (cache) ثم write() — فلا يتجاوز أحد
  // الآخر، وتظهر البيانات المستلمة فوراً في الواجهة دون إعادة تحميل.
  const SYNC_TABLES = ['products', 'categories', 'customers', 'sales', 'sale_items',
    'purchases', 'suppliers', 'debt_payments', 'supplier_payments',
    'stock_adjustments', 'returns', 'held_sales'];
  const SETTINGS_BASELINE_TS = '2000-01-01T00:00:00.000Z';
  const SETTINGS_DEFAULTS = {
    storeName: 'دكاني', address: '', phone: '', currency: 'دج', lowStockThreshold: 5,
    expiryWarningDays: 15, logo: '', thankYouMessage: 'شكراً لتعاملكم معنا 🙏', language: 'ar',
    alertLowStock: true, alertExpired: true, alertExpiringSoon: true,
    alertCustomerDebt: true, alertSupplierDebt: true,
    custTierSilver: 5000, custTierGold: 20000, custTierVip: 50000
  };

  // يُستدعى مرة واحدة بعد الإقلاع: يلتقط بصمات الوضع الحالي ويبدأ ختم أي تعديل لاحق
  function _initSyncTracking() {
    try {
      // عدّادات الحقول التراكمية للسجلات الموجودة (الأساس = قيمتها الحالية)
      const tPn = now();
      for (const tb in PN_FIELDS) {
        let touchedPn = false;
        (cache[tb] || []).forEach(it => {
          if (!it || it.id === undefined) return;
          if (!it._pn) touchedPn = true;
          const pn = _pnEnsure(tb, it, tPn);
          (_pnLast[tb] || (_pnLast[tb] = new Map())).set(it.id, pn);
        });
        if (touchedPn) idb.set(PREFIX + tb, cache[tb]);
      }
      SYNC_MUTABLE.forEach(t => {
        const m = new Map();
        (cache[t] || []).forEach(it => { if (it && it.id !== undefined) m.set(it.id, _sigOf(it)); });
        _sigs[t] = m;
      });
      const s = cache.settings || (cache.settings = {});
      if (!s._ts) s._ts = {};
      // الإعدادات التي عدّلها التاجر سابقاً (قبل هذا التحديث) تُعتبر "أقدم من أي تعديل جديد
      // لكن أحدث من القيمة الافتراضية" حتى تنتقل لجهاز جديد بدل أن تطغى عليها قيمه الافتراضية
      for (const k in s) {
        if (k === '_ts' || s._ts[k]) continue;
        if (JSON.stringify(s[k]) !== JSON.stringify(SETTINGS_DEFAULTS[k])) s._ts[k] = SETTINGS_BASELINE_TS;
      }
      _settingsSig = _settingsSnapshot(s);
      SYNC_TABLES_ALL.forEach(t => {
        const m = new Map();
        (cache[t] || []).forEach(it => { if (it && it.id !== undefined) m.set(it.id, t === 'categories' ? (it.name || '') : ''); });
        _idMaps[t] = m;
      });
      // بنود الفواتير القديمة كانت بلا معرّف (id) فلم تكن تُنقل بين الأجهزة إطلاقاً.
      // نعطيها معرّفاً ثابتاً (معرّف الفاتورة + ترتيب البند) — نفس صيغة البنود الجديدة.
      // يتم قبل التقاط خرائط المعرّفات حتى لا يُعدّ هذا التعديل حذفاً أو تغييراً.
      const siList = cache.sale_items || [];
      const siPos = {};
      let siFixed = false;
      for (const it of siList) {
        if (!it || !it.saleId) continue;
        const k = siPos[it.saleId] || 0;
        siPos[it.saleId] = k + 1;
        if (it.id === undefined) { it.id = it.saleId + '#' + k; siFixed = true; }
      }
      if (siFixed) {
        idb.set(PREFIX + 'sale_items', siList);
        const m2 = new Map();
        siList.forEach(it => { if (it && it.id !== undefined) m2.set(it.id, ''); });
        _idMaps['sale_items'] = m2;
      }
      // تنظيف شواهد الحذف القديمة جداً حتى لا تتراكم للأبد
      const store = cache.tombstones || (cache.tombstones = {});
      const cutoff = new Date(Date.now() - TOMB_MAX_AGE_DAYS * 864e5).toISOString();
      let pruned = false;
      for (const t in store) for (const k in store[t]) { if (store[t][k] < cutoff) { delete store[t][k]; pruned = true; } }
      if (pruned) idb.set(PREFIX + 'tombstones', store);
      _tracking = true;
    } catch (e) { _tracking = false; }
  }

  const _tsOf = it => (it && (it.updatedAt || it.createdAt || it.date)) || '';
  function _canon(v) {
    if (Array.isArray(v)) return '[' + v.map(_canon).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter(k => v[k] !== undefined).sort().map(k => JSON.stringify(k) + ':' + _canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  function _plain(it) { const o = Object.assign({}, it); delete o.image; return _canon(o); }

  // دمج سجل (منتج/زبون/مورد) فيه حقول تراكمية: باقي الحقول بقاعدة "الأحدث"،
  // أما الحقول التراكمية فتُحسب من دمج العدّادات (max) — لا يضيع أي تعديل متزامن.
  function _mergePNRecord(table, loc, inc) {
    const t = now();
    _pnEnsure(table, loc, t);
    if (!inc._pn || typeof inc._pn !== 'object') {
      // نسخة من جهاز بإصدار قديم (بلا عدّادات): نرجع للمنطق القديم
      if (!_incomingWins(loc, inc)) return null;
      const r0 = Object.assign({}, inc);
      _pnEnsure(table, r0, t);
      if (table === 'products' && loc.image && !r0.image) r0.image = loc.image;
      return r0;
    }
    // الحقول غير التراكمية: الأحدث في كل حقل بمفرده
    const acc = PN_FIELDS[table];
    const recWinner = _incomingWins(loc, inc) ? 'inc' : 'loc';   // عند غياب ختم الحقل نعود لقاعدة السجل كله
    const r = {};
    const ft = {};
    new Set([...Object.keys(loc), ...Object.keys(inc)]).forEach(k => {
      if (_FT_SKIP.includes(k) && k !== 'id') return;
      if (k === 'id') { r.id = loc.id; return; }
      if (acc.includes(k)) return;            // تُحسب من العدّادات أدناه
      const lt = (loc._ft && loc._ft[k]) || '', it2 = (inc._ft && inc._ft[k]) || '';
      let pick;
      if (lt || it2) {
        if (it2 > lt) pick = 'inc';
        else if (it2 < lt) pick = 'loc';
        else pick = _canon(inc[k]) > _canon(loc[k]) ? 'inc' : 'loc';
      } else pick = recWinner;
      const src = pick === 'inc' ? inc : loc;
      if (src[k] !== undefined) r[k] = JSON.parse(JSON.stringify(src[k]));
      const mx = lt > it2 ? lt : it2;
      if (mx) ft[k] = mx;
    });
    // الحقول التراكمية (غير الرقمية أو غير المُدارة) تبقى كما هي من النسخة الأحدث
    acc.forEach(k => { if (r[k] === undefined) { const src = recWinner === 'inc' ? inc : loc; if (src[k] !== undefined) r[k] = src[k]; } });
    if (Object.keys(ft).length) r._ft = ft;
    r._pn = {};
    const keys = new Set([...Object.keys(loc._pn || {}), ...Object.keys(inc._pn || {})]);
    keys.forEach(k => {
      const a2 = (loc._pn || {})[k], b2 = inc._pn[k];
      r._pn[k] = (a2 && b2) ? _pnMergeCounter(a2, b2) : JSON.parse(JSON.stringify(a2 || b2));
      _pnSetVal(table, r, k, _pnImplied(r._pn[k]));
    });
    const tl = loc.updatedAt || '', ti = inc.updatedAt || '';
    if (tl || ti) r.updatedAt = tl > ti ? tl : ti;
    if (table === 'products' && loc.image && !r.image) r.image = loc.image;
    return _plain(r) !== _plain(loc) ? r : null;
  }
  // هل النسخة القادمة أحدث من المحلية؟ عند تساوي الختم نختار نسخة محدّدة بشكل ثابت
  // (نفس الاختيار على كل الأجهزة) حتى تتطابق الأجهزة ولا تتبادل التحديثات للأبد
  function _incomingWins(loc, inc) {
    const lt = _tsOf(loc), it = _tsOf(inc);
    if (it > lt) return true;
    if (it < lt) return false;
    const a = _plain(inc), b = _plain(loc);
    return a !== b && a > b;
  }

  // ─── شواهد الحذف: قراءة/دمج ─────────────────────────────────────────────
  function _tombAt(table, it) {
    const tm = (cache.tombstones || {})[table];
    if (!tm) return '';
    const a = tm[String(it.id)] || '';
    const b = table === 'categories' ? (tm['name:' + (it.name || '')] || '') : '';
    return a > b ? a : b;
  }
  function _clearTomb(table, it) {
    const tm = (cache.tombstones || {})[table];
    if (!tm) return;
    delete tm[String(it.id)];
    if (table === 'categories') delete tm['name:' + (it.name || '')];
  }
  function _persistTombs() { idb.set(PREFIX + 'tombstones', cache.tombstones || {}); }

  function tombstones() {
    const out = [], store = cache.tombstones || {};
    for (const t in store) for (const id in store[t]) out.push({ t, id, at: store[t][id] });
    return out;
  }

  // تطبيق حذف قادم من جهاز آخر: نحذف السجل المحلي إن لم يُعدَّل بعد وقت الحذف
  function mergeTombstones(list) {
    if (!Array.isArray(list) || !list.length) return false;
    const store = cache.tombstones || (cache.tombstones = {});
    const byTable = {};
    for (const x of list) {
      if (!x || !x.t || x.id === undefined || !x.at || !SYNC_TABLES.includes(x.t)) continue;
      (byTable[x.t] = byTable[x.t] || []).push(x);
    }
    let changed = false, tombTouched = false;
    for (const t in byTable) {
      const tm = store[t] || (store[t] = {});
      for (const x of byTable[t]) {
        const k = String(x.id);
        if (!tm[k] || tm[k] < x.at) { tm[k] = x.at; tombTouched = true; }
      }
      const table = read(t);
      if (!Array.isArray(table)) continue;
      const keep = [];
      let removedAny = false;
      for (const it of table) {
        if (it && it.id !== undefined) {
          const at = _tombAt(t, it);
          if (at && _tsOf(it) <= at) { removedAny = true; continue; }
        }
        keep.push(it);
      }
      if (removedAny) {
        _remoteApply = true;
        try { write(t, keep); } finally { _remoteApply = false; }
        changed = true;
      }
    }
    if (tombTouched) _persistTombs();
    return changed;
  }

  function mergeRecords(table, items) {
    if (!SYNC_TABLES.includes(table) || !Array.isArray(items) || !items.length) return false;
    const list = read(table);
    if (!Array.isArray(list)) return false;
    const idx = new Map();
    list.forEach((x, i) => { if (x && x.id !== undefined) idx.set(x.id, i); });
    const names = table === 'categories' ? new Set(list.map(c => c && c.name)) : null;
    let changed = false, tombTouched = false;
    for (const inc of items) {
      if (!inc || inc.id === undefined) continue;
      // سجل محذوف عندنا: لا يعود إلا إن عُدّل بعد وقت الحذف
      const tat = _tombAt(table, inc);
      if (tat) {
        if (_tsOf(inc) <= tat) continue;
        _clearTomb(table, inc); tombTouched = true;
      }
      const i = idx.get(inc.id);
      if (i === undefined) {
        // التصنيفات الافتراضية لها معرّفات عشوائية على كل جهاز، والمنتجات تشير للتصنيف
        // بالاسم — لذلك لا نُضيف تصنيفاً بنفس الاسم مرة ثانية (يمنع التكرار)
        if (names && names.has(inc.name)) continue;
        if (PN_FIELDS[table]) _pnEnsure(table, inc, now());
        idx.set(inc.id, list.length);
        list.push(inc);
        if (names) names.add(inc.name);
        changed = true;
        continue;
      }
      const loc = list[i];
      if (PN_FIELDS[table]) {
        const merged = _mergePNRecord(table, loc, inc);
        if (merged) { list[i] = merged; changed = true; }
        continue;
      }
      if (_incomingWins(loc, inc)) {
        // الصور لا تُنقل بين الأجهزة — نُبقي صورة هذا الجهاز كما هي ولا نمسحها
        list[i] = (table === 'products' && loc.image && !inc.image) ? Object.assign({}, inc, { image: loc.image }) : inc;
        changed = true;
      }
    }
    if (changed) {
      _remoteApply = true;
      try { write(table, list); } finally { _remoteApply = false; }
    }
    if (tombTouched) _persistTombs();
    return changed;
  }

  // دمج الإعدادات لكل مفتاح على حدة: الأحدث يفوز (بدل أن يفوز المحلي دائماً)
  function mergeSettings(remote) {
    if (!remote || typeof remote !== 'object') return false;
    const local = read('settings') || {};
    const lts = Object.assign({}, local._ts || {});
    const rts = remote._ts || {};
    const next = Object.assign({}, local);
    let changed = false;
    for (const k in remote) {
      if (k === '_ts') continue;
      const rv = JSON.stringify(remote[k]);
      const has = Object.prototype.hasOwnProperty.call(local, k);
      let take = false;
      const a = rts[k] || '', b = lts[k] || '';
      if (!has) take = true;
      else if (rv !== JSON.stringify(local[k])) {
        if (a > b) take = true;
        else if (a === b && a !== '') take = rv > JSON.stringify(local[k]);
      }
      if (take) { next[k] = remote[k]; if (a) lts[k] = a; changed = true; }
    }
    if (changed) {
      next._ts = lts;
      _remoteApply = true;
      try { write('settings', next); } finally { _remoteApply = false; }
    }
    return changed;
  }

  const Sync = {
    TABLES: SYNC_TABLES,
    table: t => read(t) || [],
    settings: () => read('settings') || {},
    mergeRecords, mergeSettings, mergeTombstones, tombstones
  };

  return { Settings, Categories, Products, Suppliers, Customers, Sync,
           DebtPayments, SupplierPayments, Sales, Purchases, StockAdjustments, Returns, HeldSales,
           UndoManager,
           exportData, importData, resetAll, stats, uid, today, now };
})();