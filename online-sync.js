/**
 * DAKANI ONLINE TEAM SYNC (P2P) — العمل الجماعي عبر الإنترنت
 * ─────────────────────────────────────────────────────────────
 * ⚠️ ملف مستقل تماماً (بنفس مبدأ accounts.js و cloud-folder-sync.js):
 *    لا يعدّل أي دالة أو ملف موجود، فقط يضيف صفحة جديدة + محرّك مزامنة
 *    خلفي، ويستخدم الدوال العامة الجاهزة فقط.
 *
 * ⚠️ لا توجد أي قاعدة بيانات وسيطة ولا أي خادم يُخزّن بيانات دكاني:
 *    النقل يتم مباشرة جهاز-إلى-جهاز عبر WebRTC (نفس التقنية التي
 *    تعمل بها مكالمات الفيديو المباشرة بين المتصفحات). "الإنترنت"
 *    أو "الشبكة المحلية" هنا مجرد أنبوب نقل لحظي فقط — لا يمرّ عبره
 *    أي تخزين لبياناتك عند أي طرف ثالث.
 *
 *  وضعان للاتصال:
 *   1) "عبر الإنترنت" — تلقائي بالكامل، يكفي إدخال نفس "رمز الفريق"
 *      في كل الأجهزة. نستخدم PeerJS (مكتبة WebRTC مفتوحة المصدر
 *      ومعروفة) فقط لمساعدة جهازين على "إيجاد" بعضهما (تبادل عنوان
 *      اتصال WebRTC لثوانٍ معدودة) — لا يمرّ أي بيانات فعلية لدكاني
 *      عبر خوادمها إطلاقاً، النقل الفعلي يكون مباشراً بين الجهازين.
 *   2) "اتصال محلي / بدون إنترنت" — يدوي بالكامل عبر نسخ/لصق "رمز"
 *      قصير بين جهازين (مثل كيبل/نفس الشبكة)، لا يحتاج أي اتصال
 *      بالإنترنت إطلاقاً إن كان الجهازان على نفس الشبكة المحلية.
 *
 *  آلية العمل بدون قاعدة بيانات:
 *   - كل جهاز يحتفظ محلياً فقط (على نفسه) بسجل "آخر ما أرسله بنجاح"
 *     لكل عنصر بيانات. عند أي اتصال جديد (بأي جهاز آخر من الفريق،
 *     بأي وضع)، يُعاد فحص الفرق بين البيانات المحلية وهذا السجل،
 *     وتُرسَل فوراً كل التغييرات التي لم تُنقل بعد.
 *   - إن انقطع الإنترنت، يستمر التطبيق يعمل محلياً بشكل طبيعي كالمعتاد
 *     (كل الميزات محلية 100% أصلاً)، وعند عودة الاتصال (أو عند أول
 *     اتصال قادم مع أي جهاز آخر من الفريق) تُستكمل عملية النقل تلقائياً
 *     من حيث توقفت — دون أي تدخل يدوي.
 *   - كل الرسائل تُعاد بثّها (Flood relay) بين كل الأجهزة المتصلة
 *     ببعضها البعض (مباشرة أو عبر أجهزة وسيطة من نفس الفريق)، لذا
 *     تتزامن كل الأجهزة حتى لو لم يكن كل جهازين متصلين ببعضهما مباشرة.
 *   - لا حذف تلقائي لأي بيانات محلية إطلاقاً (فلسفة آمنة تراكمية،
 *     نفس مبدأ cloud-folder-sync.js) — فقط إضافة/تحديث ما هو أحدث.
 *   - صور المنتجات (base64) لا تُنقَل عبر الإنترنت عمداً لأنها ثقيلة
 *     جداً على اتصال مباشر بين الأجهزة؛ فقط الأسعار والكميات والنصوص.
 */

const DakaniOnlineSync = (() => {

  // ════════════════════════════════════════════════════════════
  //  تخزين محلي (خاص بهذا الجهاز فقط — ليس مشتركاً مع أي أحد)
  // ════════════════════════════════════════════════════════════
  const LS_TEAMID     = 'dakani_onlinesync_teamid';
  const LS_DEVICENAME = 'dakani_onlinesync_devname';
  const LS_PUSHED     = 'dakani_onlinesync_pushed_v2'; // بصمات آخر ما أُرسل بنجاح — أساس استكمال النقل بعد الانقطاع
  const LS_KICKED_UNTIL = 'dakani_onlinesync_kicked_until';

  const PUSH_INTERVAL_MS   = 8 * 1000;  // فحص التغييرات المحلية وبثّها كل 8 ثوانٍ طالما هناك اتصال واحد على الأقل — أسرع إحساساً كالتطبيقات الكبرى
  const RECONNECT_MS       = 8 * 1000;  // محاولة إعادة الاتصال بالإنترنت كل 8 ثوانٍ عند الانقطاع
  const PRESENCE_STALE_MS  = 90 * 1000; // اعتبار الجهاز "غير متصل" إن لم نستلم منه شيئاً منذ هذه المدة

  // خوادم STUN لمساعدة الجهازين على معرفة عنوانيهما العامّين، + خادم TURN عام مجاني
  // للحالات التي يفشل فيها الاتصال المباشر (مثل هاتف على بيانات الجوال خلف NAT صارم) —
  // بيانات اعتماد openrelay.metered.ca معروفة وعامة (مخصّصة للتجربة من قبل مطوّري WebRTC)،
  // ولا تمر عبرها بياناتك إلا كـ"تحويلة" مشفّرة عند الحاجة فقط، وليست تخزيناً لأي شيء.
  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:openrelay.metered.ca:80' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' }
  ];
  const LOCAL_ICE_TIMEOUT_MS = 7000; // مهلة انتظار جمع مسارات الاتصال في الوضع المحلي

  const RECORD_TABLES = [
    'products', 'categories', 'customers', 'sales', 'sale_items',
    'purchases', 'suppliers', 'debt_payments', 'supplier_payments',
    'stock_adjustments', 'returns', 'held_sales'
  ];
  const SINGLE_KEYS_LS = {
    cbx_expenses: 'dakani_cbx_expenses', cbx_capital: 'dakani_cbx_capital',
    cbx_shifts: 'dakani_cbx_shifts', cbx_moves: 'dakani_cbx_moves',
    managers: 'dakani_manager_profiles', employees: 'dakani_employees'
  };

  // ─── حالة التشغيل (في الذاكرة فقط) ───────────────────────────
  let peer = null;                 // كائن PeerJS (وضع الإنترنت فقط)
  let isHub = false;               // هل هذا الجهاز هو نقطة الالتقاء الحالية على الإنترنت؟
  let internetTimer = null;
  let pushTimer = null;
  let presenceTimer = null;
  let pendingLocalPC = null;       // اتصال محلي قيد الإنشاء (بانتظار لصق رمز الرد)
  let publicIp = '';

  // كل الاتصالات المفتوحة حالياً (إنترنت + محلي) بصيغة موحّدة
  // key: معرّف داخلي عشوائي للاتصال، value: {send, close, transport, remoteId, remoteName, lastSeen}
  const conns = new Map();
  // حضور الأجهزة (معرّف الجهاز → آخر معلومة عنه) — للعرض فقط، ليس سجلاً دائماً
  const presence = new Map();
  const seenMsgIds = [];
  const seenMsgSet = new Set();

  // سجل أحداث حيّ (للتشخيص داخل الصفحة نفسها — يظهر بالضبط أين تتعطّل عملية الاتصال)
  const DEBUG_LOG = [];
  let sentCount = 0, recvCount = 0;
  function _log(msg) {
    const line = new Date().toLocaleTimeString('ar-DZ', { hour12: false }) + ' — ' + msg;
    DEBUG_LOG.push(line);
    if (DEBUG_LOG.length > 80) DEBUG_LOG.shift();
    try { console.log('[Dakani P2P]', msg); } catch (e) {}
    _renderIfVisible();
  }

  // ─── أدوات عامة (نسخة محلية خاصة بهذا الملف — نفس نمط باقي الملفات) ─
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();

  function _lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } }
  function _lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }
  function _lsGetStr(key) { try { return localStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function _lsSetStr(key, val) { try { localStorage.setItem(key, val); } catch (e) {} }
  function _lsDel(key) { try { localStorage.removeItem(key); } catch (e) {} }

  function _isManager() {
    try { return typeof DakaniAccounts !== 'undefined' && DakaniAccounts.getRole && DakaniAccounts.getRole() === 'manager'; }
    catch (e) { return false; }
  }
  function _deviceId() {
    try { if (typeof DakaniLicense !== 'undefined' && DakaniLicense.getPermanentDeviceId) return DakaniLicense.getPermanentDeviceId(); }
    catch (e) {}
    return 'UNKNOWN';
  }
  function _defaultDeviceName() {
    const ua = navigator.userAgent || '';
    let browser = 'متصفح';
    if (/Edg\//.test(ua)) browser = 'Edge';
    else if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) browser = 'Chrome';
    else if (/Firefox\//.test(ua)) browser = 'Firefox';
    else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS'
      : /Win/i.test(navigator.platform || '') ? 'Windows' : /Mac/i.test(navigator.platform || '') ? 'Mac' : 'جهاز';
    return `${browser} - ${platform}`;
  }
  function getTeamId() { return _lsGetStr(LS_TEAMID); }
  function getDeviceName() { return _lsGetStr(LS_DEVICENAME) || _defaultDeviceName(); }
  function isConfigured() { return !!getTeamId(); }
  function isConnected() { return conns.size > 0; }

  function _toast(msg, type) {
    if (typeof toast === 'function') { toast(msg, type); return; }
    const colors = { success: '#10b981', error: '#ef4444', info: '#3b82f6', warning: '#f59e0b' };
    const t = document.createElement('div');
    t.textContent = msg;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: colors[type] || colors.info, color: '#fff', padding: '12px 24px',
      borderRadius: '10px', fontFamily: 'Cairo, sans-serif', fontSize: '14px',
      zIndex: '999999', boxShadow: '0 4px 20px rgba(0,0,0,.3)', transition: 'opacity .4s'
    });
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); }, 3500);
  }
  function _clickToast(msg, onClick) {
    const t = document.createElement('div');
    t.innerHTML = `<i class="fas fa-rotate"></i> ${escHtml(msg)}`;
    Object.assign(t.style, {
      position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
      background: '#0ea5e9', color: '#fff', padding: '12px 22px', cursor: 'pointer',
      borderRadius: '10px', fontFamily: 'Cairo, sans-serif', fontSize: '14px',
      zIndex: '999999', boxShadow: '0 4px 20px rgba(0,0,0,.35)', transition: 'opacity .4s',
      display: 'flex', gap: '8px', alignItems: 'center'
    });
    t.onclick = () => { onClick(); t.remove(); };
    document.body.appendChild(t);
    setTimeout(() => { if (t.parentNode) { t.style.opacity = '0'; setTimeout(() => t.remove(), 400); } }, 9000);
  }
  function _relTime(iso) {
    if (!iso) return '—';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'الآن';
    if (diff < 3600) return `قبل ${Math.floor(diff / 60)} د`;
    if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} س`;
    return `قبل ${Math.floor(diff / 86400)} يوم`;
  }

  async function _getPublicIP() {
    try {
      const res = await fetch('https://api.ipify.org?format=json', { cache: 'no-store' });
      const data = await res.json();
      return data && data.ip ? data.ip : '';
    } catch (e) { return ''; }
  }

  // ════════════════════════════════════════════════════════════
  //  رمز الفريق (يُنشأ مرة واحدة، يُشارك بين كل الأجهزة)
  // ════════════════════════════════════════════════════════════
  function _genTeamId() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = ''; for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  // ════════════════════════════════════════════════════════════
  //  قراءة/دمج البيانات المحلية (IndexedDB) — نفس منطق cloud-folder-sync.js
  // ════════════════════════════════════════════════════════════
  function _readAllFromDB() {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const idb = e.target.result;
          const tx = idb.transaction('keyval', 'readonly');
          const store = tx.objectStore('keyval');
          const out = {};
          let pending = RECORD_TABLES.length + 1;
          RECORD_TABLES.forEach(t => {
            const r = store.get('dakani_' + t);
            r.onsuccess = () => { out[t] = Array.isArray(r.result) ? r.result : []; if (--pending === 0) resolve(out); };
            r.onerror   = () => { out[t] = []; if (--pending === 0) resolve(out); };
          });
          const rs = store.get('dakani_settings');
          rs.onsuccess = () => { out.settings = rs.result || {}; if (--pending === 0) resolve(out); };
          rs.onerror   = () => { out.settings = {}; if (--pending === 0) resolve(out); };
        };
        req.onerror = () => resolve(null);
      } catch (e) { resolve(null); }
    });
  }

  function _upsertRecord(table, item) {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const idb = e.target.result;
          const tx = idb.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          const key = 'dakani_' + table;
          const r = store.get(key);
          r.onsuccess = () => {
            const list = Array.isArray(r.result) ? r.result.slice() : [];
            const i = list.findIndex(x => x && x.id === item.id);
            if (i > -1) {
              const localTime = list[i].updatedAt || list[i].createdAt || '';
              const incomingTime = item.updatedAt || item.createdAt || '';
              if (incomingTime && localTime && incomingTime <= localTime) { resolve(false); return; }
              list[i] = item;
            } else { list.push(item); }
            store.put(list, key);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          };
          r.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  function _mergeSettings(remoteSettings) {
    return new Promise(resolve => {
      try {
        const req = indexedDB.open('DakaniDB', 1);
        req.onsuccess = e => {
          const idb = e.target.result;
          const tx = idb.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          const r = store.get('dakani_settings');
          r.onsuccess = () => {
            const merged = Object.assign({}, remoteSettings || {}, r.result || {}); // المحلي له الأولوية دائماً
            store.put(merged, 'dakani_settings');
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
          };
          r.onerror = () => resolve(false);
        };
        req.onerror = () => resolve(false);
      } catch (e) { resolve(false); }
    });
  }

  function _mergeLSKeyAdditive(lsKey, incomingArr) {
    try {
      let current = [];
      try { current = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (e) {}
      const existingIds = new Set(current.map(item => (item && typeof item === 'object') ? item.id : item));
      const additions = (Array.isArray(incomingArr) ? incomingArr : []).filter(item => {
        const id = (item && typeof item === 'object') ? item.id : item;
        return id === undefined || !existingIds.has(id);
      });
      if (additions.length) localStorage.setItem(lsKey, JSON.stringify(current.concat(additions)));
      return additions.length > 0;
    } catch (e) { return false; }
  }

  function _sig(item) {
    return (item && (item.updatedAt || item.createdAt)) ? String(item.updatedAt || item.createdAt) : (JSON.stringify(item).length + '');
  }

  // ════════════════════════════════════════════════════════════
  //  بناء رسالة "كل ما لم يُنقل بعد" (نفس الأساس الذي يضمن استكمال
  //  النقل تلقائياً بعد أي انقطاع، لأن السجل محلي دائم في localStorage)
  // ════════════════════════════════════════════════════════════
  async function _buildOutgoingDelta() {
    const data = await _readAllFromDB();
    if (!data) return null;
    const pushedMap = _lsGet(LS_PUSHED, {});
    const records = [];
    for (const table of RECORD_TABLES) {
      pushedMap[table] = pushedMap[table] || {};
      for (const item of (data[table] || [])) {
        if (!item || item.id === undefined) continue;
        const sig = _sig(item);
        if (pushedMap[table][item.id] === sig) continue;
        const clean = (table === 'products' && item.image) ? Object.assign({}, item, { image: undefined }) : item;
        records.push({ t: table, id: item.id, data: clean });
        pushedMap[table][item.id] = sig;
      }
    }
    const singles = {};
    singles.settings = data.settings || {};
    for (const key in SINGLE_KEYS_LS) {
      try { singles[key] = JSON.parse(localStorage.getItem(SINGLE_KEYS_LS[key]) || '[]'); } catch (e) { singles[key] = []; }
    }
    _lsSet(LS_PUSHED, pushedMap);
    if (!records.length) return { records: [], singles: null };
    return { records, singles };
  }

  // رسالة كاملة (تُرسَل مرة واحدة فقط لكل اتصال جديد، لضمان التقاء البيانات فوراً)
  async function _buildFullSnapshot() {
    const data = await _readAllFromDB();
    if (!data) return null;
    const records = [];
    for (const table of RECORD_TABLES) {
      for (const item of (data[table] || [])) {
        if (!item || item.id === undefined) continue;
        const clean = (table === 'products' && item.image) ? Object.assign({}, item, { image: undefined }) : item;
        records.push({ t: table, id: item.id, data: clean });
      }
    }
    const singles = { settings: data.settings || {} };
    for (const key in SINGLE_KEYS_LS) {
      try { singles[key] = JSON.parse(localStorage.getItem(SINGLE_KEYS_LS[key]) || '[]'); } catch (e) { singles[key] = []; }
    }
    return { records, singles };
  }

  async function _applyIncoming(msg) {
    let changed = false;
    if (Array.isArray(msg.records)) {
      for (const rec of msg.records) {
        if (!rec || !rec.t || rec.id === undefined) continue;
        const applied = await _upsertRecord(rec.t, rec.data);
        if (applied) changed = true;
      }
    }
    if (msg.singles) {
      if (msg.singles.settings) await _mergeSettings(msg.singles.settings);
      for (const key in SINGLE_KEYS_LS) {
        if (msg.singles[key]) { const ok = _mergeLSKeyAdditive(SINGLE_KEYS_LS[key], msg.singles[key]); changed = changed || ok; }
      }
    }
    if (changed) { _log('🔄 دُمجت بيانات جديدة محلياً'); _scheduleAutoRefresh(); }
  }

  // ─── تحديث تلقائي صامت (بلا أي زر) — يؤجَّل فقط إن كان المستخدم في
  // منتصف عملية حساسة (نافذة مفتوحة أو داخل صفحة البيع) حتى لا يقاطعه ───
  let _autoRefreshPending = false;
  function _scheduleAutoRefresh() {
    _autoRefreshPending = true;
    _tryAutoRefresh();
  }
  function _tryAutoRefresh() {
    if (!_autoRefreshPending) return;
    const modalOpen = !!document.querySelector('.modal-overlay.active');
    const onSellPage = document.getElementById('page-sell')?.classList.contains('active');
    if (modalOpen || onSellPage) { setTimeout(_tryAutoRefresh, 5000); return; }
    _autoRefreshPending = false;
    location.reload();
  }

  // ════════════════════════════════════════════════════════════
  //  طبقة الاتصالات الموحّدة (تُخفي الفرق بين إنترنت/محلي عن باقي الكود)
  // ════════════════════════════════════════════════════════════
  function _registerConn(sendFn, closeFn, transport) {
    const cid = uid();
    const c = { id: cid, transport, send: sendFn, close: closeFn, remoteId: null, remoteName: null, remoteIp: '', lastSeen: now() };
    conns.set(cid, c);
    return c;
  }
  function _unregisterConn(cid) {
    conns.delete(cid);
    _renderIfVisible();
  }

  async function _onConnOpen(c) {
    _log(`✅ اتصال جديد مفتوح (${c.transport === 'internet' ? 'إنترنت' : 'محلي'}) — جارٍ إرسال التعريف والبيانات...`);
    // أول رسالة: تعريف بالجهاز
    if (!publicIp) publicIp = await _getPublicIP();
    _send(c, { type: 'hello', id: uid(), from: _deviceId(), name: getDeviceName(), ip: publicIp });
    // مزامنة فورية كاملة مع هذا الاتصال الجديد تحديداً
    const snap = await _buildFullSnapshot();
    if (snap) _send(c, { type: 'snapshot', id: uid(), from: _deviceId(), records: snap.records, singles: snap.singles });
    _startPushLoopIfNeeded();
    _renderIfVisible();
  }
  function _onConnClose(c) {
    _log(`⛔ انقطع اتصال (${c.transport === 'internet' ? 'إنترنت' : 'محلي'})${c.remoteName ? ' مع ' + c.remoteName : ''}`);
    _unregisterConn(c.id);
    if (c.remoteId) presence.delete(c.remoteId);
    // تنظيف أي أجزاء رسائل كبيرة لم تكتمل بعد لهذا الاتصال (تفادي تسرّب ذاكرة)
    for (const key of Array.from(chunkBuffers.keys())) { if (key.startsWith(c.id + '|')) chunkBuffers.delete(key); }
    if (conns.size === 0 && pushTimer) { clearInterval(pushTimer); pushTimer = null; }
    _renderIfVisible();
  }

  // ─── إرسال آمن: يقسّم أي رسالة كبيرة إلى أجزاء صغيرة تلقائياً ─────────────
  // (هذا هو الإصلاح الجوهري لعطل "Message too big for JSON channel" — قنوات
  // WebRTC/PeerJS لها حد أقصى لحجم الرسالة الواحدة، وبيانات المحل الكاملة
  // غالباً أكبر من ذلك بكثير)
  const CHUNK_SIZE = 12000; // بالأحرف — أقل من أي حد معروف لقنوات البيانات (حتى المتحفّظة منها)
  function _rawSend(c, obj) {
    try { c.send(obj); }
    catch (e) { _log('⚠️ فشل إرسال جزء رسالة: ' + (e && e.message || e)); }
  }
  function _send(c, obj) {
    let str;
    try { str = JSON.stringify(obj); } catch (e) { _log('⚠️ تعذّر تجهيز رسالة للإرسال'); return; }
    sentCount++;
    if (str.length <= CHUNK_SIZE) { _rawSend(c, obj); return; }
    const cid = obj.id || uid();
    const total = Math.ceil(str.length / CHUNK_SIZE);
    for (let i = 0; i < total; i++) {
      _rawSend(c, { type: '__chunk', cid, seq: i, total, part: str.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
    }
    _log(`📦 أُرسلت رسالة كبيرة (${(str.length / 1024).toFixed(0)} كيلوبايت) على ${total} جزءاً`);
  }

  // ─── استقبال: يجمّع أجزاء الرسائل الكبيرة قبل تمريرها للمعالجة العادية ────
  const chunkBuffers = new Map(); // key: connId+'|'+cid → {parts, total, received}
  function _onRawMessage(raw, c) {
    if (!raw) return;
    if (raw.type === '__chunk') { _handleChunk(raw, c); return; }
    _onMessage(raw, c);
  }
  function _handleChunk(msg, c) {
    const key = c.id + '|' + msg.cid;
    let buf = chunkBuffers.get(key);
    if (!buf) { buf = { parts: new Array(msg.total), received: 0, total: msg.total }; chunkBuffers.set(key, buf); }
    if (buf.parts[msg.seq] === undefined) buf.received++;
    buf.parts[msg.seq] = msg.part;
    if (buf.received === buf.total) {
      chunkBuffers.delete(key);
      try {
        const full = JSON.parse(buf.parts.join(''));
        _log('📦 اكتمل تجميع رسالة كبيرة (' + msg.total + ' أجزاء) — جارٍ المعالجة');
        _onMessage(full, c);
      } catch (e) { _log('❌ فشل تجميع رسالة كبيرة: ' + (e && e.message || e)); }
    }
  }

  function _broadcastToAll(obj) { conns.forEach(c => _send(c, obj)); }
  function _relayToOthers(obj, exceptConnId) { conns.forEach(c => { if (c.id !== exceptConnId) _send(c, obj); }); }

  async function _onMessage(msg, c) {
    if (!msg || !msg.id) { _log('⚠️ وصلت رسالة بلا معرّف — تم تجاهلها'); return; }
    recvCount++;
    if (seenMsgSet.has(msg.id)) return; // منع التكرار/الحلقات عند إعادة البث
    seenMsgSet.add(msg.id); seenMsgIds.push(msg.id);
    if (seenMsgIds.length > 800) { const old = seenMsgIds.shift(); seenMsgSet.delete(old); }
    if (msg.from === _deviceId()) return;

    c.lastSeen = now();

    switch (msg.type) {
      case 'hello':
        _log('📩 استلمت تعريفاً من: ' + (msg.name || msg.from));
        c.remoteId = msg.from; c.remoteName = msg.name; c.remoteIp = msg.ip;
        presence.set(msg.from, { name: msg.name, ip: msg.ip, transport: c.transport, lastSeen: now() });
        _renderIfVisible();
        break;
      case 'snapshot':
      case 'delta':
        if (c.remoteId) presence.set(c.remoteId, Object.assign({}, presence.get(c.remoteId) || { name: c.remoteName, ip: c.remoteIp, transport: c.transport }, { lastSeen: now() }));
        await _applyIncoming(msg);
        break;
      case 'kick':
        if (msg.targetId === _deviceId()) _handleBeingKicked();
        break;
      case 'ping':
        break; // مجرد نبضة لإبقاء الاتصال حياً — تحديث lastSeen تم أعلاه بالفعل
    }
    if (msg.type !== 'ping') _relayToOthers(msg, c.id);
  }

  function _handleBeingKicked() {
    _lsSetStr(LS_KICKED_UNTIL, String(Date.now() + 10 * 60 * 1000)); // تهدئة 10 دقائق قبل إعادة محاولة تلقائية
    _stopEverything();
    _toast('🔌 تم فصلك من الفريق بواسطة المدير', 'warning');
    _renderIfVisible();
  }

  // ════════════════════════════════════════════════════════════
  //  دورة رفع الفروقات (طالما هناك اتصال واحد على الأقل مفتوح)
  // ════════════════════════════════════════════════════════════
  function _startPushLoopIfNeeded() {
    if (pushTimer) return;
    pushTimer = setInterval(async () => {
      if (conns.size === 0) return;
      // نبضة إبقاء حيّ دائمة — حتى إن لم توجد بيانات جديدة، لضمان بقاء الاتصال
      // مفتوحاً باستمرار طالما الإنترنت متوفر (بعض الشبكات/الراوترات تُغلق
      // الاتصال الخامل تلقائياً بعد مدة قصيرة من عدم النشاط)
      _broadcastToAll({ type: 'ping', id: uid(), from: _deviceId() });
      const delta = await _buildOutgoingDelta();
      if (delta && delta.records.length) {
        _broadcastToAll({ type: 'delta', id: uid(), from: _deviceId(), records: delta.records, singles: delta.singles });
      }
    }, PUSH_INTERVAL_MS);
  }

  // ════════════════════════════════════════════════════════════
  //  الوضع 1: عبر الإنترنت (تلقائي — PeerJS لمجرد "التعارف" الأولي)
  // ════════════════════════════════════════════════════════════
  function _peerOpts() {
    return { config: { iceServers: STUN_SERVERS }, debug: 0 };
  }

  function _hubId(teamId) { return 'dkteam-' + teamId; }

  function startInternetMode() {
    if (Date.now() < parseInt(_lsGetStr(LS_KICKED_UNTIL) || '0', 10)) {
      _toast('⏳ انتظر قليلاً قبل إعادة الاتصال (تم فصلك مؤخراً من قبل المدير)', 'warning');
      return;
    }
    if (typeof Peer === 'undefined') { _toast('⚠️ تعذّر تحميل مكوّن الاتصال — تحقق من اتصالك بالإنترنت', 'error'); return; }
    if (internetTimer) return; // يعمل بالفعل
    _log('▶️ بدء وضع الإنترنت — محاولة الاتصال...');
    _tryBecomeHubOrSpoke();
    internetTimer = setInterval(() => {
      if (!peer || peer.destroyed || (!isHub && !_hasOpenInternetConn())) _tryBecomeHubOrSpoke();
    }, RECONNECT_MS);
  }

  function _hasOpenInternetConn() {
    for (const c of conns.values()) if (c.transport === 'internet') return true;
    return false;
  }

  function _resetPeer(reason) {
    if (reason) _log('🔄 إعادة تهيئة الاتصال: ' + reason);
    if (peer) { try { peer.destroy(); } catch (e) {} }
    peer = null; isHub = false;
  }

  function _tryBecomeHubOrSpoke() {
    if (peer && !peer.destroyed) return;
    const teamId = getTeamId();
    if (!teamId) return;
    _log('🔎 محاولة أن أصبح نقطة الالتقاء (hub) لرمز الفريق: ' + teamId);
    let p;
    try { p = new Peer(_hubId(teamId), _peerOpts()); }
    catch (e) { _log('❌ تعذّر إنشاء اتصال WebRTC: ' + (e && e.message || e)); return; }
    peer = p;
    let settled = false;

    p.on('open', () => {
      settled = true;
      isHub = true;
      _log('👑 أصبحت هذا الجهاز نقطة الالتقاء — بانتظار انضمام الأجهزة الأخرى');
      p.on('connection', spokeConn => { _log('📞 جهاز آخر يحاول الاتصال بي...'); _wirePeerJsConn(spokeConn); });
    });

    p.on('disconnected', () => { _log('⚠️ انقطع الاتصال بخادم التعارف — سيُعاد المحاولة تلقائياً'); });

    p.on('error', err => {
      const type = err && err.type;
      _log('⚠️ خطأ اتصال (' + type + ')' + (settled ? ' — بعد أن كنت متصلاً بالفعل' : ''));
      if (!settled && type === 'unavailable-id') {
        settled = true;
        isHub = false;
        try { p.destroy(); } catch (e) {}
        peer = null;
        _connectAsSpoke(teamId);
        return;
      }
      // أي خطأ آخر (شبكة/خادم/متصفح): لا نبقى عالقين — نصفّر الحالة ليعيد المؤقّت المحاولة تلقائياً
      _resetPeer(null);
    });
  }

  function _connectAsSpoke(teamId) {
    const myId = 'dk-' + teamId + '-' + _deviceId() + '-' + Math.random().toString(36).slice(2, 6);
    _log('🔗 نقطة الالتقاء مشغولة من جهاز آخر — أتصل بها كعضو في الفريق');
    let p;
    try { p = new Peer(myId, _peerOpts()); } catch (e) { _log('❌ تعذّر إنشاء اتصال WebRTC: ' + (e && e.message || e)); return; }
    peer = p;
    p.on('open', () => {
      const conn = p.connect(_hubId(teamId), { reliable: true, serialization: 'json' });
      _wirePeerJsConn(conn);
    });
    p.on('error', err => {
      _log('⚠️ خطأ اتصال كعضو (' + (err && err.type) + ') — ستُعاد المحاولة تلقائياً');
      _resetPeer(null);
    });
  }

  // يراقب الاتصال الفعلي (WebRTC/ICE) خلف PeerJS — يكشف تحديداً حالات فشل عبور الشبكات (NAT)
  // وهي السبب الأكثر شيوعاً لظهور "متصل" في جهاز و"غير متصل" في الآخر
  function _watchIceState(peerConn) {
    try {
      const pc = peerConn.peerConnection;
      if (!pc) return;
      pc.oniceconnectionstatechange = () => {
        _log('🧭 حالة الشبكة (ICE): ' + pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          _toast('⚠️ فشل الاتصال المباشر بين الجهازين (على الأرجح بسبب شبكة/جدار حماية) — جرّب الوضع المحلي إن كانا على نفس الواي فاي', 'warning');
        }
      };
    } catch (e) {}
  }

  function _wirePeerJsConn(peerConn) {
    let c = null;
    _watchIceState(peerConn);
    peerConn.on('open', () => {
      c = _registerConn(
        obj => peerConn.send(obj),
        () => peerConn.close(),
        'internet'
      );
      _onConnOpen(c);
    });
    peerConn.on('data', d => { if (c) _onRawMessage(d, c); });
    peerConn.on('close', () => { if (c) _onConnClose(c); });
    peerConn.on('error', err => { _log('⚠️ خطأ في قناة البيانات: ' + (err && err.message || err)); if (c) _onConnClose(c); });
  }

  function stopInternetMode() {
    if (internetTimer) { clearInterval(internetTimer); internetTimer = null; }
    conns.forEach((c, id) => { if (c.transport === 'internet') { try { c.close(); } catch (e) {} conns.delete(id); } });
    if (peer) { try { peer.destroy(); } catch (e) {} peer = null; }
    isHub = false;
  }

  function forceReconnect() {
    _log('🔁 إعادة اتصال يدوية بطلب المستخدم');
    stopInternetMode();
    setTimeout(() => startInternetMode(), 300);
  }

  // ════════════════════════════════════════════════════════════
  //  الوضع 2: اتصال محلي مباشر (كيبل/نفس الشبكة) — بدون إنترنت إطلاقاً
  //  تبادل يدوي لـ "رمز دعوة" و"رمز رد" (نسخ/لصق) مرة واحدة فقط لكل زوج أجهزة
  // ════════════════════════════════════════════════════════════
  function _waitIceComplete(pc, timeoutMs) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') { resolve(); return; }
      const t = setTimeout(() => { _log('⏱️ انتهت مهلة تجميع مسارات الاتصال — سنكمل بما تم جمعه حتى الآن'); resolve(); }, timeoutMs || LOCAL_ICE_TIMEOUT_MS);
      pc.onicegatheringstatechange = () => {
        _log('📡 حالة تجميع المسارات: ' + pc.iceGatheringState);
        if (pc.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
      };
    });
  }
  function _watchLocalPcState(pc) {
    pc.oniceconnectionstatechange = () => {
      _log('🧭 حالة الشبكة المحلية (ICE): ' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        _toast('⚠️ فشل الاتصال المحلي — تأكّد أن الجهازين على نفس الشبكة (الواي فاي)، أو جرّب وضع الإنترنت', 'warning');
      }
    };
  }
  function _encodeCode(obj) { return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))); }
  function _decodeCode(text) {
    try { return JSON.parse(decodeURIComponent(escape(atob(String(text || '').trim())))); }
    catch (e) { return null; }
  }

  // الجهاز (أ): يولّد "رمز الدعوة"
  async function localCreateInvite() {
    if (pendingLocalPC) { _log('ℹ️ استبدال محاولة اتصال محلي سابقة لم تكتمل بمحاولة جديدة'); try { pendingLocalPC.close(); } catch (e) {} pendingLocalPC = null; }
    _log('📝 إنشاء رمز دعوة جديد...');
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    _watchLocalPcState(pc);
    const channel = pc.createDataChannel('dakani');
    _wireLocalChannel(channel);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await _waitIceComplete(pc);
    pendingLocalPC = pc;
    _log('✅ رمز الدعوة جاهز — شاركه مع الجهاز الآخر');
    return _encodeCode({ sdp: pc.localDescription, from: _deviceId(), name: getDeviceName() });
  }

  // الجهاز (أ): يُدخل "رمز الرد" القادم من الجهاز (ب) لإتمام الاتصال
  async function localAcceptAnswer(answerCode) {
    if (!pendingLocalPC) { _toast('⚠️ لم يبدأ أي اتصال محلي بعد — أنشئ رمز الدعوة أولاً', 'error'); return false; }
    const obj = _decodeCode(answerCode);
    if (!obj || !obj.sdp) { _toast('⚠️ الرمز غير صحيح — تأكد من نسخه كاملاً', 'error'); return false; }
    try {
      _log('🔗 تطبيق رمز الرد...');
      await pendingLocalPC.setRemoteDescription(obj.sdp);
      pendingLocalPC = null;
      return true;
    } catch (e) { _log('❌ فشل تطبيق رمز الرد: ' + (e && e.message || e)); _toast('❌ تعذّر إتمام الاتصال — تأكد من نسخ الرمز الصحيح والكامل', 'error'); return false; }
  }

  // الجهاز (ب): يلصق "رمز الدعوة" القادم من الجهاز (أ) ويولّد "رمز الرد"
  async function localAcceptInvite(inviteCode) {
    const obj = _decodeCode(inviteCode);
    if (!obj || !obj.sdp) { _toast('⚠️ الرمز غير صحيح — تأكد من نسخه كاملاً', 'error'); return null; }
    _log('📝 توليد رمز رد لدعوة من: ' + (obj.name || obj.from));
    const pc = new RTCPeerConnection({ iceServers: STUN_SERVERS });
    _watchLocalPcState(pc);
    pc.ondatachannel = e => _wireLocalChannel(e.channel);
    await pc.setRemoteDescription(obj.sdp);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await _waitIceComplete(pc);
    _log('✅ رمز الرد جاهز — أعده للجهاز الأول');
    return _encodeCode({ sdp: pc.localDescription, from: _deviceId(), name: getDeviceName() });
  }

  function _wireLocalChannel(channel) {
    let c = null;
    channel.onopen = () => {
      c = _registerConn(
        obj => channel.send(JSON.stringify(obj)),
        () => channel.close(),
        'local'
      );
      _onConnOpen(c);
    };
    channel.onmessage = e => { if (c) { try { _onRawMessage(JSON.parse(e.data), c); } catch (err) { _log('❌ رسالة غير صالحة عبر الاتصال المحلي'); } } };
    channel.onclose = () => { if (c) _onConnClose(c); };
  }

  // ════════════════════════════════════════════════════════════
  //  إنشاء/مغادرة الفريق
  // ════════════════════════════════════════════════════════════
  function createOrSetTeam(teamId, deviceName) {
    _lsSetStr(LS_TEAMID, teamId);
    _lsSetStr(LS_DEVICENAME, deviceName || _defaultDeviceName());
  }

  function leaveTeam() {
    _stopEverything();
    _lsDel(LS_TEAMID); _lsDel(LS_PUSHED); _lsDel(LS_KICKED_UNTIL);
    _toast('تم مغادرة الفريق من هذا الجهاز', 'info');
    if (typeof renderOnlineSyncPage === 'function') renderOnlineSyncPage();
  }

  function _stopEverything() {
    stopInternetMode();
    conns.forEach(c => { try { c.close(); } catch (e) {} });
    conns.clear();
    presence.clear();
    if (pushTimer) { clearInterval(pushTimer); pushTimer = null; }
  }

  // ════════════════════════════════════════════════════════════
  //  فصل جهاز يعمل حالياً على الإنترنت — للمدير فقط
  //  (يعمل فقط طالما هذا الجهاز متصل الآن — لا يوجد سجل دائم لحذفه لاحقاً)
  // ════════════════════════════════════════════════════════════
  function kickDevice(targetId) {
    if (!_isManager()) { _toast('⚠️ هذا الإجراء متاح للمدير فقط / Manager only', 'warning'); return; }
    if (!confirm('فصل هذا الجهاز عن الفريق الآن؟ (يمكنه محاولة العودة لاحقاً)\nDisconnect this device now?')) return;
    _broadcastToAll({ type: 'kick', id: uid(), from: _deviceId(), targetId });
    setTimeout(() => { presence.delete(targetId); _renderIfVisible(); }, 500);
  }

  function renameThisDevice(name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    _lsSetStr(LS_DEVICENAME, clean);
    _broadcastToAll({ type: 'hello', id: uid(), from: _deviceId(), name: clean, ip: publicIp });
    _toast('تم تحديث اسم الجهاز', 'success');
  }

  // ════════════════════════════════════════════════════════════
  //  تنظيف الحضور القديم دورياً (لا يوجد إشعار إغلاق دائماً على كل الشبكات)
  // ════════════════════════════════════════════════════════════
  function _startPresenceCleanup() {
    if (presenceTimer) return;
    presenceTimer = setInterval(() => {
      const cutoff = Date.now() - PRESENCE_STALE_MS;
      let changed = false;
      presence.forEach((v, k) => { if (new Date(v.lastSeen).getTime() < cutoff) { presence.delete(k); changed = true; } });
      if (changed) _renderIfVisible();
    }, 20000);
  }

  function _renderIfVisible() {
    if (document.getElementById('page-online-sync')?.classList.contains('active') && typeof renderOnlineSyncPage === 'function') {
      renderOnlineSyncPage();
    }
  }

  // ════════════════════════════════════════════════════════════
  //  الإقلاع التلقائي عند فتح التطبيق إن كان مُهيّأً مسبقاً
  // ════════════════════════════════════════════════════════════
  function _bootIfConfigured() {
    _startPresenceCleanup();
    if (isConfigured()) startInternetMode();
  }

  // ════════════════════════════════════════════════════════════
  //  الواجهة — CSS
  // ════════════════════════════════════════════════════════════
  function _injectStyles() {
    if (document.getElementById('dakani-onlinesync-style')) return;
    const style = document.createElement('style');
    style.id = 'dakani-onlinesync-style';
    style.textContent = `
      .os-grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-bottom:16px; }
      @media (max-width:900px){ .os-grid{ grid-template-columns:1fr; } }
      .os-card { background:var(--surface,#111827); border:1px solid var(--border,#1e293b); border-radius:var(--radius,12px); padding:20px; }
      .os-card h3 { margin:0 0 12px; font-size:15px; display:flex; align-items:center; gap:8px; }
      .os-status { display:inline-flex; align-items:center; gap:6px; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; }
      .os-status.on { background:rgba(16,185,129,.15); color:#10b981; }
      .os-status.off { background:rgba(148,163,184,.15); color:var(--text2,#94a3b8); }
      .os-code-box { display:flex; gap:8px; align-items:flex-start; background:var(--surface3,#1e2d3d); border:1px solid var(--border2,#253347); border-radius:8px; padding:10px 12px; margin:10px 0; }
      .os-code-box textarea, .os-code-box code { flex:1; font-family:monospace; font-size:11px; word-break:break-all; color:var(--accent,#10b981); background:none; border:none; resize:vertical; }
      .os-tabs { display:flex; gap:8px; margin-bottom:14px; }
      .os-tab { flex:1; text-align:center; padding:10px; border:1px solid var(--border2,#253347); border-radius:10px; cursor:pointer; font-size:13px; }
      .os-tab.active { border-color:var(--accent,#10b981); background:rgba(16,185,129,.08); color:var(--accent,#10b981); font-weight:700; }
      .os-hint { font-size:12px; color:var(--text2,#94a3b8); line-height:1.7; margin-top:6px; }
      .os-device-row { display:flex; align-items:center; justify-content:space-between; padding:10px 0; border-bottom:1px solid var(--border,#1e293b); gap:10px; flex-wrap:wrap; }
      .os-device-row:last-child { border-bottom:none; }
      .os-device-meta { font-size:12px; color:var(--text2,#94a3b8); }
      .os-badge-you { background:var(--accent,#10b981); color:#fff; font-size:10px; padding:2px 8px; border-radius:10px; margin-inline-start:6px; }
      .os-badge-mode { font-size:10px; padding:2px 8px; border-radius:10px; margin-inline-start:6px; background:rgba(14,165,233,.15); color:#0ea5e9; }
      .os-danger-zone { border:1px solid rgba(239,68,68,.35); border-radius:10px; padding:14px; margin-top:16px; }
      .os-danger-zone h4 { margin:0 0 8px; color:#ef4444; font-size:13px; }
    `;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════════════════════
  //  الواجهة — الصفحة
  // ════════════════════════════════════════════════════════════
  function _injectPageShell() {
    if (document.getElementById('page-online-sync')) return;
    const main = document.getElementById('main-content');
    if (!main) return;
    const div = document.createElement('div');
    div.className = 'page';
    div.id = 'page-online-sync';
    div.innerHTML = `<div class="page-header"><h1>العمل عبر الإنترنت <span>Online Team Sync</span></h1></div>
      <div id="os-content"></div>`;
    main.appendChild(div);
  }

  function _setupHtml() {
    return `
      <div class="os-card">
        <h3><i class="fas fa-tower-broadcast"></i> ربط أجهزة المحل ببعضها / Link your devices</h3>
        <p class="os-hint">
          يربط هذا الخيار كل أجهزة محلك (مكاتب، هاتف، حاسوب...) مباشرة ببعضها — دون أي خادم بيانات وسيط،
          البيانات تنتقل مباشرة من جهاز إلى آخر فقط. إن انقطع الاتصال يستمر التطبيق يعمل محلياً كالمعتاد،
          وعند عودته تُستكمل عملية النقل تلقائياً.
        </p>
        <div class="form-group" style="margin-top:14px;"><label>اسم هذا الجهاز / This device name</label>
          <input type="text" id="os-devname-input" value="${escHtml(_defaultDeviceName())}"/>
        </div>
      </div>

      <div class="os-grid" style="margin-top:16px;">
        <div class="os-card">
          <h3><i class="fas fa-wifi"></i> عبر الإنترنت (تلقائي)</h3>
          <p class="os-hint">أدخل نفس "رمز الفريق" في كل الأجهزة — يتصلون تلقائياً حتى لو كانوا في مدن مختلفة.</p>
          <div class="form-group"><label>رمز الفريق / Team code</label>
            <input type="text" id="os-teamid-input" placeholder="مثال: ABC123XYZ9" style="text-transform:uppercase;"/>
          </div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-primary" onclick="DakaniOnlineSync._submitGenTeam()"><i class="fas fa-plus"></i> إنشاء رمز جديد</button>
            <button class="btn-secondary" onclick="DakaniOnlineSync._submitJoinTeam()"><i class="fas fa-right-to-bracket"></i> اتصال بهذا الرمز</button>
          </div>
        </div>

        <div class="os-card">
          <h3><i class="fas fa-plug"></i> اتصال محلي / بدون إنترنت</h3>
          <p class="os-hint">مناسب لجهازين في نفس المكان (نفس الواي فاي) لا يحتاج إنترنت إطلاقاً. خطوتان بالنسخ واللصق.</p>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button class="btn-secondary" onclick="DakaniOnlineSync._showLocalCreate()"><i class="fas fa-arrow-up-from-bracket"></i> أنا البادئ (أرسل رمز دعوة)</button>
            <button class="btn-secondary" onclick="DakaniOnlineSync._showLocalAccept()"><i class="fas fa-arrow-down-to-bracket"></i> استلمت رمز دعوة</button>
          </div>
          <div id="os-local-area" style="margin-top:12px;"></div>
        </div>
      </div>
    `;
  }

  function _submitGenTeam() {
    const name = document.getElementById('os-devname-input')?.value;
    const teamId = _genTeamId();
    createOrSetTeam(teamId, name);
    startInternetMode();
    _toast('✅ تم إنشاء رمز الفريق: ' + teamId + ' — شاركه مع بقية الأجهزة', 'success');
    renderOnlineSyncPage();
  }
  function _submitJoinTeam() {
    const name = document.getElementById('os-devname-input')?.value;
    const teamId = (document.getElementById('os-teamid-input')?.value || '').trim().toUpperCase();
    if (!teamId) { _toast('أدخل رمز الفريق أولاً', 'warning'); return; }
    createOrSetTeam(teamId, name);
    startInternetMode();
    renderOnlineSyncPage();
  }

  async function _showLocalCreate() {
    const area = document.getElementById('os-local-area');
    if (!area) return;
    area.innerHTML = `<div class="os-hint">جارٍ توليد رمز الدعوة...</div>`;
    const code = await localCreateInvite();
    area.innerHTML = `
      <div class="form-group"><label>1) شارك رمز الدعوة هذا مع الجهاز الآخر</label>
        <div class="os-code-box"><textarea readonly rows="3" id="os-invite-out">${escHtml(code)}</textarea>
          <button class="btn-icon" onclick="DakaniOnlineSync._copyEl('os-invite-out')"><i class="fas fa-copy"></i></button></div>
      </div>
      <div class="form-group"><label>2) الصق "رمز الرد" القادم من الجهاز الآخر هنا</label>
        <textarea id="os-answer-in" rows="3" placeholder="الصق رمز الرد هنا"></textarea>
      </div>
      <button class="btn-primary" onclick="DakaniOnlineSync._submitLocalAnswer()"><i class="fas fa-link"></i> إتمام الاتصال</button>`;
  }
  function _showLocalAccept() {
    const area = document.getElementById('os-local-area');
    if (!area) return;
    area.innerHTML = `
      <div class="form-group"><label>1) الصق رمز الدعوة القادم من الجهاز الآخر</label>
        <textarea id="os-invite-in" rows="3" placeholder="الصق رمز الدعوة هنا"></textarea>
      </div>
      <button class="btn-primary" onclick="DakaniOnlineSync._submitLocalInvite()"><i class="fas fa-reply"></i> توليد رمز الرد</button>
      <div id="os-answer-out-area" style="margin-top:10px;"></div>`;
  }
  async function _submitLocalInvite() {
    const val = document.getElementById('os-invite-in')?.value;
    const code = await localAcceptInvite(val);
    if (!code) return;
    const teamId = getTeamId() || ('LOCAL-' + uid());
    if (!getTeamId()) createOrSetTeam(teamId, document.getElementById('os-devname-input')?.value);
    document.getElementById('os-answer-out-area').innerHTML = `
      <label class="os-hint">3) أرسل رمز الرد هذا للجهاز الأول لإتمام الاتصال</label>
      <div class="os-code-box"><textarea readonly rows="3" id="os-answer-out">${escHtml(code)}</textarea>
        <button class="btn-icon" onclick="DakaniOnlineSync._copyEl('os-answer-out')"><i class="fas fa-copy"></i></button></div>`;
  }
  async function _submitLocalAnswer() {
    const val = document.getElementById('os-answer-in')?.value;
    const teamId = getTeamId() || ('LOCAL-' + uid());
    if (!getTeamId()) createOrSetTeam(teamId, document.getElementById('os-devname-input')?.value);
    const ok = await localAcceptAnswer(val);
    if (ok) { _toast('✅ تم الاتصال المحلي بنجاح', 'success'); renderOnlineSyncPage(); }
  }
  function _copyEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    navigator.clipboard?.writeText(el.value || el.textContent).then(() => _toast('تم النسخ ✓', 'success')).catch(() => {});
  }

  function _connectedHtml() {
    const manager = _isManager();
    const myId = _deviceId();
    const list = Array.from(presence.entries()).map(([id, v]) => Object.assign({ id }, v))
      .sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

    const rows = list.length ? list.map(d => `
      <div class="os-device-row">
        <div>
          <strong>${escHtml(d.name || 'جهاز')}</strong>
          <span class="os-badge-mode">${d.transport === 'internet' ? 'إنترنت' : 'محلي'}</span>
          <div class="os-device-meta">
            <i class="fas fa-globe"></i> ${escHtml(d.ip || 'غير معروف')} &nbsp;•&nbsp; آخر تواصل: ${_relTime(d.lastSeen)}
          </div>
        </div>
        ${manager ? `<button class="btn-icon danger" title="فصل الجهاز" onclick="DakaniOnlineSync.kickDevice('${escHtml(d.id)}')"><i class="fas fa-trash"></i></button>` : ''}
      </div>`).join('') : `<div class="os-hint">لا توجد أجهزة متصلة حالياً — الأجهزة تظهر هنا فور اتصالها فعلياً.</div>`;

    return `
      <div class="os-grid">
        <div class="os-card">
          <h3><i class="fas fa-circle-nodes"></i> حالة الاتصال
            <span class="os-status ${isConnected() ? 'on' : 'off'}" style="margin-inline-start:auto;">
              <i class="fas fa-circle" style="font-size:8px;"></i> ${isConnected() ? 'متصل الآن' : 'بانتظار اتصال'}
            </span>
          </h3>
          <p class="os-hint">اسم هذا الجهاز:</p>
          <div style="display:flex; gap:8px;">
            <input type="text" id="os-rename-input" value="${escHtml(getDeviceName())}" style="flex:1;"/>
            <button class="btn-secondary" onclick="DakaniOnlineSync._submitRename()"><i class="fas fa-pen"></i></button>
          </div>
        </div>
        <div class="os-card">
          <h3><i class="fas fa-key"></i> رمز الفريق / Team code</h3>
          <p class="os-hint">شاركه مع أي جهاز جديد تريد ربطه (يدخله في خانة "اتصال بهذا الرمز").</p>
          <div class="os-code-box"><code id="os-teamid-out">${escHtml(getTeamId())}</code>
            <button class="btn-icon" onclick="DakaniOnlineSync._copyEl('os-teamid-out')"><i class="fas fa-copy"></i></button></div>
          <p class="os-hint">لإضافة جهاز محلي بدون إنترنت، افتح "اتصال محلي" من هذه الصفحة على الجهازين.</p>
          <div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:6px;">
            <button class="btn-secondary" onclick="DakaniOnlineSync._showLocalCreate()"><i class="fas fa-arrow-up-from-bracket"></i> أنا البادئ</button>
            <button class="btn-secondary" onclick="DakaniOnlineSync._showLocalAccept()"><i class="fas fa-arrow-down-to-bracket"></i> استلمت رمز دعوة</button>
          </div>
          <div id="os-local-area" style="margin-top:10px;"></div>
        </div>
      </div>
      <div class="os-card" style="margin-bottom:16px;">
        <h3><i class="fas fa-laptop-mobile"></i> الأجهزة المتصلة الآن / Currently Connected
          <button class="btn-icon" title="إعادة محاولة الاتصال" style="margin-inline-start:auto;" onclick="DakaniOnlineSync.forceReconnect()"><i class="fas fa-rotate"></i></button>
        </h3>
        ${rows}
      </div>
      <div class="os-card" style="margin-bottom:16px;">
        <h3><i class="fas fa-stethoscope"></i> سجل التشخيص / Diagnostics
          <span class="os-badge-mode">أرسلت: ${sentCount}</span><span class="os-badge-mode">استلمت: ${recvCount}</span>
          <button class="btn-icon" title="نسخ السجل" style="margin-inline-start:auto;" onclick="DakaniOnlineSync._copyLog()"><i class="fas fa-copy"></i></button>
        </h3>
        <p class="os-hint">إن لم يظهر جهاز آخر، افتح هذا السجل في كلا الجهازين وقارن أين توقفت الأحداث — هذا يوضح بالضبط أين تعطّل الاتصال.</p>
        <div class="os-code-box" style="max-height:220px; overflow-y:auto; display:block;">
          ${DEBUG_LOG.length ? DEBUG_LOG.slice().reverse().map(l => `<div style="font-family:monospace; font-size:11px; color:var(--text2,#94a3b8); padding:2px 0; border-bottom:1px solid var(--border,#1e293b);">${escHtml(l)}</div>`).join('') : '<div class="os-hint">لا توجد أحداث بعد</div>'}
        </div>
      </div>
      <div class="os-hint" style="margin-bottom:10px;"><i class="fas fa-circle-info"></i>
        صور المنتجات لا تُنقَل عبر هذا الجسر (لتفادي إبطاء الاتصال المباشر) — فقط الأسعار والكميات والبيانات النصية.
        المزامنة تراكمية فقط: لا يُحذف أي شيء محلياً تلقائياً حتى لو حُذف في جهاز آخر.
        كذلك: يجب أن يكون الجهازان مفتوحين معاً (أو يتداخل وقت فتحهما) لينتقل أي تحديث بينهما مباشرة أو عبر جهاز وسيط من نفس الفريق.
      </div>
      ${manager ? `
      <div class="os-danger-zone">
        <h4><i class="fas fa-triangle-exclamation"></i> منطقة خطرة — للمدير فقط</h4>
        <button class="btn-secondary" onclick="DakaniOnlineSync._confirmLeave()"><i class="fas fa-plug-circle-xmark"></i> مغادرة الفريق من هذا الجهاز</button>
      </div>` : ''}
    `;
  }
  function _copyLog() {
    navigator.clipboard?.writeText(DEBUG_LOG.join('\n')).then(() => _toast('تم نسخ سجل التشخيص ✓', 'success')).catch(() => {});
  }

  function _submitRename() { renameThisDevice(document.getElementById('os-rename-input')?.value); }
  function _confirmLeave() {
    if (!confirm('مغادرة الفريق من هذا الجهاز فقط؟ بقية الأجهزة تبقى مرتبطة ببعضها.\nLeave the team from this device only?')) return;
    leaveTeam();
  }

  function renderOnlineSyncPage() {
    _injectStyles();
    _injectPageShell();
    const content = document.getElementById('os-content');
    if (!content) return;
    content.innerHTML = isConfigured() ? _connectedHtml() : _setupHtml();
  }

  function _showOnlineSyncPage() {
    _injectPageShell();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-online-sync').classList.add('active');
    document.querySelector('[data-page="online-sync"]')?.classList.add('active');
    const title = document.getElementById('topbar-title');
    if (title) title.textContent = 'العمل عبر الإنترنت / Online Team Sync';
    renderOnlineSyncPage();
    if (window.innerWidth < 900) document.getElementById('sidebar')?.classList.remove('open');
  }

  // ════════════════════════════════════════════════════════════
  //  ربط الشريط الجانبي + التنقّل — دون لمس script.js
  // ════════════════════════════════════════════════════════════
  function _injectSidebarNavItem() {
    if (document.querySelector('[data-page="online-sync"]')) return;
    const nav = document.querySelector('.sidebar-nav');
    const settingsItem = document.querySelector('.sidebar-nav [data-page="settings"]');
    if (!nav) return;
    const a = document.createElement('a');
    a.href = '#'; a.className = 'nav-item'; a.dataset.page = 'online-sync';
    a.innerHTML = `<i class="fas fa-tower-broadcast"></i><span class="nav-ar">العمل عبر الإنترنت</span>`;
    a.addEventListener('click', e => { e.preventDefault(); if (typeof navigateTo === 'function') navigateTo('online-sync'); else _showOnlineSyncPage(); });
    if (settingsItem) nav.insertBefore(a, settingsItem); else nav.appendChild(a);
  }

  function _wrapNavigateTo() {
    if (typeof window.navigateTo !== 'function' || window.navigateTo.__dakaniOnlineWrapped) return;
    const original = window.navigateTo;
    const wrapped = function (page) {
      if (page === 'online-sync') {
        if (!_isManager()) { _toast('⚠️ هذه الصفحة متاحة للمدير فقط / Manager only', 'warning'); return; }
        _showOnlineSyncPage();
        return;
      }
      original(page);
    };
    wrapped.__dakaniOnlineWrapped = true;
    window.navigateTo = wrapped;
  }

  // ════════════════════════════════════════════════════════════
  //  التهيئة
  // ════════════════════════════════════════════════════════════
  function _boot() {
    _injectStyles();
    _injectSidebarNavItem();
    _wrapNavigateTo();
    _bootIfConfigured();
    _watchAppLifecycle();
  }

  // يعيد محاولة الاتصال فوراً عند عودة الإنترنت أو عند إظهار التطبيق مجدداً
  // (المتصفحات تُبطئ المؤقّتات في الخلفية، فلا يكفي الاعتماد على العدّاد
  // الدوري وحده) — يعمل بغض النظر عن كون المستخدم الحالي مديراً أو موظفاً،
  // لأن المزامنة تعمل في الخلفية دوماً بمجرد تفعيلها مرة واحدة
  function _watchAppLifecycle() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && isConfigured()) {
        _log('👀 التطبيق ظاهر الآن — التحقق من الاتصال');
        _ensureConnected();
        _tryAutoRefresh();
      }
    });
    window.addEventListener('online', () => {
      if (isConfigured()) { _log('🌐 عاد الاتصال بالإنترنت — إعادة المحاولة فوراً'); _ensureConnected(); }
    });
  }
  // يضمن محاولة اتصال فورية حتى لو كانت حلقة إعادة المحاولة الدورية تعمل
  // بالفعل (تلك الحلقة قد تتباطأ في الخلفية على المتصفحات، فلا تكفي وحدها)
  function _ensureConnected() {
    if (!isConfigured() || _hasOpenInternetConn()) return;
    if (peer && !peer.destroyed) _resetPeer('فحص عند العودة للواجهة — لا يوجد اتصال فعلي رغم وجود جلسة سابقة');
    if (!internetTimer) { startInternetMode(); return; }
    _tryBecomeHubOrSpoke();
  }

  function init() { _boot(); }

  return {
    init, isConfigured, isConnected, getTeamId, getDeviceName,
    createOrSetTeam, startInternetMode, stopInternetMode, forceReconnect, leaveTeam, kickDevice, renameThisDevice,
    localCreateInvite, localAcceptInvite, localAcceptAnswer,
    renderOnlineSyncPage, _showOnlineSyncPage,
    _submitGenTeam, _submitJoinTeam, _showLocalCreate, _showLocalAccept,
    _submitLocalInvite, _submitLocalAnswer, _submitRename, _copyEl, _copyLog, _confirmLeave
  };

})();

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => DakaniOnlineSync.init(), 0);
});
