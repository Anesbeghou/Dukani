/**
 * DAKANI ACCOUNTS SYSTEM — المدير والكاشير
 * ─────────────────────────────────────────────────────────────
 * ملف مستقل تماماً (بنفس مبدأ barcode.js و keyboard-shortcuts.js):
 * لا يعدّل أي دالة أو ملف موجود، فقط يضيف طبقة صلاحيات فوق التطبيق
 * الحالي عبر: التفاف حول navigateTo()، حقن CSS/HTML، واعتراض بعض
 * الأزرار الحسّاسة. هذا يقلّل تماماً احتمال تعارضه مع script.js.
 *
 * الفكرة العامة:
 *  - بعد التفعيل (الترخيص)، تظهر شاشة اختيار: "مدير" أو "كاشير"
 *  - المدير يدخل "مفتاح مدير" (يُولَّد من keygen.html — مرتبط ببصمة
 *    الجهاز تماماً مثل مفتاح الترخيص، لكن بدون تاريخ انتهاء إطلاقاً)
 *  - الكاشير يدخل مباشرة بدون أي كلمة سر
 *  - في وضع الكاشير: صفحات "المنتجات/نقطة البيع/الزبائن/الفواتير/
 *    المرتجعات" فقط مفتوحة، البقية مقفلة (أيقونة قفل + "للمدير فقط")
 *  - أي رقم/عنصر متعلق بالربح أو سعر التكلفة يُخفى في وضع الكاشير
 *    حتى داخل الصفحات المفتوحة (مثال: عمود سعر الشراء، ربح الفاتورة)
 *  - صفحة جديدة "الموظفون" (لإدارة بيانات الموظفين والرواتب) — للمدير فقط
 *  - التبديل بين الحسابات يتطلّب دائماً إدخال مفتاح المدير من جديد
 *  - يمكن إنشاء أكثر من حساب مدير واحد (كل مدير له مفتاحه الخاص
 *    المرتبط بجهاز/أجهزة محدّدة)، وأكثر من موظف واحد
 *  - إعدادات المتجر (اللغة، العملة...) عامة دائماً ولا علاقة لها
 *    بالحساب النشط، لذلك تبقى كما هي بغض النظر عن الحساب المُفعّل
 */

const DakaniAccounts = (() => {

  // ════════════════════════════════════════════════════════════
  //  ⚠️  غيّر هذه القيمة قبل النشر — يجب أن تطابق قسم "مفتاح المدير"
  //      في keygen.html تماماً (نفس مبدأ SECRET في license.js)
  // ════════════════════════════════════════════════════════════
  const MGR_SECRET = 'DAKANI-2025-SÉTIF-MGR-Q7L4';

  // ─── مفاتيح التخزين ───────────────────────────────────────────
  const LS_MANAGERS   = 'dakani_manager_profiles'; // دائم: قائمة حسابات المدراء المحفوظة على هذا الجهاز
  const LS_EMPLOYEES  = 'dakani_employees';        // دائم: قائمة الموظفين
  const LS_REVOKED_MGR = 'dakani_revoked_manager_keys'; // دائم: مفاتيح مدراء أُلغيت صراحة (حذف حقيقي وليس شكلياً فقط)
  const SS_ROLE        = 'dakani_active_role';       // للجلسة الحالية فقط
  const SS_MANAGER_ID  = 'dakani_active_manager_id';
  const SS_EMPLOYEE_ID = 'dakani_active_employee_id';

  // ─── صفحات الكاشير المسموح بها فقط ───────────────────────────
  const CASHIER_PAGES = ['dashboard-lite', 'products', 'sell', 'customers', 'invoices', 'returns'];
  // ملاحظة: 'dashboard-lite' غير مستخدمة حالياً (اللوحة الرئيسية مقفلة بالكامل
  // لأنها تعرض إحصائيات الربح)، أبقيناها هنا فقط للتوسّع المستقبلي.
  const ALLOWED_FOR_CASHIER = ['products', 'sell', 'customers', 'invoices', 'returns'];

  // أفعال (onclick) حسّاسة داخل الصفحات المفتوحة يجب منعها عن الكاشير
  const BLOCKED_ACTIONS = ['viewPriceHistory'];

  // ─── أدوات عامة ───────────────────────────────────────────────
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();

  function _hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }

  function _merchantCode(name) {
    const upper = String(name || '').toUpperCase().replace(/[^A-Z0-9\u0600-\u06FF]/g, '');
    if (upper.length >= 2) return _hash(upper).slice(0, 2);
    return _hash(name + Date.now()).slice(0, 2);
  }

  // ─── قراءة/كتابة localStorage بأمان ───────────────────────────
  function _lsGet(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; }
    catch (e) { return fallback; }
  }
  function _lsSet(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }
  function _ssGet(key) { try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function _ssSet(key, val) { try { sessionStorage.setItem(key, val); } catch (e) {} }
  function _ssDel(key) { try { sessionStorage.removeItem(key); } catch (e) {} }

  // ─── بصمة الجهاز الخاصة بمفتاح المدير ──────────────────────────
  // ⚠️ عمداً نستخدم البصمة "الدائمة" (getPermanentDeviceId) وليست بصمة
  // الترخيص (getDeviceId). بصمة الترخيص تتجدّد تلقائياً عند انتهاء
  // الاشتراك أو عند كشف أدوات المطور (F12) — لو اعتمدنا عليها هنا،
  // كان مفتاح المدير سيتوقف عن العمل في كل مرة يتجدّد فيها الترخيص،
  // رغم أنه نفس الجهاز الفعلي لنفس المدير. البصمة الدائمة لا تتغيّر
  // أبداً، فيبقى مفتاح المدير شغالاً حتى لو انتهى ترخيص التطبيق نفسه.
  function _deviceId() {
    try {
      if (typeof DakaniLicense !== 'undefined' && DakaniLicense.getPermanentDeviceId) {
        return DakaniLicense.getPermanentDeviceId();
      }
      if (typeof DakaniLicense !== 'undefined' && DakaniLicense.getDeviceId) {
        return DakaniLicense.getDeviceId();
      }
    } catch (e) {}
    return '';
  }

  // ─── التحقق من مفتاح المدير ────────────────────────────────────
  // صيغة المفتاح: MGR-<كود التاجر 2><معرّف الجهاز 6>-<CHK 4>
  // لا يوجد تاريخ انتهاء إطلاقاً — فقط قفل الجهاز.
  function _mgrChecksum(payload, deviceId) {
    return _hash(MGR_SECRET + payload + deviceId + MGR_SECRET).slice(0, 4);
  }

  // ─── قائمة المفاتيح المُلغاة صراحة (بعد حذف حساب مدير) ─────────
  // بدون هذا، حذف "حساب مدير" من القائمة كان شكلياً فقط: نفس المفتاح
  // يبقى صالحاً رياضياً (checksum) ويقدر صاحبه يسجّل دخول من جديد
  // ويُنشأ له حساب جديد تلقائياً. الآن الحذف يُبطل المفتاح فعلياً.
  function _getRevokedManagerKeys() { return _lsGet(LS_REVOKED_MGR, []); }
  function _revokeManagerKey(key) {
    const list = _getRevokedManagerKeys();
    if (!list.includes(key)) { list.push(key); _lsSet(LS_REVOKED_MGR, list); }
  }
  function _isManagerKeyRevoked(key) { return _getRevokedManagerKeys().includes(key); }

  function verifyManagerKey(key) {
    const clean = String(key || '').toUpperCase().replace(/\s/g, '');
    const parts = clean.split('-');
    if (parts.length !== 3 || parts[0] !== 'MGR') {
      return { valid: false, reason: 'صيغة مفتاح المدير غير صحيحة / Invalid key format' };
    }
    const payload = parts[1], checksum = parts[2];
    if (payload.length !== 8 || checksum.length !== 4) {
      return { valid: false, reason: 'صيغة مفتاح المدير غير صحيحة / Invalid key format' };
    }
    const deviceId = payload.slice(2);
    const expected = _mgrChecksum(payload, deviceId);
    if (expected !== checksum) {
      return { valid: false, reason: 'مفتاح المدير غير صالح / Invalid manager key' };
    }
    const current = _deviceId();
    if (!current || deviceId !== current) {
      return { valid: false, reason: 'هذا المفتاح مخصّص لجهاز آخر ولا يعمل هنا / This key is locked to another device' };
    }
    if (_isManagerKeyRevoked(clean)) {
      return { valid: false, reason: 'تم إلغاء هذا المفتاح من هذا الجهاز — اطلب مفتاحاً جديداً / This key was revoked on this device' };
    }
    return { valid: true, deviceId, raw: clean };
  }

  // ─── حسابات المدراء (يمكن إنشاء أكثر من حساب) ──────────────────
  function getManagers() { return _lsGet(LS_MANAGERS, []); }
  function saveManagers(list) { _lsSet(LS_MANAGERS, list); }

  function findManagerByKey(key) {
    return getManagers().find(m => m.key === key);
  }

  // يُستدعى بعد نجاح verifyManagerKey — يحفظ حساب مدير جديد أو يعيد الموجود
  function registerOrGetManager(key, name) {
    const clean = String(key || '').toUpperCase().replace(/\s/g, '');
    const existing = findManagerByKey(clean);
    if (existing) return existing;
    const list = getManagers();
    const profile = {
      id: uid(),
      name: (name || '').trim() || ('مدير ' + (list.length + 1)),
      key: clean,
      deviceId: clean.split('-')[1].slice(2),
      createdAt: now()
    };
    list.push(profile);
    saveManagers(list);
    return profile;
  }

  function renameManager(id, name) {
    const list = getManagers();
    const m = list.find(x => x.id === id);
    if (m) { m.name = name; saveManagers(list); }
  }

  function deleteManager(id) {
    const list = getManagers();
    const m = list.find(x => x.id === id);
    if (m) _revokeManagerKey(m.key); // إبطال حقيقي للمفتاح، وليس حذفاً شكلياً من القائمة فقط
    saveManagers(list.filter(x => x.id !== id));
    if (_ssGet(SS_MANAGER_ID) === id) {
      _ssDel(SS_MANAGER_ID);
      _ssDel(SS_ROLE);
      // إن كان هذا حساب المدير النشط حالياً، نطلب تسجيل دخول جديداً فوراً
      if (typeof showGate === 'function') showGate({ closable: false });
    }
  }

  // ─── الموظفون ────────────────────────────────────────────────
  function getEmployees() { return _lsGet(LS_EMPLOYEES, []); }
  function saveEmployees(list) { _lsSet(LS_EMPLOYEES, list); }

  function addEmployee(data) {
    const list = getEmployees();
    const emp = {
      id: uid(),
      name: (data.name || '').trim(),
      phone: (data.phone || '').trim(),
      title: (data.title || '').trim(),
      salary: parseFloat(data.salary) || 0,
      hireDate: data.hireDate || new Date().toISOString().slice(0, 10),
      address: (data.address || '').trim(),
      notes: (data.notes || '').trim(),
      active: data.active !== false,
      createdAt: now()
    };
    list.push(emp);
    saveEmployees(list);
    return emp;
  }

  function updateEmployee(id, data) {
    const list = getEmployees();
    const emp = list.find(e => e.id === id);
    if (!emp) return null;
    Object.assign(emp, {
      name: (data.name || '').trim(),
      phone: (data.phone || '').trim(),
      title: (data.title || '').trim(),
      salary: parseFloat(data.salary) || 0,
      hireDate: data.hireDate || emp.hireDate,
      address: (data.address || '').trim(),
      notes: (data.notes || '').trim(),
      active: data.active !== false
    });
    saveEmployees(list);
    return emp;
  }

  function deleteEmployee(id) {
    saveEmployees(getEmployees().filter(e => e.id !== id));
    if (_ssGet(SS_EMPLOYEE_ID) === id) { _ssDel(SS_EMPLOYEE_ID); }
  }

  function getEmployee(id) { return getEmployees().find(e => e.id === id) || null; }

  // ─── حالة الجلسة الحالية ───────────────────────────────────────
  function getRole() { return _ssGet(SS_ROLE) || ''; } // '' | 'manager' | 'cashier'
  function getActiveManager() {
    const id = _ssGet(SS_MANAGER_ID);
    return id ? (getManagers().find(m => m.id === id) || null) : null;
  }
  function getActiveEmployee() {
    const id = _ssGet(SS_EMPLOYEE_ID);
    return id ? getEmployee(id) : null;
  }

  function _setManagerSession(profile) {
    _ssSet(SS_ROLE, 'manager');
    _ssSet(SS_MANAGER_ID, profile.id);
    _ssDel(SS_EMPLOYEE_ID);
  }
  function _setCashierSession(employeeId) {
    _ssSet(SS_ROLE, 'cashier');
    _ssDel(SS_MANAGER_ID);
    if (employeeId) _ssSet(SS_EMPLOYEE_ID, employeeId); else _ssDel(SS_EMPLOYEE_ID);
  }

  function canAccessPage(page) {
    if (getRole() !== 'cashier') return true; // المدير يرى كل شيء
    return ALLOWED_FOR_CASHIER.includes(page);
  }

  // ════════════════════════════════════════════════════════════
  //  الأنماط (CSS) — تُحقن مرة واحدة
  // ════════════════════════════════════════════════════════════
  function _injectStyles() {
    if (document.getElementById('dakani-accounts-style')) return;
    const style = document.createElement('style');
    style.id = 'dakani-accounts-style';
    style.textContent = `
      /* ─── إخفاء كل ما يخص الربح/التكلفة في وضع الكاشير ─────────── */
      body.dakani-role-cashier .profit-cell,
      body.dakani-role-cashier .kpi-card.kpi-profit,
      body.dakani-role-cashier .profit-row,
      body.dakani-role-cashier .receipt-profit,
      body.dakani-role-cashier .receipt-disc,
      body.dakani-role-cashier #chart-profit,
      body.dakani-role-cashier #inv-summary-bar .profit-cell,
      body.dakani-role-cashier #page-products table thead th:nth-child(5),
      body.dakani-role-cashier #page-products #products-body td:nth-child(5),
      body.dakani-role-cashier .mgr-only-field,
      body.dakani-role-cashier #prod-price-history-row {
        display: none !important;
      }

      /* ─── عناصر التنقّل المقفلة ──────────────────────────────── */
      .nav-item.dk-locked { opacity: .45; cursor: not-allowed; position: relative; }
      .nav-item.dk-locked .dk-lock-badge {
        display: inline-flex; align-items: center; justify-content: center;
        margin-inline-start: 6px; font-size: 11px; color: var(--gold, #f59e0b);
      }
      .nav-item .dk-lock-badge { display: none; }

      /* ─── شارة الحساب + زر التبديل في الشريط العلوي ─────────────── */
      .dk-role-badge {
        display: flex; align-items: center; gap: 8px;
        background: var(--surface3, #1e2d3d); border: 1px solid var(--border2, #253347);
        border-radius: 999px; padding: 5px 12px 5px 6px; font-size: 12px;
        color: var(--text, #e2e8f0); cursor: pointer; white-space: nowrap;
        transition: border-color .2s;
      }
      .dk-role-badge:hover { border-color: var(--accent, #10b981); }
      .dk-role-badge .dk-role-icon {
        width: 22px; height: 22px; border-radius: 50%;
        background: var(--accent-g, linear-gradient(135deg,#10b981,#0ea5e9));
        display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; flex-shrink:0;
      }
      .dk-role-badge.dk-role-cashier .dk-role-icon { background: var(--gold, #f59e0b); }

      /* ─── شاشة اختيار/تبديل الحساب ────────────────────────────── */
      #dk-gate-overlay {
        position: fixed; inset: 0; z-index: 99990;
        background: rgba(10,15,30,.92);
        display: none; align-items: center; justify-content: center;
        font-family: 'Cairo', sans-serif; padding: 16px;
      }
      #dk-gate-overlay.active { display: flex; }
      .dk-gate-box {
        background: var(--surface, #111827); border: 1px solid var(--border, #1e293b);
        border-radius: var(--radius, 12px); width: 100%; max-width: 420px;
        padding: 30px 26px; box-shadow: var(--shadow-lg, 0 8px 40px rgba(0,0,0,.6));
        text-align: center; position: relative; max-height: 90vh; overflow-y: auto;
      }
      .dk-gate-close {
        position: absolute; top: 12px; inset-inline-end: 12px;
        background: none; border: none; color: var(--text2, #94a3b8);
        font-size: 18px; cursor: pointer;
      }
      .dk-gate-logo { font-size: 30px; color: var(--accent, #10b981); margin-bottom: 8px; }
      .dk-gate-title { font-size: 19px; font-weight: 800; color: var(--text, #e2e8f0); margin-bottom: 4px; }
      .dk-gate-sub { font-size: 12.5px; color: var(--text2, #94a3b8); margin-bottom: 22px; }
      .dk-role-choice { display: flex; gap: 12px; margin-bottom: 6px; }
      .dk-role-btn {
        flex: 1; background: var(--surface3, #1e2d3d); border: 1px solid var(--border2, #253347);
        border-radius: 12px; padding: 18px 10px; cursor: pointer; color: var(--text, #e2e8f0);
        font-family: 'Cairo', sans-serif; transition: all .15s;
      }
      .dk-role-btn:hover { border-color: var(--accent, #10b981); transform: translateY(-2px); }
      .dk-role-btn i { font-size: 24px; display: block; margin-bottom: 8px; color: var(--accent, #10b981); }
      .dk-role-btn span { font-size: 13px; font-weight: 700; }
      .dk-role-btn small { display: block; font-size: 10.5px; color: var(--text2, #94a3b8); margin-top: 3px; }

      .dk-back-link { display: inline-flex; align-items: center; gap: 6px; color: var(--text2, #94a3b8); font-size: 12.5px; cursor: pointer; margin-bottom: 14px; }
      .dk-back-link:hover { color: var(--accent, #10b981); }

      .dk-field { text-align: right; margin-bottom: 14px; }
      .dk-field label { display: block; font-size: 12.5px; color: var(--text2, #94a3b8); margin-bottom: 6px; }
      .dk-field input, .dk-field select, .dk-field textarea {
        width: 100%; box-sizing: border-box; background: var(--surface3, #1e2d3d);
        border: 1px solid var(--border2, #253347); color: var(--text, #e2e8f0);
        border-radius: 10px; padding: 11px 14px; font-size: 14px; font-family: 'Cairo', sans-serif; outline: none;
      }
      .dk-field input:focus, .dk-field select:focus, .dk-field textarea:focus { border-color: var(--accent, #10b981); }
      .dk-field.dk-key-field input { font-family: monospace; letter-spacing: 2px; text-transform: uppercase; direction: ltr; text-align: center; }

      .dk-btn {
        width: 100%; padding: 12px; border: none; border-radius: 10px;
        background: var(--accent-g, linear-gradient(135deg,#10b981,#0ea5e9)); color: #fff;
        font-weight: 700; font-size: 14px; font-family: 'Cairo', sans-serif; cursor: pointer; margin-top: 4px;
      }
      .dk-btn:hover { opacity: .92; }
      .dk-btn.dk-btn-ghost { background: transparent; border: 1px solid var(--border2, #253347); color: var(--text2, #94a3b8); margin-top: 10px; }

      .dk-error { background: rgba(239,68,68,.1); border: 1px solid rgba(239,68,68,.3); color: #f87171; border-radius: 10px; padding: 9px 12px; font-size: 12.5px; margin-bottom: 12px; text-align: right; }
      .dk-hint { font-size: 11px; color: var(--text3, #64748b); margin-top: 8px; line-height: 1.7; }
      .dk-device-chip { font-family: monospace; letter-spacing: 3px; color: #3b82f6; font-weight: 700; direction: ltr; display:inline-block; }

      .dk-profile-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px; }
      .dk-profile-item {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        background: var(--surface3, #1e2d3d); border: 1px solid var(--border2, #253347);
        border-radius: 10px; padding: 10px 14px; cursor: pointer; text-align: right;
      }
      .dk-profile-item:hover { border-color: var(--accent, #10b981); }
      .dk-profile-item .dk-pi-name { font-size: 13px; font-weight: 700; color: var(--text, #e2e8f0); }
      .dk-profile-item .dk-pi-sub { font-size: 10.5px; color: var(--text2, #94a3b8); }

      /* ─── صفحة الموظفين ───────────────────────────────────────── */
      #page-employees .dk-emp-tabs { display: flex; gap: 8px; margin-bottom: 16px; }
      #page-employees .dk-emp-tab {
        padding: 8px 16px; border-radius: 999px; cursor: pointer; font-size: 13px;
        background: var(--surface2, #1a2332); border: 1px solid var(--border, #1e293b); color: var(--text2, #94a3b8);
      }
      #page-employees .dk-emp-tab.active { background: var(--accent, #10b981); color: #fff; border-color: var(--accent, #10b981); }
      #page-employees .dk-emp-panel { display: none; }
      #page-employees .dk-emp-panel.active { display: block; }
      .dk-lock-note {
        background: rgba(245,158,11,.1); border: 1px solid rgba(245,158,11,.3); color: var(--gold, #f59e0b);
        border-radius: 10px; padding: 10px 14px; font-size: 12.5px; margin-bottom: 14px; display: flex; gap: 8px; align-items: center;
      }
    `;
    document.head.appendChild(style);
  }

  // ════════════════════════════════════════════════════════════
  //  إشعار "للمدير فقط"
  // ════════════════════════════════════════════════════════════
  function denyToast() {
    if (typeof toast === 'function') {
      toast('<i class="fas fa-lock"></i> هذا القسم للمدير فقط / Manager access only', 'warning');
    }
  }

  // ════════════════════════════════════════════════════════════
  //  شاشة البوابة (اختيار/تبديل الحساب)
  // ════════════════════════════════════════════════════════════
  let _gateEl = null;
  function _ensureGate() {
    if (_gateEl) return _gateEl;
    _gateEl = document.createElement('div');
    _gateEl.id = 'dk-gate-overlay';
    document.body.appendChild(_gateEl);
    _gateEl.addEventListener('click', e => { if (e.target === _gateEl && _gateCanClose) hideGate(); });
    return _gateEl;
  }

  let _gateCanClose = false;
  function showGate(opts) {
    opts = opts || {};
    _gateCanClose = !!opts.closable;
    _ensureGate();
    _gateEl.classList.add('active');
    _renderRoleChoice();
  }
  function hideGate() {
    if (_gateEl) _gateEl.classList.remove('active');
  }

  function _closeBtnHtml() {
    return _gateCanClose ? `<button class="dk-gate-close" onclick="DakaniAccounts._hideGateUI()"><i class="fas fa-xmark"></i></button>` : '';
  }

  // الخطوة 1: اختيار مدير/كاشير
  function _renderRoleChoice() {
    const dev = _deviceId();
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        ${_closeBtnHtml()}
        <div class="dk-gate-logo"><i class="fas fa-user-shield"></i></div>
        <div class="dk-gate-title">من يدخل الآن؟</div>
        <div class="dk-gate-sub">Who's signing in? / اختر نوع الحساب</div>
        <div class="dk-role-choice">
          <button class="dk-role-btn" onclick="DakaniAccounts._showManagerStep()">
            <i class="fas fa-user-tie"></i><span>مدير</span><small>Manager</small>
          </button>
          <button class="dk-role-btn" onclick="DakaniAccounts._showCashierStep()">
            <i class="fas fa-cash-register"></i><span>كاشير</span><small>Cashier</small>
          </button>
        </div>
        <div class="dk-hint">معرّف هذا الجهاز: <span class="dk-device-chip">${dev || '—'}</span></div>
      </div>`;
  }

  // الخطوة 2أ: دخول المدير (مفتاح المدير)
  function _showManagerStep(errorMsg) {
    const dev = _deviceId();
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        ${_closeBtnHtml()}
        <div class="dk-back-link" onclick="DakaniAccounts._renderRoleChoice()"><i class="fas fa-arrow-right"></i> رجوع</div>
        <div class="dk-gate-logo"><i class="fas fa-user-tie"></i></div>
        <div class="dk-gate-title">دخول المدير</div>
        <div class="dk-gate-sub">أدخل مفتاح المدير الخاص بهذا الجهاز</div>
        ${errorMsg ? `<div class="dk-error"><i class="fas fa-circle-xmark"></i> ${errorMsg}</div>` : ''}
        <div class="dk-field dk-key-field">
          <label><i class="fas fa-key"></i> مفتاح المدير / Manager Key</label>
          <input type="text" id="dk-mgr-key" placeholder="MGR-XXXXXXXX-XXXX" autocomplete="off" spellcheck="false"/>
        </div>
        <button class="dk-btn" onclick="DakaniAccounts._submitManagerKey()"><i class="fas fa-unlock"></i> دخول</button>
        <div class="dk-hint">
          لا تملك مفتاحاً؟ أرسل معرّف جهازك <span class="dk-device-chip">${dev || '—'}</span> لمن يولّد لك المفتاح.
          كل تبديل حساب للمدير يتطلّب هذا المفتاح مجدداً لحماية الحساب.
        </div>
      </div>`;
    document.getElementById('dk-mgr-key')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitManagerKey();
    });
  }

  function _submitManagerKey() {
    const val = (document.getElementById('dk-mgr-key')?.value || '').trim();
    if (!val) return;
    const result = verifyManagerKey(val);
    if (!result.valid) { _showManagerStep(result.reason); return; }
    const existing = findManagerByKey(result.raw);
    if (existing) {
      _setManagerSession(existing);
      _afterLogin();
    } else {
      _showManagerNameStep(result.raw);
    }
  }

  // اسم المدير عند أول استخدام لمفتاح جديد (يسمح بإنشاء أكثر من حساب مدير)
  function _showManagerNameStep(key) {
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        <div class="dk-gate-logo"><i class="fas fa-id-badge"></i></div>
        <div class="dk-gate-title">مفتاح جديد ✓</div>
        <div class="dk-gate-sub">أدخل اسمك لحفظ حساب المدير هذا على الجهاز</div>
        <div class="dk-field">
          <label><i class="fas fa-user"></i> اسم المدير / Manager Name</label>
          <input type="text" id="dk-mgr-name" placeholder="مثال: علي بلعيد" autocomplete="off"/>
        </div>
        <button class="dk-btn" onclick="DakaniAccounts._confirmManagerName('${key}')"><i class="fas fa-check"></i> تأكيد</button>
      </div>`;
    document.getElementById('dk-mgr-name')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _confirmManagerName(key);
    });
    setTimeout(() => document.getElementById('dk-mgr-name')?.focus(), 50);
  }

  function _confirmManagerName(key) {
    const name = (document.getElementById('dk-mgr-name')?.value || '').trim();
    const profile = registerOrGetManager(key, name);
    _setManagerSession(profile);
    _afterLogin();
  }

  // الخطوة 2ب: دخول الكاشير (بدون كلمة سر، مع اختيار موظف اختياري)
  function _showCashierStep() {
    const emps = getEmployees().filter(e => e.active !== false);
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        <div class="dk-back-link" onclick="DakaniAccounts._renderRoleChoice()"><i class="fas fa-arrow-right"></i> رجوع</div>
        <div class="dk-gate-logo"><i class="fas fa-cash-register"></i></div>
        <div class="dk-gate-title">دخول الكاشير</div>
        <div class="dk-gate-sub">بدون كلمة سر — من يعمل الآن؟ (اختياري)</div>
        ${emps.length ? `
          <div class="dk-profile-list">
            ${emps.map(e => `
              <div class="dk-profile-item" onclick="DakaniAccounts._submitCashier('${e.id}')">
                <span class="dk-pi-name"><i class="fas fa-user"></i> ${escHtml(e.name)}</span>
                <span class="dk-pi-sub">${escHtml(e.title || '')}</span>
              </div>`).join('')}
          </div>` : ''}
        <button class="dk-btn" onclick="DakaniAccounts._submitCashier(null)"><i class="fas fa-right-to-bracket"></i> دخول بدون تحديد اسم</button>
      </div>`;
  }

  function _submitCashier(employeeId) {
    _setCashierSession(employeeId);
    _afterLogin();
  }

  function _afterLogin() {
    hideGate();
    _applyRoleUI();
    // إن كانت الصفحة الحالية غير مسموحة للدور الجديد، انتقل للوحة/المنتجات
    const active = document.querySelector('.page.active');
    const currentPage = active ? active.id.replace('page-', '') : '';
    if (!canAccessPage(currentPage)) {
      if (typeof navigateTo === 'function') navigateTo(getRole() === 'cashier' ? 'sell' : 'dashboard');
    }
  }

  // ════════════════════════════════════════════════════════════
  //  تطبيق واجهة الدور الحالي (شارة + أقفال + CSS)
  // ════════════════════════════════════════════════════════════
  function _applyRoleUI() {
    const role = getRole();
    document.body.classList.toggle('dakani-role-cashier', role === 'cashier');
    _refreshNavLocks();
    _refreshRoleBadge();
    // ⚠️ ضروري: نعيد بناء كل الصفحات الحساسة (ربح/تكلفة) بالدور الجديد فوراً،
    // لأن تبديل الكلاس هنا لا يُعيد رسم أي صفحة رُسمت سابقاً بدور مختلف —
    // الدالة معرَّفة في script.js ومُصدَّرة على window لعزل الملفين عن بعضهما.
    if (typeof window.dakaniRefreshSensitivePages === 'function') {
      window.dakaniRefreshSensitivePages();
    }
  }

  function _refreshNavLocks() {
    const role = getRole();
    document.querySelectorAll('.sidebar-nav .nav-item').forEach(el => {
      const page = el.dataset.page;
      const locked = role === 'cashier' && !ALLOWED_FOR_CASHIER.includes(page);
      el.classList.toggle('dk-locked', locked);
      let badge = el.querySelector('.dk-lock-badge');
      if (locked) {
        if (!badge) {
          badge = document.createElement('i');
          badge.className = 'fas fa-lock dk-lock-badge';
          badge.title = 'للمدير فقط / Manager only';
          el.appendChild(badge);
        }
        badge.style.display = 'inline-flex';
      } else if (badge) {
        badge.style.display = 'none';
      }
    });
  }

  function _refreshRoleBadge() {
    const el = document.getElementById('dk-role-badge');
    if (!el) return;
    const role = getRole();
    if (role === 'manager') {
      const m = getActiveManager();
      el.className = 'dk-role-badge';
      el.innerHTML = `<span class="dk-role-icon"><i class="fas fa-user-tie"></i></span> ${m ? escHtml(m.name) : 'مدير'} <i class="fas fa-right-left" style="font-size:10px;opacity:.6"></i>`;
    } else {
      const e = getActiveEmployee();
      el.className = 'dk-role-badge dk-role-cashier';
      el.innerHTML = `<span class="dk-role-icon"><i class="fas fa-cash-register"></i></span> ${e ? escHtml(e.name) : 'كاشير'} <i class="fas fa-right-left" style="font-size:10px;opacity:.6"></i>`;
    }
  }

  function _injectTopbarBadge() {
    if (document.getElementById('dk-role-badge')) return;
    const wrap = document.querySelector('.topbar-right');
    if (!wrap) return;
    const btn = document.createElement('div');
    btn.className = 'dk-role-badge';
    btn.id = 'dk-role-badge';
    btn.title = 'تبديل الحساب / Switch account';
    btn.onclick = () => showGate({ closable: true });
    wrap.insertBefore(btn, wrap.firstChild);
  }

  // ════════════════════════════════════════════════════════════
  //  صفحة "الموظفون" — تُبنى وتُحقن ديناميكياً في main-content
  // ════════════════════════════════════════════════════════════
  function _injectEmployeesPageShell() {
    if (document.getElementById('page-employees')) return;
    const main = document.getElementById('main-content');
    if (!main) return;
    const div = document.createElement('div');
    div.className = 'page';
    div.id = 'page-employees';
    div.innerHTML = `
      <div class="page-header">
        <h1>الموظفون <span>Employees</span></h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" id="dk-add-emp-btn"><i class="fas fa-plus"></i> إضافة موظف / Add Employee</button>
        </div>
      </div>
      <div class="dk-emp-tabs">
        <div class="dk-emp-tab active" data-tab="emp">الموظفون / Employees</div>
        <div class="dk-emp-tab" data-tab="mgr">حسابات المدراء / Manager Accounts</div>
      </div>
      <div class="dk-emp-panel active" id="dk-panel-emp">
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr>
              <th>#</th><th>الاسم / Name</th><th>الوظيفة / Title</th><th>الهاتف / Phone</th>
              <th>الراتب / Salary</th><th>تاريخ التوظيف / Hired</th><th>الحالة / Status</th><th>إجراءات / Actions</th>
            </tr></thead>
            <tbody id="dk-employees-body"></tbody>
          </table>
        </div>
      </div>
      <div class="dk-emp-panel" id="dk-panel-mgr">
        <div class="dk-lock-note"><i class="fas fa-info-circle"></i> حسابات المدراء تُنشأ عبر مفتاح مدير جديد (من مولّد المفاتيح) — هذه القائمة للعرض والتسمية فقط.</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>الاسم / Name</th><th>الجهاز / Device</th><th>تاريخ الإضافة / Added</th><th>إجراءات / Actions</th></tr></thead>
            <tbody id="dk-managers-body"></tbody>
          </table>
        </div>
      </div>`;
    main.appendChild(div);

    div.querySelectorAll('.dk-emp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        div.querySelectorAll('.dk-emp-tab').forEach(t => t.classList.remove('active'));
        div.querySelectorAll('.dk-emp-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('dk-panel-' + tab.dataset.tab).classList.add('active');
      });
    });
    document.getElementById('dk-add-emp-btn').addEventListener('click', () => _openEmployeeModal(null));
  }

  function _injectEmployeeModal() {
    if (document.getElementById('modal-employee')) return;
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'modal-employee';
    div.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="dk-emp-modal-title"><i class="fas fa-user-plus"></i> إضافة موظف / Add Employee</h3>
          <button class="btn-icon" onclick="closeModal('modal-employee')"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="dk-emp-id"/>
          <div class="form-row">
            <div class="form-group"><label>الاسم الكامل / Full Name</label><input type="text" id="dk-emp-name"/></div>
            <div class="form-group"><label>الوظيفة / Job Title</label><input type="text" id="dk-emp-title" placeholder="مثال: كاشير"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>الهاتف / Phone</label><input type="text" id="dk-emp-phone"/></div>
            <div class="form-group"><label>الراتب / Salary</label><input type="number" id="dk-emp-salary" step="0.01" placeholder="0.00"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label>تاريخ التوظيف / Hire Date</label><input type="date" id="dk-emp-hire"/></div>
            <div class="form-group"><label>الحالة / Status</label>
              <select id="dk-emp-active"><option value="1">نشط / Active</option><option value="0">غير نشط / Inactive</option></select>
            </div>
          </div>
          <div class="form-group"><label>العنوان / Address</label><input type="text" id="dk-emp-address"/></div>
          <div class="form-group"><label>ملاحظات / Notes</label><textarea id="dk-emp-notes" rows="2"></textarea></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeModal('modal-employee')">إلغاء / Cancel</button>
          <button class="btn-primary" onclick="DakaniAccounts._saveEmployeeForm()"><i class="fas fa-check"></i> حفظ / Save</button>
        </div>
      </div>`;
    document.body.appendChild(div);
  }

  function _openEmployeeModal(id) {
    _injectEmployeeModal();
    const emp = id ? getEmployee(id) : null;
    document.getElementById('dk-emp-modal-title').innerHTML = emp
      ? '<i class="fas fa-user-pen"></i> تعديل موظف / Edit Employee'
      : '<i class="fas fa-user-plus"></i> إضافة موظف / Add Employee';
    document.getElementById('dk-emp-id').value = emp ? emp.id : '';
    document.getElementById('dk-emp-name').value = emp ? emp.name : '';
    document.getElementById('dk-emp-title').value = emp ? emp.title : '';
    document.getElementById('dk-emp-phone').value = emp ? emp.phone : '';
    document.getElementById('dk-emp-salary').value = emp ? emp.salary : '';
    document.getElementById('dk-emp-hire').value = emp ? emp.hireDate : new Date().toISOString().slice(0, 10);
    document.getElementById('dk-emp-active').value = emp ? (emp.active !== false ? '1' : '0') : '1';
    document.getElementById('dk-emp-address').value = emp ? emp.address : '';
    document.getElementById('dk-emp-notes').value = emp ? emp.notes : '';
    if (typeof openModal === 'function') openModal('modal-employee');
    else document.getElementById('modal-employee').classList.add('active');
  }

  function _saveEmployeeForm() {
    const id = document.getElementById('dk-emp-id').value;
    const name = document.getElementById('dk-emp-name').value.trim();
    if (!name) { if (typeof toast === 'function') toast('أدخل اسم الموظف / Enter employee name', 'warning'); return; }
    const data = {
      name,
      title: document.getElementById('dk-emp-title').value,
      phone: document.getElementById('dk-emp-phone').value,
      salary: document.getElementById('dk-emp-salary').value,
      hireDate: document.getElementById('dk-emp-hire').value,
      active: document.getElementById('dk-emp-active').value === '1',
      address: document.getElementById('dk-emp-address').value,
      notes: document.getElementById('dk-emp-notes').value
    };
    if (id) updateEmployee(id, data); else addEmployee(data);
    if (typeof closeModal === 'function') closeModal('modal-employee');
    _renderEmployeesTable();
    if (typeof toast === 'function') toast('تم الحفظ ✓ / Saved', 'success');
  }

  function _deleteEmployeeConfirm(id) {
    if (!confirm('هل تريد حذف هذا الموظف؟ / Delete this employee?')) return;
    deleteEmployee(id);
    _renderEmployeesTable();
  }

  function _renderEmployeesTable() {
    const S = (typeof DB !== 'undefined' && DB.Settings) ? DB.Settings.get() : {};
    const cur = S.currency || 'دج';
    const f = (n) => (typeof fmt === 'function') ? fmt(n) : (parseFloat(n) || 0).toFixed(2);
    const body = document.getElementById('dk-employees-body');
    if (!body) return;
    const list = getEmployees();
    body.innerHTML = list.length ? list.map((e, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escHtml(e.name)}</strong>${e.phone ? `<br/><small>${escHtml(e.phone)}</small>` : ''}</td>
        <td>${escHtml(e.title || '—')}</td>
        <td>${escHtml(e.phone || '—')}</td>
        <td>${f(e.salary)} ${cur}</td>
        <td>${e.hireDate || '—'}</td>
        <td><span class="badge ${e.active !== false ? 'badge-ok' : 'badge-out'}">${e.active !== false ? 'نشط' : 'غير نشط'}</span></td>
        <td>
          <button class="btn-icon edit" onclick="DakaniAccounts._openEmployeeModal('${e.id}')"><i class="fas fa-pen"></i></button>
          <button class="btn-icon danger" onclick="DakaniAccounts._deleteEmployeeConfirm('${e.id}')"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('') : `<tr><td colspan="8" class="empty-td">لا يوجد موظفون بعد / No employees yet</td></tr>`;

    const mbody = document.getElementById('dk-managers-body');
    if (mbody) {
      const managers = getManagers();
      mbody.innerHTML = managers.length ? managers.map((m, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${escHtml(m.name)}</strong></td>
          <td><code>${m.deviceId}</code></td>
          <td>${(m.createdAt || '').slice(0, 10)}</td>
          <td><button class="btn-icon danger" onclick="DakaniAccounts._deleteManagerConfirm('${m.id}')"><i class="fas fa-trash"></i></button></td>
        </tr>`).join('') : `<tr><td colspan="5" class="empty-td">لا توجد حسابات مدراء بعد / No manager accounts yet</td></tr>`;
    }
  }

  function _deleteManagerConfirm(id) {
    if (!confirm('هل تريد حذف حساب المدير هذا من هذا الجهاز؟ / Remove this manager account from this device?')) return;
    deleteManager(id);
    _renderEmployeesTable();
    if (typeof toast === 'function') toast('تم الحذف / Removed', 'success');
  }

  function _showEmployeesPage() {
    _injectEmployeesPageShell();
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('page-employees').classList.add('active');
    document.querySelector('[data-page="employees"]')?.classList.add('active');
    const title = document.getElementById('topbar-title');
    if (title) title.textContent = 'الموظفون / Employees';
    _renderEmployeesTable();
    if (window.innerWidth < 900) document.getElementById('sidebar')?.classList.remove('open');
  }

  // ─── وسم حقل "سعر الشراء" الثابت في نافذة المنتج مرة واحدة فقط ─
  // (عمود سعر الشراء في الجدول يُخفى عبر nth-child لأنه ثابت البنية،
  // لكن حقل الإدخال داخل النافذة المنبثقة يحتاج وسماً صريحاً لأن
  // العنصر الأب <div class="form-group"> ليس له id أو class مميز)
  function _tagStaticManagerOnlyFields() {
    const buyInput = document.getElementById('prod-buy');
    const wrap = buyInput ? buyInput.closest('.form-group') : null;
    if (wrap) wrap.classList.add('mgr-only-field');
  }

  // ════════════════════════════════════════════════════════════
  //  إضافة عنصر "الموظفون" في الشريط الجانبي
  // ════════════════════════════════════════════════════════════
  function _injectSidebarNavItem() {
    if (document.querySelector('[data-page="employees"]')) return;
    const nav = document.querySelector('.sidebar-nav');
    const settingsItem = document.querySelector('.sidebar-nav [data-page="settings"]');
    if (!nav) return;
    const a = document.createElement('a');
    a.href = '#'; a.className = 'nav-item'; a.dataset.page = 'employees';
    a.innerHTML = `<i class="fas fa-user-tie"></i><span class="nav-ar">الموظفون</span>`;
    a.addEventListener('click', e => { e.preventDefault(); navigateTo('employees'); });
    if (settingsItem) nav.insertBefore(a, settingsItem); else nav.appendChild(a);
  }

  // ════════════════════════════════════════════════════════════
  //  التفاف حول navigateTo — بدون لمس script.js
  // ════════════════════════════════════════════════════════════
  function _wrapNavigateTo() {
    if (typeof window.navigateTo !== 'function' || window.navigateTo.__dakaniWrapped) return;
    const original = window.navigateTo;
    const wrapped = function (page) {
      if (!canAccessPage(page)) { denyToast(); return; }
      if (page === 'employees') { _showEmployeesPage(); return; }
      original(page);
    };
    wrapped.__dakaniWrapped = true;
    window.navigateTo = wrapped;
  }

  // ─── اعتراض أزرار حسّاسة داخل الصفحات المفتوحة (مثل سجل أسعار الشراء) ─
  function _installActionGuard() {
    document.addEventListener('click', function (e) {
      if (getRole() !== 'cashier') return;
      const el = e.target.closest('[onclick]');
      if (!el) return;
      const oc = (el.getAttribute('onclick') || '').trim();
      if (BLOCKED_ACTIONS.some(fn => oc.startsWith(fn))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        denyToast();
      }
    }, true);
  }

  // ════════════════════════════════════════════════════════════
  //  التهيئة
  // ════════════════════════════════════════════════════════════
  function _boot() {
    _injectStyles();
    _injectTopbarBadge();
    _injectSidebarNavItem();
    _tagStaticManagerOnlyFields();
    _wrapNavigateTo();
    _installActionGuard();

    const role = getRole();
    if (role === 'manager' || role === 'cashier') {
      // جلسة قائمة بالفعل (نفس التبويب لم يُغلق) — لا حاجة لإعادة الاختيار
      _applyRoleUI();
    } else {
      showGate({ closable: false });
    }
  }

  function init() {
    _boot();
  }

  // API عام
  return {
    init,
    getRole, getActiveManager, getActiveEmployee,
    getManagers, getEmployees, addEmployee, updateEmployee, deleteEmployee,
    verifyManagerKey, canAccessPage,
    showGate, hideGate,
    // مستخدمة داخلياً عبر onclick= في الواجهة المُولَّدة ديناميكياً
    _renderRoleChoice, _showManagerStep, _submitManagerKey, _confirmManagerName,
    _showCashierStep, _submitCashier,
    _openEmployeeModal, _saveEmployeeForm, _deleteEmployeeConfirm, _deleteManagerConfirm,
    _hideGateUI: hideGate
  };

})();

// ─── التشغيل: نفس حيلة التأجيل المستخدمة في باقي الملفات — ننتظر حتى
// يكون التطبيق (بعد الترخيص) جاهزاً تماماً قبل عرض بوابة الحساب فوقه ────
document.addEventListener('DOMContentLoaded', () => {
  DakaniAccounts.init();
});