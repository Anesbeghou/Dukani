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

  // ─── كلمات المرور (اختيارية) ───────────────────────────────────
  // ⚠️ التخزين هنا محلي على الجهاز فقط (localStorage). نخزّن "بصمة" مملَّحة بدل كلمة
  // المرور نفسها كي لا تظهر نصاً صريحاً في النسخ الاحتياطية/المزامنة، لكنها ليست
  // تشفيراً بمستوى الخوادم — هي حاجز تشغيلي داخل المحل لا حماية من مهاجم متمكّن.
  function _pwHash(pw, salt) {
    let a = 0x811c9dc5, b = 0x01000193 ^ 0x5bd1e995;
    const s = String(salt || '') + '|' + String(pw || '') + '|' + String(salt || '');
    for (let r = 0; r < 1500; r++) {
      for (let i = 0; i < s.length; i++) {
        a ^= s.charCodeAt(i); a = Math.imul(a, 0x01000193) >>> 0;
        b = (Math.imul(b ^ a, 0x85ebca6b) + 0x27d4eb2f) >>> 0;
      }
    }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
  }
  function _makePw(pw) { const salt = uid(); return { pwSalt: salt, pwHash: _pwHash(pw, salt) }; }
  function _checkPw(rec, pw) { return !!(rec && rec.pwHash && _pwHash(pw, rec.pwSalt) === rec.pwHash); }

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

  // إنشاء حساب مدير بزر (بدون مفتاح): الدخول بكلمة المرور فقط — يُنشئه مدير مسجَّل دخوله
  function createManagerAccount(data) {
    const name = (data.name || '').trim();
    const pw = String(data.password || '');
    if (!name) return { ok: false, reason: 'أدخل اسم المدير / Enter a name' };
    if (pw.length < 4) return { ok: false, reason: 'كلمة المرور 4 أحرف على الأقل / Password min 4 chars' };
    const list = getManagers();
    if (list.some(m => (m.name || '').trim().toLowerCase() === name.toLowerCase())) return { ok: false, reason: 'يوجد حساب مدير بنفس الاسم / Name already used' };
    const profile = { id: uid(), name, key: null, deviceId: '', phone: (data.phone || '').trim(), notes: (data.notes || '').trim(), createdAt: now(), ..._makePw(pw) };
    list.push(profile);
    saveManagers(list);
    return { ok: true, profile };
  }
  // تعديل بيانات مدير: الاسم/الهاتف/ملاحظات + كلمة مرور جديدة (اختيارية)
  function updateManager(id, data) {
    const list = getManagers();
    const m = list.find(x => x.id === id);
    if (!m) return { ok: false, reason: 'الحساب غير موجود' };
    const name = (data.name || '').trim();
    if (!name) return { ok: false, reason: 'أدخل اسم المدير / Enter a name' };
    if (list.some(x => x.id !== id && (x.name || '').trim().toLowerCase() === name.toLowerCase())) return { ok: false, reason: 'يوجد حساب مدير بنفس الاسم / Name already used' };
    m.name = name;
    m.phone = (data.phone || '').trim();
    m.notes = (data.notes || '').trim();
    if (data.password) {
      if (String(data.password).length < 4) return { ok: false, reason: 'كلمة المرور 4 أحرف على الأقل / Password min 4 chars' };
      Object.assign(m, _makePw(data.password));
    } else if (data.removePassword && m.key) {
      delete m.pwHash; delete m.pwSalt;   // العودة لاستخدام المفتاح المولَّد ككلمة سر
    }
    m.updatedAt = now();
    saveManagers(list);
    return { ok: true, profile: m };
  }
  function verifyManagerLogin(id, secret) {
    const m = getManagers().find(x => x.id === id);
    if (!m) return false;
    const clean = String(secret || '').trim();
    if (m.pwHash) {
      if (_checkPw(m, clean)) return true;
      // المفتاح الأصلي يبقى وسيلة استرجاع إن وُجد (مرتبط بهذا الجهاز تحديداً)
      const k = clean.toUpperCase().replace(/\s/g, '');
      return !!(m.key && k === m.key && verifyManagerKey(k).valid);
    }
    const k = clean.toUpperCase().replace(/\s/g, '');
    return !!(m.key && k === m.key && verifyManagerKey(k).valid);
  }

  function renameManager(id, name) {
    const list = getManagers();
    const m = list.find(x => x.id === id);
    if (m) { m.name = name; m.updatedAt = now(); saveManagers(list); }
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
    if (data.password) Object.assign(emp, _makePw(data.password));
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
      active: data.active !== false,
      updatedAt: now()
    });
    if (data.password) Object.assign(emp, _makePw(data.password));
    else if (data.removePassword) { delete emp.pwHash; delete emp.pwSalt; }
    saveEmployees(list);
    return emp;
  }

  function deleteEmployee(id) {
    saveEmployees(getEmployees().filter(e => e.id !== id));
    if (_ssGet(SS_EMPLOYEE_ID) === id) { _ssDel(SS_EMPLOYEE_ID); }
  }

  function getEmployee(id) { return getEmployees().find(e => e.id === id) || null; }
  function verifyEmployeePassword(id, pw) {
    const e = getEmployee(id);
    if (!e) return false;
    if (!e.pwHash) return true;           // موظف بدون كلمة مرور
    return _checkPw(e, pw);
  }

  // المستخدم الحالي (للبائع في الفاتورة وتقارير الأداء)
  function getCurrentUser() {
    const role = getRole();
    if (role === 'manager') {
      const m = getActiveManager();
      return { id: m ? m.id : 'manager', name: m ? m.name : 'مدير', role: 'manager' };
    }
    if (role === 'cashier') {
      const e = getActiveEmployee();
      return { id: e ? e.id : null, name: e ? e.name : 'كاشير', role: 'cashier' };
    }
    return null;
  }

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

  // الخطوة 2أ: دخول المدير — حسابات محفوظة (كلمة مرور أو المفتاح) + دخول بمفتاح جديد
  function _showManagerStep(errorMsg) {
    const dev = _deviceId();
    const managers = getManagers();
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        ${_closeBtnHtml()}
        <div class="dk-back-link" onclick="DakaniAccounts._renderRoleChoice()"><i class="fas fa-arrow-right"></i> رجوع</div>
        <div class="dk-gate-logo"><i class="fas fa-user-tie"></i></div>
        <div class="dk-gate-title">دخول المدير</div>
        ${managers.length ? `
          <div class="dk-gate-sub">اختر حسابك ثم أدخل كلمة المرور</div>
          <div class="dk-profile-list">
            ${managers.map(m => `
              <div class="dk-profile-item" onclick="DakaniAccounts._showManagerPassword('${m.id}')">
                <span class="dk-pi-name"><i class="fas fa-user-tie"></i> ${escHtml(m.name)}</span>
                <span class="dk-pi-sub"><i class="fas fa-${m.pwHash ? 'lock' : 'key'}"></i> ${m.pwHash ? 'كلمة مرور' : 'مفتاح المدير'}</span>
              </div>`).join('')}
          </div>
          <div class="dk-hint" style="margin:0 0 12px">— أو أدخل مفتاح مدير جديد —</div>` : `
          <div class="dk-gate-sub">أدخل مفتاح المدير الخاص بهذا الجهاز</div>`}
        ${errorMsg ? `<div class="dk-error"><i class="fas fa-circle-xmark"></i> ${errorMsg}</div>` : ''}
        <div class="dk-field dk-key-field">
          <label><i class="fas fa-key"></i> مفتاح المدير / Manager Key</label>
          <input type="text" id="dk-mgr-key" placeholder="MGR-XXXXXXXX-XXXX" autocomplete="off" spellcheck="false"/>
        </div>
        <button class="dk-btn" onclick="DakaniAccounts._submitManagerKey()"><i class="fas fa-unlock"></i> دخول بالمفتاح</button>
        <div class="dk-hint">
          المفتاح يُستخدم للدخول أول مرة؛ بعدها يمكنك إبقاءه ككلمة سر أو تغييرها من «الحسابات».
          لا تملك مفتاحاً؟ أرسل معرّف جهازك <span class="dk-device-chip">${dev || '—'}</span> لمن يولّد لك المفتاح.
        </div>
      </div>`;
    document.getElementById('dk-mgr-key')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') _submitManagerKey();
    });
  }

  function _showManagerPassword(id, errorMsg) {
    const m = getManagers().find(x => x.id === id);
    if (!m) { _showManagerStep(); return; }
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        ${_closeBtnHtml()}
        <div class="dk-back-link" onclick="DakaniAccounts._showManagerStep()"><i class="fas fa-arrow-right"></i> رجوع</div>
        <div class="dk-gate-logo"><i class="fas fa-user-tie"></i></div>
        <div class="dk-gate-title">${escHtml(m.name)}</div>
        <div class="dk-gate-sub">${m.pwHash ? 'أدخل كلمة المرور' : 'أدخل مفتاح المدير (كلمة السر المولَّدة)'}</div>
        ${errorMsg ? `<div class="dk-error"><i class="fas fa-circle-xmark"></i> ${errorMsg}</div>` : ''}
        <div class="dk-field ${m.pwHash ? '' : 'dk-key-field'}">
          <label><i class="fas fa-lock"></i> ${m.pwHash ? 'كلمة المرور / Password' : 'المفتاح / Key'}</label>
          <input type="password" id="dk-mgr-pw" autocomplete="off" spellcheck="false"/>
        </div>
        <button class="dk-btn" onclick="DakaniAccounts._submitManagerPassword('${m.id}')"><i class="fas fa-unlock"></i> دخول</button>
        ${m.pwHash && m.key ? '<div class="dk-hint">نسيت كلمة المرور؟ أدخل مفتاح المدير الأصلي في الحقل نفسه.</div>' : ''}
      </div>`;
    const inp = document.getElementById('dk-mgr-pw');
    inp?.addEventListener('keydown', e => { if (e.key === 'Enter') _submitManagerPassword(m.id); });
    setTimeout(() => inp?.focus(), 50);
  }

  function _submitManagerPassword(id) {
    const val = document.getElementById('dk-mgr-pw')?.value || '';
    if (!val) return;
    if (!verifyManagerLogin(id, val)) { _showManagerPassword(id, 'كلمة المرور غير صحيحة / Wrong password'); return; }
    const m = getManagers().find(x => x.id === id);
    _setManagerSession(m);
    _afterLogin();
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

  // الخطوة 2ب: دخول الكاشير — اختيار الموظف (وكلمة مروره إن وُجدت)
  function _showCashierStep() {
    const emps = getEmployees().filter(e => e.active !== false);
    const anyPw = emps.some(e => e.pwHash);
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        <div class="dk-back-link" onclick="DakaniAccounts._renderRoleChoice()"><i class="fas fa-arrow-right"></i> رجوع</div>
        <div class="dk-gate-logo"><i class="fas fa-cash-register"></i></div>
        <div class="dk-gate-title">دخول الكاشير</div>
        <div class="dk-gate-sub">${anyPw ? 'اختر اسمك' : 'من يعمل الآن؟ (اختياري)'}</div>
        ${emps.length ? `
          <div class="dk-profile-list">
            ${emps.map(e => `
              <div class="dk-profile-item" onclick="DakaniAccounts._submitCashier('${e.id}')">
                <span class="dk-pi-name"><i class="fas fa-user"></i> ${escHtml(e.name)}</span>
                <span class="dk-pi-sub">${e.pwHash ? '<i class="fas fa-lock"></i> ' : ''}${escHtml(e.title || '')}</span>
              </div>`).join('')}
          </div>` : ''}
        ${anyPw ? '' : `<button class="dk-btn" onclick="DakaniAccounts._submitCashier(null)"><i class="fas fa-right-to-bracket"></i> دخول بدون تحديد اسم</button>`}
      </div>`;
  }

  function _showEmployeePassword(id, errorMsg) {
    const e = getEmployee(id);
    if (!e) { _showCashierStep(); return; }
    _gateEl.innerHTML = `
      <div class="dk-gate-box">
        <div class="dk-back-link" onclick="DakaniAccounts._showCashierStep()"><i class="fas fa-arrow-right"></i> رجوع</div>
        <div class="dk-gate-logo"><i class="fas fa-user-lock"></i></div>
        <div class="dk-gate-title">${escHtml(e.name)}</div>
        <div class="dk-gate-sub">أدخل كلمة المرور</div>
        ${errorMsg ? `<div class="dk-error"><i class="fas fa-circle-xmark"></i> ${errorMsg}</div>` : ''}
        <div class="dk-field"><label><i class="fas fa-lock"></i> كلمة المرور / Password</label>
          <input type="password" id="dk-emp-pw" autocomplete="off"/></div>
        <button class="dk-btn" onclick="DakaniAccounts._submitEmployeePassword('${e.id}')"><i class="fas fa-unlock"></i> دخول</button>
      </div>`;
    const inp = document.getElementById('dk-emp-pw');
    inp?.addEventListener('keydown', ev => { if (ev.key === 'Enter') _submitEmployeePassword(e.id); });
    setTimeout(() => inp?.focus(), 50);
  }
  function _submitEmployeePassword(id) {
    const val = document.getElementById('dk-emp-pw')?.value || '';
    if (!verifyEmployeePassword(id, val)) { _showEmployeePassword(id, 'كلمة المرور غير صحيحة / Wrong password'); return; }
    _setCashierSession(id);
    _afterLogin();
  }

  function _submitCashier(employeeId) {
    if (employeeId) {
      const e = getEmployee(employeeId);
      if (e && e.pwHash) { _showEmployeePassword(employeeId); return; }
    }
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
        <h1>الحسابات <span>Accounts</span></h1>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn-primary" id="dk-add-emp-btn"><i class="fas fa-user-plus"></i> إضافة موظف / Add Employee</button>
          <button class="btn-secondary" id="dk-add-mgr-btn"><i class="fas fa-user-shield"></i> إضافة حساب مدير / Add Manager</button>
        </div>
      </div>
      <div class="dk-emp-tabs">
        <div class="dk-emp-tab active" data-tab="emp">الموظفون / Employees</div>
        <div class="dk-emp-tab" data-tab="mgr">حسابات المدراء / Manager Accounts</div>
        <div class="dk-emp-tab" data-tab="perf">أداء الموظفين / Performance</div>
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
        <div class="dk-lock-note"><i class="fas fa-info-circle"></i> يُستخدم مفتاح المدير للدخول أول مرة؛ بعدها يمكنك إبقاءه ككلمة سر أو تغيير الاسم وكلمة المرور من زر التعديل. يمكنك أيضاً إنشاء حساب مدير جديد بزر «إضافة حساب مدير» (يدخل بكلمة مرور).</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>#</th><th>الاسم / Name</th><th>طريقة الدخول</th><th>الهاتف</th><th>تاريخ الإضافة / Added</th><th>إجراءات / Actions</th></tr></thead>
            <tbody id="dk-managers-body"></tbody>
          </table>
        </div>
      </div>
      <div class="dk-emp-panel" id="dk-panel-perf"><div id="dk-perf-host"></div></div>`;
    main.appendChild(div);

    div.querySelectorAll('.dk-emp-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        div.querySelectorAll('.dk-emp-tab').forEach(t => t.classList.remove('active'));
        div.querySelectorAll('.dk-emp-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('dk-panel-' + tab.dataset.tab).classList.add('active');
        if (tab.dataset.tab === 'perf') _renderPerfTab();
      });
    });
    document.getElementById('dk-add-emp-btn').addEventListener('click', () => _openEmployeeModal(null));
    document.getElementById('dk-add-mgr-btn').addEventListener('click', () => _openManagerModal(null));
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
          <div class="form-row">
            <div class="form-group"><label>كلمة المرور (اختياري) / Password <small style="color:#6b7280">اتركها فارغة بدون كلمة مرور</small></label>
              <input type="password" id="dk-emp-password" autocomplete="new-password" placeholder="••••"/></div>
            <div class="form-group" id="dk-emp-rmpw-wrap" style="display:none"><label>&nbsp;</label>
              <label style="display:flex;align-items:center;gap:6px;font-size:12.5px"><input type="checkbox" id="dk-emp-rmpw" style="width:auto"/> إزالة كلمة المرور الحالية</label></div>
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

  function _injectManagerModal() {
    if (document.getElementById('modal-manager')) return;
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'modal-manager';
    div.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="dk-mgr-modal-title"><i class="fas fa-user-shield"></i> حساب مدير</h3>
          <button class="btn-icon" onclick="closeModal('modal-manager')"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="modal-body">
          <input type="hidden" id="dk-mgr-id"/>
          <div class="form-row">
            <div class="form-group"><label>الاسم / Name <span class="req">*</span></label><input type="text" id="dk-mgr-name-inp"/></div>
            <div class="form-group"><label>الهاتف / Phone</label><input type="text" id="dk-mgr-phone"/></div>
          </div>
          <div class="form-row">
            <div class="form-group"><label id="dk-mgr-pw-label">كلمة المرور / Password</label><input type="password" id="dk-mgr-pw1" autocomplete="new-password"/></div>
            <div class="form-group"><label>تأكيد كلمة المرور / Confirm</label><input type="password" id="dk-mgr-pw2" autocomplete="new-password"/></div>
          </div>
          <div class="form-group" id="dk-mgr-rmpw-wrap" style="display:none">
            <label style="display:flex;align-items:center;gap:6px;font-size:12.5px"><input type="checkbox" id="dk-mgr-rmpw" style="width:auto"/> إزالة كلمة المرور المخصّصة والعودة لمفتاح المدير الأصلي ككلمة سر</label>
          </div>
          <div class="form-group"><label>ملاحظات / Notes</label><textarea id="dk-mgr-notes" rows="2"></textarea></div>
          <div class="dk-hint" id="dk-mgr-modal-hint"></div>
        </div>
        <div class="modal-footer">
          <button class="btn-secondary" onclick="closeModal('modal-manager')">إلغاء / Cancel</button>
          <button class="btn-primary" onclick="DakaniAccounts._saveManagerForm()"><i class="fas fa-check"></i> حفظ / Save</button>
        </div>
      </div>`;
    document.body.appendChild(div);
  }

  function _openManagerModal(id) {
    _injectManagerModal();
    const m = id ? getManagers().find(x => x.id === id) : null;
    document.getElementById('dk-mgr-modal-title').innerHTML = m
      ? '<i class="fas fa-user-pen"></i> تعديل حساب مدير / Edit Manager'
      : '<i class="fas fa-user-shield"></i> إضافة حساب مدير / Add Manager';
    document.getElementById('dk-mgr-id').value = m ? m.id : '';
    document.getElementById('dk-mgr-name-inp').value = m ? m.name : '';
    document.getElementById('dk-mgr-phone').value = m ? (m.phone || '') : '';
    document.getElementById('dk-mgr-notes').value = m ? (m.notes || '') : '';
    document.getElementById('dk-mgr-pw1').value = '';
    document.getElementById('dk-mgr-pw2').value = '';
    document.getElementById('dk-mgr-rmpw').checked = false;
    document.getElementById('dk-mgr-rmpw-wrap').style.display = (m && m.pwHash && m.key) ? '' : 'none';
    document.getElementById('dk-mgr-pw-label').textContent = m ? 'كلمة مرور جديدة (اتركها فارغة بدون تغيير)' : 'كلمة المرور / Password *';
    document.getElementById('dk-mgr-modal-hint').textContent = m
      ? (m.key ? 'يمكن دائماً الدخول بمفتاح المدير الأصلي لهذا الجهاز كوسيلة استرجاع.' : 'هذا الحساب يدخل بكلمة المرور فقط.')
      : 'سيدخل هذا الحساب بكلمة المرور فقط (بدون مفتاح جهاز).';
    openModal('modal-manager');
  }

  function _saveManagerForm() {
    const id = document.getElementById('dk-mgr-id').value;
    const pw1 = document.getElementById('dk-mgr-pw1').value;
    const pw2 = document.getElementById('dk-mgr-pw2').value;
    const data = {
      name: document.getElementById('dk-mgr-name-inp').value,
      phone: document.getElementById('dk-mgr-phone').value,
      notes: document.getElementById('dk-mgr-notes').value,
      password: pw1,
      removePassword: document.getElementById('dk-mgr-rmpw').checked
    };
    if (pw1 !== pw2) { if (typeof toast === 'function') toast('كلمتا المرور غير متطابقتين / Passwords do not match', 'warning'); return; }
    const res = id ? updateManager(id, data) : createManagerAccount(data);
    if (!res.ok) { if (typeof toast === 'function') toast(res.reason, 'warning'); return; }
    closeModal('modal-manager');
    _renderEmployeesTable();
    _refreshRoleBadge();
    if (typeof toast === 'function') toast('تم الحفظ ✓ / Saved', 'success');
  }

  function _renderPerfTab() {
    const host = document.getElementById('dk-perf-host');
    if (!host) return;
    if (window.DakaniStaffPerf && typeof window.DakaniStaffPerf.render === 'function') window.DakaniStaffPerf.render(host);
    else host.innerHTML = '<div class="empty-state">وحدة الأداء غير محمَّلة / Performance module not loaded</div>';
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
    document.getElementById('dk-emp-password').value = '';
    document.getElementById('dk-emp-rmpw').checked = false;
    document.getElementById('dk-emp-rmpw-wrap').style.display = (emp && emp.pwHash) ? '' : 'none';
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
      notes: document.getElementById('dk-emp-notes').value,
      password: document.getElementById('dk-emp-password').value,
      removePassword: document.getElementById('dk-emp-rmpw').checked
    };
    if (data.password && data.password.length < 4) { if (typeof toast === 'function') toast('كلمة المرور 4 أحرف على الأقل / Password min 4 chars', 'warning'); return; }
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
        <td><strong>${escHtml(e.name)}</strong>${e.pwHash ? ' <i class="fas fa-lock" title="لديه كلمة مرور" style="font-size:11px;color:var(--gold,#f59e0b)"></i>' : ''}${e.phone ? `<br/><small>${escHtml(e.phone)}</small>` : ''}</td>
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
      const activeMgr = getActiveManager();
      mbody.innerHTML = managers.length ? managers.map((m, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${escHtml(m.name)}</strong>${activeMgr && activeMgr.id === m.id ? ' <span class="badge badge-ok">أنت</span>' : ''}</td>
          <td>${m.pwHash ? '<i class="fas fa-lock"></i> كلمة مرور' : '<i class="fas fa-key"></i> مفتاح المدير'}${m.key ? '' : ' <small>(بدون مفتاح)</small>'}</td>
          <td>${escHtml(m.phone || '—')}</td>
          <td>${(m.createdAt || '').slice(0, 10)}</td>
          <td>
            <button class="btn-icon edit" onclick="DakaniAccounts._openManagerModal('${m.id}')" title="تعديل"><i class="fas fa-pen"></i></button>
            <button class="btn-icon danger" onclick="DakaniAccounts._deleteManagerConfirm('${m.id}')" title="حذف"><i class="fas fa-trash"></i></button>
          </td>
        </tr>`).join('') : `<tr><td colspan="6" class="empty-td">لا توجد حسابات مدراء بعد / No manager accounts yet</td></tr>`;
    }
  }

  function _deleteManagerConfirm(id) {
    if (getManagers().length <= 1) { if (typeof toast === 'function') toast('لا يمكن حذف آخر حساب مدير / Cannot delete the last manager', 'warning'); return; }
    if (getActiveManager() && getActiveManager().id === id) { if (typeof toast === 'function') toast('لا يمكنك حذف الحساب الذي تستخدمه الآن / Cannot delete your own active account', 'warning'); return; }
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
    if (title) title.textContent = 'الحسابات / Accounts';
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
    a.innerHTML = `<i class="fas fa-users-gear"></i><span class="nav-ar">الحسابات</span>`;
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
    getManagers, getEmployees, addEmployee, updateEmployee, deleteEmployee, getEmployee,
    createManagerAccount, updateManager, verifyManagerLogin, verifyEmployeePassword, getCurrentUser,
    verifyManagerKey, canAccessPage,
    showGate, hideGate,
    // مستخدمة داخلياً عبر onclick= في الواجهة المُولَّدة ديناميكياً
    _renderRoleChoice, _showManagerStep, _submitManagerKey, _confirmManagerName,
    _showCashierStep, _submitCashier, _showManagerPassword, _submitManagerPassword,
    _showEmployeePassword, _submitEmployeePassword, _openManagerModal, _saveManagerForm,
    _openEmployeeModal, _saveEmployeeForm, _deleteEmployeeConfirm, _deleteManagerConfirm,
    _hideGateUI: hideGate
  };

})();

// ─── التشغيل: نفس حيلة التأجيل المستخدمة في باقي الملفات — ننتظر حتى
// يكون التطبيق (بعد الترخيص) جاهزاً تماماً قبل عرض بوابة الحساب فوقه ────
document.addEventListener('DOMContentLoaded', () => {
  DakaniAccounts.init();
});