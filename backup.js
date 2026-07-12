/**
 * DAKANI BACKUP SYSTEM v1.0
 * ─────────────────────────────────────────────────────────────
 * نسخ احتياطي تلقائي يومي لكل بيانات دكاني
 * - يحفظ آخر 7 نسخ في localStorage
 * - تنزيل يدوي فوري بصيغة JSON
 * - استعادة كاملة من ملف JSON
 * - يعمل 100% بدون إنترنت (Offline)
 * ─────────────────────────────────────────────────────────────
 */

const DakaniBackup = (() => {

  const BACKUP_KEY   = 'dakani_backups';   // مفتاح localStorage
  const MAX_BACKUPS  = 7;                  // أقصى عدد نسخ محفوظة
  const CHECK_KEY    = 'dakani_last_backup_date'; // تاريخ آخر نسخ

  // ─── استخراج كل البيانات من IndexedDB عبر DB ──────────────
  function _collectData() {
    if (typeof DB === 'undefined') {
      console.warn('[Backup] DB غير متاح بعد');
      return null;
    }
    const tables = [
      'settings', 'categories', 'products', 'customers',
      'sales', 'sale_items', 'purchases', 'suppliers',
      'debt_payments', 'stock_adjustments', 'returns'
    ];
    const snapshot = {};
    tables.forEach(t => {
      try { snapshot[t] = DB.getAll ? DB.getAll(t) : (DB._cache ? DB._cache[t] : []); }
      catch(e) { snapshot[t] = []; }
    });

    // استخدام الواجهة العامة للـ DB
    snapshot._meta = {
      version: '1.0',
      createdAt: new Date().toISOString(),
      device: navigator.platform || 'unknown'
    };
    return snapshot;
  }

  // ─── قراءة بيانات الـ cache من DB مباشرة (أسلوب آمن) ─────
  function _readFromDB() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tx = db.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const tables = [
            'settings', 'categories', 'products', 'customers',
            'sales', 'sale_items', 'purchases', 'suppliers',
            'debt_payments', 'stock_adjustments', 'returns', 'seeded'
          ];
          const snapshot = {
            _meta: {
              version: '1.0',
              createdAt: new Date().toISOString(),
              appName: 'Dakani POS',
              device: navigator.platform || 'unknown'
            }
          };
          let pending = tables.length;
          tables.forEach(t => {
            const r = store.get('dakani_' + t);
            r.onsuccess = () => {
              snapshot[t] = r.result ?? [];
              if (--pending === 0) resolve(snapshot);
            };
            r.onerror = () => {
              snapshot[t] = [];
              if (--pending === 0) resolve(snapshot);
            };
          });
        };
        req.onerror = () => resolve(null);
      } catch(e) { resolve(null); }
    });
  }

  // ─── حفظ نسخة في localStorage ────────────────────────────
  function _saveToLocalStorage(snapshot) {
    try {
      const existing = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
      existing.unshift({
        date: snapshot._meta.createdAt,
        data: snapshot
      });
      // الاحتفاظ بآخر MAX_BACKUPS نسخة فقط
      if (existing.length > MAX_BACKUPS) existing.splice(MAX_BACKUPS);
      localStorage.setItem(BACKUP_KEY, JSON.stringify(existing));
      localStorage.setItem(CHECK_KEY, new Date().toISOString().slice(0, 10));
      return true;
    } catch(e) {
      console.error('[Backup] فشل الحفظ في localStorage:', e);
      return false;
    }
  }

  // ─── تنزيل ملف JSON ───────────────────────────────────────
  function _downloadJSON(snapshot) {
    const json = JSON.stringify(snapshot, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href     = url;
    a.download = `dakani-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── استعادة البيانات من ملف JSON إلى IndexedDB ──────────
  function _restoreToIndexedDB(snapshot) {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tx = db.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          const tables = Object.keys(snapshot).filter(k => k !== '_meta');
          tables.forEach(t => {
            store.put(snapshot[t], 'dakani_' + t);
          });
          tx.oncomplete = () => resolve(true);
          tx.onerror    = () => reject(tx.error);
        };
        req.onerror = e => reject(e.target.error);
      } catch(e) { reject(e); }
    });
  }

  // ─── دمج البيانات من ملف JSON مع البيانات الحالية (بدون حذف القديم) ─
  // لكل جدول: نُبقي كل السجلات القديمة، ونضيف فقط السجلات الجديدة التي
  // لا يوجد لها نفس الـ id في البيانات الحالية. لا شيء يُمحى أو يُستبدل.
  function _mergeToIndexedDB(snapshot) {
    return new Promise((resolve, reject) => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const db = e.target.result;
          const tables = Object.keys(snapshot).filter(k => k !== '_meta');
          if (!tables.length) { resolve(true); return; }

          // 1) نقرأ أولاً البيانات الحالية من هذا الجهاز
          const readTx = db.transaction('keyval', 'readonly');
          const readStore = readTx.objectStore('keyval');
          const current = {};
          let pending = tables.length;

          tables.forEach(t => {
            const r = readStore.get('dakani_' + t);
            r.onsuccess = () => { current[t] = r.result; if (--pending === 0) _writeMerged(); };
            r.onerror   = () => { current[t] = undefined; if (--pending === 0) _writeMerged(); };
          });

          // 2) ندمج، ثم نكتب النتيجة النهائية فقط (لا نلمس القديم قبل حساب الدمج)
          function _writeMerged() {
            const writeTx = db.transaction('keyval', 'readwrite');
            const writeStore = writeTx.objectStore('keyval');

            tables.forEach(t => {
              const oldVal = current[t];
              const newVal = snapshot[t];
              let merged;

              if (t === 'settings') {
                // الإعدادات: نُبقي إعدادات هذا الجهاز كما هي، ونضيف فقط
                // أي حقل إعدادات جديد غير موجود أصلاً هنا
                merged = Object.assign({}, newVal || {}, oldVal || {});
              } else if (Array.isArray(newVal)) {
                const oldArr = Array.isArray(oldVal) ? oldVal : [];
                const existingIds = new Set(oldArr.map(item => item && item.id));
                const additions = newVal.filter(item => !item || item.id === undefined || !existingIds.has(item.id));
                merged = oldArr.concat(additions); // القديم أولاً + الجديد فقط
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
      } catch(e) { reject(e); }
    });
  }

  // ─── تحقق هل تمّ النسخ اليوم ─────────────────────────────
  function _needsBackup() {
    const last = localStorage.getItem(CHECK_KEY);
    const today = new Date().toISOString().slice(0, 10);
    return last !== today;
  }

  // ══════════════════════════════════════════════════════════
  //  الواجهة العامة Public API
  // ══════════════════════════════════════════════════════════

  /**
   * يُشغَّل عند تحميل التطبيق — يأخذ نسخة تلقائياً مرة يوميًا
   */
  async function autoBackup() {
    if (!_needsBackup()) return;
    const snapshot = await _readFromDB();
    if (!snapshot) return;
    const ok = _saveToLocalStorage(snapshot);
    if (ok) console.log('[Backup] ✅ نسخة احتياطية تلقائية ' + snapshot._meta.createdAt);
  }

  /**
   * تنزيل نسخة احتياطية فورية الآن (يدوي)
   */
  async function downloadNow() {
    showToast('⏳ جارٍ إنشاء النسخة الاحتياطية...', 'info');
    const snapshot = await _readFromDB();
    if (!snapshot) { showToast('❌ فشل في قراءة البيانات', 'error'); return; }
    _saveToLocalStorage(snapshot);
    _downloadJSON(snapshot);
    showToast('✅ تم تنزيل النسخة الاحتياطية بنجاح', 'success');
  }

  /**
   * استعادة من ملف JSON يختاره المستخدم
   * mode = 'replace' → يستبدل كل البيانات الحالية بمحتوى الملف (الوضع القديم)
   * mode = 'merge'   → يُبقي البيانات الحالية ويضيف إليها فقط ما هو جديد في الملف
   */
  function restoreFromFile(mode = 'replace') {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.json';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      let snapshot;
      try { snapshot = JSON.parse(text); }
      catch { showToast('❌ الملف غير صالح', 'error'); return; }

      if (!snapshot._meta || snapshot._meta.appName !== 'Dakani POS') {
        showToast('❌ هذا الملف ليس نسخة احتياطية لدكاني', 'error');
        return;
      }

      const isMerge = mode === 'merge';
      const confirm = window.confirm(
        isMerge
          ? `📥 سيتم دمج النسخة المؤرخة:\n${snapshot._meta.createdAt}\n\nستبقى كل بياناتك الحالية كما هي، وستُضاف إليها فقط العناصر الجديدة الموجودة في الملف (بدون حذف أو استبدال أي شيء). هل تريد المتابعة؟`
          : `⚠️ سيتم استعادة النسخة المؤرخة:\n${snapshot._meta.createdAt}\n\nسيُستبدل بها كل البيانات الحالية. هل تريد المتابعة؟`
      );
      if (!confirm) return;

      showToast(isMerge ? '⏳ جارٍ الدمج...' : '⏳ جارٍ الاستعادة...', 'info');
      try {
        if (isMerge) {
          await _mergeToIndexedDB(snapshot);
          showToast('✅ تم الدمج بنجاح! سيُعاد تشغيل التطبيق...', 'success');
        } else {
          await _restoreToIndexedDB(snapshot);
          showToast('✅ تمت الاستعادة! سيُعاد تشغيل التطبيق...', 'success');
        }
        setTimeout(() => location.reload(), 2000);
      } catch(err) {
        showToast('❌ فشلت العملية: ' + err.message, 'error');
      }
    };
    document.body.appendChild(input);
    input.click();
    document.body.removeChild(input);
  }

  /**
   * قائمة النسخ المحفوظة في localStorage
   */
  function listBackups() {
    try {
      const list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
      return list.map((b, i) => ({ index: i, date: b.date }));
    } catch { return []; }
  }

  /**
   * استعادة من نسخة محفوظة داخلياً (بالرقم)
   */
  async function restoreFromLocal(index) {
    try {
      const list = JSON.parse(localStorage.getItem(BACKUP_KEY) || '[]');
      const entry = list[index];
      if (!entry) { showToast('❌ النسخة غير موجودة', 'error'); return; }

      const confirm = window.confirm(
        `⚠️ استعادة النسخة المؤرخة:\n${entry.date}\n\nهل تريد المتابعة؟`
      );
      if (!confirm) return;

      showToast('⏳ جارٍ الاستعادة...', 'info');
      await _restoreToIndexedDB(entry.data);
      showToast('✅ تمت الاستعادة! سيُعاد تشغيل التطبيق...', 'success');
      setTimeout(() => location.reload(), 2000);
    } catch(err) {
      showToast('❌ فشلت الاستعادة: ' + err.message, 'error');
    }
  }

  // ─── Toast Helper (يعمل مع دكاني أو بمفرده) ─────────────
  function showToast(msg, type = 'info') {
    // إذا كان للتطبيق دالة toast خاصة
    if (typeof window.showToast === 'function') { window.showToast(msg); return; }
    const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6' };
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%',
      transform: 'translateX(-50%)',
      background: colors[type] || colors.info,
      color: '#fff', padding: '12px 24px', borderRadius: '10px',
      fontFamily: 'Cairo, sans-serif', fontSize: '14px',
      zIndex: '999999', boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
      transition: 'opacity .4s'
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3000);
  }

  // ─── واجهة إدارة النسخ الاحتياطية ───────────────────────
  function showBackupPanel() {
    document.getElementById('backup-panel-overlay')?.remove();

    const backups = listBackups();
    const rows = backups.length
      ? backups.map((b, i) => `
          <div class="bp-row">
            <span class="bp-date">
              <i class="fas fa-calendar-check"></i>
              ${new Date(b.date).toLocaleString('ar-DZ')}
            </span>
            <button class="bp-restore-btn" onclick="DakaniBackup.restoreFromLocal(${i})">
              <i class="fas fa-rotate-left"></i> استعادة
            </button>
          </div>`).join('')
      : '<p class="bp-empty">لا توجد نسخ احتياطية محفوظة محلياً بعد.</p>';

    const overlay = document.createElement('div');
    overlay.id = 'backup-panel-overlay';
    overlay.innerHTML = `
      <div class="bp-panel">
        <div class="bp-header">
          <span><i class="fas fa-database"></i> النسخ الاحتياطية</span>
          <button onclick="document.getElementById('backup-panel-overlay').remove()">
            <i class="fas fa-xmark"></i>
          </button>
        </div>

        <div class="bp-actions">
          <button class="bp-btn bp-btn-green" onclick="DakaniBackup.downloadNow()">
            <i class="fas fa-download"></i> تنزيل نسخة الآن
          </button>
          <button class="bp-btn bp-btn-blue" onclick="DakaniBackup.restoreFromFile('replace')">
            <i class="fas fa-upload"></i> استعادة من ملف (استبدال كامل)
          </button>
        </div>
        <div class="bp-actions">
          <button class="bp-btn bp-btn-purple" onclick="DakaniBackup.restoreFromFile('merge')">
            <i class="fas fa-code-merge"></i> استيراد ودمج (بدون حذف القديم)
          </button>
        </div>

        <div class="bp-list-title">
          <i class="fas fa-clock-rotate-left"></i>
          النسخ المحفوظة تلقائياً (آخر ${MAX_BACKUPS} أيام)
        </div>
        <div class="bp-list">${rows}</div>

        <p class="bp-note">
          <i class="fas fa-info-circle"></i>
          يتم أخذ نسخة احتياطية تلقائية مرة واحدة يومياً عند فتح التطبيق.
          لحماية بياناتك من أعطال الكهرباء والتخزين، يُنصح بتنزيل نسخة دورياً.
        </p>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      #backup-panel-overlay {
        position:fixed;inset:0;z-index:99998;
        background:rgba(0,0,0,.7);backdrop-filter:blur(4px);
        display:flex;align-items:center;justify-content:center;
        font-family:'Cairo',sans-serif;
      }
      .bp-panel {
        background:#111827;border:1px solid #1f2937;border-radius:18px;
        padding:28px;width:100%;max-width:480px;color:#fff;
        box-shadow:0 25px 60px rgba(0,0,0,.5);
      }
      .bp-header {
        display:flex;justify-content:space-between;align-items:center;
        font-size:18px;font-weight:700;color:#10b981;margin-bottom:20px;
      }
      .bp-header button {
        background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer;
      }
      .bp-actions { display:flex;gap:10px;margin-bottom:20px; }
      .bp-btn {
        flex:1;padding:11px;border:none;border-radius:10px;
        font-family:'Cairo',sans-serif;font-size:14px;font-weight:600;
        cursor:pointer;display:flex;align-items:center;justify-content:center;gap:7px;
      }
      .bp-btn-green { background:linear-gradient(135deg,#10b981,#059669);color:#fff; }
      .bp-btn-blue  { background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff; }
      .bp-btn-purple{ background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff; }
      .bp-btn:hover { opacity:.88; }
      .bp-list-title { color:#9ca3af;font-size:13px;margin-bottom:10px; }
      .bp-list { max-height:240px;overflow-y:auto; }
      .bp-row {
        display:flex;justify-content:space-between;align-items:center;
        background:#0d1117;border:1px solid #1f2937;border-radius:10px;
        padding:10px 14px;margin-bottom:8px;
      }
      .bp-date { font-size:13px;color:#d1d5db; }
      .bp-restore-btn {
        background:#374151;border:none;color:#10b981;
        border-radius:8px;padding:6px 12px;font-size:12px;
        font-family:'Cairo',sans-serif;cursor:pointer;
        display:flex;align-items:center;gap:5px;
      }
      .bp-restore-btn:hover { background:#4b5563; }
      .bp-empty { color:#6b7280;font-size:13px;text-align:center;padding:20px 0; }
      .bp-note {
        color:#4b5563;font-size:11px;margin-top:16px;
        border-top:1px solid #1f2937;padding-top:14px;line-height:1.8;
      }`;

    document.head.appendChild(style);
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.remove();
    });
  }

  return { autoBackup, downloadNow, restoreFromFile, restoreFromLocal, listBackups, showBackupPanel };

})();

// ─── تشغيل النسخ التلقائي عند تحميل الصفحة ──────────────────
window.addEventListener('dakani-licensed', () => {
  setTimeout(() => DakaniBackup.autoBackup(), 3000);
});
// احتياط إذا لم يكن هناك حدث ترخيص
window.addEventListener('load', () => {
  setTimeout(() => DakaniBackup.autoBackup(), 5000);
});
