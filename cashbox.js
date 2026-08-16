/**
 * DAKANI CASHBOX & EXPENSES
 * ─────────────────────────────────────────────────────────────
 * صفحة "المصاريف والصندوق": مصاريف التشغيل (إيجار / رواتب / فواتير /
 * مصاريف عامة) + رأس المال (إضافات وسحوبات) + إدارة الصندوق (فتح وإغلاق
 * المناوبة، إيداعات وسحوبات نقدية أثناء المناوبة، ومطابقة النقد الفعلي
 * بالنقد المتوقع عند الإغلاق).
 *
 * ⚠️ ملف مستقل تماماً (نفس مبدأ camera-scanner.js و license.js و
 *    keyboard-shortcuts.js): لا يعدّل أي دالة موجودة في script.js أو
 *    database.js، وله تخزينه الخاص (localStorage) حتى لا يتعارض مع
 *    قاعدة بيانات IndexedDB الأصلية. الاعتماد الوحيد على الملفات
 *    الأخرى هو *القراءة فقط* من DB.Sales و DB.DebtPayments و
 *    DB.Settings لحساب النقد المتوقع بالصندوق، وهي دوال قراءة لا
 *    تُغيَّر ولا تُستدعى بشكل يُعدِّل بياناتها.
 *
 * التعديلات الوحيدة خارج هذا الملف (ضرورية فقط لإظهار الصفحة والتنقّل إليها):
 *   - index.html : عنصر تنقّل واحد + حاوية صفحة فارغة (يُملأ محتواها هنا)
 *   - script.js  : سطر في PAGE_TITLES وسطر في handlers داخل navigateTo()
 *   - sw.js      : إضافة اسم الملف لقائمة التخزين المؤقت Offline
 */

const DakaniCashbox = (() => {

  const KEYS = {
    expenses:  'dakani_cbx_expenses',
    capital:   'dakani_cbx_capital',
    shifts:    'dakani_cbx_shifts',
    moves:     'dakani_cbx_moves'
  };

  // ─── تخزين محلي بسيط (JSON عبر localStorage) — متزامن وموثوق دون أي Race ──
  function _get(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); }
    catch (e) { return []; }
  }
  function _set(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now   = () => new Date().toISOString();

  // فئات المصاريف الثابتة
  const EXPENSE_CATEGORIES = [
    { id: 'rent',    label: 'إيجار / Rent' },
    { id: 'salary',  label: 'رواتب / Salaries' },
    { id: 'bill',    label: 'فواتير / Bills' },
    { id: 'general', label: 'مصاريف عامة / General' }
  ];
  const categoryLabel = id => (EXPENSE_CATEGORIES.find(c => c.id === id) || {}).label || id || '—';

  // ══════════════════════════ المصاريف ══════════════════════════
  const Expenses = {
    all: () => _get(KEYS.expenses).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    byId: id => _get(KEYS.expenses).find(e => e.id === id),
    add(data) {
      const list = _get(KEYS.expenses);
      const item = {
        id: uid(),
        category: data.category || 'general',
        amount: Math.max(0, parseFloat(data.amount) || 0),
        note: (data.note || '').trim(),
        paidFromRegister: !!data.paidFromRegister,
        date: data.date || now(),
        createdAt: now()
      };
      list.push(item);
      _set(KEYS.expenses, list);
      // إن اختار المستخدم دفع المصروف من نقد الصندوق الحالي، سجّله كسحب مرتبط
      // بالمناوبة المفتوحة فقط (وليس بمناوبة مغلقة) حتى لا يُحسب على مناوبة انتهت
      if (item.paidFromRegister && item.amount > 0) {
        const shift = Shifts.current();
        if (shift) {
          Moves.add({
            shiftId: shift.id, type: 'withdraw', amount: item.amount,
            note: 'مصروف: ' + categoryLabel(item.category) + (item.note ? (' — ' + item.note) : ''),
            linkedExpenseId: item.id
          });
        }
      }
      return item;
    },
    delete(id) {
      const item = Expenses.byId(id);
      if (!item) return;
      // احذف حركة السحب المرتبطة بهذا المصروف (إن وُجدت) حتى لا يبقى الصندوق
      // "مثقلاً" بسحب لمصروف لم يعد موجوداً
      _set(KEYS.moves, _get(KEYS.moves).filter(m => m.linkedExpenseId !== id));
      _set(KEYS.expenses, _get(KEYS.expenses).filter(e => e.id !== id));
    },
    totals(list) {
      const t = { rent: 0, salary: 0, bill: 0, general: 0, all: 0 };
      (list || Expenses.all()).forEach(e => {
        t.all += e.amount;
        if (t[e.category] !== undefined) t[e.category] += e.amount;
      });
      return t;
    },
    todayTotal() {
      const t = new Date().toISOString().slice(0, 10);
      return Expenses.all().filter(e => (e.date || '').startsWith(t)).reduce((a, e) => a + e.amount, 0);
    }
  };

  // ══════════════════════════ رأس المال ══════════════════════════
  const Capital = {
    all: () => _get(KEYS.capital).slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    byId: id => _get(KEYS.capital).find(c => c.id === id),
    add(data) {
      const list = _get(KEYS.capital);
      const item = {
        id: uid(),
        type: data.type === 'out' ? 'out' : 'in', // in = إضافة رأس مال / out = سحب من رأس المال
        amount: Math.max(0, parseFloat(data.amount) || 0),
        note: (data.note || '').trim(),
        date: data.date || now(),
        createdAt: now()
      };
      list.push(item);
      _set(KEYS.capital, list);
      return item;
    },
    delete(id) { _set(KEYS.capital, _get(KEYS.capital).filter(c => c.id !== id)); },
    balance() {
      return _get(KEYS.capital).reduce((a, c) => a + (c.type === 'in' ? c.amount : -c.amount), 0);
    },
    totals() {
      const list = _get(KEYS.capital);
      return {
        in:  list.filter(c => c.type === 'in').reduce((a, c) => a + c.amount, 0),
        out: list.filter(c => c.type === 'out').reduce((a, c) => a + c.amount, 0)
      };
    }
  };

  // ══════════════════════════ المناوبات (فتح/إغلاق الصندوق) ══════════════════════════
  const Shifts = {
    all: () => _get(KEYS.shifts).slice().sort((a, b) => (b.openedAt || '').localeCompare(a.openedAt || '')),
    current: () => _get(KEYS.shifts).find(s => s.status === 'open') || null,
    byId: id => _get(KEYS.shifts).find(s => s.id === id),

    open(openingBalance, note) {
      if (Shifts.current()) return null; // لا يمكن فتح مناوبتين معاً
      const list = _get(KEYS.shifts);
      const s = {
        id: uid(),
        openedAt: now(),
        closedAt: null,
        openingBalance: Math.max(0, parseFloat(openingBalance) || 0),
        expectedBalance: null,
        closingActual: null,
        difference: null,
        note: (note || '').trim(),
        closeNote: '',
        status: 'open'
      };
      list.push(s);
      _set(KEYS.shifts, list);
      return s;
    },

    // النقد المتوقع الآن (أو عند إغلاق مناوبة بعينها): الرصيد الافتتاحي
    // + المبيعات النقدية أثناء المناوبة + تحصيلات الديون أثناء المناوبة
    // + الإيداعات - السحوبات (وتشمل السحوبات مصاريف الصندوق المرتبطة)
    expectedBalance(shift) {
      shift = shift || Shifts.current();
      if (!shift) return 0;
      const from = shift.openedAt;
      let cashIn = 0;
      try {
        if (typeof DB !== 'undefined' && DB.Sales) {
          (DB.Sales.all() || []).forEach(s => {
            if (s.date && s.date >= from) {
              cashIn += (s.cashAmount != null ? s.cashAmount : (s.paymentMethod === 'cash' ? s.total : 0));
            }
          });
        }
        if (typeof DB !== 'undefined' && DB.DebtPayments) {
          (DB.DebtPayments.all() || []).forEach(p => {
            if (p.date && p.date >= from) cashIn += (p.amount || 0);
          });
        }
      } catch (e) { /* لا نكسر الصفحة إن تغيّر شكل DB مستقبلاً */ }

      const moves = Moves.byShift(shift.id);
      const deposits    = moves.filter(m => m.type === 'deposit').reduce((a, m) => a + m.amount, 0);
      const withdrawals = moves.filter(m => m.type === 'withdraw').reduce((a, m) => a + m.amount, 0);
      return shift.openingBalance + cashIn + deposits - withdrawals;
    },

    close(actualAmount, note) {
      const cur = Shifts.current();
      if (!cur) return null;
      const expected = Shifts.expectedBalance(cur);
      const actual = Math.max(0, parseFloat(actualAmount) || 0);
      const list = _get(KEYS.shifts);
      const i = list.findIndex(s => s.id === cur.id);
      if (i === -1) return null;
      list[i].closedAt = now();
      list[i].expectedBalance = expected;
      list[i].closingActual = actual;
      list[i].difference = actual - expected;
      list[i].closeNote = (note || '').trim();
      list[i].status = 'closed';
      _set(KEYS.shifts, list);
      return list[i];
    }
  };

  // ══════════════════════════ حركات الصندوق (إيداع/سحب) ══════════════════════════
  const Moves = {
    all: () => _get(KEYS.moves).slice(),
    byShift: id => _get(KEYS.moves).filter(m => m.shiftId === id).sort((a, b) => (b.date || '').localeCompare(a.date || '')),
    add(data) {
      const list = _get(KEYS.moves);
      const m = {
        id: uid(),
        shiftId: data.shiftId,
        type: data.type === 'withdraw' ? 'withdraw' : 'deposit',
        amount: Math.max(0, parseFloat(data.amount) || 0),
        note: (data.note || '').trim(),
        linkedExpenseId: data.linkedExpenseId || null,
        date: now()
      };
      list.push(m);
      _set(KEYS.moves, list);
      return m;
    },
    delete(id) { _set(KEYS.moves, _get(KEYS.moves).filter(m => m.id !== id)); }
  };

  return { Expenses, Capital, Shifts, Moves, EXPENSE_CATEGORIES, categoryLabel, uid, now };

})();

// ══════════════════════════════════════════════════════════════════════════
// ──────────────────────────── واجهة المستخدم (UI) ───────────────────────────
// ══════════════════════════════════════════════════════════════════════════
(function () {

  let _cbxTab = 'register';           // التبويب النشط: register | expenses | capital
  let _cbxMoveType = 'deposit';       // نوع حركة الصندوق الجاري إدخالها
  let _cbxExpFilterCat = '';
  let _cbxExpFilterFrom = '';
  let _cbxExpFilterTo = '';

  // ─── حماية بسيطة من أكواد HTML داخل ملاحظات المستخدم ─────────────────────
  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function _cur() {
    try { return (DB.Settings.get().currency) || 'دج'; } catch (e) { return 'دج'; }
  }
  function _fmt(n) {
    return typeof fmt === 'function' ? fmt(n) : (parseFloat(n) || 0).toFixed(2);
  }
  function _fmtDate(d) {
    return typeof fmtDate === 'function' ? fmtDate(d) : (d ? new Date(d).toLocaleString('ar-DZ') : '—');
  }
  function _toast(msg, type) {
    if (typeof toast === 'function') toast(msg, type); else alert(msg);
  }

  // ─── حقن الأنماط الخاصة بالصفحة مرة واحدة فقط ────────────────────────────
  function ensureStyles() {
    if (document.getElementById('cbx-styles')) return;
    const style = document.createElement('style');
    style.id = 'cbx-styles';
    style.textContent = `
      .cbx-tabs { display:flex; gap:8px; margin:18px 0; flex-wrap:wrap; }
      .cbx-tab-btn {
        background: var(--surface2, #1a2332); color: var(--text2, #94a3b8);
        border: 1px solid var(--border, #1e293b); border-radius: var(--radius-sm, 8px);
        padding: 10px 18px; font-family:'Cairo',sans-serif; font-size:14px; font-weight:600;
        cursor:pointer; display:flex; align-items:center; gap:8px; transition:.15s;
      }
      .cbx-tab-btn:hover { color: var(--text, #e2e8f0); border-color: var(--border2, #253347); }
      .cbx-tab-btn.active { background: var(--accent, #10b981); color:#fff; border-color: var(--accent, #10b981); }
      .cbx-card {
        background: var(--surface, #111827); border:1px solid var(--border, #1e293b);
        border-radius: var(--radius, 12px); padding:22px; margin-bottom:20px;
      }
      .cbx-shift-empty { text-align:center; padding:30px 20px; }
      .cbx-shift-empty i { font-size:40px; color: var(--accent, #10b981); margin-bottom:14px; display:block; }
      .cbx-shift-empty h3 { margin-bottom:8px; font-size:17px; }
      .cbx-shift-empty p { color: var(--text2, #94a3b8); font-size:13px; margin-bottom:18px; max-width:420px; margin-inline:auto; }
      .cbx-shift-row { display:flex; flex-wrap:wrap; gap:24px; margin-bottom:18px; }
      .cbx-shift-row > div { flex:1; min-width:150px; }
      .cbx-label { display:block; color: var(--text2, #94a3b8); font-size:12px; margin-bottom:4px; }
      .cbx-shift-row strong { font-size:19px; }
      .cbx-expected { color: var(--accent, #10b981); }
      .cbx-shift-actions { display:flex; gap:10px; flex-wrap:wrap; }
      .cbx-subtitle { font-size:15px; margin:22px 0 10px; color: var(--text, #e2e8f0); font-weight:700; }
      .cbx-diff-box { display:flex; gap:20px; flex-wrap:wrap; background: var(--surface2, #1a2332); border-radius: var(--radius-sm, 8px); padding:14px 18px; margin:14px 0; }
      .cbx-diff-box > div { flex:1; min-width:110px; text-align:center; }
      .cbx-diff-box .cbx-label { margin-bottom:6px; }
      .cbx-diff-pos { color: var(--accent, #10b981); font-weight:800; font-size:17px; }
      .cbx-diff-neg { color: var(--red, #ef4444); font-weight:800; font-size:17px; }
      .cbx-diff-zero { color: var(--text, #e2e8f0); font-weight:800; font-size:17px; }
      .cbx-form-row { display:flex; gap:12px; flex-wrap:wrap; }
      .cbx-form-row .form-group { flex:1; min-width:160px; }
      .cbx-checkbox-row { display:flex; align-items:center; gap:8px; margin-top:4px; }
      .cbx-checkbox-row input { width:auto; }
    `;
    document.head.appendChild(style);
  }

  // ─── إنشاء عناصر النوافذ المنبثقة مرة واحدة فقط في نهاية الصفحة ──────────
  function ensureModals() {
    if (document.getElementById('modal-cbx-open-shift')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="modal-overlay" id="modal-cbx-open-shift">
        <div class="modal">
          <div class="modal-header">
            <h2><i class="fas fa-play"></i> فتح مناوبة جديدة / Open Shift</h2>
            <button onclick="closeModal('modal-cbx-open-shift')"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>الرصيد الافتتاحي (النقد الموجود بالصندوق الآن) / Opening Cash</label>
              <input type="number" id="cbx-open-balance" min="0" step="any" placeholder="0"/>
            </div>
            <div class="form-group">
              <label>ملاحظة (اختياري) / Note</label>
              <input type="text" id="cbx-open-note" placeholder="أي تفاصيل إضافية..."/>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal('modal-cbx-open-shift')">إلغاء</button>
            <button class="btn-primary" onclick="cbxSaveOpenShift()"><i class="fas fa-check"></i> فتح المناوبة</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="modal-cbx-close-shift">
        <div class="modal">
          <div class="modal-header">
            <h2><i class="fas fa-stop"></i> إغلاق المناوبة / Close Shift</h2>
            <button onclick="closeModal('modal-cbx-close-shift')"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <p style="color:var(--text2,#94a3b8);font-size:13px;margin-bottom:12px;">
              أدخل المبلغ الفعلي الذي عددته في الصندوق الآن، وسيقارنه النظام تلقائياً بالرصيد المتوقع.
            </p>
            <div class="form-group">
              <label>النقد الفعلي المعدود / Actual Counted Cash</label>
              <input type="number" id="cbx-close-actual" min="0" step="any" placeholder="0" oninput="cbxUpdateCloseDiff()"/>
            </div>
            <div class="cbx-diff-box">
              <div><span class="cbx-label">المتوقع / Expected</span><div id="cbx-close-expected">0.00</div></div>
              <div><span class="cbx-label">الفعلي / Actual</span><div id="cbx-close-actual-view">0.00</div></div>
              <div><span class="cbx-label">الفرق / Difference</span><div id="cbx-close-diff" class="cbx-diff-zero">0.00</div></div>
            </div>
            <div class="form-group">
              <label>ملاحظة (اختياري) / Note</label>
              <input type="text" id="cbx-close-note" placeholder="سبب الفرق إن وُجد..."/>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal('modal-cbx-close-shift')">إلغاء</button>
            <button class="btn-danger" onclick="cbxSaveCloseShift()"><i class="fas fa-check"></i> تأكيد الإغلاق</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="modal-cbx-move">
        <div class="modal">
          <div class="modal-header">
            <h2 id="cbx-move-title"><i class="fas fa-arrow-down"></i> إيداع في الصندوق / Deposit</h2>
            <button onclick="closeModal('modal-cbx-move')"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>المبلغ / Amount</label>
              <input type="number" id="cbx-move-amount" min="0" step="any" placeholder="0"/>
            </div>
            <div class="form-group">
              <label>ملاحظة / Note</label>
              <input type="text" id="cbx-move-note" placeholder="سبب الإيداع أو السحب..."/>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal('modal-cbx-move')">إلغاء</button>
            <button class="btn-primary" onclick="cbxSaveMove()"><i class="fas fa-check"></i> تأكيد</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="modal-cbx-expense">
        <div class="modal">
          <div class="modal-header">
            <h2><i class="fas fa-file-invoice-dollar"></i> إضافة مصروف / Add Expense</h2>
            <button onclick="closeModal('modal-cbx-expense')"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <div class="cbx-form-row">
              <div class="form-group">
                <label>نوع المصروف / Category</label>
                <select id="cbx-exp-cat">
                  ${DakaniCashbox.EXPENSE_CATEGORIES.map(c => `<option value="${c.id}">${c.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>المبلغ / Amount</label>
                <input type="number" id="cbx-exp-amount" min="0" step="any" placeholder="0"/>
              </div>
            </div>
            <div class="form-group">
              <label>التاريخ / Date</label>
              <input type="date" id="cbx-exp-date"/>
            </div>
            <div class="form-group">
              <label>ملاحظة (اختياري) / Note</label>
              <input type="text" id="cbx-exp-note" placeholder="تفاصيل إضافية..."/>
            </div>
            <div class="cbx-checkbox-row">
              <input type="checkbox" id="cbx-exp-from-register"/>
              <label for="cbx-exp-from-register" style="margin:0;">خصمه الآن من نقد الصندوق (المناوبة المفتوحة)</label>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal('modal-cbx-expense')">إلغاء</button>
            <button class="btn-primary" onclick="cbxSaveExpense()"><i class="fas fa-check"></i> حفظ المصروف</button>
          </div>
        </div>
      </div>

      <div class="modal-overlay" id="modal-cbx-capital">
        <div class="modal">
          <div class="modal-header">
            <h2><i class="fas fa-sack-dollar"></i> حركة رأس مال / Capital Transaction</h2>
            <button onclick="closeModal('modal-cbx-capital')"><i class="fas fa-xmark"></i></button>
          </div>
          <div class="modal-body">
            <div class="cbx-form-row">
              <div class="form-group">
                <label>النوع / Type</label>
                <select id="cbx-cap-type">
                  <option value="in">إضافة رأس مال / Capital In</option>
                  <option value="out">سحب من رأس المال / Capital Out</option>
                </select>
              </div>
              <div class="form-group">
                <label>المبلغ / Amount</label>
                <input type="number" id="cbx-cap-amount" min="0" step="any" placeholder="0"/>
              </div>
            </div>
            <div class="form-group">
              <label>التاريخ / Date</label>
              <input type="date" id="cbx-cap-date"/>
            </div>
            <div class="form-group">
              <label>ملاحظة (اختياري) / Note</label>
              <input type="text" id="cbx-cap-note" placeholder="تفاصيل إضافية..."/>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" onclick="closeModal('modal-cbx-capital')">إلغاء</button>
            <button class="btn-primary" onclick="cbxSaveCapital()"><i class="fas fa-check"></i> حفظ</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);
  }

  // ─── نقطة الدخول: تُستدعى من navigateTo('cashbox') عبر handlers ─────────
  window.renderCashbox = function renderCashbox() {
    ensureStyles();
    ensureModals();
    const page = document.getElementById('page-cashbox');
    if (!page) return;

    const cur = _cur();
    const shift = DakaniCashbox.Shifts.current();
    const expected = shift ? DakaniCashbox.Shifts.expectedBalance(shift) : 0;
    const todayExp = DakaniCashbox.Expenses.todayTotal();
    const capBalance = DakaniCashbox.Capital.balance();

    page.innerHTML = `
      <div class="page-header">
        <h1>المصاريف والصندوق <span>Cash &amp; Expenses</span></h1>
      </div>

      <div class="kpi-grid" style="margin-bottom:0">
        <div class="kpi-card kpi-sales">
          <div class="kpi-icon"><i class="fas fa-cash-register"></i></div>
          <div class="kpi-info">
            <div class="kpi-value">${shift ? 'مفتوحة' : 'مغلقة'}</div>
            <div class="kpi-label">حالة المناوبة</div>
          </div>
        </div>
        <div class="kpi-card kpi-profit">
          <div class="kpi-icon"><i class="fas fa-vault"></i></div>
          <div class="kpi-info">
            <div class="kpi-value">${shift ? (_fmt(expected) + ' ' + cur) : '—'}</div>
            <div class="kpi-label">الرصيد المتوقع بالصندوق</div>
          </div>
        </div>
        <div class="kpi-card kpi-low">
          <div class="kpi-icon"><i class="fas fa-file-invoice-dollar"></i></div>
          <div class="kpi-info">
            <div class="kpi-value">${_fmt(todayExp)} ${cur}</div>
            <div class="kpi-label">مصاريف اليوم</div>
          </div>
        </div>
        <div class="kpi-card kpi-invoices">
          <div class="kpi-icon"><i class="fas fa-sack-dollar"></i></div>
          <div class="kpi-info">
            <div class="kpi-value">${_fmt(capBalance)} ${cur}</div>
            <div class="kpi-label">رصيد رأس المال</div>
          </div>
        </div>
      </div>

      <div class="cbx-tabs">
        <button class="cbx-tab-btn ${_cbxTab === 'register' ? 'active' : ''}" onclick="cbxSwitchTab('register')"><i class="fas fa-cash-register"></i> الصندوق والمناوبة</button>
        <button class="cbx-tab-btn ${_cbxTab === 'expenses' ? 'active' : ''}" onclick="cbxSwitchTab('expenses')"><i class="fas fa-file-invoice-dollar"></i> المصاريف</button>
        <button class="cbx-tab-btn ${_cbxTab === 'capital' ? 'active' : ''}" onclick="cbxSwitchTab('capital')"><i class="fas fa-sack-dollar"></i> رأس المال</button>
      </div>

      <div id="cbx-tab-content"></div>
    `;

    if (_cbxTab === 'register') _renderRegisterTab();
    else if (_cbxTab === 'expenses') _renderExpensesTab();
    else _renderCapitalTab();
  };

  window.cbxSwitchTab = function (tab) {
    _cbxTab = tab;
    renderCashbox();
  };

  // ══════════════════════════ تبويب الصندوق والمناوبة ══════════════════════════
  function _renderRegisterTab() {
    const holder = document.getElementById('cbx-tab-content');
    if (!holder) return;
    const cur = _cur();
    const shift = DakaniCashbox.Shifts.current();

    let html = '';
    if (!shift) {
      html += `
        <div class="cbx-card cbx-shift-empty">
          <i class="fas fa-cash-register"></i>
          <h3>لا توجد مناوبة مفتوحة حالياً</h3>
          <p>افتح مناوبة جديدة لبدء تسجيل حركة الصندوق (إيداعات وسحوبات) ولحساب النقد المتوقع تلقائياً عند الإغلاق.</p>
          <button class="btn-primary" onclick="cbxOpenShiftModal()"><i class="fas fa-play"></i> فتح مناوبة جديدة</button>
        </div>`;
    } else {
      const expected = DakaniCashbox.Shifts.expectedBalance(shift);
      html += `
        <div class="cbx-card">
          <div class="cbx-shift-row">
            <div><span class="cbx-label">فُتحت في</span><strong>${_fmtDate(shift.openedAt)}</strong></div>
            <div><span class="cbx-label">الرصيد الافتتاحي</span><strong>${_fmt(shift.openingBalance)} ${cur}</strong></div>
            <div><span class="cbx-label">الرصيد المتوقع الآن</span><strong class="cbx-expected">${_fmt(expected)} ${cur}</strong></div>
          </div>
          ${shift.note ? `<p style="color:var(--text2,#94a3b8);font-size:13px;margin-bottom:14px;">📝 ${esc(shift.note)}</p>` : ''}
          <div class="cbx-shift-actions">
            <button class="btn-secondary" onclick="cbxOpenMoveModal('deposit')"><i class="fas fa-arrow-down"></i> إيداع</button>
            <button class="btn-secondary" onclick="cbxOpenMoveModal('withdraw')"><i class="fas fa-arrow-up"></i> سحب</button>
            <button class="btn-danger" onclick="cbxOpenCloseShiftModal()"><i class="fas fa-stop"></i> إغلاق المناوبة</button>
          </div>
        </div>
        <h3 class="cbx-subtitle">حركات المناوبة الحالية</h3>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>الوقت</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th>إجراءات</th></tr></thead>
            <tbody>${_movesRows(DakaniCashbox.Moves.byShift(shift.id), cur)}</tbody>
          </table>
        </div>`;
    }

    const closedShifts = DakaniCashbox.Shifts.all().filter(s => s.status === 'closed');
    html += `
      <h3 class="cbx-subtitle">سجل المناوبات السابقة</h3>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>الفتح</th><th>الإغلاق</th><th>الرصيد الافتتاحي</th><th>المتوقع</th><th>الفعلي</th><th>الفرق</th>
          </tr></thead>
          <tbody>${
            closedShifts.length ? closedShifts.map(s => {
              const diff = s.difference || 0;
              const diffClass = diff > 0 ? 'cbx-diff-pos' : diff < 0 ? 'cbx-diff-neg' : 'cbx-diff-zero';
              const diffLabel = (diff > 0 ? '+' : '') + _fmt(diff) + ' ' + cur;
              return `<tr>
                <td>${_fmtDate(s.openedAt)}</td>
                <td>${_fmtDate(s.closedAt)}</td>
                <td>${_fmt(s.openingBalance)} ${cur}</td>
                <td>${_fmt(s.expectedBalance)} ${cur}</td>
                <td>${_fmt(s.closingActual)} ${cur}</td>
                <td class="${diffClass}">${diffLabel}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="empty-td">لا توجد مناوبات سابقة / No past shifts</td></tr>'
          }</tbody>
        </table>
      </div>`;

    holder.innerHTML = html;
  }

  function _movesRows(moves, cur) {
    if (!moves.length) return '<tr><td colspan="5" class="empty-td">لا توجد حركات بعد / No movements yet</td></tr>';
    return moves.map(m => {
      const isDep = m.type === 'deposit';
      return `<tr>
        <td>${_fmtDate(m.date)}</td>
        <td><span class="badge ${isDep ? 'badge-ok' : 'badge-low'}">${isDep ? 'إيداع' : 'سحب'}</span></td>
        <td>${isDep ? '+' : '-'}${_fmt(m.amount)} ${cur}</td>
        <td>${esc(m.note) || '—'}</td>
        <td>${m.linkedExpenseId ? '<span style="color:var(--text3,#64748b);font-size:12px">مرتبط بمصروف</span>' : `<button class="btn-icon danger" onclick="cbxDeleteMove('${m.id}')" title="حذف"><i class="fas fa-trash"></i></button>`}</td>
      </tr>`;
    }).join('');
  }

  window.cbxOpenShiftModal = function () {
    if (DakaniCashbox.Shifts.current()) { _toast('توجد مناوبة مفتوحة بالفعل / A shift is already open', 'info'); return; }
    document.getElementById('cbx-open-balance').value = '';
    document.getElementById('cbx-open-note').value = '';
    openModal('modal-cbx-open-shift');
  };

  window.cbxSaveOpenShift = function () {
    const balance = document.getElementById('cbx-open-balance').value;
    const note = document.getElementById('cbx-open-note').value;
    if (balance === '' || isNaN(parseFloat(balance)) || parseFloat(balance) < 0) {
      _toast('أدخل رصيداً افتتاحياً صحيحاً / Enter a valid opening balance', 'error'); return;
    }
    const s = DakaniCashbox.Shifts.open(balance, note);
    if (!s) { _toast('توجد مناوبة مفتوحة بالفعل / A shift is already open', 'error'); return; }
    closeModal('modal-cbx-open-shift');
    _toast('تم فتح المناوبة بنجاح / Shift opened', 'success');
    renderCashbox();
  };

  window.cbxOpenCloseShiftModal = function () {
    const shift = DakaniCashbox.Shifts.current();
    if (!shift) return;
    document.getElementById('cbx-close-actual').value = '';
    document.getElementById('cbx-close-note').value = '';
    document.getElementById('cbx-close-expected').textContent = _fmt(DakaniCashbox.Shifts.expectedBalance(shift)) + ' ' + _cur();
    document.getElementById('cbx-close-actual-view').textContent = '0.00 ' + _cur();
    const diffEl = document.getElementById('cbx-close-diff');
    diffEl.textContent = '0.00 ' + _cur();
    diffEl.className = 'cbx-diff-zero';
    openModal('modal-cbx-close-shift');
  };

  window.cbxUpdateCloseDiff = function () {
    const shift = DakaniCashbox.Shifts.current();
    if (!shift) return;
    const expected = DakaniCashbox.Shifts.expectedBalance(shift);
    const actual = parseFloat(document.getElementById('cbx-close-actual').value) || 0;
    const diff = actual - expected;
    document.getElementById('cbx-close-actual-view').textContent = _fmt(actual) + ' ' + _cur();
    const diffEl = document.getElementById('cbx-close-diff');
    diffEl.textContent = (diff > 0 ? '+' : '') + _fmt(diff) + ' ' + _cur();
    diffEl.className = diff > 0 ? 'cbx-diff-pos' : diff < 0 ? 'cbx-diff-neg' : 'cbx-diff-zero';
  };

  window.cbxSaveCloseShift = function () {
    const actual = document.getElementById('cbx-close-actual').value;
    const note = document.getElementById('cbx-close-note').value;
    if (actual === '' || isNaN(parseFloat(actual)) || parseFloat(actual) < 0) {
      _toast('أدخل المبلغ الفعلي المعدود / Enter the actual counted amount', 'error'); return;
    }
    const shift = DakaniCashbox.Shifts.current();
    if (!shift) return;
    const expectedBefore = DakaniCashbox.Shifts.expectedBalance(shift);
    if (!confirm(
      `⚠️ تأكيد إغلاق المناوبة\n\nالمتوقع: ${_fmt(expectedBefore)} ${_cur()}\nالفعلي: ${_fmt(actual)} ${_cur()}\nالفرق: ${_fmt(actual - expectedBefore)} ${_cur()}\n\nمتابعة؟`
    )) return;
    DakaniCashbox.Shifts.close(actual, note);
    closeModal('modal-cbx-close-shift');
    _toast('تم إغلاق المناوبة / Shift closed', 'success');
    renderCashbox();
  };

  window.cbxOpenMoveModal = function (type) {
    const shift = DakaniCashbox.Shifts.current();
    if (!shift) { _toast('لا توجد مناوبة مفتوحة / No open shift', 'error'); return; }
    _cbxMoveType = type === 'withdraw' ? 'withdraw' : 'deposit';
    document.getElementById('cbx-move-title').innerHTML = _cbxMoveType === 'deposit'
      ? '<i class="fas fa-arrow-down"></i> إيداع في الصندوق / Deposit'
      : '<i class="fas fa-arrow-up"></i> سحب من الصندوق / Withdraw';
    document.getElementById('cbx-move-amount').value = '';
    document.getElementById('cbx-move-note').value = '';
    openModal('modal-cbx-move');
  };

  window.cbxSaveMove = function () {
    const shift = DakaniCashbox.Shifts.current();
    if (!shift) { closeModal('modal-cbx-move'); return; }
    const amount = document.getElementById('cbx-move-amount').value;
    const note = document.getElementById('cbx-move-note').value;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      _toast('أدخل مبلغاً صحيحاً / Enter a valid amount', 'error'); return;
    }
    DakaniCashbox.Moves.add({ shiftId: shift.id, type: _cbxMoveType, amount, note });
    closeModal('modal-cbx-move');
    _toast(_cbxMoveType === 'deposit' ? 'تم تسجيل الإيداع / Deposit recorded' : 'تم تسجيل السحب / Withdrawal recorded', 'success');
    renderCashbox();
  };

  window.cbxDeleteMove = function (id) {
    if (!confirm('حذف هذه الحركة؟ / Delete this movement?')) return;
    DakaniCashbox.Moves.delete(id);
    _toast('تم الحذف / Deleted', 'success');
    renderCashbox();
  };

  // ══════════════════════════ تبويب المصاريف ══════════════════════════
  function _renderExpensesTab() {
    const holder = document.getElementById('cbx-tab-content');
    if (!holder) return;
    const cur = _cur();

    let list = DakaniCashbox.Expenses.all();
    if (_cbxExpFilterCat) list = list.filter(e => e.category === _cbxExpFilterCat);
    if (_cbxExpFilterFrom) list = list.filter(e => (e.date || '') >= _cbxExpFilterFrom);
    if (_cbxExpFilterTo) list = list.filter(e => (e.date || '') <= _cbxExpFilterTo + 'T23:59:59');
    const totals = DakaniCashbox.Expenses.totals(list);

    holder.innerHTML = `
      <div class="page-header" style="margin-bottom:14px;">
        <div></div>
        <button class="btn-primary" onclick="cbxOpenExpenseModal()"><i class="fas fa-plus"></i> إضافة مصروف</button>
      </div>
      <div class="filter-bar">
        <select id="cbx-exp-filter-cat" onchange="cbxFilterExpenses()">
          <option value="">كل الأنواع / All Categories</option>
          ${DakaniCashbox.EXPENSE_CATEGORIES.map(c => `<option value="${c.id}" ${_cbxExpFilterCat === c.id ? 'selected' : ''}>${c.label}</option>`).join('')}
        </select>
        <input type="date" id="cbx-exp-filter-from" value="${_cbxExpFilterFrom}" onchange="cbxFilterExpenses()"/>
        <input type="date" id="cbx-exp-filter-to" value="${_cbxExpFilterTo}" onchange="cbxFilterExpenses()"/>
        <button class="btn-secondary" onclick="cbxFilterExpenses()"><i class="fas fa-filter"></i> تصفية</button>
      </div>
      <div class="kpi-grid" style="margin:16px 0 20px">
        ${DakaniCashbox.EXPENSE_CATEGORIES.map(c => `
          <div class="kpi-card kpi-low">
            <div class="kpi-icon"><i class="fas fa-file-invoice-dollar"></i></div>
            <div class="kpi-info"><div class="kpi-value">${_fmt(totals[c.id])} ${cur}</div><div class="kpi-label">${c.label}</div></div>
          </div>`).join('')}
        <div class="kpi-card kpi-profit">
          <div class="kpi-icon"><i class="fas fa-coins"></i></div>
          <div class="kpi-info"><div class="kpi-value">${_fmt(totals.all)} ${cur}</div><div class="kpi-label">الإجمالي</div></div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th>من الصندوق؟</th><th>إجراءات</th></tr></thead>
          <tbody>${
            list.length ? list.map(e => `<tr>
              <td>${_fmtDate(e.date)}</td>
              <td>${DakaniCashbox.categoryLabel(e.category)}</td>
              <td>${_fmt(e.amount)} ${cur}</td>
              <td>${esc(e.note) || '—'}</td>
              <td>${e.paidFromRegister ? '<span class="badge badge-ok">نعم</span>' : '<span class="badge">لا</span>'}</td>
              <td><button class="btn-icon danger" onclick="cbxDeleteExpense('${e.id}')" title="حذف"><i class="fas fa-trash"></i></button></td>
            </tr>`).join('') : '<tr><td colspan="6" class="empty-td">لا توجد مصاريف / No expenses</td></tr>'
          }</tbody>
        </table>
      </div>`;
  }

  window.cbxFilterExpenses = function () {
    _cbxExpFilterCat = document.getElementById('cbx-exp-filter-cat').value;
    _cbxExpFilterFrom = document.getElementById('cbx-exp-filter-from').value;
    _cbxExpFilterTo = document.getElementById('cbx-exp-filter-to').value;
    _renderExpensesTab();
  };

  window.cbxOpenExpenseModal = function () {
    document.getElementById('cbx-exp-cat').value = 'general';
    document.getElementById('cbx-exp-amount').value = '';
    document.getElementById('cbx-exp-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cbx-exp-note').value = '';
    const chk = document.getElementById('cbx-exp-from-register');
    const hasShift = !!DakaniCashbox.Shifts.current();
    chk.checked = false;
    chk.disabled = !hasShift;
    openModal('modal-cbx-expense');
  };

  window.cbxSaveExpense = function () {
    const category = document.getElementById('cbx-exp-cat').value;
    const amount = document.getElementById('cbx-exp-amount').value;
    const date = document.getElementById('cbx-exp-date').value;
    const note = document.getElementById('cbx-exp-note').value;
    const paidFromRegister = document.getElementById('cbx-exp-from-register').checked;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      _toast('أدخل مبلغاً صحيحاً / Enter a valid amount', 'error'); return;
    }
    DakaniCashbox.Expenses.add({ category, amount, note, paidFromRegister, date: date ? new Date(date).toISOString() : null });
    closeModal('modal-cbx-expense');
    _toast('تم حفظ المصروف / Expense saved', 'success');
    if (typeof checkAlerts === 'function') { /* لا تغيير على التنبيهات، فقط إعادة رسم آمنة */ }
    renderCashbox();
  };

  window.cbxDeleteExpense = function (id) {
    if (!confirm('حذف هذا المصروف؟ / Delete this expense?')) return;
    DakaniCashbox.Expenses.delete(id);
    _toast('تم الحذف / Deleted', 'success');
    renderCashbox();
  };

  // ══════════════════════════ تبويب رأس المال ══════════════════════════
  function _renderCapitalTab() {
    const holder = document.getElementById('cbx-tab-content');
    if (!holder) return;
    const cur = _cur();
    const list = DakaniCashbox.Capital.all();
    const totals = DakaniCashbox.Capital.totals();
    const balance = DakaniCashbox.Capital.balance();

    holder.innerHTML = `
      <div class="page-header" style="margin-bottom:14px;">
        <div></div>
        <button class="btn-primary" onclick="cbxOpenCapitalModal()"><i class="fas fa-plus"></i> إضافة حركة رأس مال</button>
      </div>
      <div class="kpi-grid" style="margin-bottom:20px">
        <div class="kpi-card kpi-profit">
          <div class="kpi-icon"><i class="fas fa-sack-dollar"></i></div>
          <div class="kpi-info"><div class="kpi-value">${_fmt(balance)} ${cur}</div><div class="kpi-label">الرصيد الحالي لرأس المال</div></div>
        </div>
        <div class="kpi-card kpi-sales">
          <div class="kpi-icon"><i class="fas fa-arrow-down"></i></div>
          <div class="kpi-info"><div class="kpi-value">${_fmt(totals.in)} ${cur}</div><div class="kpi-label">إجمالي الإضافات</div></div>
        </div>
        <div class="kpi-card kpi-low">
          <div class="kpi-icon"><i class="fas fa-arrow-up"></i></div>
          <div class="kpi-info"><div class="kpi-value">${_fmt(totals.out)} ${cur}</div><div class="kpi-label">إجمالي السحوبات</div></div>
        </div>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>ملاحظة</th><th>إجراءات</th></tr></thead>
          <tbody>${
            list.length ? list.map(c => `<tr>
              <td>${_fmtDate(c.date)}</td>
              <td><span class="badge ${c.type === 'in' ? 'badge-ok' : 'badge-low'}">${c.type === 'in' ? 'إضافة' : 'سحب'}</span></td>
              <td>${c.type === 'in' ? '+' : '-'}${_fmt(c.amount)} ${cur}</td>
              <td>${esc(c.note) || '—'}</td>
              <td><button class="btn-icon danger" onclick="cbxDeleteCapital('${c.id}')" title="حذف"><i class="fas fa-trash"></i></button></td>
            </tr>`).join('') : '<tr><td colspan="5" class="empty-td">لا توجد حركات رأس مال / No capital transactions</td></tr>'
          }</tbody>
        </table>
      </div>`;
  }

  window.cbxOpenCapitalModal = function () {
    document.getElementById('cbx-cap-type').value = 'in';
    document.getElementById('cbx-cap-amount').value = '';
    document.getElementById('cbx-cap-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('cbx-cap-note').value = '';
    openModal('modal-cbx-capital');
  };

  window.cbxSaveCapital = function () {
    const type = document.getElementById('cbx-cap-type').value;
    const amount = document.getElementById('cbx-cap-amount').value;
    const date = document.getElementById('cbx-cap-date').value;
    const note = document.getElementById('cbx-cap-note').value;
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      _toast('أدخل مبلغاً صحيحاً / Enter a valid amount', 'error'); return;
    }
    DakaniCashbox.Capital.add({ type, amount, note, date: date ? new Date(date).toISOString() : null });
    closeModal('modal-cbx-capital');
    _toast('تم الحفظ / Saved', 'success');
    renderCashbox();
  };

  window.cbxDeleteCapital = function (id) {
    if (!confirm('حذف هذه الحركة؟ / Delete this transaction?')) return;
    DakaniCashbox.Capital.delete(id);
    _toast('تم الحذف / Deleted', 'success');
    renderCashbox();
  };

})();