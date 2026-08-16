/**
 * DAKANI KEYBOARD SHORTCUTS
 * ─────────────────────────────────────────────────────────────
 * اختصارات لوحة مفاتيح لتسريع العمل داخل نظام دكاني — تعمل بالكامل
 * دون اتصال بالإنترنت ولا تعتمد على أي مكتبة خارجية.
 *
 * ⚠️ ملف مستقل تماماً (نفس مبدأ camera-scanner.js و license.js):
 *    لا يعدّل أي دالة أو ملف موجود، فقط يستدعي الدوال العامة الجاهزة
 *    (navigateTo, openModal, checkout, handleUndo...) — هذا يقلّل تماماً
 *    احتمال تعارضه مع أي شيء موجود حالياً في script.js.
 *
 * أهم قاعدة أمان: كل الاختصارات هنا تستخدم مفتاح تعديل (Ctrl/Alt) أو
 * مفتاح Escape فقط. لا يوجد أي اختصار بحرف واحد بدون Ctrl/Alt، لأن أي
 * ضغطة حرف بدون تعديل تُلتقط أصلاً كجزء من "قارئ الباركود الوهمي"
 * (buffer) في script.js — استخدامها هنا كان سيكسر ميزة مسح الباركود.
 *
 * الاختصارات المتاحة:
 *   Ctrl/Cmd + K      → التركيز على البحث السريع العلوي
 *   Ctrl/Cmd + /       → إظهار/إخفاء نافذة الاختصارات هذه
 *   Ctrl/Cmd + Z       → تراجع عن آخر عملية (فقط خارج حقول الإدخال)
 *   Ctrl/Cmd + Enter   → إتمام البيع (داخل صفحة نقطة البيع فقط)
 *   Esc                → إغلاق أي نافذة منبثقة مفتوحة حالياً
 *   Alt + 1..9, 0      → تنقّل سريع بين الصفحات
 *   Alt + F            → التركيز على مربع البحث/الفلترة في الصفحة الحالية
 *   Alt + N            → إجراء "إضافة جديد" الخاص بالصفحة الحالية (إن وُجد)
 */
(function () {

  // ─── مطابقة الصفحات بالأرقام (بنفس ترتيب الشريط الجانبي) ──────────────────
  const NAV_MAP = {
    '1': 'dashboard', '2': 'products', '3': 'sell', '4': 'purchases',
    '5': 'suppliers', '6': 'customers', '7': 'invoices', '8': 'returns',
    '9': 'inventory', '0': 'reports'
  };

  // مربع البحث/الفلترة الرئيسي لكل صفحة (Alt+F)
  const SEARCH_MAP = {
    products: 'prod-search', sell: 'pos-search', suppliers: 'supp-search',
    customers: 'cust-search', inventory: 'inv-search',
    invoices: 'inv-barcode-search', returns: 'ret-search'
  };

  // إجراء "إضافة جديد" الخاص بكل صفحة (Alt+N) — تُستدعى دوال عامة موجودة أصلاً
  const ADD_MAP = {
    products:  () => openModal('modal-product'),
    customers: () => openAddCustomerModal(),
    purchases: () => openModal('modal-purchase'),
    suppliers: () => openSupplierModal(),
    returns:   () => openReturnModal()
  };

  const SHORTCUTS_LIST = [
    ['Ctrl / Cmd + K', 'التركيز على البحث السريع العلوي / Focus quick search'],
    ['Ctrl / Cmd + /', 'إظهار أو إخفاء هذه القائمة / Toggle this list'],
    ['Ctrl / Cmd + Z', 'تراجع عن آخر عملية / Undo last operation'],
    ['Ctrl / Cmd + Enter', 'إتمام البيع في نقطة البيع / Checkout on POS'],
    ['Esc', 'إغلاق أي نافذة مفتوحة / Close open modal'],
    ['Alt + 1 … 9 , 0', 'تنقّل سريع بين الصفحات / Quick page navigation'],
    ['Alt + F', 'التركيز على البحث في الصفحة الحالية / Focus page search'],
    ['Alt + N', 'إضافة جديد في الصفحة الحالية / Add new (current page)']
  ];

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function currentPage() {
    const active = document.querySelector('.page.active');
    return active ? active.id.replace('page-', '') : '';
  }

  // يغلق أي نافذة منبثقة (.modal-overlay) مفتوحة حالياً عبر closeModal الأصلية
  function closeAnyOpenModal() {
    const openModals = document.querySelectorAll('.modal-overlay.active');
    if (!openModals.length) return false;
    openModals.forEach(m => {
      if (typeof closeModal === 'function') closeModal(m.id);
      else m.classList.remove('active');
    });
    return true;
  }

  function focusPageSearch() {
    const id = SEARCH_MAP[currentPage()];
    const el = id && document.getElementById(id);
    if (el) { el.focus(); if (el.select) el.select(); }
  }

  function contextualAdd() {
    const fn = ADD_MAP[currentPage()];
    if (typeof fn === 'function') fn();
    else if (typeof toast === 'function') {
      toast('لا يوجد إجراء إضافة سريع لهذه الصفحة / No quick-add here', 'info');
    }
  }

  // ─── نافذة عرض قائمة الاختصارات (مبنية بالكامل هنا، لا تلمس index.html) ────
  function ensureHelpOverlay() {
    let overlay = document.getElementById('kbd-shortcuts-overlay');
    if (overlay) return overlay;

    const style = document.createElement('style');
    style.textContent = `
      #kbd-shortcuts-overlay {
        position: fixed; inset: 0; z-index: 99998;
        background: rgba(0,0,0,.55);
        display: none; align-items: center; justify-content: center;
        font-family: 'Cairo', sans-serif;
      }
      #kbd-shortcuts-overlay.active { display: flex; }
      .kbd-box {
        background: var(--surface, #111827); color: var(--text, #e2e8f0);
        border: 1px solid var(--border, #1e293b); border-radius: var(--radius, 12px);
        width: 100%; max-width: 460px; max-height: 80vh; overflow-y: auto;
        padding: 24px 26px; box-shadow: var(--shadow-lg, 0 8px 40px rgba(0,0,0,.6));
      }
      .kbd-box h3 { margin: 0 0 16px; font-size: 17px; display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .kbd-box h3 button {
        background: none; border: none; color: var(--text2, #94a3b8);
        font-size: 18px; cursor: pointer; line-height:1;
      }
      .kbd-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 0; border-bottom: 1px solid var(--border, #1e293b); font-size: 13px; }
      .kbd-row:last-child { border-bottom: none; }
      .kbd-key { background: var(--surface3, #1e2d3d); border: 1px solid var(--border2, #253347); border-radius: 6px; padding: 3px 8px; font-family: monospace; font-size: 12px; white-space: nowrap; color: var(--accent, #10b981); }
      .kbd-desc { color: var(--text2, #94a3b8); text-align: right; }
    `;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.id = 'kbd-shortcuts-overlay';
    overlay.innerHTML = `
      <div class="kbd-box">
        <h3>
          <button type="button" aria-label="إغلاق" onclick="window.DakaniShortcuts.hideHelp()"><i class="fas fa-xmark"></i></button>
          <span><i class="fas fa-keyboard"></i> اختصارات لوحة المفاتيح / Keyboard Shortcuts</span>
        </h3>
        ${SHORTCUTS_LIST.map(([key, desc]) =>
          `<div class="kbd-row"><span class="kbd-key">${key}</span><span class="kbd-desc">${desc}</span></div>`
        ).join('')}
      </div>`;
    overlay.addEventListener('click', e => { if (e.target === overlay) hideHelp(); });
    document.body.appendChild(overlay);
    return overlay;
  }

  function showHelp() { ensureHelpOverlay().classList.add('active'); }
  function hideHelp() { document.getElementById('kbd-shortcuts-overlay')?.classList.remove('active'); }
  function toggleHelp() {
    const overlay = ensureHelpOverlay();
    overlay.classList.contains('active') ? hideHelp() : showHelp();
  }

  // إتاحة تحكم بسيط من الخارج عند الحاجة (مثلاً زر مساعدة مستقبلي)
  window.DakaniShortcuts = { showHelp, hideHelp, toggleHelp };

  document.addEventListener('keydown', e => {
    // ─── Esc: أولوية قصوى — إغلاق أي نافذة مفتوحة، بما فيها قائمة الاختصارات ──
    if (e.key === 'Escape') {
      if (document.getElementById('kbd-shortcuts-overlay')?.classList.contains('active')) {
        hideHelp();
        return;
      }
      closeAnyOpenModal();
      return; // لا داعي لأي معالجة إضافية
    }

    const mod = e.ctrlKey || e.metaKey;

    // ─── Ctrl/Cmd + K → التركيز على البحث السريع ─────────────────────────────
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      const gs = document.getElementById('global-search');
      if (gs) { e.preventDefault(); gs.focus(); gs.select(); }
      return;
    }

    // ─── Ctrl/Cmd + / → إظهار/إخفاء قائمة الاختصارات ─────────────────────────
    if (mod && e.key === '/') {
      e.preventDefault();
      toggleHelp();
      return;
    }

    // ─── Ctrl/Cmd + Z → تراجع (فقط إن لم يكن المستخدم يكتب داخل حقل) ─────────
    // هذا الشرط مهم جداً: نترك Ctrl+Z يعمل بشكل طبيعي (تراجع عن الكتابة) داخل
    // أي حقل نصي، ولا نستولي عليه إلا خارج الحقول لتفعيل تراجع دكاني نفسه.
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (isEditableTarget(document.activeElement)) return;
      if (typeof handleUndo === 'function') { e.preventDefault(); handleUndo(); }
      return;
    }

    // ─── Ctrl/Cmd + Enter → إتمام البيع (داخل صفحة نقطة البيع فقط) ───────────
    if (mod && e.key === 'Enter') {
      if (currentPage() === 'sell' && typeof checkout === 'function') {
        e.preventDefault();
        checkout();
      }
      return;
    }

    // ─── Alt + [1-9,0] → تنقّل سريع بين الصفحات ──────────────────────────────
    if (e.altKey && !mod && NAV_MAP[e.key]) {
      e.preventDefault();
      if (typeof navigateTo === 'function') navigateTo(NAV_MAP[e.key]);
      return;
    }

    // ─── Alt + F → التركيز على بحث الصفحة الحالية ────────────────────────────
    if (e.altKey && !mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      focusPageSearch();
      return;
    }

    // ─── Alt + N → إضافة جديد حسب الصفحة الحالية ─────────────────────────────
    if (e.altKey && !mod && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      contextualAdd();
      return;
    }
  });

})();