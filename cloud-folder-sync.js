/**
 * DAKANI CLOUD FOLDER SYNC v1.0
 * ─────────────────────────────────────────────────────────────
 * مزامنة تلقائية كل 60 ثانية إلى أي منصة سحابية (Google Drive،
 * Dropbox، OneDrive... إلخ) — دون الحاجة لأي حساب مطوّر أو
 * Client ID أو اتصال API مباشر بأي شركة.
 *
 * الفكرة: تختار مرة واحدة فقط "المجلد المحلي" الذي يرفعه برنامج
 * المزامنة السحابية (Google Drive for Desktop / Dropbox / OneDrive)
 * تلقائياً لحسابك، ويكتب هذا الملف نسخة محدَّثة من بيانات دكاني
 * بداخل هذا المجلد كل 60 ثانية. برنامج المزامنة السحابي نفسه هو من
 * يتكفّل برفعها فعلياً للإنترنت — نحن فقط نكتب الملف محلياً.
 *
 * ⚠️ ملف مستقل تماماً (بنفس مبدأ camera-scanner.js و license.js):
 * لا يعدّل أي دالة أو ملف موجود، ويعيد استخدام دوال DakaniBackup
 * العامة الجاهزة (downloadNow, restoreFromFile) كحل بديل فقط في
 * المتصفحات التي لا تدعم الميزة، دون المساس بـ backup.js إطلاقاً.
 *
 * ⚠️ قيود المتصفح (وليست عيباً في الكود، بل قيد أمان من المتصفح):
 *  - تعمل هذه الميزة فقط في متصفحات تعتمد على Chromium على حاسوب
 *    مكتبي: Google Chrome، Microsoft Edge، Opera، Brave...
 *    (File System Access API غير مدعومة في Firefox أو Safari أو
 *    على الهاتف حالياً). في هذه الحالات نعرض بديلاً: تنزيل يدوي
 *    للملف يضعه التاجر بنفسه داخل مجلد المزامنة السحابي.
 *  - تتطلب أن يُفتح التطبيق عبر https:// أو http://localhost
 *    (نفس قيد أي ميزة أمان متصفح حديثة) — لا تعمل بفتح الملف
 *    مباشرة (file://).
 *  - قد يطلب المتصفح تأكيد الصلاحية مرة أخرى بعد إغلاقه وإعادة
 *    فتحه (قيد أمان من المتصفح لحماية ملفات المستخدم) — يكفي حينها
 *    ضغطة واحدة على زر "إعادة التفعيل" الذي يظهر تلقائياً.
 */

const DakaniCloudSync = (() => {

  const FILE_NAME    = 'dakani-backup.json';
  const INTERVAL_MS  = 60 * 1000; // 60 ثانية بالضبط كما طُلب

  const LS_LINKED     = 'dakani_cloudsync_linked';
  const LS_LAST_SYNC  = 'dakani_cloudsync_last';
  const LS_FOLDER_NAME= 'dakani_cloudsync_folder_name';

  const IDB_NAME  = 'DakaniCloudSyncDB';
  const IDB_STORE = 'handles';
  const IDB_KEY   = 'dirHandle';

  // نفس قائمة الجداول المستخدمة في backup.js تماماً — لضمان توافق كامل
  const TABLES = [
    'settings', 'categories', 'products', 'customers',
    'sales', 'sale_items', 'purchases', 'suppliers',
    'debt_payments', 'stock_adjustments', 'returns', 'seeded'
  ];

  let intervalId  = null;
  let needsReauth = false;

  // ────────────────────────────────────────────────────────────
  function isSupported() {
    return typeof window.showDirectoryPicker === 'function' && window.isSecureContext;
  }
  function isLinked() { return localStorage.getItem(LS_LINKED) === '1'; }
  function getLastSync() { return localStorage.getItem(LS_LAST_SYNC) || ''; }
  function getFolderName() { return localStorage.getItem(LS_FOLDER_NAME) || ''; }
  function getNeedsReauth() { return needsReauth; }

  // ─── تخزين/قراءة مقبض المجلد (FileSystemDirectoryHandle) عبر IndexedDB ─
  // (لا يمكن تخزينه في localStorage، فقط IndexedDB يدعم structured clone له)
  function _openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = e => { e.target.result.createObjectStore(IDB_STORE); };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => reject(e.target.error);
    });
  }
  async function _saveHandle(handle) {
    const db = await _openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(handle, IDB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function _loadHandle() {
    try {
      const db = await _openIdb();
      return new Promise(resolve => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
        r.onsuccess = () => resolve(r.result || null);
        r.onerror   = () => resolve(null);
      });
    } catch (e) { return null; }
  }
  async function _clearHandle() {
    try {
      const db = await _openIdb();
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
    } catch (e) {}
  }

  // ─── التحقق من الصلاحية، وطلبها فقط عند الحاجة ────────────────
  // queryPermission لا يحتاج تفاعل مستخدم (يمكن استدعاؤه تلقائياً بصمت).
  // requestPermission يحتاج غالباً ضغطة مستخدم فعلية (زر) لتنجح.
  async function _hasPermission(handle) {
    try { return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted'; }
    catch (e) { return false; }
  }
  async function _requestPermission(handle) {
    try { return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted'; }
    catch (e) { return false; }
  }

  // ─── بيانات "المصاريف والصندوق" و"المدراء/الموظفين" (localStorage مستقل) ──
  // هذه المفاتيح ليست جزءاً من IndexedDB، ولم تكن مشمولة سابقاً في مزامنة
  // مجلد السحابة (كانت مشمولة فقط في backup.js)، لذا أي مزامنة بين جهازين
  // كانت تفوّت بيانات الصندوق وحسابات المدراء/الموظفين. نجمعها ونستعيدها هنا
  // بنفس المنطق تماماً حتى تُنقَل مع بقية بيانات المحل.
  const CASHBOX_LS_KEYS = ['dakani_cbx_expenses', 'dakani_cbx_capital', 'dakani_cbx_shifts', 'dakani_cbx_moves'];
  const ACCOUNTS_LS_KEYS = ['dakani_manager_profiles', 'dakani_employees', 'dakani_revoked_manager_keys'];

  function _collectLSKeys(keys) {
    const out = {};
    keys.forEach(k => {
      try { out[k] = JSON.parse(localStorage.getItem(k) || '[]'); }
      catch (e) { out[k] = []; }
    });
    return out;
  }
  function _restoreLSKeys(keys, data, mode) {
    if (!data) return;
    keys.forEach(k => {
      const incoming = Array.isArray(data[k]) ? data[k] : [];
      if (mode === 'merge') {
        let current = [];
        try { current = JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) {}
        const existingIds = new Set(current.map(item => (item && typeof item === 'object') ? item.id : item));
        const additions = incoming.filter(item => {
          const id = (item && typeof item === 'object') ? item.id : item;
          return id === undefined || !existingIds.has(id);
        });
        try { localStorage.setItem(k, JSON.stringify(current.concat(additions))); } catch (e) {}
      } else {
        try { localStorage.setItem(k, JSON.stringify(incoming)); } catch (e) {}
      }
    });
  }

  // ─── قراءة كل بيانات المحل من IndexedDB (نفس منطق backup.js تماماً) ─
  function _readFromDB() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tx = db.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const snapshot = {
            _meta: {
              version: '1.0',
              createdAt: new Date().toISOString(),
              appName: 'Dakani POS',
              device: navigator.platform || 'unknown'
            },
            _cashbox: _collectLSKeys(CASHBOX_LS_KEYS),
            _accounts: _collectLSKeys(ACCOUNTS_LS_KEYS)
          };
          let pending = TABLES.length;
          TABLES.forEach(t => {
            const r = store.get('dakani_' + t);
            r.onsuccess = () => { snapshot[t] = r.result ?? []; if (--pending === 0) resolve(snapshot); };
            r.onerror   = () => { snapshot[t] = [];           if (--pending === 0) resolve(snapshot); };
          });
        };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  // ─── استبدال كامل للبيانات في IndexedDB ──────────────────────
  function _restoreToIndexedDB(snapshot) {
    return new Promise((resolve, reject) => {
      try {
        if (snapshot && snapshot._cashbox) _restoreLSKeys(CASHBOX_LS_KEYS, snapshot._cashbox, 'replace');
        if (snapshot && snapshot._accounts) _restoreLSKeys(ACCOUNTS_LS_KEYS, snapshot._accounts, 'replace');
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tx = db.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          Object.keys(snapshot).filter(k => k !== '_meta' && k !== '_cashbox' && k !== '_accounts').forEach(t => {
            store.put(snapshot[t], 'dakani_' + t);
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror    = () => reject(tx.error);
        };
        req.onerror = e => reject(e.target.error);
      } catch (e) { reject(e); }
    });
  }

  // ─── دمج البيانات مع الموجود حالياً بدون حذف أي شيء قديم ─────
  function _mergeToIndexedDB(snapshot) {
    return new Promise((resolve, reject) => {
      try {
        if (snapshot && snapshot._cashbox) _restoreLSKeys(CASHBOX_LS_KEYS, snapshot._cashbox, 'merge');
        if (snapshot && snapshot._accounts) _restoreLSKeys(ACCOUNTS_LS_KEYS, snapshot._accounts, 'merge');
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tables = Object.keys(snapshot).filter(k => k !== '_meta' && k !== '_cashbox' && k !== '_accounts');
          if (!tables.length) { resolve(true); return; }

          const readTx = db.transaction('keyval', 'readonly');
          const readStore = readTx.objectStore('keyval');
          const current = {};
          let pending = tables.length;

          tables.forEach(t => {
            const r = readStore.get('dakani_' + t);
            r.onsuccess = () => { current[t] = r.result; if (--pending === 0) _writeMerged(); };
            r.onerror   = () => { current[t] = undefined; if (--pending === 0) _writeMerged(); };
          });

          function _writeMerged() {
            const writeTx = db.transaction('keyval', 'readwrite');
            const writeStore = writeTx.objectStore('keyval');
            tables.forEach(t => {
              const oldVal = current[t];
              const newVal = snapshot[t];
              let merged;
              if (t === 'settings') {
                merged = Object.assign({}, newVal || {}, oldVal || {});
              } else if (Array.isArray(newVal)) {
                const oldArr = Array.isArray(oldVal) ? oldVal : [];
                const existingIds = new Set(oldArr.map(item => item && item.id));
                const additions = newVal.filter(item => !item || item.id === undefined || !existingIds.has(item.id));
                merged = oldArr.concat(additions);
              } else {
                merged = oldVal !== undefined ? oldVal : newVal;
              }
              writeStore.put(merged, 'dakani_' + t);
            });
            writeTx.oncomplete = () => resolve(true);
            writeTx.onerror    = () => reject(writeTx.error);
          }
        };
        req.onerror = e => reject(e.target.error);
      } catch (e) { reject(e); }
    });
  }

  // ─── Toast بسيط (يستخدم toast دكاني إن وُجدت) ────────────────
  function _toast(msg, type) {
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6' };
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: colors[type] || colors.info, color: '#fff', padding: '12px 24px',
      borderRadius: '10px', fontFamily: 'Cairo, sans-serif', fontSize: '14px',
      zIndex: '999999', boxShadow: '0 4px 20px rgba(0,0,0,.3)', transition: 'opacity .4s'
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
  }

  // ════════════════════════════════════════════════════════════
  //  الواجهة العامة Public API
  // ════════════════════════════════════════════════════════════

  /** اختيار مجلد المزامنة لأول مرة (يجب أن يكون مجلد Google Drive/Dropbox/OneDrive) */
  async function chooseFolder() {
    if (!isSupported()) {
      _toast('⚠️ متصفحك الحالي لا يدعم هذه الميزة. استعمل Chrome أو Edge على حاسوب، أو استعمل التنزيل اليدوي أدناه.', 'error');
      return false;
    }
    let handle;
    try {
      handle = await window.showDirectoryPicker({ id: 'dakani-cloud-sync', mode: 'readwrite' });
    } catch (e) {
      return false; // المستخدم ألغى الاختيار — لا داعي لأي رسالة خطأ
    }
    try {
      const granted = await _requestPermission(handle);
      if (!granted) throw new Error('لم يتم منح صلاحية الكتابة لهذا المجلد');

      await _saveHandle(handle);
      localStorage.setItem(LS_LINKED, '1');
      localStorage.setItem(LS_FOLDER_NAME, handle.name || '');
      needsReauth = false;

      const ok = await syncNow(true);
      if (!ok) throw new Error('تعذّرت الكتابة الأولى داخل المجلد');

      _toast(`✅ تم ربط مجلد "${handle.name}" — ستُحفظ نسخة محدَّثة كل 60 ثانية تلقائياً`, 'success');
      _startLoop();
      if (typeof window.renderCloudSyncPanel === 'function') window.renderCloudSyncPanel();
      return true;
    } catch (err) {
      _toast('❌ ' + err.message, 'error');
      return false;
    }
  }

  /** إلغاء الربط بالكامل (لا يحذف أي ملف موجود مسبقاً في المجلد) */
  async function unlink() {
    _stopLoop();
    await _clearHandle();
    localStorage.removeItem(LS_LINKED);
    localStorage.removeItem(LS_LAST_SYNC);
    localStorage.removeItem(LS_FOLDER_NAME);
    needsReauth = false;
    _toast('🔌 تم إلغاء ربط مجلد المزامنة', 'info');
    if (typeof window.renderCloudSyncPanel === 'function') window.renderCloudSyncPanel();
  }

  /**
   * إعادة تفعيل الصلاحية بعد أن ينساها المتصفح (يجب أن تُستدعى مباشرة
   * من ضغطة زر حقيقية من المستخدم حتى تنجح — قيد أمان من المتصفح)
   */
  async function reauthorize() {
    const handle = await _loadHandle();
    if (!handle) { _toast('⚠️ لا يوجد مجلد مرتبط أصلاً', 'error'); return false; }
    const granted = await _requestPermission(handle);
    if (granted) {
      needsReauth = false;
      _toast('✅ تم تفعيل الصلاحية من جديد', 'success');
      _startLoop();
    } else {
      _toast('❌ لم يتم منح الصلاحية', 'error');
    }
    if (typeof window.renderCloudSyncPanel === 'function') window.renderCloudSyncPanel();
    return granted;
  }

  /** كتابة نسخة محدَّثة الآن داخل المجلد (silent = بدون رسائل توست عند كل تشغيل تلقائي) */
  async function syncNow(silent) {
    const handle = await _loadHandle();
    if (!handle) { if (!silent) _toast('⚠️ اختر مجلد المزامنة أولاً', 'error'); return false; }

    const hasPerm = await _hasPermission(handle);
    if (!hasPerm) {
      needsReauth = true;
      if (!silent) _toast('⚠️ يلزم إعادة تفعيل صلاحية المجلد — اضغط زر "إعادة التفعيل"', 'error');
      if (typeof window.renderCloudSyncPanel === 'function') window.renderCloudSyncPanel();
      return false;
    }
    needsReauth = false;

    try {
      const snapshot = await _readFromDB();
      if (!snapshot) throw new Error('تعذّرت قراءة بيانات المحل من هذا الجهاز');

      const fileHandle = await handle.getFileHandle(FILE_NAME, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(JSON.stringify(snapshot));
      await writable.close();

      localStorage.setItem(LS_LAST_SYNC, new Date().toISOString());
      if (!silent) _toast('✅ تم حفظ نسخة محدَّثة في مجلد المزامنة', 'success');
      _updateStatusLine();
      return true;
    } catch (err) {
      if (!silent) _toast('❌ فشلت المزامنة: ' + err.message, 'error');
      else console.warn('[CloudSync] فشلت المزامنة الصامتة:', err.message);
      return false;
    }
  }

  /** استعادة (دمج أو استبدال) من ملف dakani-backup.json الموجود داخل المجلد المرتبط */
  async function restoreFromFolder(mode) {
    const handle = await _loadHandle();
    if (!handle) { _toast('⚠️ اختر مجلد المزامنة أولاً', 'error'); return; }

    const hasPerm = await _hasPermission(handle) || await _requestPermission(handle);
    if (!hasPerm) { _toast('⚠️ يلزم منح صلاحية الوصول للمجلد أولاً', 'error'); return; }

    let fileHandle;
    try { fileHandle = await handle.getFileHandle(FILE_NAME, { create: false }); }
    catch (e) { _toast('⚠️ لا توجد نسخة محفوظة في هذا المجلد بعد', 'error'); return; }

    try {
      const file = await fileHandle.getFile();
      const text = await file.text();
      let snapshot;
      try { snapshot = JSON.parse(text); } catch { throw new Error('محتوى الملف غير صالح'); }
      if (!snapshot._meta || snapshot._meta.appName !== 'Dakani POS') {
        throw new Error('هذا الملف ليس نسخة احتياطية لدكاني');
      }

      const isMerge = mode === 'merge';
      const ok = window.confirm(
        isMerge
          ? `📥 سيتم دمج النسخة المحفوظة بتاريخ:\n${snapshot._meta.createdAt}\n\nستبقى بياناتك الحالية، وتُضاف إليها العناصر الجديدة فقط. متابعة؟`
          : `⚠️ سيتم استبدال كل بياناتك الحالية بالنسخة المحفوظة بتاريخ:\n${snapshot._meta.createdAt}\n\nمتابعة؟`
      );
      if (!ok) return;

      _toast(isMerge ? '⏳ جارٍ الدمج...' : '⏳ جارٍ الاستعادة...', 'info');
      if (isMerge) await _mergeToIndexedDB(snapshot);
      else await _restoreToIndexedDB(snapshot);

      _toast('✅ تمت العملية بنجاح! سيُعاد تشغيل التطبيق...', 'success');
      setTimeout(() => location.reload(), 2000);
    } catch (err) {
      _toast('❌ فشلت الاستعادة: ' + err.message, 'error');
    }
  }

  // ─── الحلقة التلقائية كل 60 ثانية بالضبط ──────────────────────
  function _startLoop() {
    _stopLoop();
    intervalId = setInterval(() => syncNow(true), INTERVAL_MS);
  }
  function _stopLoop() {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }
  }

  /** يُستدعى عند إقلاع التطبيق: يستأنف المزامنة بصمت إن كانت الصلاحية سليمة */
  async function resumeIfLinked() {
    if (!isSupported() || !isLinked()) return;
    const handle = await _loadHandle();
    if (!handle) return;
    const hasPerm = await _hasPermission(handle); // لا يحتاج تفاعل مستخدم، آمن الاستدعاء تلقائياً
    needsReauth = !hasPerm;
    if (hasPerm) {
      await syncNow(true); // مزامنة فورية عند فتح التطبيق
      _startLoop();
    }
    if (typeof window.renderCloudSyncPanel === 'function') window.renderCloudSyncPanel();
  }

  function _updateStatusLine() {
    const el = document.getElementById('cloudsync-last-sync');
    if (el) el.textContent = new Date(getLastSync()).toLocaleString('ar-DZ');
  }

  return {
    isSupported, isLinked, getLastSync, getFolderName, getNeedsReauth,
    chooseFolder, unlink, reauthorize, syncNow, restoreFromFolder, resumeIfLinked
  };

})();

// ─── استئناف المزامنة تلقائياً عند فتح التطبيق (بدون أي إزعاج) ───────
window.addEventListener('dakani-licensed', () => {
  setTimeout(() => DakaniCloudSync.resumeIfLinked(), 4000);
});
window.addEventListener('load', () => {
  setTimeout(() => DakaniCloudSync.resumeIfLinked(), 6000);
});

/**
 * ─────────────────────────────────────────────────────────────
 *  رسم لوحة الإعدادات — تُبنى بالكامل ديناميكياً داخل
 *  <div id="cloudsync-panel-body"> الفارغ في index.html.
 *  تعتمد فقط على أصناف CSS الموجودة أصلاً (settings-card,
 *  btn-primary, btn-secondary, btn-danger) دون أي تعديل على style.css.
 * ─────────────────────────────────────────────────────────────
 */
function renderCloudSyncPanel() {
  const box = document.getElementById('cloudsync-panel-body');
  if (!box) return;

  // ─── قسم ثابت: بديل التنزيل اليدوي (يعمل في كل المتصفحات دائماً) ─
  const manualFallback = `
    <div class="setting-desc" style="margin-top:14px;padding-top:14px;border-top:1px dashed var(--border,#1e293b)">
      <i class="fas fa-circle-info"></i>
      بديل يدوي يعمل في كل المتصفحات: نزّل نسخة الآن وضعها بنفسك داخل مجلد Google Drive/Dropbox على جهازك.
    </div>
    <button class="btn-secondary" onclick="DakaniBackup.downloadNow()">
      <i class="fas fa-download"></i> تنزيل نسخة الآن / Download Now
    </button>
    <button class="btn-secondary" onclick="DakaniBackup.restoreFromFile('merge')">
      <i class="fas fa-upload"></i> استعادة من ملف / Restore from File
    </button>`;

  if (!DakaniCloudSync.isSupported()) {
    box.innerHTML = `
      <div class="setting-desc" style="color:#f59e0b">
        <i class="fas fa-triangle-exclamation"></i>
        المزامنة التلقائية كل 60 ثانية تحتاج متصفح Chrome أو Edge على حاسوب مكتبي.
        متصفحك الحالي غير مدعوم لهذه الميزة تحديداً — استعمل البديل اليدوي أدناه في كل الأحوال.
      </div>
      ${manualFallback}`;
    return;
  }

  if (!DakaniCloudSync.isLinked()) {
    box.innerHTML = `
      <button class="btn-primary" onclick="DakaniCloudSync.chooseFolder()">
        <i class="fas fa-folder-plus"></i> اختيار مجلد المزامنة السحابي / Choose Sync Folder
      </button>
      <div class="setting-desc">
        <i class="fas fa-circle-info"></i>
        اختر مجلد Google Drive أو Dropbox أو OneDrive الموجود على جهازك (المجلد الذي يرفع تلقائياً لحسابك). بعدها ستُحفظ نسخة محدَّثة بداخله كل 60 ثانية تلقائياً.
      </div>
      ${manualFallback}`;
    return;
  }

  const last = DakaniCloudSync.getLastSync();
  const lastText = last ? new Date(last).toLocaleString('ar-DZ') : 'لم تتم المزامنة بعد';
  const needsReauth = DakaniCloudSync.getNeedsReauth();

  box.innerHTML = `
    <div class="setting-desc">
      <i class="fas fa-folder-open" style="color:var(--accent,#10b981)"></i>
      المجلد المرتبط: <b>${DakaniCloudSync.getFolderName() || '—'}</b>
    </div>
    <div class="setting-desc">
      ${needsReauth
        ? '<i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i> <b style="color:#f59e0b">المزامنة متوقفة مؤقتاً — يلزم إعادة التفعيل</b>'
        : '<i class="fas fa-circle-check" style="color:var(--accent,#10b981)"></i> المزامنة نشطة (كل 60 ثانية)'}
    </div>
    <div class="setting-desc">
      <i class="fas fa-clock-rotate-left"></i>
      آخر مزامنة: <b id="cloudsync-last-sync">${lastText}</b>
    </div>

    ${needsReauth ? `
    <button class="btn-primary" onclick="DakaniCloudSync.reauthorize()">
      <i class="fas fa-rotate-right"></i> إعادة التفعيل / Reactivate
    </button>` : ''}

    <button class="btn-primary" onclick="DakaniCloudSync.syncNow()">
      <i class="fas fa-cloud-arrow-up"></i> مزامنة الآن / Sync Now
    </button>
    <button class="btn-secondary" onclick="DakaniCloudSync.restoreFromFolder('merge')">
      <i class="fas fa-cloud-arrow-down"></i> استعادة ودمج / Restore &amp; Merge
    </button>
    <button class="btn-secondary" onclick="DakaniCloudSync.restoreFromFolder('replace')">
      <i class="fas fa-rotate"></i> استعادة واستبدال كامل / Restore &amp; Replace
    </button>
    <button class="btn-danger" onclick="if(confirm('إلغاء ربط مجلد المزامنة؟ (الملف المحفوظ فيه يبقى كما هو)')) DakaniCloudSync.unlink()">
      <i class="fas fa-link-slash"></i> إلغاء الربط / Unlink
    </button>
    ${manualFallback}`;
}
window.renderCloudSyncPanel = renderCloudSyncPanel;

// إعادة الرسم فور دخول المستخدم لصفحة الإعدادات (دون لمس script.js:
// فقط مراقبة تغيّر class على عنصر الصفحة نفسه)
document.addEventListener('DOMContentLoaded', () => {
  renderCloudSyncPanel();
  const settingsPage = document.getElementById('page-settings');
  if (settingsPage && window.MutationObserver) {
    new MutationObserver(() => {
      if (settingsPage.classList.contains('active')) renderCloudSyncPanel();
    }).observe(settingsPage, { attributes: true, attributeFilter: ['class'] });
  }
});