/**
 * DAKANI – Main Application Script
 */

// ─── State ───────────────────────────────────────────────────────────────────
let cart = [];
let selectedPayment = 'cash';
let chartWeekly = null, chartProfit = null, chartReport = null;
let _prodImageData = '';   // الصورة الحالية داخل نافذة إضافة/تعديل منتج (base64)
let _variantRowSeq  = 0;   // معرّف تسلسلي مؤقت لصفوف المتغيّرات الجديدة في الواجهة
let _vpProductId    = null; // المنتج المعروض حالياً في نافذة اختيار المتغيّر (POS)

// ─── حارس دور المستخدم (الربح/سعر التكلفة) ───────────────────────────────────
// ⚠️ هذا الملف مستقل تماماً عن accounts.js (نفس مبدأ باقي ملفات دكاني)، لذلك:
//   - إن لم يكن DakaniAccounts معرّفاً إطلاقاً → الدور الافتراضي "مدير" (لا كسر).
//   - إن كان معرّفاً لكن استدعاء getRole() فشل لأي سبب → نفترض "مدير" أيضاً،
//     احتياطاً حتى لا يتسبّب خطأ غير متوقّع بإخفاء بيانات عن المدير نفسه.
// الهدف: منع كتابة رقم الربح/سعر التكلفة الحقيقي داخل الـ HTML من الأساس عندما
// يكون الدور "كاشير" — بدل الاعتماد فقط على display:none (الذي لا يمنع تسرّب
// الرقم عبر حفظ الصفحة كـ HTML أو عبر إضافات المتصفح التي تقرأ الـ DOM كاملاً).
function _isCashierRole() {
  try {
    return typeof DakaniAccounts !== 'undefined'
      && typeof DakaniAccounts.getRole === 'function'
      && DakaniAccounts.getRole() === 'cashier';
  } catch (e) {
    return false;
  }
}
// يُستخدم في كل قالب HTML يحتوي رقم ربح/سعر تكلفة: يعيد النص الجاهز نفسه
// للمدير، أو "—" فقط للكاشير دون أن يمرّ الرقم الحقيقي بالـ HTML إطلاقاً.
function _hideIfCashier(renderedText) {
  return _isCashierRole() ? '—' : renderedText;
}

// ─── إعادة رسم كل الصفحات الحساسة عند تبديل الحساب/الدور ─────────────────────
// ⚠️ ضروري جداً: accounts.js يبدّل الدور بتبديل كلاس CSS على body فقط، دون أي
// إعادة تحميل للصفحة (لا location.reload). فإن كان المستخدم قد دخل كمدير ورأى
// صفحة تحتوي أرقام ربح/تكلفة حقيقية (لوحة تحكم، منتجات، فواتير...) ثم بدّل إلى
// حساب كاشير في نفس التبويب دون تحديث المتصفح، تبقى تلك الأرقام القديمة فعلياً
// موجودة في الـ DOM (فقط مخفية بصرياً بـ CSS)، رغم أن كل الفحوصات أعلاه تمنع
// كتابة أرقام حقيقية جديدة من الآن فصاعداً. الحل: إعادة بناء محتوى كل صفحة
// حساسة فوراً بعد كل تسجيل دخول أو تبديل حساب، بغضّ النظر عن كون هذه الصفحة
// هي الصفحة المفتوحة حالياً أم لا — حتى لا يبقى أي رقم قديم خلف الكواليس.
//
// يُستدعى هذا من accounts.js (عبر window.dakaniRefreshSensitivePages) داخل
// _applyRoleUI، أي مباشرة بعد كل دخول/تبديل حساب وأيضاً عند إقلاع التطبيق إن
// كانت هناك جلسة محفوظة مسبقاً.
function _dakaniRefreshSensitivePages() {
  try {
    // صفحات متاحة للكاشير وتحتوي فحوصات دور مفصّلة لكل رقم حساس — نعيد
    // بناءها فعلياً بالدور الجديد (تُظهر الأرقام الصحيحة حسب الدور تلقائياً)
    if (typeof loadDashboard   === 'function') loadDashboard();
    if (typeof renderProducts  === 'function') renderProducts();
    if (typeof renderInvoices  === 'function') renderInvoices();
    if (typeof renderReturns   === 'function') renderReturns();
    if (typeof renderCustomers === 'function') renderCustomers();

    // صفحات مخصّصة للمدير فقط (غير متاحة للكاشير عبر التنقّل العادي) ومحتواها
    // بالكامل تقريباً بيانات تكلفة/إنفاق غير مُفحوصة رقماً برقم. إعادة استدعاء
    // دوال رسمها هنا كانت ستكتب نفس الأرقام الحقيقية من جديد بلا فائدة، لذا
    // نكتفي بإفراغ حاوياتها — ستُعاد بناؤها بشكل طبيعي وآمن إن زارها المدير لاحقاً
    ['purchases-body', 'purch-summary-bar',
     'inv-summary', 'inv-log-wrap',
     'suppliers-body', 'supp-kpi-grid', 'supp-summary-bar', 'supp-report-body',
     'report-kpis', 'report-top-products', 'report-payment-methods', 'report-categories',
     'report-top-customers', 'report-returns-purchases', 'report-sales-body',
     'report-dead-stock-summary', 'report-dead-stock']
      .forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = ''; });
    if (chartReport) { chartReport.destroy(); chartReport = null; }
  } catch (e) {
    // لا نكسر عملية تسجيل الدخول/تبديل الحساب إن فشل تحديث صفحة معيّنة لأي سبب
  }
}
window.dakaniRefreshSensitivePages = _dakaniRefreshSensitivePages;

// ─── License Gate ─────────────────────────────────────────────────────────────
// فحص دوري كل 60 ثانية — يكشف انتهاء الصلاحية أثناء الاستخدام
setInterval(() => {
  if (!DakaniLicense.info()) DakaniLicense.gate();
}, 60000);

// ─── دالة تشغيل التطبيق ──────────────────────────────────────────────────────
function _bootApp() {
  updateTopbarDate();
  setInterval(updateTopbarDate, 60000);
  // إن كان الدور "كاشير" محفوظاً مسبقاً في هذه الجلسة، لا تفتح لوحة التحكم
  // إطلاقاً عند الإقلاع (تحتوي أرقام ربح حقيقية) — افتح نقطة البيع مباشرة،
  // بنفس منطق التوجيه المستخدم في accounts.js بعد تسجيل الدخول.
  navigateTo(_isCashierRole() ? 'sell' : 'dashboard');
  setupPaymentButtons();
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.page); })
  );
  checkAlerts();
  syncThemeIcon();
  updateUndoButton();
  if (typeof renderLangPicker === 'function') renderLangPicker();
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // 1. فحص الترخيص أولاً — إذا لم يكن صالحاً يُوقف كل شيء
  if (!DakaniLicense.gate()) {
    // عند إدخال مفتاح صحيح لاحقاً يُشغّل التطبيق
    window.addEventListener('dakani-licensed', _bootApp, { once: true });
    return;
  }
  // 2. الترخيص صالح — شغّل التطبيق مباشرة
  _bootApp();
});

function updateTopbarDate() {
  const now = new Date();
  const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
  const el = document.getElementById('topbar-date');
  if (el) el.textContent = now.toLocaleDateString('ar-DZ', opts);
  const d = document.getElementById('dash-date');
  if (d) d.textContent = now.toLocaleDateString('ar-DZ', opts);
}

// ─── الوضع الليلي / النهاري ───────────────────────────────────────────────────
const THEME_KEY = 'dakani_theme';

function toggleTheme() {
  const isLight = document.documentElement.classList.toggle('light-mode');
  try { localStorage.setItem(THEME_KEY, isLight ? 'light' : 'dark'); } catch (e) {}
  syncThemeIcon();
}

function syncThemeIcon() {
  const isLight = document.documentElement.classList.contains('light-mode');
  const icon = document.getElementById('theme-toggle-icon');
  if (icon) icon.className = isLight ? 'fas fa-moon' : 'fas fa-sun';
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.title = isLight ? 'التبديل للوضع الليلي / Switch to dark mode' : 'التبديل للوضع النهاري / Switch to light mode';
}

// ─── Navigation ──────────────────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: 'لوحة التحكم / Dashboard',
  products:  'المنتجات / Products',
  sell:      'نقطة البيع / Point of Sale',
  purchases: 'المشتريات / Purchases',
  suppliers: 'الموردون / Suppliers',
  customers: 'الزبائن / Customers',
  invoices:  'الفواتير / Invoices',
  returns:   'المرتجعات / Returns & Refunds',
  inventory: 'تسوية المخزون / Inventory',
  cashbox:   'المصاريف والصندوق / Expenses & Cash Register',
  reports:   'التقارير / Reports',
  settings:  'الإعدادات / Settings'
};

function navigateTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  const navEl  = document.querySelector(`[data-page="${page}"]`);
  if (pageEl) pageEl.classList.add('active');
  if (navEl)  navEl.classList.add('active');
  document.getElementById('topbar-title').textContent = PAGE_TITLES[page] || '';
  const handlers = {
    dashboard: loadDashboard, products: renderProducts, sell: loadPOS,
    purchases: renderPurchases, suppliers: renderSuppliers, customers: renderCustomers,
    invoices: renderInvoices, returns: renderReturns, reports: initReports,
    settings: loadSettings, inventory: renderInventory,
    cashbox: (typeof renderCashbox === 'function' ? renderCashbox : null)
  };
  if (handlers[page]) handlers[page]();
  if (window.innerWidth < 900) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── زر التراجع عن آخر عملية (Undo) ────────────────────────────────────────
// يعمل على أي عملية من: بيع، مرتجع، شراء، تسوية مخزون — يتراجع فقط عن آخر
// عملية تم تسجيلها بغض النظر عن نوعها.

function updateUndoButton() {
  const btn = document.getElementById('undo-btn');
  if (!btn) return;
  const op = DB.UndoManager.peek();
  if (op) {
    btn.disabled = false;
    btn.classList.add('has-undo');
    const title = `تراجع عن: ${op.label} / Undo: ${op.label}`;
    btn.title = title;
    btn.setAttribute('data-i18n-title', title);
  } else {
    btn.disabled = true;
    btn.classList.remove('has-undo');
    const title = 'لا توجد عملية للتراجع عنها / Nothing to undo';
    btn.title = title;
    btn.setAttribute('data-i18n-title', title);
  }
}

function handleUndo() {
  const op = DB.UndoManager.peek();
  if (!op) { toast('لا توجد عملية للتراجع عنها / Nothing to undo', 'info'); return; }
  if (!confirm(
    `⚠️ التراجع عن آخر عملية\n\n${op.label}\n\n` +
    `سيتم عكس أثر هذه العملية على المخزون والحسابات المرتبطة بها. متابعة؟`
  )) return;

  const result = DB.UndoManager.undoLast();
  if (!result.ok) { toast(result.reason || 'تعذّر التراجع / Cannot undo', 'error'); return; }

  toast(`↩️ تم التراجع عن: ${op.label}`, 'success');

  // إعادة رسم الصفحة الحالية لتعكس التغييرات (المخزون/الحسابات) + التنبيهات
  const activeEl = document.querySelector('.page.active');
  const page = activeEl ? activeEl.id.replace('page-', '') : '';
  if (page) navigateTo(page);
  checkAlerts();
  updateUndoButton();
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function loadDashboard() {
  const todaySales   = DB.Sales.today();
  const todayTotal   = todaySales.reduce((a, s) => a + s.total, 0);
  // ─── الربح الصافي اليوم = ربح المبيعات النقدية اليوم + ربح الديون التي
  // سُدِّدت اليوم (بغضّ النظر عن تاريخ فاتورتها الأصلية) — أما الجزء الآجل من
  // مبيعات اليوم فيبقى "معلَّقاً" حتى يُسدَّد ولا يُحتسب كربح بعد ───────────
  const todayDebtProfit = (DB.DebtPayments.all() || [])
    .filter(p => p.date && p.date.startsWith(DB.today()))
    .reduce((a, p) => a + (p.profit || 0), 0);
  const todayProfit  = todaySales.reduce((a, s) => a + DB.Sales.netProfit(s), 0) + todayDebtProfit;
  const products     = DB.Products.all();
  const customers    = DB.Customers.all();
  const low          = DB.Products.lowStock();
  const S            = DB.Settings.get();
  const cur          = S.currency || 'دج';

  const expired      = DB.Products.expired();
  const expiringSoon = DB.Products.expiringSoon();

  setText('kpi-sales',     fmt(todayTotal) + ' ' + cur);
  setText('kpi-profit',    _hideIfCashier(fmt(todayProfit) + ' ' + cur));
  setText('kpi-products',  products.length);
  setText('kpi-customers', customers.length);
  setText('kpi-low',       low.length);
  setText('kpi-invoices',  todaySales.length);
  setText('kpi-expiry',    expiringSoon.length);
  setText('kpi-expired',   expired.length);

  // Weekly chart
  const weekly = DB.Sales.weeklySales();
  buildWeeklyChart(weekly, cur);
  buildProfitChart(weekly, cur);

  // Top products
  const top = DB.Sales.topProducts(5);
  const tpEl = document.getElementById('top-products-list');
  if (tpEl) {
    if (!top.length) { tpEl.innerHTML = '<div class="empty-state">لا توجد مبيعات بعد / No sales yet</div>'; }
    else tpEl.innerHTML = top.map((p, i) =>
      `<div class="top-prod-row">
        <span class="top-rank">${i+1}</span>
        <span class="top-name">${escHtml(p.nameAr)}</span>
        <span class="top-qty">${p.qty} وحدة</span>
        <span class="top-rev">${fmt(p.revenue)} ${cur}</span>
      </div>`).join('');
  }

  // Stock alerts
  const saEl = document.getElementById('stock-alerts-list');
  if (saEl) {
    if (!low.length) { saEl.innerHTML = '<div class="empty-state good"><i class="fas fa-check-circle"></i> كل المخزون جيد / All stock OK</div>'; }
    else saEl.innerHTML = low.map(p =>
      `<div class="alert-row ${p.stock === 0 ? 'alert-out' : 'alert-low'}">
        <i class="fas fa-${p.stock === 0 ? 'ban' : 'triangle-exclamation'}"></i>
        <span>${escHtml(p.nameAr)}</span>
        <span class="alert-stock">${p.stock} ${p.unit || ''}</span>
      </div>`).join('');
  }

  // Expiry alerts
  const eaEl = document.getElementById('expiry-alerts-list');
  if (eaEl) {
    const expiryRows = [...expired, ...expiringSoon];
    if (!expiryRows.length) {
      eaEl.innerHTML = '<div class="empty-state good"><i class="fas fa-check-circle"></i> لا توجد منتجات قريبة من الانتهاء / No expiry alerts</div>';
    } else {
      eaEl.innerHTML = expiryRows.map(p => {
        const info = expiryInfo(p);
        const isExpired = info.status === 'expired';
        return `<div class="alert-row ${isExpired ? 'alert-out' : 'alert-low'}">
          <i class="fas fa-${isExpired ? 'skull-crossbones' : 'hourglass-half'}"></i>
          <span>${escHtml(p.nameAr)}</span>
          <span class="alert-stock">${fmtDateOnly(p.expiryDate)} — ${info.label}</span>
          ${isExpired ? `<button class="btn-icon danger" title="تسوية الآن / Write off now" onclick="writeOffExpired('${p.id}')"><i class="fas fa-boxes-stacked"></i></button>` : ''}
        </div>`;
      }).join('');
    }
  }

  // Recent sales
  const recent = DB.Sales.all().slice(-10).reverse();
  const tbody = document.getElementById('recent-sales-body');
  if (tbody) {
    tbody.innerHTML = recent.length ? recent.map((s, i) =>
      `<tr>
        <td>${s.invoiceNo}</td>
        <td>${escHtml(s.items.map(it => it.nameAr).join(', ').slice(0,40))}</td>
        <td>${escHtml(s.customerName)}</td>
        <td>${s.items.reduce((a, it) => a + it.qty, 0)}</td>
        <td>${fmt(s.total)} ${cur}</td>
        <td class="profit-cell">${_hideIfCashier('+' + fmt(DB.Sales.netProfit(s)) + ' ' + cur)}</td>
        <td>${fmtDate(s.date)}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty-td">لا توجد مبيعات / No sales yet</td></tr>';
  }
}

function buildWeeklyChart(weekly, cur) {
  const ctx = document.getElementById('chart-weekly');
  if (!ctx) return;
  if (chartWeekly) chartWeekly.destroy();
  // ⚠️ هذا الرسم البياني مرئي بالكامل للكاشير (لا يُخفى بـ CSS مثل chart-profit)،
  // لذلك لا نبني مجموعة بيانات "الأرباح" إطلاقاً في وضع الكاشير — إخفاؤها بصرياً
  // فقط كان سيُبقي القيم داخل بيانات الرسم القابلة للقراءة.
  const datasets = [
    { label: 'مبيعات', data: weekly.map(d => d.total), backgroundColor: '#10b98133', borderColor: '#10b981', borderWidth: 2, borderRadius: 6 }
  ];
  if (!_isCashierRole()) {
    datasets.push({ label: 'أرباح', data: weekly.map(d => d.profit), backgroundColor: '#f59e0b33', borderColor: '#f59e0b', borderWidth: 2, borderRadius: 6 });
  }
  chartWeekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weekly.map(d => d.label),
      datasets: datasets
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } }, scales: {
      x: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } },
      y: { ticks: { color: '#94a3b8' }, grid: { color: '#1e293b' } }
    }}
  });
}

function buildProfitChart(weekly, cur) {
  const ctx = document.getElementById('chart-profit');
  if (!ctx) return;
  if (chartProfit) chartProfit.destroy();
  // هذا الرسم البياني بالكامل عن التكلفة/الربح — لا معنى لبنائه أصلاً للكاشير
  if (_isCashierRole()) { chartProfit = null; return; }
  const total  = weekly.reduce((a, d) => a + d.total, 0);
  const profit = weekly.reduce((a, d) => a + d.profit, 0);
  const cost   = Math.max(0, total - profit);
  chartProfit = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['تكلفة / Cost', 'ربح / Profit'],
      datasets: [{ data: [cost, profit], backgroundColor: ['#1e293b', '#10b981'], borderWidth: 0 }]
    },
    options: { responsive: true, plugins: { legend: { labels: { color: '#94a3b8' } } } }
  });
}

// ─── Products ─────────────────────────────────────────────────────────────────
function renderProducts() {
  const q    = (document.getElementById('prod-search')?.value || '').toLowerCase();
  const cat  = document.getElementById('prod-cat-filter')?.value || '';
  const stk  = document.getElementById('prod-stock-filter')?.value || '';
  const S    = DB.Settings.get();
  const cur  = S.currency || 'دج';
  const low  = S.lowStockThreshold || 5;
  let prods  = DB.Products.all();

  // Populate category filter
  const catSel = document.getElementById('prod-cat-filter');
  if (catSel && catSel.options.length <= 1) {
    DB.Categories.all().forEach(c => {
      const o = document.createElement('option'); o.value = c.name; o.textContent = c.name;
      catSel.appendChild(o);
    });
  }

  if (q) prods = prods.filter(p => p.nameAr.toLowerCase().includes(q) || (p.nameEn||'').toLowerCase().includes(q) || (p.barcode||'').includes(q));
  if (cat) prods = prods.filter(p => p.category === cat);
  if (stk === 'low') prods = prods.filter(p => { const s = DB.Products.totalStock(p); return s > 0 && s <= low; });
  else if (stk === 'ok') prods = prods.filter(p => DB.Products.totalStock(p) > low);
  else if (stk === 'out') prods = prods.filter(p => DB.Products.totalStock(p) === 0);

  const tbody = document.getElementById('products-body');
  if (!tbody) return;
  tbody.innerHTML = prods.length ? prods.map((p, i) => {
    const stock = DB.Products.totalStock(p);
    const stockStatus = stock === 0 ? 'badge-out' : stock <= low ? 'badge-low' : 'badge-ok';
    const stockLabel  = stock === 0 ? 'نفذ' : stock <= low ? 'منخفض' : 'متوفر';
    const exp = expiryInfo(p);
    const expCell = !p.expiryDate ? '<span style="color:#6b7280">—</span>'
      : `<span class="badge ${exp.badge}" title="${exp.label}">${fmtDateOnly(p.expiryDate)}</span>` +
        (exp.status === 'expired' ? ` <button class="btn-icon danger" title="تسوية الآن / Write off now" onclick="writeOffExpired('${p.id}')"><i class="fas fa-boxes-stacked"></i></button>` : '');
    const thumb = p.image
      ? `<span class="prod-table-thumb"><img src="${p.image}" alt=""/></span>`
      : `<span class="prod-table-thumb"><i class="fas fa-box"></i></span>`;
    const variantBadge = DB.Products.hasVariants(p)
      ? `<br/><span class="badge" style="background:rgba(59,130,246,.12);color:#3b82f6;margin-top:4px;">${p.variants.length} متغيّر / variants</span>`
      : '';
    return `<tr>
      <td>${i+1}</td>
      <td>${thumb}<strong>${escHtml(p.nameAr)}</strong>${p.nameEn ? `<br/><small>${escHtml(p.nameEn)}</small>` : ''}${variantBadge}</td>
      <td><code>${p.barcode || '—'}</code></td>
      <td>${p.category || '—'}</td>
      <td>${_hideIfCashier(fmt(p.buyPrice) + ' ' + cur)}</td>
      <td>${fmt(p.sellPrice)} ${cur}</td>
      <td><strong>${stock}</strong> ${p.unit || ''}</td>
      <td>${p.minStock || 5}</td>
      <td><span class="badge ${stockStatus}">${stockLabel}</span></td>
      <td>${expCell}</td>
      <td>
        <button class="btn-icon" onclick="viewPriceHistory('${p.id}')" title="سجل أسعار الشراء / Price History"><i class="fas fa-chart-line"></i></button>
        <button class="btn-icon edit" onclick="editProduct('${p.id}')"><i class="fas fa-pen"></i></button>
        <button class="btn-icon danger" onclick="deleteProduct('${p.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="11" class="empty-td">لا توجد منتجات / No products</td></tr>';
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
  if (id === 'modal-product') populateProductModal();
  if (id === 'modal-purchase') populatePurchaseModal();
  if (id === 'modal-held-sales') renderHeldSalesList();
}
function closeModal(id) {
  document.getElementById(id).classList.remove('active');
  if (id === 'modal-invoice') closeShareMenu();
}

// فتح نافذة إضافة زبون جديد بحقول فارغة وتصنيف "جديد"
function openAddCustomerModal() {
  document.getElementById('cust-modal-title').textContent = 'إضافة زبون / Add Customer';
  document.getElementById('cust-id').value      = '';
  document.getElementById('cust-name').value    = '';
  document.getElementById('cust-phone').value   = '';
  document.getElementById('cust-address').value = '';
  document.getElementById('cust-notes').value   = '';
  renderCustomerTierInfo(null);
  openModal('modal-customer');
}

function populateProductModal(prod) {
  const cats = DB.Categories.all();
  const sel  = document.getElementById('prod-cat');
  sel.innerHTML = cats.map(c => `<option value="${escHtml(c.name)}">${escHtml(c.name)}</option>`).join('');
  if (prod) {
    document.getElementById('prod-modal-title').textContent = 'تعديل منتج / Edit Product';
    document.getElementById('prod-id').value       = prod.id;
    document.getElementById('prod-name-ar').value  = prod.nameAr;
    document.getElementById('prod-name-en').value  = prod.nameEn || '';
    document.getElementById('prod-barcode').value  = prod.barcode || '';
    document.getElementById('prod-cat').value      = prod.category || '';
    const buyInput = document.getElementById('prod-buy');
    buyInput.value = _isCashierRole() ? '' : prod.buyPrice;
    buyInput.disabled = _isCashierRole(); // يمنع الكتابة فوق سعر التكلفة الحقيقي عند الحفظ
    document.getElementById('prod-sell').value     = prod.sellPrice;
    document.getElementById('prod-stock').value    = prod.stock;
    document.getElementById('prod-min').value      = prod.minStock || 5;
    document.getElementById('prod-unit').value     = prod.unit || 'قطعة';
    document.getElementById('prod-expiry').value   = prod.expiryDate || '';
    _prodImageData = prod.image || '';
    renderProductImagePreview();
    renderVariantRows(Array.isArray(prod.variants) ? prod.variants : []);
    toggleWeightFields();
    const histRow = document.getElementById('prod-price-history-row');
    if (histRow) histRow.style.display = '';
  } else {
    document.getElementById('prod-modal-title').textContent = 'إضافة منتج / Add Product';
    ['prod-id','prod-name-ar','prod-name-en','prod-barcode','prod-buy','prod-sell','prod-stock','prod-expiry'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('prod-buy').disabled = _isCashierRole(); // نفس منع الكتابة فوق سعر التكلفة، حتى للمنتجات الجديدة
    document.getElementById('prod-min').value = 5;
    _prodImageData = '';
    renderProductImagePreview();
    renderVariantRows([]);
    const histRow = document.getElementById('prod-price-history-row');
    if (histRow) histRow.style.display = 'none';
  }
}

function editProduct(id) {
  const p = DB.Products.byId(id);
  if (!p) return;
  document.getElementById('modal-product').classList.add('active');
  populateProductModal(p);
}

// ─── صورة المنتج ──────────────────────────────────────────────────────────────
// نفس مبدأ رفع الشعار: نقرأ الملف، نُصغِّر أبعاده عبر canvas لتقليل حجم البيانات
// المخزَّنة في IndexedDB (مهم عند وجود عشرات/مئات المنتجات بصور)، ثم نخزّنها base64.
function uploadProductImage(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('الرجاء اختيار صورة صالحة / Please select a valid image', 'error');
    event.target.value = '';
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    toast('حجم الصورة كبير جداً (الحد الأقصى 8MB) / Image too large (max 8MB)', 'error');
    event.target.value = '';
    return;
  }
  _resizeImageFile(file, 640, 0.85)
    .then(dataUrl => {
      _prodImageData = dataUrl;
      renderProductImagePreview();
      toast('تم تجهيز الصورة / Image ready ✓', 'success');
    })
    .catch(() => toast('تعذّرت معالجة الصورة / Could not process image', 'error'));
  event.target.value = '';
}

function removeProductImage() {
  _prodImageData = '';
  renderProductImagePreview();
}

function renderProductImagePreview() {
  const box = document.getElementById('prod-image-preview-box');
  const hidden = document.getElementById('prod-image');
  if (hidden) hidden.value = _prodImageData || '';
  if (!box) return;
  box.innerHTML = _prodImageData
    ? `<img src="${_prodImageData}" class="logo-preview-img" alt="product"/>`
    : `<i class="fas fa-image"></i><span>لا توجد صورة</span>`;
}

// يُصغِّر أي صورة إلى حد أقصى للأبعاد (maxDim) عبر canvas ويُعيدها كـ JPEG مضغوط.
// يعمل بالكامل داخل المتصفح دون اتصال بالإنترنت.
function _resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else { width = Math.round(width * (maxDim / height)); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── متغيّرات المنتج (Variants) ───────────────────────────────────────────────
// كل صف يمثّل متغيّراً (مثلاً: مقاس L أو لون أحمر) بمعرّف id، اسم name، باركود
// خاص (اختياري)، سعر شراء/بيع خاص (اختياري — فارغ = استخدم سعر المنتج الافتراضي)،
// ومخزون stock خاص به. الصفوف تُقرأ مباشرة من الـ DOM عند الحفظ (مصدر وحيد للحقيقة).
function renderVariantRows(variants) {
  const list = document.getElementById('prod-variants-list');
  if (!list) return;
  list.innerHTML = '';
  variants.forEach(v => _appendVariantRow(v));
  _refreshVariantsEmptyState();
}

function addVariantRow() {
  _appendVariantRow(null);
  _refreshVariantsEmptyState();
}

function _appendVariantRow(v) {
  const list = document.getElementById('prod-variants-list');
  if (!list) return;
  const rowId = (v && v.id) ? v.id : ('vtmp-' + (++_variantRowSeq));
  const row = document.createElement('div');
  row.className = 'variant-row';
  row.dataset.variantId = rowId;
  row.dataset.existing = (v && v.id) ? '1' : '0';
  row.innerHTML = `
    <input type="text" class="v-name" placeholder="مثال: أحمر - كبير / Red - L" value="${v && v.name ? _escAttr(v.name) : ''}"/>
    <input type="text" class="v-barcode" placeholder="باركود خاص (اختياري)" value="${v && v.barcode ? _escAttr(v.barcode) : ''}"/>
    <input type="number" class="v-sell" placeholder="سعر البيع" step="0.01" value="${v && v.sellPrice != null && v.sellPrice !== '' ? v.sellPrice : ''}"/>
    <input type="number" class="v-stock" placeholder="المخزون" step="0.01" value="${v && v.stock != null ? v.stock : 0}"/>
    <button type="button" class="variant-remove-btn" onclick="removeVariantRow(this)" title="حذف / Remove"><i class="fas fa-trash"></i></button>`;
  list.appendChild(row);
}

function removeVariantRow(btn) {
  const row = btn.closest('.variant-row');
  if (row) row.remove();
  _refreshVariantsEmptyState();
}

function _refreshVariantsEmptyState() {
  const list  = document.getElementById('prod-variants-list');
  const empty = document.getElementById('prod-variants-empty');
  if (!list || !empty) return;
  empty.style.display = list.children.length ? 'none' : 'block';
}

function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// يقرأ صفوف المتغيّرات من الـ DOM ويحوّلها لمصفوفة بيانات جاهزة للحفظ.
// صفوف بدون اسم تُتجاهَل تلقائياً (تُعتبر صفاً فارغاً غير مقصود).
function _collectVariantsFromUI() {
  const rows = document.querySelectorAll('#prod-variants-list .variant-row');
  const variants = [];
  rows.forEach(row => {
    const name = row.querySelector('.v-name')?.value.trim();
    if (!name) return;
    const barcode  = row.querySelector('.v-barcode')?.value.trim();
    const sellRaw  = row.querySelector('.v-sell')?.value;
    const stockRaw = row.querySelector('.v-stock')?.value;
    const isExisting = row.dataset.existing === '1';
    variants.push({
      id: isExisting ? row.dataset.variantId : DB.uid(),
      name,
      barcode: barcode || '',
      sellPrice: (sellRaw !== '' && sellRaw != null) ? parseFloat(sellRaw) : '',
      buyPrice: '',
      stock: parseFloat(stockRaw) || 0
    });
  });
  return variants;
}

function saveProduct() {
  const category = document.getElementById('prod-cat').value;
  const variants = category === 'بالميزان' ? [] : _collectVariantsFromUI();
  const data = {
    id:        document.getElementById('prod-id').value || null,
    nameAr:    document.getElementById('prod-name-ar').value.trim(),
    nameEn:    document.getElementById('prod-name-en').value.trim(),
    barcode:   document.getElementById('prod-barcode').value.trim(),
    category:  document.getElementById('prod-cat').value,
    // الكاشير لا يرى ولا يُدخل سعر التكلفة (الحقل معطَّل/فارغ عمداً) — نحافظ على
    // القيمة الحقيقية المخزَّنة أصلاً بدل قراءتها من الحقل، لمنع فقدان البيانات
    buyPrice: (() => {
      const idVal = document.getElementById('prod-id').value;
      if (_isCashierRole()) {
        const existing = idVal ? DB.Products.byId(idVal) : null;
        return existing ? (existing.buyPrice || 0) : 0;
      }
      return parseFloat(document.getElementById('prod-buy').value) || 0;
    })(),
    sellPrice: parseFloat(document.getElementById('prod-sell').value) || 0,
    stock:     (() => {
      const u = document.getElementById('prod-cat')?.value;
      const v = document.getElementById('prod-stock').value;
      return u === 'بالميزان' ? (parseFloat(v) || 0) : (parseInt(v) || 0);
    })(),
    minStock:  parseInt(document.getElementById('prod-min').value) || 5,
    unit:      document.getElementById('prod-unit').value,
    expiryDate: document.getElementById('prod-expiry').value || '',
    image:     _prodImageData || '',
    variants:  variants
  };
  if (!data.nameAr) { toast('أدخل اسم المنتج / Enter product name', 'error'); return; }
  if (data.sellPrice < data.buyPrice) { toast('سعر البيع أقل من سعر الشراء! / Sell < Buy!', 'warning'); }
  // تحقّق سريع: لا تكرار في باركود المتغيّرات داخل نفس المنتج
  const vBarcodes = variants.map(v => v.barcode).filter(Boolean);
  if (new Set(vBarcodes).size !== vBarcodes.length) {
    toast('يوجد باركود مكرّر بين المتغيّرات / Duplicate variant barcode', 'error');
    return;
  }
  DB.Products.save(data);
  closeModal('modal-product');
  renderProducts();
  checkAlerts();
  toast('تم حفظ المنتج / Product saved ✓', 'success');
}

function deleteProduct(id) {
  if (!confirm('هل تريد حذف هذا المنتج؟ / Delete this product?')) return;
  DB.Products.delete(id);
  renderProducts();
  toast('تم الحذف / Deleted', 'info');
}

// ─── سجل أسعار الشراء التاريخية (تتبّع تطوّر سعر الشراء لكل منتج مع الموردين) ───
// يقرأ فقط من سجل المشتريات الموجود أصلاً (DB.Purchases) دون إنشاء أي بيانات
// جديدة أو تعديل أي شيء — عرض فقط، آمن تماماً على البيانات الحالية.
function viewPriceHistory(productId) {
  // سجل أسعار الشراء بأكمله بيانات تكلفة — يُرفض كلياً للكاشير، وليس فقط
  // العدد داخله (طبقة حماية إضافية إلى جانب اعتراض accounts.js عند النقر)
  if (_isCashierRole()) { toast('غير مصرح لك بعرض هذه البيانات / Not authorized', 'error'); return; }
  const p = DB.Products.byId(productId);
  if (!p) return;
  const S    = DB.Settings.get();
  const cur  = S.currency || 'دج';
  const hist = DB.Purchases.byProduct(productId).slice().reverse(); // الأحدث أولاً
  const stats = DB.Purchases.priceStats(productId);

  document.getElementById('price-hist-title').innerHTML =
    `<i class="fas fa-chart-line"></i> سجل أسعار الشراء — ${escHtml(p.nameAr)}`;

  let statsHTML = '';
  if (stats) {
    const trendUp    = stats.last > stats.first;
    const trendDown  = stats.last < stats.first;
    const trendColor = trendUp ? '#f87171' : (trendDown ? '#10b981' : '#6b7280');
    const trendIcon  = trendUp ? 'fa-arrow-trend-up' : (trendDown ? 'fa-arrow-trend-down' : 'fa-minus');
    const changePct  = stats.first ? Math.abs(((stats.last - stats.first) / stats.first) * 100).toFixed(1) : '0.0';
    statsHTML = `
      <div class="supp-stat-row">
        <div class="supp-stat"><div class="supp-stat-val">${fmt(p.buyPrice)} ${cur}</div><div class="supp-stat-lbl">سعر الشراء الحالي في بطاقة المنتج</div></div>
        <div class="supp-stat"><div class="supp-stat-val">${fmt(stats.last)} ${cur}</div><div class="supp-stat-lbl">آخر سعر شراء (${fmtDateOnly(stats.lastDate)})</div></div>
        <div class="supp-stat"><div class="supp-stat-val">${fmt(stats.min)} ${cur}</div><div class="supp-stat-lbl">أقل سعر</div></div>
        <div class="supp-stat"><div class="supp-stat-val">${fmt(stats.max)} ${cur}</div><div class="supp-stat-lbl">أعلى سعر</div></div>
        <div class="supp-stat"><div class="supp-stat-val">${fmt(stats.avg)} ${cur}</div><div class="supp-stat-lbl">متوسط السعر (${stats.count} عملية شراء)</div></div>
        <div class="supp-stat"><div class="supp-stat-val" style="color:${trendColor}"><i class="fas ${trendIcon}"></i> ${changePct}%</div><div class="supp-stat-lbl">التغيّر منذ أول شراء مسجّل</div></div>
      </div>`;
  }

  let tableHTML;
  if (hist.length) {
    const rows = hist.map((h, idx) => {
      const supp = h.supplierId ? DB.Suppliers.byId(h.supplierId) : null;
      const suppName = supp
        ? `<span class="badge-supp" onclick="closeModal('modal-price-history');viewSupplierDetail('${supp.id}')">${escHtml(supp.name)}</span>`
        : (h.supplier || '—');
      // hist مرتّبة من الأحدث للأقدم، فالعملية الأقدم مباشرة هي hist[idx+1]
      const older = hist[idx + 1];
      let changeHTML = '<span style="color:#6b7280">— (أول عملية مسجّلة)</span>';
      if (older) {
        const diff = (parseFloat(h.unitPrice) || 0) - (parseFloat(older.unitPrice) || 0);
        if (diff > 0)      changeHTML = `<span style="color:#f87171"><i class="fas fa-arrow-up"></i> ${fmt(diff)} ${cur}</span>`;
        else if (diff < 0) changeHTML = `<span style="color:#10b981"><i class="fas fa-arrow-down"></i> ${fmt(Math.abs(diff))} ${cur}</span>`;
        else               changeHTML = `<span style="color:#6b7280">بدون تغيير</span>`;
      }
      return `<tr>
        <td>${fmtDate(h.date)}</td>
        <td>${suppName}</td>
        <td>${h.qty} ${p.unit || ''}</td>
        <td><strong>${fmt(h.unitPrice)} ${cur}</strong></td>
        <td>${changeHTML}</td>
        <td>${fmt((h.qty || 0) * (h.unitPrice || 0))} ${cur}</td>
      </tr>`;
    }).join('');

    tableHTML = `
      <div class="table-wrap" style="margin-top:14px;">
        <table class="data-table">
          <thead><tr>
            <th>التاريخ / Date</th><th>المورد / Supplier</th><th>الكمية / Qty</th>
            <th>سعر الوحدة / Unit Price</th><th>التغيّر عن السابق / Change</th><th>الإجمالي / Total</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } else {
    tableHTML = `<div class="empty-state" style="padding:24px;">لا توجد عمليات شراء مسجّلة لهذا المنتج بعد / No purchase history yet for this product</div>`;
  }

  document.getElementById('price-hist-body').innerHTML = statsHTML + tableHTML;
  document.getElementById('modal-price-history').classList.add('active');
}

// ─── Point of Sale ────────────────────────────────────────────────────────────
function loadPOS() {
  renderPOSProducts();
  renderPOSCategories();
  populatePOSCustomers();
  renderCart();
  updateHeldSalesBadge();
}

function renderPOSProducts(filter = '', cat = '') {
  let prods = filter ? DB.Products.search(filter) : DB.Products.all();
  if (cat) prods = prods.filter(p => p.category === cat);
  prods = prods.filter(p => DB.Products.totalStock(p) > 0);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const low = S.lowStockThreshold || 5;
  const grid = document.getElementById('pos-products-grid');
  if (!grid) return;
  grid.innerHTML = prods.length ? prods.map(p => {
    const stock = DB.Products.totalStock(p);
    const thumb = p.image ? `<div class="pos-prod-thumb"><img src="${p.image}" alt=""/></div>` : '';
    const hasVariants = DB.Products.hasVariants(p);
    const clickAction = hasVariants ? `openVariantPicker('${p.id}')` : `addToCart('${p.id}')`;
    const variantBadge = hasVariants ? `<div class="pos-prod-variant-badge"><i class="fas fa-layer-group"></i> ${p.variants.length} خيار / options</div>` : '';
    return `<div class="pos-prod-card ${stock <= 0 ? 'out-stock' : ''}" onclick="${clickAction}">
      ${thumb}
      <div class="pos-prod-name">${escHtml(p.nameAr)}</div>
      ${p.nameEn ? `<div class="pos-prod-en">${escHtml(p.nameEn)}</div>` : ''}
      <div class="pos-prod-price">${hasVariants ? 'من / from ' : ''}${fmt(p.sellPrice)} ${cur}</div>
      <div class="pos-prod-stock ${stock <= low ? 'low' : ''}">
        ${p.category === 'بالميزان' ? '<i class="fas fa-scale-balanced"></i>' : '<i class="fas fa-box"></i>'} ${p.category === 'بالميزان' ? (stock + ' كغ') : (stock + ' ' + (p.unit || ''))}
      </div>
      ${variantBadge}
    </div>`;
  }).join('')
  : '<div class="empty-state">لا توجد منتجات / No products</div>';
}

function renderPOSCategories() {
  const bar = document.getElementById('pos-cat-bar');
  if (!bar) return;
  const cats = DB.Categories.all();
  bar.innerHTML = `<button class="cat-btn active" onclick="filterPOSCat('', this)">الكل / All</button>` +
    cats.map(c => `<button class="cat-btn" onclick="filterPOSCat('${escHtml(c.name)}', this)">${escHtml(c.name)}</button>`).join('');
}

function filterPOSCat(cat, btn) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPOSProducts(document.getElementById('pos-search').value, cat);
}

function posSearch(val) {
  renderPOSProducts(val);
}

// ─── Barcode Scanner: Enter key → add product instantly ──────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const posInput = document.getElementById('pos-search');
  if (!posInput) return;

  posInput.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const val = posInput.value.trim();
    if (!val) return;

    // 1️⃣ Try exact barcode match first (scanner sends exact code)
    const byBarcode = DB.Products.byBarcode(val);
    if (byBarcode) {
      addToCart(byBarcode.id, byBarcode._matchedVariant ? byBarcode._matchedVariant.id : null);
      posInput.value = '';
      renderPOSProducts('');
      posInput.focus();
      return;
    }

    // 2️⃣ Try search — if only one result, add it automatically
    const results = DB.Products.search(val);
    const available = results.filter(p => DB.Products.totalStock(p) > 0);
    if (available.length === 1) {
      addToCart(available[0].id);
      posInput.value = '';
      renderPOSProducts('');
      posInput.focus();
      return;
    }

    // 3️⃣ Multiple results — just show them, let user click
    if (available.length > 1) {
      toast(`وُجد ${available.length} منتج — اختر من القائمة / ${available.length} found, select one`, 'info');
      return;
    }

    // 4️⃣ Nothing found
    toast(`❌ باركود غير موجود: ${val} / Barcode not found`, 'error');
    posInput.select();
  });
});

// ─── ماسح الباركود الشامل (USB / بلوتوث) — يعمل من أي مكان في التطبيق ────────
// كل قارئ باركود (USB أو Bluetooth) يعمل فعلياً كلوحة مفاتيح: يكتب رمز الباركود
// بسرعة فائقة جداً ثم يرسل Enter. المستمعات أعلاه (pos-search, inv-barcode-search...)
// تكفي فقط عندما يكون أحد هذه الحقول مُركَّزاً عليه (focused). هذا القسم يضيف طبقة
// إضافية تلتقط أي مسح حتى لو لم يكن أي حقل نص مُركَّزاً عليه إطلاقاً (مثلاً بعد فتح
// الصفحة مباشرة أو أثناء التنقّل بدون نقر داخل مربع البحث)، ويوجّه النتيجة تلقائياً
// حسب الصفحة أو النافذة (Modal) المفتوحة حالياً — دون التأثير على أي سلوك موجود.
(function () {
  let buffer = '';
  let lastTime = 0;
  const MAX_GAP = 50; // مللي ثانية بين حرف وآخر — القارئ يكتب أسرع من أي إنسان
  const MIN_LEN = 3;  // أقل طول مقبول لاعتباره باركود حقيقي (وليس ضغطة عرضية)

  function isEditableTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function isModalOpen(id) {
    const el = document.getElementById(id);
    return !!(el && el.classList.contains('active'));
  }

  function currentPage() {
    const active = document.querySelector('.page.active');
    return active ? active.id.replace('page-', '') : '';
  }

  // يُنفَّذ عند اكتمال مسح باركود صالح (Enter) بينما لا يوجد حقل نص مُركَّز عليه حالياً
  function handleGlobalScan(raw) {
    const val = raw.trim();
    if (!val) return;
    const upper = val.toUpperCase();

    // 1) نافذة إضافة/تعديل منتج مفتوحة → عبِّئ حقل الباركود تلقائياً
    if (isModalOpen('modal-product')) {
      const input = document.getElementById('prod-barcode');
      if (input) { input.value = val; toast('تم تعبئة الباركود تلقائياً ✓ / Barcode filled', 'success'); return; }
    }

    // 2) نافذة "مرتجع جديد" مفتوحة → ابحث عن الفاتورة بهذا الباركود
    if (isModalOpen('modal-return')) {
      const input = document.getElementById('ret-inv-input');
      if (input) { input.value = val; retInvKeydown({ key: 'Enter' }); return; }
    }

    const page = currentPage();

    // 3) صفحة نقطة البيع → أضف المنتج مباشرة للسلة (نفس منطق pos-search)
    if (page === 'sell') {
      const posInput = document.getElementById('pos-search');
      const byBarcode = DB.Products.byBarcode(val);
      if (byBarcode) {
        addToCart(byBarcode.id, byBarcode._matchedVariant ? byBarcode._matchedVariant.id : null);
        if (posInput) posInput.value = '';
        renderPOSProducts('');
        return;
      }
      const results = DB.Products.search(val).filter(p => DB.Products.totalStock(p) > 0);
      if (results.length === 1) {
        addToCart(results[0].id);
        if (posInput) posInput.value = '';
        renderPOSProducts('');
        return;
      }
      if (results.length > 1) {
        if (posInput) posInput.value = val;
        renderPOSProducts(val);
        toast(`وُجد ${results.length} منتج — اختر من القائمة / ${results.length} found, select one`, 'info');
        return;
      }
      toast(`❌ باركود غير موجود: ${val} / Barcode not found`, 'error');
      return;
    }

    // 4) صفحة الفواتير → ابحث عن الفاتورة برقمها وافتحها فوراً عند التطابق
    if (page === 'invoices') {
      const input = document.getElementById('inv-barcode-search');
      if (input) { input.value = val; invBarcodeKeydown({ key: 'Enter' }); return; }
    }

    // 5) صفحة المرتجعات (بدون نافذة مفتوحة) → ابحث في قائمة المرتجعات
    if (page === 'returns') {
      const input = document.getElementById('ret-search');
      if (input) { input.value = val; retListKeydown({ key: 'Enter' }); return; }
    }

    // 6) أي صفحة أخرى (لوحة التحكم، المنتجات...): جرّب مطابقة منتج، ثم فاتورة، كحل احتياطي —
    //    مفيد عند مسح منتج من أي مكان في التطبيق للانتقال به مباشرة إلى نقطة البيع
    const prod = DB.Products.byBarcode(val);
    if (prod) {
      navigateTo('sell');
      setTimeout(() => { addToCart(prod.id, prod._matchedVariant ? prod._matchedVariant.id : null); renderPOSProducts(''); }, 50);
      return;
    }
    const sale = (DB.Sales.all() || []).find(s => (s.invoiceNo || '').toUpperCase() === upper);
    if (sale) {
      navigateTo('invoices');
      setTimeout(() => viewInvoice(sale.id), 50);
      return;
    }

    toast(`❌ لم يتم التعرف على الباركود: ${val} / Barcode not recognized`, 'error');
  }

  // إتاحة الدالة عالمياً — تُستخدم من ماسح الكاميرا (camera-scanner.js) لتوجيه أي
  // رمز يتم مسحه بالكاميرا بنفس منطق قارئ الباركود الفيزيائي (USB/Bluetooth)
  // بالضبط، دون تكرار أو تعديل أي منطق موجود.
  window.handleGlobalScan = handleGlobalScan;

  document.addEventListener('keydown', e => {
    // إن كان التركيز داخل حقل نص/قائمة، اترك المستمعات الخاصة بكل حقل (أعلاه) تتكفل بالأمر
    if (isEditableTarget(document.activeElement)) { buffer = ''; return; }

    // تجاهل اختصارات المتصفح/النظام (Ctrl/Alt/Meta) حتى لا نتعارض معها
    if (e.ctrlKey || e.altKey || e.metaKey) { buffer = ''; return; }

    const now = Date.now();

    if (e.key === 'Enter') {
      if (buffer.length >= MIN_LEN) {
        e.preventDefault();
        const code = buffer;
        buffer = '';
        handleGlobalScan(code);
      } else {
        buffer = '';
      }
      return;
    }

    // حرف واحد قابل للطباعة فقط (رقم/حرف/رمز) — وليس مفتاح تنقّل مثل Tab/Shift/Arrow
    if (e.key.length === 1) {
      const isContinuation = buffer.length > 0 && (now - lastTime) <= MAX_GAP;
      buffer = isContinuation ? buffer + e.key : e.key;
      lastTime = now;
      // أثناء مسح سريع فعلي، امنع أي سلوك افتراضي (مثل تمرير الصفحة بالمسافة)
      if (isContinuation) e.preventDefault();
    } else {
      // أي مفتاح آخر (Shift, Tab, Arrow...) ينهي أي تجميع جارٍ لأنه ليس من القارئ
      buffer = '';
    }
  });
})();

function populatePOSCustomers() {
  const sel = document.getElementById('pos-customer');
  if (!sel) return;
  sel.innerHTML = '<option value="">زبون عام / Walk-in</option>' +
    DB.Customers.all().map(c => {
      const debtLabel = (c.debt||0) > 0 ? ` ⚠️ دين: ${fmt(c.debt)} دج` : '';
      return `<option value="${c.id}">${escHtml(c.name)}${c.phone ? ' – ' + escHtml(c.phone) : ''}${debtLabel}</option>`;
    }).join('');

  // إعادة ضبط حقل بحث الزبون (Autocomplete) عند كل دخول لصفحة نقطة البيع
  const input = document.getElementById('pos-customer-search');
  const clearBtn = document.getElementById('pos-customer-clear-btn');
  const dd = document.getElementById('pos-customer-dropdown');
  if (input) input.value = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }
}

// ─── بحث الزبون بالاسم (أو رقم الهاتف) داخل نقطة البيع — Autocomplete ────────
function _custDisplayLabel(c) {
  const debtLabel = (c.debt||0) > 0 ? ` ⚠️ دين: ${fmt(c.debt)} دج` : '';
  return `${escHtml(c.name)}${c.phone ? ' – ' + escHtml(c.phone) : ''}${debtLabel}`;
}

function posCustomerSearchInput(val) {
  const dd = document.getElementById('pos-customer-dropdown');
  if (!dd) return;
  const q = (val || '').trim().toLowerCase();
  const all = DB.Customers.all();
  const list = q
    ? all.filter(c => (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q))
    : all;

  const walkinOption = `<div class="pos-cust-option walkin" onclick="selectPOSCustomer('')">
      <span class="pos-cust-name"><i class="fas fa-user"></i> زبون عام / Walk-in</span>
    </div>`;

  if (!list.length) {
    dd.innerHTML = walkinOption + `<div class="pos-cust-empty">${q ? 'لا توجد نتائج مطابقة / No matching customers' : 'لا يوجد زبائن / No customers yet'}</div>`;
  } else {
    dd.innerHTML = walkinOption + list.map(c => `
      <div class="pos-cust-option" onclick="selectPOSCustomer('${c.id}')">
        <span class="pos-cust-name">${escHtml(c.name)}${c.phone ? ' – ' + escHtml(c.phone) : ''}</span>
        ${(c.debt||0) > 0 ? `<span class="pos-cust-debt">⚠️ ${fmt(c.debt)} دج</span>` : ''}
      </div>`).join('');
  }
  dd.style.display = 'block';
}

function posCustomerSearchKeydown(e) {
  // Enter مع نتيجة وحيدة مطابقة → اختيارها مباشرة (مثل بحث المنتجات)
  if (e.key !== 'Enter') return;
  const val = (e.target.value || '').trim().toLowerCase();
  if (!val) return;
  const matches = DB.Customers.all().filter(c =>
    (c.name || '').toLowerCase().includes(val) || (c.phone || '').toLowerCase().includes(val));
  if (matches.length === 1) selectPOSCustomer(matches[0].id);
}

function selectPOSCustomer(custId) {
  const sel = document.getElementById('pos-customer');
  if (sel) sel.value = custId || '';

  const dd = document.getElementById('pos-customer-dropdown');
  if (dd) { dd.style.display = 'none'; dd.innerHTML = ''; }

  posCustomerChanged(); // يتكفّل بمزامنة حقل البحث المرئي وشارة الدين
}

// إغلاق قائمة نتائج بحث الزبون عند الضغط خارجها — لا يؤثر على أي سلوك آخر
document.addEventListener('click', e => {
  const combo = document.getElementById('pos-customer-combo');
  if (combo && !combo.contains(e.target)) {
    const dd = document.getElementById('pos-customer-dropdown');
    if (dd) dd.style.display = 'none';
  }
});

function posCustomerChanged() {
  const custId = document.getElementById('pos-customer')?.value || '';
  const cust = custId ? DB.Customers.byId(custId) : null;

  // مزامنة حقل بحث الزبون المرئي مع القيمة الفعلية المحفوظة في <select> المخفي —
  // يشمل هذا التغيير اليدوي من القائمة وأيضاً التغيير البرمجي (استئناف فاتورة معلّقة مثلاً)
  const input = document.getElementById('pos-customer-search');
  const clearBtn = document.getElementById('pos-customer-clear-btn');
  if (input) input.value = cust ? _custDisplayLabel(cust) : '';
  if (clearBtn) clearBtn.style.display = cust ? 'flex' : 'none';

  const banner = document.getElementById('pos-debt-banner');
  if (!banner) return;
  if (!custId || !cust || !(cust.debt > 0)) { banner.style.display = 'none'; return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  document.getElementById('pos-debt-label').textContent = `⚠️ ${escHtml(cust.name)} لديه دين غير مسدَّد`;
  document.getElementById('pos-debt-amount').textContent = `الدين الحالي: ${fmt(cust.debt)} ${cur} — البيع الآجل سيزيد هذا الدين`;
  banner.style.display = 'flex';
}

// ─── Weight modal state ───────────────────────────────────────────────────────
let _weightProductId = null;
let _weightMode = 'amount'; // 'amount' | 'grams' | 'kg'

// ─── إعادة حساب سطر واحد في السلة مع مراعاة خصمه الخاص (خصم على مستوى المنتج) ─
function _itemEffectivePrice(it) {
  const d = Math.min(100, Math.max(0, parseFloat(it.discount) || 0));
  return it.price * (1 - d / 100);
}
function _recalcCartItem(it) {
  const effPrice = _itemEffectivePrice(it);
  it.total  = it.qty * effPrice;
  it.profit = (effPrice - it.buyPrice) * it.qty;
}

function addToCart(productId, variantId) {
  const p = DB.Products.byId(productId);
  if (!p) { toast('المنتج غير متوفر / Out of stock', 'error'); return; }

  // منتج له متغيّرات ولم يُحدَّد أيّها بعد → افتح نافذة اختيار المتغيّر بدل الإضافة المباشرة
  if (!variantId && DB.Products.hasVariants(p)) {
    openVariantPicker(productId);
    return;
  }

  const stock = DB.Products.variantStock(p, variantId);
  if (stock <= 0) { toast('المنتج غير متوفر / Out of stock', 'error'); return; }

  // ⚖️ منتجات الميزان — فتح نافذة إدخال الوزن/المبلغ (لا تُستخدم مع المتغيّرات)
  if (p.category === 'بالميزان') {
    openWeightModal(productId);
    return;
  }

  const variant   = variantId ? (p.variants || []).find(v => v.id === variantId) : null;
  const sellPrice = DB.Products.effectiveSellPrice(p, variantId);
  const buyPrice  = DB.Products.effectiveBuyPrice(p, variantId);
  const nameAr    = variant ? `${escHtml(p.nameAr)} (${escHtml(variant.name)})` : p.nameAr;

  // كل منتج له حالة دفع خاصة به (نقدي/آجل) — لذلك لا نجمع عناصر بحالتي دفع مختلفتين معاً
  const defaultPayType = selectedPayment === 'credit' ? 'credit' : 'cash';
  const existing = cart.find(i => i.productId === productId && (i.variantId || null) === (variantId || null) && (i.payType || 'cash') === defaultPayType);
  if (existing) {
    if (existing.qty >= stock) { toast('لا يوجد مخزون كافٍ / Not enough stock', 'warning'); return; }
    existing.qty++;
    _recalcCartItem(existing);
  } else {
    cart.push({ productId: p.id, variantId: variantId || null, nameAr, nameEn: p.nameEn, price: sellPrice, buyPrice,
      qty: 1, total: sellPrice, profit: sellPrice - buyPrice, unit: p.unit,
      payType: defaultPayType, discount: 0 });
  }
  renderCart(); updateTotals();
}

// ─── Variant Picker (POS): يظهر عند النقر على منتج له أكثر من متغيّر واحد ──────
function openVariantPicker(productId) {
  const p = DB.Products.byId(productId);
  if (!p || !DB.Products.hasVariants(p)) return;
  _vpProductId = productId;
  document.getElementById('vp-title').textContent = p.nameAr + (p.nameEn ? ' / ' + p.nameEn : '');
  renderVariantPickerList();
  document.getElementById('modal-variant-picker').classList.add('active');
}

function renderVariantPickerList() {
  const p = DB.Products.byId(_vpProductId);
  const list = document.getElementById('vp-list');
  if (!p || !list) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  list.innerHTML = (p.variants || []).map(v => {
    const stock = parseFloat(v.stock) || 0;
    const price = DB.Products.effectiveSellPrice(p, v.id);
    const out = stock <= 0;
    return `<div class="variant-option ${out ? 'disabled' : ''}" ${out ? '' : `onclick="pickVariantForCart('${v.id}')"`}>
      <div>
        <div class="variant-option-name">${escHtml(v.name)}</div>
        <div class="variant-option-stock">${out ? 'نفذ / Out of stock' : (stock + ' ' + (p.unit || '') + ' متوفر')}</div>
      </div>
      <div class="variant-option-price">${fmt(price)} ${cur}</div>
    </div>`;
  }).join('') || '<div class="empty-state">لا توجد متغيّرات / No variants</div>';
}

function pickVariantForCart(variantId) {
  if (!_vpProductId) return;
  addToCart(_vpProductId, variantId);
  closeModal('modal-variant-picker');
}

// ─── Weight Modal Logic ───────────────────────────────────────────────────────
function openWeightModal(productId) {
  const p = DB.Products.byId(productId);
  if (!p) return;
  _weightProductId = productId;
  _weightMode = 'amount';
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const nameEl = document.getElementById('wi-prod-name');
  const priceEl = document.getElementById('wi-price-kg');
  if (nameEl) nameEl.textContent = p.nameAr + (p.nameEn ? ' / ' + p.nameEn : '');
  if (priceEl) priceEl.textContent = 'سعر الكيلوغرام: ' + fmt(p.sellPrice) + ' ' + cur;
  document.getElementById('wi-value').value = '';
  document.getElementById('wi-result-text').textContent = '';
  setWeightMode('amount');
  openModal('modal-weight-input');
  setTimeout(() => document.getElementById('wi-value')?.focus(), 150);
}

function setWeightMode(mode) {
  _weightMode = mode;
  ['amount','grams','kg'].forEach(m => {
    document.getElementById('wi-btn-' + m)?.classList.toggle('active', m === mode);
  });
  const labels = { amount: 'المبلغ المدفوع / Amount Paid (دج)', grams: 'الوزن بالغرام / Weight in Grams', kg: 'الوزن بالكيلوغرام / Weight in Kg' };
  const el = document.getElementById('wi-input-label');
  if (el) el.textContent = labels[mode] || '';
  document.getElementById('wi-value').value = '';
  document.getElementById('wi-result-text').textContent = '';
}

function calcWeightResult() {
  const p = DB.Products.byId(_weightProductId);
  if (!p) return;
  const val = parseFloat(document.getElementById('wi-value').value) || 0;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  let kg = 0, total = 0, resultText = '';

  if (_weightMode === 'amount') {
    // المبلغ / سعر الكيلو = الوزن بالكيلو
    total = val;
    kg    = p.sellPrice > 0 ? val / p.sellPrice : 0;
    resultText = kg > 0
      ? `الوزن المقابل: <strong>${(kg * 1000).toFixed(0)} غ</strong> (${kg.toFixed(3)} كغ)`
      : '—';
  } else if (_weightMode === 'grams') {
    kg    = val / 1000;
    total = kg * p.sellPrice;
    resultText = `المبلغ: <strong>${fmt(total)} ${cur}</strong>`;
  } else if (_weightMode === 'kg') {
    kg    = val;
    total = kg * p.sellPrice;
    resultText = `المبلغ: <strong>${fmt(total)} ${cur}</strong>`;
  }

  const resEl = document.getElementById('wi-result-text');
  if (resEl) resEl.innerHTML = val > 0 ? resultText : '—';
}

function confirmWeightAdd() {
  const p = DB.Products.byId(_weightProductId);
  if (!p) return;
  const val = parseFloat(document.getElementById('wi-value').value) || 0;
  if (val <= 0) { toast('أدخل قيمة صحيحة / Enter a valid value', 'error'); return; }

  let kg = 0, total = 0;
  if (_weightMode === 'amount') {
    total = val;
    kg    = p.sellPrice > 0 ? val / p.sellPrice : 0;
  } else if (_weightMode === 'grams') {
    kg    = val / 1000;
    total = kg * p.sellPrice;
  } else {
    kg    = val;
    total = kg * p.sellPrice;
  }

  if (kg > p.stock) { toast('الوزن المطلوب يتجاوز المخزون (' + p.stock.toFixed(3) + ' كغ)', 'warning'); return; }

  const profit = (p.sellPrice - p.buyPrice) * kg;
  // كل عملية بيع بالميزان = عنصر مستقل في السلة (qty=kg)
  cart.push({
    productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn,
    price: p.sellPrice,  // سعر الكيلو
    buyPrice: p.buyPrice,
    qty: kg,             // الكمية = كيلوغرامات
    total: total,
    profit: profit,
    unit: 'كغ',
    isWeighed: true,
    weightGrams: Math.round(kg * 1000),
    payType: selectedPayment === 'credit' ? 'credit' : 'cash',
    discount: 0
  });

  closeModal('modal-weight-input');
  renderCart(); updateTotals();
  toast(`تمت الإضافة: ${(kg * 1000).toFixed(0)} غ — ${fmt(total)} دج ✓`, 'success');
}

// ─── Toggle weight hint in product modal ─────────────────────────────────────
function toggleWeightFields() {
  const cat = document.getElementById('prod-cat')?.value;
  const isWeighed = cat === 'بالميزان';
  const hint = document.getElementById('weight-hint');
  if (hint) hint.style.display = isWeighed ? 'block' : 'none';
  // المتغيّرات (Variants) غير مدعومة لمنتجات الميزان — نافذة إدخال الوزن تتعامل مع
  // منتج واحد فقط. نُخفي القسم فقط دون حذف بيانات محفوظة مسبقاً (احتياطاً).
  const vSection = document.getElementById('prod-variants-section');
  if (vSection) vSection.style.display = isWeighed ? 'none' : 'block';
}

function renderCart() {
  const el = document.getElementById('pos-cart');
  if (!el) return;
  if (!cart.length) { el.innerHTML = '<div class="cart-empty"><i class="fas fa-cart-shopping"></i><br/>السلة فارغة / Cart is empty</div>'; updateTotals(); return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  el.innerHTML = cart.map((it, i) => {
    const isCredit = (it.payType || 'cash') === 'credit';
    const payToggleBtn = `<button class="item-pay-toggle ${isCredit ? 'is-credit' : ''}" onclick="toggleItemPayType(${i})" title="اضغط لتغيير طريقة دفع هذا المنتج">
        <i class="fas ${isCredit ? 'fa-clock' : 'fa-money-bill'}"></i> ${isCredit ? 'آجل' : 'نقدي'}
      </button>`;
    const hasDisc = (it.discount || 0) > 0;
    const discBtn = `<button class="item-disc-btn ${hasDisc ? 'has-disc' : ''}" onclick="openItemDiscountModal(${i})" title="خصم على هذا المنتج / Item discount">
        <i class="fas fa-tag"></i>${hasDisc ? ` -${it.discount}%` : ''}
      </button>`;
    const priceLine = hasDisc
      ? `<span class="cart-item-price-old">${fmt(it.price)} ${cur}</span> <span class="cart-item-price-new">${fmt(_itemEffectivePrice(it))} ${cur}</span>`
      : `${fmt(it.price)} ${cur}`;

    const prodForImg = DB.Products.byId(it.productId);
    const cartThumb = prodForImg && prodForImg.image
      ? `<div class="cart-item-thumb"><img src="${prodForImg.image}" alt=""/></div>`
      : `<div class="cart-item-thumb"><i class="fas fa-box"></i></div>`;

    if (it.isWeighed) {
      // عرض منتجات الميزان بشكل مختلف
      return `<div class="cart-item ${isCredit ? 'cart-item-credit' : ''}">
        ${cartThumb}
        <div class="cart-item-info">
          <div class="cart-item-name">⚖️ ${escHtml(it.nameAr)}</div>
          <div class="cart-item-price">${priceLine}/كغ</div>
          <div class="cart-weight-label">${it.weightGrams} غ = ${(it.qty).toFixed(3)} كغ</div>
        </div>
        <div class="cart-item-controls">
          ${discBtn}
          ${payToggleBtn}
          <button onclick="removeFromCart(${i})" title="حذف" class="remove-btn"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="cart-item-total">${fmt(it.total)} ${cur}</div>
      </div>`;
    }
    return `<div class="cart-item ${isCredit ? 'cart-item-credit' : ''}">
      ${cartThumb}
      <div class="cart-item-info">
        <div class="cart-item-name">${escHtml(it.nameAr)}</div>
        <div class="cart-item-price">${priceLine}</div>
      </div>
      <div class="cart-item-controls">
        <button onclick="changeQty(${i}, -1)"><i class="fas fa-minus"></i></button>
        <input type="number" class="qty-input" value="${it.qty}" min="1" step="1"
          onclick="this.select()"
          onchange="setQty(${i}, this.value)"
          onkeydown="if(event.key==='Enter'){this.blur();}" />
        <button onclick="changeQty(${i}, 1)"><i class="fas fa-plus"></i></button>
        ${discBtn}
        ${payToggleBtn}
        <button class="remove-btn" onclick="removeFromCart(${i})"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="cart-item-total">${fmt(it.total)} ${cur}</div>
    </div>`;
  }).join('');
  updateTotals();
}

// ─── نافذة الخصم على منتج واحد داخل السلة ───────────────────────────────────
let _itemDiscountIndex = null;

function openItemDiscountModal(index) {
  const it = cart[index];
  if (!it) return;
  _itemDiscountIndex = index;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  document.getElementById('idisc-prod-name').textContent = it.nameAr + (it.nameEn ? ' / ' + it.nameEn : '');
  document.getElementById('idisc-prod-price').textContent = 'السعر الأصلي: ' + fmt(it.price) + ' ' + cur + (it.isWeighed ? '/كغ' : '');
  document.getElementById('idisc-value').value = it.discount || 0;
  calcItemDiscountPreview();
  openModal('modal-item-discount');
  setTimeout(() => document.getElementById('idisc-value')?.focus(), 150);
}

function calcItemDiscountPreview() {
  const it = cart[_itemDiscountIndex];
  const resEl = document.getElementById('idisc-result-text');
  if (!it || !resEl) return;
  let d = parseFloat(document.getElementById('idisc-value').value);
  if (isNaN(d)) d = 0;
  d = Math.min(100, Math.max(0, d));
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const effPrice = it.price * (1 - d / 100);
  const lineTotal = effPrice * it.qty;
  resEl.innerHTML = d > 0
    ? `السعر بعد الخصم: <strong>${fmt(effPrice)} ${cur}</strong><br/>إجمالي السطر: <strong>${fmt(lineTotal)} ${cur}</strong>`
    : 'لا يوجد خصم على هذا المنتج';
}

function confirmItemDiscount() {
  const it = cart[_itemDiscountIndex];
  if (!it) return;
  let d = parseFloat(document.getElementById('idisc-value').value);
  if (isNaN(d) || d < 0) d = 0;
  if (d > 100) d = 100;
  it.discount = d;
  _recalcCartItem(it);
  closeModal('modal-item-discount');
  renderCart();
  toast(d > 0 ? `تم تطبيق خصم ${d}% على ${escHtml(it.nameAr)} ✓` : 'تمت إزالة الخصم عن المنتج', 'success');
}

function clearItemDiscount() {
  const it = cart[_itemDiscountIndex];
  if (!it) return;
  it.discount = 0;
  _recalcCartItem(it);
  closeModal('modal-item-discount');
  renderCart();
  toast('تمت إزالة الخصم عن المنتج', 'info');
}

// ─── تبديل حالة الدفع لمنتج واحد داخل السلة (نقدي ⇄ آجل) ─────────────────────
function toggleItemPayType(index) {
  const it = cart[index];
  if (!it) return;
  it.payType = (it.payType || 'cash') === 'credit' ? 'cash' : 'credit';
  renderCart();
}

function changeQty(index, delta) {
  const it = cart[index];
  if (!it) return;
  const p = DB.Products.byId(it.productId);
  const newQty = it.qty + delta;
  if (newQty < 1) { removeFromCart(index); return; }
  if (newQty > (p?.stock || 0)) { toast('لا يوجد مخزون كافٍ / Not enough stock', 'warning'); return; }
  it.qty = newQty; _recalcCartItem(it);
  renderCart();
}

// ─── تعديل الكمية مباشرة عبر الكتابة (بدون أزرار +/-) ─────────────────────
function setQty(index, value) {
  const it = cart[index];
  if (!it) return;

  let newQty = parseInt(value, 10);

  // لو الإدخال غير صالح (فارغ / نص / صفر أو أقل) → رجّع القيمة القديمة
  if (isNaN(newQty) || newQty < 1) {
    renderCart();
    return;
  }

  const p = DB.Products.byId(it.productId);
  const stock = p?.stock || 0;
  if (newQty > stock) {
    toast('لا يوجد مخزون كافٍ / Not enough stock', 'warning');
    newQty = stock > 0 ? stock : it.qty; // اضبط على أقصى مخزون متاح
    if (newQty < 1) { renderCart(); return; }
  }

  it.qty = newQty;
  _recalcCartItem(it);
  renderCart();
}

function removeFromCart(index) { cart.splice(index, 1); renderCart(); }
function clearCart() {
  cart = [];
  const receivedInput = document.getElementById('pos-received');
  if (receivedInput) receivedInput.value = '';
  renderCart();
}

// ═══════════════════════════════════════════════════════════════════════════
// ─── تعليق الفواتير (Hold Sale) ──────────────────────────────────────────────
// يسمح بحفظ السلة الحالية مؤقتاً (مع الزبون والخصم والمبلغ المستلم) وإفراغ
// شاشة البيع لخدمة زبون آخر، ثم الرجوع لاحقاً واستئناف الفاتورة كما كانت
// دون التأثير على أي بيانات أخرى (لا يتم إنشاء فاتورة بيع فعلية حتى الآن).
// ═══════════════════════════════════════════════════════════════════════════

function holdSale() {
  if (!cart.length) { toast('السلة فارغة، لا يوجد ما يمكن تعليقه / Cart is empty', 'error'); return; }

  const custId = document.getElementById('pos-customer')?.value || '';
  const cust   = custId ? DB.Customers.byId(custId) : null;
  const disc   = parseFloat(document.getElementById('pos-discount')?.value || 0);
  const subtotal = cart.reduce((a, it) => a + it.total, 0);
  const total    = subtotal * (1 - disc / 100);
  const receivedRaw = parseFloat(document.getElementById('pos-received')?.value);
  const received = !isNaN(receivedRaw) && receivedRaw > 0 ? receivedRaw : null;

  const note = prompt('ملاحظة اختيارية لتمييز هذه الفاتورة (مثال: اسم الزبون) / Optional note to identify this sale:', '');
  if (note === null) return; // المستخدم ألغى العملية — لا نُعلّق شيئاً

  DB.HeldSales.add({
    note: note.trim(), customerId: custId || null,
    customerName: cust ? cust.name : 'زبون عام',
    items: [...cart], discount: disc, received,
    paymentMethod: selectedPayment, subtotal, total
  });

  clearCart();
  const discInput = document.getElementById('pos-discount');
  if (discInput) discInput.value = 0;
  const custSel = document.getElementById('pos-customer');
  if (custSel) custSel.value = '';
  posCustomerChanged(); // يعيد ضبط حقل بحث الزبون المرئي إلى "زبون عام" ويخفي شارة الدين
  updateTotals();
  updateHeldSalesBadge();
  toast('تم تعليق الفاتورة ✓ يمكنك متابعة زبون آخر / Sale held', 'success');
}

function renderHeldSalesList() {
  const el = document.getElementById('held-sales-body');
  if (!el) return;
  const list = DB.HeldSales.all();
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  if (!list.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-pause-circle"></i><br/>لا توجد فواتير معلّقة حالياً / No held sales</div>';
    return;
  }

  el.innerHTML = list.map(h => {
    const timeStr = new Date(h.createdAt).toLocaleString('ar-DZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="held-sale-card">
      <div class="held-sale-info">
        <div class="held-sale-title">
          <i class="fas fa-receipt"></i> ${h.note ? escHtml(h.note) : 'فاتورة معلّقة'}
          <span class="held-sale-time">${timeStr}</span>
        </div>
        <div class="held-sale-meta">
          <span><i class="fas fa-user"></i> ${escHtml(h.customerName)}</span>
          <span><i class="fas fa-box"></i> ${h.itemCount} قطعة</span>
          <span class="held-sale-total">${fmt(h.total)} ${cur}</span>
        </div>
      </div>
      <div class="held-sale-actions">
        <button class="btn-secondary" onclick="resumeHeldSale('${h.id}')"><i class="fas fa-rotate-left"></i> استئناف / Resume</button>
        <button class="remove-btn" onclick="deleteHeldSale('${h.id}')" title="حذف / Delete"><i class="fas fa-trash"></i></button>
      </div>
    </div>`;
  }).join('');
}

function resumeHeldSale(id) {
  const held = DB.HeldSales.byId(id);
  if (!held) return;

  if (cart.length) {
    const ok = confirm('السلة الحالية تحتوي على منتجات — سيتم استبدالها بالفاتورة المعلّقة.\nCurrent cart has items — it will be replaced by the held sale. Continue?');
    if (!ok) return;
  }

  cart = held.items.map(it => ({ ...it }));

  const discInput = document.getElementById('pos-discount');
  if (discInput) discInput.value = held.discount || 0;
  const custSel = document.getElementById('pos-customer');
  if (custSel) custSel.value = held.customerId || '';
  const receivedInput = document.getElementById('pos-received');
  if (receivedInput) receivedInput.value = held.received != null ? held.received : '';

  selectedPayment = held.paymentMethod || 'cash';
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.toggle('active', b.dataset.method === selectedPayment));

  posCustomerChanged();
  DB.HeldSales.delete(id);
  closeModal('modal-held-sales');
  renderCart();
  updateTotals();
  updateHeldSalesBadge();
  toast('تم استئناف الفاتورة ✓ / Sale resumed', 'success');
}

function deleteHeldSale(id) {
  if (!confirm('هل تريد حذف هذه الفاتورة المعلّقة نهائياً؟ لا يمكن التراجع.\nDelete this held sale permanently?')) return;
  DB.HeldSales.delete(id);
  renderHeldSalesList();
  updateHeldSalesBadge();
  toast('تم الحذف / Deleted', 'success');
}

function updateHeldSalesBadge() {
  const badge = document.getElementById('held-sales-badge');
  if (!badge) return;
  const n = DB.HeldSales.count ? DB.HeldSales.count() : DB.HeldSales.all().length;
  if (n > 0) { badge.textContent = n; badge.style.display = 'inline-flex'; }
  else badge.style.display = 'none';
}

// ─── تجميع السلة حسب طريقة الدفع (نقدي / آجل) ────────────────────────────────
function getCartSplit() {
  const cashSubtotal   = cart.filter(it => (it.payType || 'cash') !== 'credit').reduce((a, it) => a + it.total, 0);
  const creditSubtotal = cart.filter(it => (it.payType || 'cash') === 'credit').reduce((a, it) => a + it.total, 0);
  return { cashSubtotal, creditSubtotal };
}

// ─── تجميع ربح السلة حسب طريقة الدفع (نقدي/بطاقة = محقَّق فوراً، آجل = معلَّق) ─
// ⚠️ هذا هو أساس إصلاح "الربح الصافي": ربح المنتجات الآجلة لا يُحسب ضمن الأرباح
// الفعلية إلا بعد سداد الدين، حتى لا يُحتسب دين غير مُحصَّل كأنه ربح.
function getCartProfitSplit() {
  const cashProfit   = cart.filter(it => (it.payType || 'cash') !== 'credit').reduce((a, it) => a + it.profit, 0);
  const creditProfit = cart.filter(it => (it.payType || 'cash') === 'credit').reduce((a, it) => a + it.profit, 0);
  return { cashProfit, creditProfit };
}

function updateTotals() {
  const subtotal = cart.reduce((a, it) => a + it.total, 0);
  const disc     = parseFloat(document.getElementById('pos-discount')?.value || 0);
  const total    = subtotal * (1 - disc / 100);
  const profit   = cart.reduce((a, it) => a + it.profit, 0) * (1 - disc / 100);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  setText('pos-subtotal', fmt(subtotal) + ' ' + cur);
  setText('pos-total',    fmt(total)    + ' ' + cur);
  setText('pos-profit',   _hideIfCashier('+' + fmt(profit) + ' ' + cur));

  // ─── إجمالي خصومات المنتجات الفردية (للعرض فقط — محتسب أصلاً ضمن subtotal) ─
  const itemsDiscTotal = cart.reduce((a, it) => a + (it.price * it.qty - it.total), 0);
  const itemsDiscRow = document.getElementById('pos-items-disc-row');
  if (itemsDiscRow) {
    if (itemsDiscTotal > 0.004) {
      itemsDiscRow.style.display = 'flex';
      setText('pos-items-disc', '− ' + fmt(itemsDiscTotal) + ' ' + cur);
    } else {
      itemsDiscRow.style.display = 'none';
    }
  }

  // ─── عرض تفصيل نقدي/آجل عندما تكون الفاتورة مقسّمة بين الاثنين ────────────
  const { cashSubtotal, creditSubtotal } = getCartSplit();
  const cashPart   = cashSubtotal   * (1 - disc / 100);
  const creditPart = creditSubtotal * (1 - disc / 100);
  const splitRow = document.getElementById('pos-split-row');
  if (splitRow) {
    if (cashSubtotal > 0 && creditSubtotal > 0) {
      splitRow.style.display = 'flex';
      setText('pos-cash-part',   fmt(cashPart)   + ' ' + cur);
      setText('pos-credit-part', fmt(creditPart) + ' ' + cur);
    } else {
      splitRow.style.display = 'none';
    }
  }

  calcChange();
}

// ─── حساب الباقي (الفكة) المستحق للزبون بناءً على المبلغ المستلم ─────────────
// ⚠️ المبلغ المطلوب فعلياً نقداً الآن هو فقط جزء المنتجات "نقدي" من الفاتورة —
//    أما الجزء "آجل" فهو دين يُسجَّل على الزبون ولا يُدفع الآن، لذا لا يجب
//    اعتباره ضمن المبلغ الواجب استلامه عند حساب الباقي.
function calcChange() {
  const receivedInput = document.getElementById('pos-received');
  const changeRow     = document.getElementById('pos-change-row');
  const changeEl       = document.getElementById('pos-change');
  if (!receivedInput || !changeRow || !changeEl) return;

  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  const disc = parseFloat(document.getElementById('pos-discount')?.value || 0);

  // المبلغ الواجب دفعه نقداً الآن = فقط جزء المنتجات "نقدي" من الفاتورة
  const { cashSubtotal } = getCartSplit();
  const cashDue = cashSubtotal * (1 - disc / 100);

  const received = parseFloat(receivedInput.value);

  if (!cart.length || isNaN(received) || received <= 0) {
    changeRow.style.display = 'none';
    changeRow.classList.remove('change-negative');
    changeEl.textContent = fmt(0) + ' ' + cur;
    return;
  }

  const diff = received - cashDue;
  changeRow.style.display = 'flex';
  if (diff >= 0) {
    changeRow.classList.remove('change-negative');
    changeEl.textContent = fmt(diff) + ' ' + cur;
  } else {
    changeRow.classList.add('change-negative');
    changeEl.textContent = 'ناقص ' + fmt(Math.abs(diff)) + ' ' + cur;
  }
}

// ─── أزرار المبالغ السريعة (فئات نقدية شائعة) + زر "المبلغ بالضبط" ───────────
function setReceivedAmount(amount) {
  const input = document.getElementById('pos-received');
  if (!input) return;
  input.value = amount;
  calcChange();
}

function setReceivedExact() {
  // المبلغ "بالضبط" يجب أن يساوي الجزء النقدي فقط (وليس المجموع الكلي الذي
  // يتضمّن أيضاً الجزء الآجل/الدين الذي لا يُدفع الآن)
  const disc = parseFloat(document.getElementById('pos-discount')?.value || 0);
  const { cashSubtotal } = getCartSplit();
  const cashDue = cashSubtotal * (1 - disc / 100);
  const input = document.getElementById('pos-received');
  if (!input) return;
  input.value = cashDue > 0 ? cashDue.toFixed(2) : '';
  calcChange();
}

function setupPaymentButtons() {
  document.querySelectorAll('.pay-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedPayment = btn.dataset.method;
    });
  });
}

function checkout() {
  if (!cart.length) { toast('السلة فارغة / Cart is empty', 'error'); return; }
  const subtotal   = cart.reduce((a, it) => a + it.total, 0);
  const disc       = parseFloat(document.getElementById('pos-discount')?.value || 0);
  const total      = subtotal * (1 - disc / 100);
  const profit     = cart.reduce((a, it) => a + it.profit, 0) * (1 - disc / 100);
  const custId     = document.getElementById('pos-customer')?.value || '';
  const cust       = custId ? DB.Customers.byId(custId) : null;

  // ─── تقسيم الفاتورة حسب طريقة دفع كل منتج (نقدي أو آجل) ───────────────────
  const { cashSubtotal, creditSubtotal } = getCartSplit();
  const cashAmount   = cashSubtotal   * (1 - disc / 100);
  const creditAmount = creditSubtotal * (1 - disc / 100);

  // ─── تقسيم الربح: نقدي/بطاقة (محقَّق فوراً) مقابل آجل (معلَّق حتى يُسدَّد الدين) ─
  const { cashProfit: cashProfitRaw, creditProfit: creditProfitRaw } = getCartProfitSplit();
  const cashProfit   = cashProfitRaw   * (1 - disc / 100);
  const creditProfit = creditProfitRaw * (1 - disc / 100);

  let paymentMethod;
  if (creditAmount <= 0)      paymentMethod = selectedPayment === 'card' ? 'card' : 'cash';
  else if (cashAmount <= 0)   paymentMethod = 'credit';
  else                        paymentMethod = 'mixed';

  // ⚠️ البيع الآجل (كلياً أو جزئياً) يتطلب تحديد زبون
  if (creditAmount > 0) {
    if (!custId) {
      toast('⚠️ وجود منتجات آجلة يتطلب تحديد زبون / Credit items require a customer', 'error');
      return;
    }
    if (cust && (cust.debt || 0) > 0) {
      const S = DB.Settings.get(); const cur = S.currency || 'دج';
      const newDebt = (cust.debt || 0) + creditAmount;
      if (!confirm(
        `⚠️ تحذير — ${escHtml(cust.name)} لديه دين غير مسدَّد!\n\n` +
        `الدين الحالي: ${fmt(cust.debt)} ${cur}\n` +
        `الجزء الآجل من هذه الفاتورة: ${fmt(creditAmount)} ${cur}\n` +
        `الدين الجديد بعد البيع: ${fmt(newDebt)} ${cur}\n\n` +
        `هل تريد المتابعة وإضافة دين جديد؟`
      )) return;
    }
  }

  // ─── التقط المبلغ المستلم والباقي قبل مسح السلة (للعرض في الإيصال فقط) ─────
  // ⚠️ الباقي يُحسب مقارنةً بالجزء النقدي فقط (cashAmount) وليس الإجمالي الكلي،
  //    لأن الجزء الآجل يُسجَّل كدين على الزبون ولا يُدفع نقداً الآن
  const receivedRaw = parseFloat(document.getElementById('pos-received')?.value);
  const received = !isNaN(receivedRaw) && receivedRaw > 0 ? receivedRaw : null;
  const changeDue = received != null ? received - cashAmount : null;

  const itemsDiscountTotal = cart.reduce((a, it) => a + (it.price * it.qty - it.total), 0);

  const sale = DB.Sales.create({
    customerId: custId || null, customerName: cust ? cust.name : 'زبون عام',
    items: [...cart], subtotal, discount: disc, itemsDiscountTotal, total, profit,
    paymentMethod, cashAmount, creditAmount, cashProfit, creditProfit
  });

  clearCart();
  document.getElementById('pos-discount').value = 0;
  document.getElementById('pos-debt-banner').style.display = 'none';
  renderPOSProducts();
  checkAlerts();
  updateUndoButton();
  showQuickReceipt(sale, received, changeDue);
}

function showQuickReceipt(sale, received, changeDue) {
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const el = document.getElementById('receipt-content');
  if (!el) { toast(`✓ تم البيع! ${sale.invoiceNo}`, 'success'); return; }
  el.innerHTML = `
    <div class="receipt-body">
      <div class="receipt-success-icon"><i class="fas fa-circle-check"></i></div>
      <div class="receipt-inv-no">${sale.invoiceNo}</div>
      <div class="receipt-barcode">${typeof DakaniBarcode !== 'undefined' ? DakaniBarcode.toSVG(sale.invoiceNo, { unit: 1.6, height: 34, showText: false }) : ''}</div>
      <div class="receipt-customer"><i class="fas fa-user"></i> ${escHtml(sale.customerName)}</div>
      <div class="receipt-items">
        ${sale.items.map(it => `<div class="receipt-item">
          <span>${escHtml(it.nameAr)} × ${it.qty} ${(it.payType||'cash')==='credit' ? '<span class="badge pay-credit" style="font-size:10px;margin-right:6px">آجل</span>' : ''}${(it.discount||0) > 0 ? `<span class="badge" style="font-size:10px;margin-right:6px;background:#ef444420;color:#ef4444">-${it.discount}%</span>` : ''}</span>
          <span>${fmt(it.total)} ${cur}</span>
        </div>`).join('')}
      </div>
      ${sale.itemsDiscountTotal ? `<div class="receipt-disc">خصم منتجات — −${fmt(sale.itemsDiscountTotal)} ${cur}</div>` : ''}
      ${sale.discount ? `<div class="receipt-disc">خصم الفاتورة ${sale.discount}% — −${fmt(sale.subtotal * sale.discount / 100)} ${cur}</div>` : ''}
      <div class="receipt-total">
        <span>الإجمالي</span>
        <span>${fmt(sale.total)} ${cur}</span>
      </div>
      ${sale.paymentMethod === 'mixed' ? `<div class="receipt-split">
          <div><i class="fas fa-money-bill"></i> نقدي: <strong>${fmt(sale.cashAmount || 0)} ${cur}</strong></div>
          <div><i class="fas fa-clock"></i> آجل: <strong>${fmt(sale.creditAmount || 0)} ${cur}</strong></div>
        </div>` : ''}
      ${received != null ? `<div class="receipt-split">
          <div><i class="fas fa-hand-holding-dollar"></i> المستلم: <strong>${fmt(received)} ${cur}</strong></div>
          <div><i class="fas fa-coins"></i> الباقي: <strong>${fmt(Math.max(changeDue, 0))} ${cur}</strong></div>
        </div>` : ''}
      <div class="receipt-profit">ربح هذه الفاتورة (محقَّق الآن): ${_hideIfCashier('+' + fmt(sale.cashProfit != null ? sale.cashProfit : sale.profit) + ' ' + cur)}</div>
      ${(sale.creditProfit || 0) > 0.004 ? `<div class="receipt-disc" style="color:var(--gold,#f59e0b)"><i class="fas fa-hourglass-half"></i> ربح معلَّق (آجل، حتى السداد): ${_hideIfCashier('+' + fmt(sale.creditProfit) + ' ' + cur)}</div>` : ''}
      <div class="receipt-method"><span class="badge pay-${sale.paymentMethod}">${payLabel(sale.paymentMethod)}</span></div>
      ${(() => {
        if ((sale.paymentMethod === 'credit' || sale.paymentMethod === 'mixed') && sale.customerId) {
          const c = DB.Customers.byId(sale.customerId);
          if (c && (c.debt||0) > 0) {
            const S = DB.Settings.get(); const cur = S.currency || 'دج';
            return `<div style="margin-top:10px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:10px;font-size:13px;color:#f87171;text-align:center">
              <i class="fas fa-triangle-exclamation"></i> إجمالي دين ${escHtml(c.name)}: <strong>${fmt(c.debt)} ${cur}</strong>
            </div>`;
          }
        }
        return '';
      })()}
    </div>`;
  _currentInvoiceId = sale.id;
  openModal('modal-receipt');
}

function printReceipt() {
  closeModal('modal-receipt');
  if (_currentInvoiceId) {
    viewInvoice(_currentInvoiceId);
    setTimeout(() => printInvoice(), 400);
  }
}

// ─── Purchases ────────────────────────────────────────────────────────────────
function renderPurchases() {
  const from   = document.getElementById('purch-date-from')?.value;
  const to     = document.getElementById('purch-date-to')?.value;
  const suppId = document.getElementById('purch-supplier-filter')?.value || '';
  let list     = DB.Purchases.all();
  if (from && to) list = list.filter(p => p.date >= from && p.date <= to);
  if (suppId) list = list.filter(p => p.supplierId === suppId);
  list = list.slice().reverse();
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('purchases-body');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map((p, i) => {
    const prod = DB.Products.byId(p.productId);
    const supp = p.supplierId ? DB.Suppliers.byId(p.supplierId) : null;
    const total = p.qty * p.unitPrice;
    return `<tr>
      <td>${i+1}</td>
      <td>${prod ? escHtml(prod.nameAr) : '—'}</td>
      <td>${supp ? `<span class="badge-supp" onclick="viewSupplierDetail('${supp.id}')">${escHtml(supp.name)}</span>` : (p.supplier || '—')}</td>
      <td>${p.qty} ${prod?.unit || ''}</td>
      <td>${fmt(p.unitPrice)} ${cur}</td>
      <td><strong>${fmt(total)} ${cur}</strong></td>
      <td>${fmtDate(p.date)}</td>
      <td class="text-muted">${escHtml(p.notes || '—')}</td>
      <td>
        <button class="btn-icon edit" onclick="editPurchase('${p.id}')" title="تعديل"><i class="fas fa-pen"></i></button>
        <button class="btn-icon danger" onclick="deletePurchase('${p.id}')" title="حذف"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="9" class="empty-td">لا توجد مشتريات / No purchases</td></tr>';

  // شريط الملخص
  const total = list.reduce((a, p) => a + p.qty * p.unitPrice, 0);
  const bar = document.getElementById('purch-summary-bar');
  if (bar && list.length) {
    bar.innerHTML = `<span><i class="fas fa-receipt"></i> ${list.length} مشترى</span>
      <span><i class="fas fa-coins"></i> الإجمالي: <strong>${fmt(total)} ${cur}</strong></span>`;
  } else if (bar) bar.innerHTML = '';
}

function populatePurchaseModal(purchase) {
  const sel = document.getElementById('purch-product');
  if (!sel) return;
  sel.innerHTML = DB.Products.all().map(p => `<option value="${p.id}">${escHtml(p.nameAr)}</option>`).join('');
  // populate supplier select
  const suppSel = document.getElementById('purch-supplier');
  if (suppSel) {
    suppSel.innerHTML = '<option value="">— بدون مورد —</option>' +
      DB.Suppliers.all().map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  }

  if (purchase) {
    // وضع التعديل: نملأ الحقول ببيانات المشترى الموجود
    document.getElementById('purch-modal-title').textContent = 'تعديل مشترى / Edit Purchase';
    document.getElementById('purch-id').value       = purchase.id;
    document.getElementById('purch-product').value  = purchase.productId;
    document.getElementById('purch-supplier').value = purchase.supplierId || '';
    document.getElementById('purch-qty').value      = purchase.qty;
    document.getElementById('purch-price').value    = purchase.unitPrice;
    document.getElementById('purch-date').value     = purchase.date || DB.today();
    document.getElementById('purch-notes').value    = purchase.notes || '';
  } else {
    // وضع الإضافة: نبدأ بحقول فارغة
    document.getElementById('purch-modal-title').textContent = 'إضافة مشترى / Add Purchase';
    document.getElementById('purch-id').value    = '';
    document.getElementById('purch-qty').value   = '';
    document.getElementById('purch-price').value = '';
    document.getElementById('purch-notes').value = '';
    document.getElementById('purch-date').value  = DB.today();
  }
}

function editPurchase(id) {
  const p = DB.Purchases.all().find(p => p.id === id);
  if (!p) return;
  document.getElementById('modal-purchase').classList.add('active');
  populatePurchaseModal(p);
}

function savePurchase() {
  const id         = document.getElementById('purch-id').value || null;
  const productId  = document.getElementById('purch-product').value;
  const qty        = parseInt(document.getElementById('purch-qty').value) || 0;
  const unitPrice  = parseFloat(document.getElementById('purch-price').value) || 0;
  const supplierId = document.getElementById('purch-supplier').value;
  if (!productId || qty < 1) { toast('أدخل المنتج والكمية', 'error'); return; }
  const data = {
    productId, qty, unitPrice, supplierId,
    supplier:  supplierId ? (DB.Suppliers.byId(supplierId)?.name || '') : '',
    date:      document.getElementById('purch-date').value,
    notes:     document.getElementById('purch-notes')?.value.trim() || ''
  };
  if (id) {
    DB.Purchases.update(id, data);
    toast('تم تحديث المشترى وتعديل المخزون ✓', 'success');
  } else {
    DB.Purchases.save(data);
    toast('تم تسجيل المشترى وتحديث المخزون ✓', 'success');
    updateUndoButton();
  }
  closeModal('modal-purchase');
  renderPurchases();
  renderProducts();
  renderSuppliers();
}

function deletePurchase(id) {
  if (!confirm('حذف هذا المشترى؟ سيتم تقليل المخزون')) return;
  DB.Purchases.delete(id);
  DB.UndoManager.invalidate('purchase', id);
  renderPurchases();
  renderProducts();
  renderSuppliers();
  updateUndoButton();
  toast('تم الحذف', 'info');
}

// ─── Suppliers ───────────────────────────────────────────────────────────────
function renderSuppliers() {
  const q    = (document.getElementById('supp-search')?.value || '').toLowerCase();
  let list   = DB.Suppliers.all();
  if (q) list = list.filter(s => s.name.toLowerCase().includes(q) || (s.phone||'').includes(q) || (s.city||'').toLowerCase().includes(q));
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('suppliers-body');
  if (!tbody) return;

  tbody.innerHTML = list.length ? list.map((s, i) => {
    const owedBalance = s.balance || 0;
    return `
    <tr class="${owedBalance > 0 ? 'row-debt' : ''}">
      <td>${i+1}</td>
      <td>
        <div style="font-weight:700;color:var(--text1)">${escHtml(s.name)}</div>
        ${s.products ? `<div style="font-size:11px;color:var(--text3)">${s.products}</div>` : ''}
      </td>
      <td>${s.phone ? `<a href="tel:${escHtml(s.phone)}" style="color:var(--accent)">${escHtml(s.phone)}</a>` : '—'}</td>
      <td>${escHtml(s.city || s.address || '—')}</td>
      <td><strong>${fmt(s.totalPurchased || 0)} ${cur}</strong></td>
      <td class="${owedBalance > 0 ? 'debt-cell-danger' : 'debt-cell-clear'}">
        ${owedBalance > 0
          ? `<div class="debt-amount-badge">${fmt(owedBalance)} ${cur}</div>`
          : `<span class="debt-clear-badge"><i class="fas fa-check-circle"></i> مسدّد</span>`}
      </td>
      <td><span class="badge-count">${s.orderCount || 0}</span></td>
      <td>${s.lastOrder ? fmtDate(s.lastOrder) : '—'}</td>
      <td style="display:flex;gap:6px;flex-wrap:wrap">
        ${owedBalance > 0 ? `<button class="btn-icon pay-btn-icon" onclick="openSupplierPayModal('${s.id}')" title="تسديد دفعة"><i class="fas fa-hand-holding-dollar"></i></button>` : ''}
        <button class="btn-icon" onclick="viewSupplierStatement('${s.id}')" title="كشف حساب"><i class="fas fa-file-invoice-dollar"></i></button>
        <button class="btn-icon" onclick="viewSupplierDetail('${s.id}')" title="تفاصيل"><i class="fas fa-eye"></i></button>
        <button class="btn-icon edit" onclick="openSupplierModal('${s.id}')" title="تعديل"><i class="fas fa-edit"></i></button>
        <button class="btn-icon danger" onclick="deleteSupplier('${s.id}')" title="حذف"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('')
  : '<tr><td colspan="9" class="empty-td">لا يوجد موردون — أضف أول مورد</td></tr>';

  // KPI cards
  const kpiGrid = document.getElementById('supp-kpi-grid');
  if (kpiGrid) {
    const totalSpent   = list.reduce((a, s) => a + (s.totalPurchased || 0), 0);
    const totalOrders  = list.reduce((a, s) => a + (s.orderCount    || 0), 0);
    const totalOwed    = list.reduce((a, s) => a + (s.balance       || 0), 0);
    const owedCount    = list.filter(s => (s.balance || 0) > 0).length;
    kpiGrid.innerHTML = `
      <div class="kpi-card kpi-sales">
        <div class="kpi-icon"><i class="fas fa-truck"></i></div>
        <div class="kpi-info"><div class="kpi-value">${list.length}</div><div class="kpi-label">عدد الموردين</div></div>
      </div>
      <div class="kpi-card kpi-profit">
        <div class="kpi-icon"><i class="fas fa-coins"></i></div>
        <div class="kpi-info"><div class="kpi-value">${fmt(totalSpent)} ${cur}</div><div class="kpi-label">إجمالي المشتريات</div></div>
      </div>
      <div class="kpi-card kpi-invoices">
        <div class="kpi-icon"><i class="fas fa-box"></i></div>
        <div class="kpi-info"><div class="kpi-value">${totalOrders}</div><div class="kpi-label">إجمالي الطلبات</div></div>
      </div>
      <div class="kpi-card kpi-low">
        <div class="kpi-icon"><i class="fas fa-triangle-exclamation"></i></div>
        <div class="kpi-info"><div class="kpi-value">${fmt(totalOwed)} ${cur}</div><div class="kpi-label">إجمالي المستحق لهم (${owedCount})</div></div>
      </div>`;
  }

  // Summary bar
  const bar = document.getElementById('supp-summary-bar');
  if (bar && list.length) {
    const totalSpent = list.reduce((a, s) => a + (s.totalPurchased || 0), 0);
    const totalOwed  = list.reduce((a, s) => a + (s.balance || 0), 0);
    bar.innerHTML = `<span><i class="fas fa-truck"></i> ${list.length} مورد</span>
      <span><i class="fas fa-coins"></i> إجمالي: <strong>${fmt(totalSpent)} ${cur}</strong></span>
      ${totalOwed > 0 ? `<span class="debt-cell-danger"><i class="fas fa-sack-dollar"></i> مستحق: <strong>${fmt(totalOwed)} ${cur}</strong></span>` : ''}`;
  } else if (bar) bar.innerHTML = '';

  // Populate supplier filter in purchases page
  const suppFilter = document.getElementById('purch-supplier-filter');
  if (suppFilter) {
    const all = DB.Suppliers.all();
    suppFilter.innerHTML = '<option value="">كل الموردين</option>' +
      all.map(s => `<option value="${s.id}">${escHtml(s.name)}</option>`).join('');
  }
}

function openSupplierModal(id = null) {
  document.getElementById('supp-id').value    = '';
  document.getElementById('supp-name').value  = '';
  document.getElementById('supp-phone').value = '';
  document.getElementById('supp-city').value  = '';
  document.getElementById('supp-email').value = '';
  document.getElementById('supp-address').value  = '';
  document.getElementById('supp-products').value = '';
  document.getElementById('supp-notes').value    = '';
  document.getElementById('supp-balance').value  = '0';
  document.getElementById('supp-modal-title').innerHTML = '<i class="fas fa-truck"></i> إضافة مورد / Add Supplier';

  if (id) {
    const s = DB.Suppliers.byId(id);
    if (!s) return;
    document.getElementById('supp-id').value       = s.id;
    document.getElementById('supp-name').value     = s.name     || '';
    document.getElementById('supp-phone').value    = s.phone    || '';
    document.getElementById('supp-city').value     = s.city     || '';
    document.getElementById('supp-email').value    = s.email    || '';
    document.getElementById('supp-address').value  = s.address  || '';
    document.getElementById('supp-products').value = s.products || '';
    document.getElementById('supp-notes').value    = s.notes    || '';
    document.getElementById('supp-balance').value  = s.balance  || 0;
    document.getElementById('supp-modal-title').innerHTML = '<i class="fas fa-edit"></i> تعديل المورد / Edit Supplier';
  }
  openModal('modal-supplier');
}

function saveSupplier() {
  const name = document.getElementById('supp-name').value.trim();
  if (!name) { toast('اسم المورد مطلوب', 'error'); return; }
  const data = {
    id:       document.getElementById('supp-id').value || undefined,
    name,
    phone:    document.getElementById('supp-phone').value.trim(),
    city:     document.getElementById('supp-city').value.trim(),
    email:    document.getElementById('supp-email').value.trim(),
    address:  document.getElementById('supp-address').value.trim(),
    products: document.getElementById('supp-products').value.trim(),
    notes:    document.getElementById('supp-notes').value.trim(),
    balance:  parseFloat(document.getElementById('supp-balance')?.value) || 0
  };
  if (!data.id) delete data.id;
  DB.Suppliers.save(data);
  closeModal('modal-supplier');
  renderSuppliers();
  // تحديث select المورد في المشتريات
  populatePurchaseModal();
  toast('تم حفظ المورد ✓', 'success');
}

function deleteSupplier(id) {
  const s = DB.Suppliers.byId(id);
  if (!s) return;
  // تحقق هل لديه مشتريات أو دفعات مسجّلة
  const hasPurchases = DB.Purchases.all().some(p => p.supplierId === id);
  const hasPayments  = DB.SupplierPayments.bySupplier(id).length > 0;
  if (hasPurchases || hasPayments) {
    if (!confirm(`⚠️ المورد "${escHtml(s.name)}" لديه ${hasPurchases ? 'مشتريات' : ''}${hasPurchases && hasPayments ? ' و' : ''}${hasPayments ? 'دفعات' : ''} مسجّلة. حذفه لن يحذفها. هل تريد المتابعة؟`)) return;
  } else {
    if (!confirm(`حذف المورد "${escHtml(s.name)}"؟`)) return;
  }
  DB.Suppliers.delete(id);
  renderSuppliers();
  toast('تم حذف المورد', 'info');
}

function viewSupplierDetail(id) {
  const s    = DB.Suppliers.byId(id);
  if (!s) return;
  const S    = DB.Settings.get(); const cur = S.currency || 'دج';
  const purchases = DB.Purchases.all()
    .filter(p => p.supplierId === id)
    .slice().reverse().slice(0, 10);
  const payments = DB.SupplierPayments.bySupplier(id).slice().reverse().slice(0, 10);
  const owedBalance = s.balance || 0;

  document.getElementById('supp-detail-title').innerHTML = `<i class="fas fa-truck"></i> ${escHtml(s.name)}`;
  document.getElementById('supp-detail-edit-btn').onclick = () => {
    closeModal('modal-supplier-detail');
    openSupplierModal(id);
  };

  const body = document.getElementById('supp-detail-body');
  body.innerHTML = `
    <div class="supp-detail-grid">
      <div class="supp-detail-info">
        <h3 style="margin:0 0 14px;color:var(--text1)"><i class="fas fa-info-circle"></i> معلومات المورد</h3>
        <div class="detail-row"><span><i class="fas fa-user"></i> الاسم</span><strong>${escHtml(s.name)}</strong></div>
        ${s.phone    ? `<div class="detail-row"><span><i class="fas fa-phone"></i> الهاتف</span><a href="tel:${escHtml(s.phone)}" style="color:var(--accent)">${escHtml(s.phone)}</a></div>` : ''}
        ${s.city     ? `<div class="detail-row"><span><i class="fas fa-city"></i> المدينة</span><span>${escHtml(s.city)}</span></div>` : ''}
        ${s.address  ? `<div class="detail-row"><span><i class="fas fa-map-marker-alt"></i> العنوان</span><span>${escHtml(s.address)}</span></div>` : ''}
        ${s.email    ? `<div class="detail-row"><span><i class="fas fa-envelope"></i> البريد</span><a href="mailto:${escHtml(s.email)}" style="color:var(--accent)">${escHtml(s.email)}</a></div>` : ''}
        ${s.products ? `<div class="detail-row"><span><i class="fas fa-boxes-stacked"></i> المنتجات</span><span>${s.products}</span></div>` : ''}
        ${s.notes    ? `<div class="detail-row"><span><i class="fas fa-note-sticky"></i> ملاحظات</span><span>${escHtml(s.notes)}</span></div>` : ''}
        <div class="supp-stat-row">
          <div class="supp-stat"><div class="supp-stat-val">${fmt(s.totalPurchased||0)} ${cur}</div><div class="supp-stat-lbl">إجمالي المشتريات</div></div>
          <div class="supp-stat"><div class="supp-stat-val">${s.orderCount||0}</div><div class="supp-stat-lbl">عدد الطلبات</div></div>
          <div class="supp-stat"><div class="supp-stat-val">${s.lastOrder ? fmtDate(s.lastOrder) : '—'}</div><div class="supp-stat-lbl">آخر طلب</div></div>
        </div>
        <div class="supp-stat-row" style="margin-top:8px">
          <div class="supp-stat ${owedBalance > 0 ? '' : ''}">
            <div class="supp-stat-val" style="color:${owedBalance > 0 ? '#f87171' : 'var(--accent)'}">${fmt(owedBalance)} ${cur}</div>
            <div class="supp-stat-lbl">المستحق له حالياً</div>
          </div>
        </div>
        ${owedBalance > 0 ? `<div style="text-align:center;margin-top:12px">
          <button class="btn-primary" onclick="closeModal('modal-supplier-detail');openSupplierPayModal('${s.id}')">
            <i class="fas fa-hand-holding-dollar"></i> تسديد دفعة الآن
          </button></div>` : ''}
      </div>
    </div>
    <h3 style="margin:20px 0 10px;color:var(--text1)"><i class="fas fa-history"></i> آخر المشتريات</h3>
    ${purchases.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>المنتج</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th><th>التاريخ</th></tr></thead>
        <tbody>${purchases.map(p => {
          const prod = DB.Products.byId(p.productId);
          return `<tr>
            <td>${prod ? escHtml(prod.nameAr) : '—'}</td>
            <td>${p.qty} ${prod?.unit||''}</td>
            <td>${fmt(p.unitPrice)} ${cur}</td>
            <td><strong>${fmt(p.qty*p.unitPrice)} ${cur}</strong></td>
            <td>${fmtDate(p.date)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<p class="empty-td">لا توجد مشتريات من هذا المورد بعد</p>'}

    <h3 style="margin:20px 0 10px;color:var(--text1)"><i class="fas fa-hand-holding-dollar"></i> آخر الدفعات المسدَّدة</h3>
    ${payments.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>التاريخ</th><th>المبلغ</th><th>ملاحظة</th><th>حذف</th></tr></thead>
        <tbody>${payments.map(p => `<tr class="pay-row">
            <td>${fmtDate(p.date)}</td>
            <td class="debt-cell-clear"><strong>${fmt(p.amount)} ${cur}</strong></td>
            <td class="text-muted">${escHtml(p.note || '—')}</td>
            <td><button class="btn-icon danger" onclick="deleteSupplierPayment('${p.id}','${s.id}')" title="إلغاء الدفعة"><i class="fas fa-trash"></i></button></td>
          </tr>`).join('')}</tbody>
      </table>
    </div>
    <div style="text-align:center;margin-top:10px">
      <button class="btn-secondary" onclick="closeModal('modal-supplier-detail');viewSupplierStatement('${s.id}')">
        <i class="fas fa-file-invoice-dollar"></i> عرض كشف الحساب الكامل
      </button>
    </div>` : '<p class="empty-td">لا توجد دفعات مسجّلة لهذا المورد بعد</p>'}`;

  openModal('modal-supplier-detail');
}

// ─── Supplier Payment Functions (سجل المدفوعات للموردين) ──────────────────────
function openSupplierPayModal(supplierId) {
  const s = DB.Suppliers.byId(supplierId);
  if (!s) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  document.getElementById('supp-pay-id').value     = supplierId;
  document.getElementById('supp-pay-amount').value = '';
  document.getElementById('supp-pay-note').value   = '';
  document.getElementById('supp-pay-date').value   = DB.today();
  document.getElementById('supp-pay-preview').style.display = 'none';

  document.getElementById('supp-pay-info').innerHTML = `
    <div class="debt-info-row"><span><i class="fas fa-truck"></i> المورد</span><strong>${escHtml(s.name)}</strong></div>
    <div class="debt-info-row"><span><i class="fas fa-sack-dollar"></i> المستحق له حالياً</span>
      <strong class="debt-total-val">${fmt(s.balance||0)} ${cur}</strong></div>
    ${s.phone ? `<div class="debt-info-row"><span><i class="fas fa-phone"></i> الهاتف</span><a href="tel:${escHtml(s.phone)}" style="color:var(--accent)">${escHtml(s.phone)}</a></div>` : ''}`;

  const balance = s.balance || 0;
  const quarters = [
    { label: 'ربع', val: Math.round(balance * 0.25) },
    { label: 'نصف', val: Math.round(balance * 0.5) },
    { label: 'ثلاثة أرباع', val: Math.round(balance * 0.75) },
    { label: 'كامل', val: balance }
  ].filter(q => q.val > 0);
  document.getElementById('supp-pay-quick-btns').innerHTML = quarters.map(q =>
    `<button class="debt-quick-btn" onclick="setSupplierPayAmount(${q.val})">${q.label}<br><small>${fmt(q.val)} ${cur}</small></button>`
  ).join('');

  openModal('modal-supplier-pay');
}

function setSupplierPayAmount(val) {
  document.getElementById('supp-pay-amount').value = val;
  updateSupplierPayPreview();
}

function paySupplierFull() {
  const id = document.getElementById('supp-pay-id').value;
  const s  = DB.Suppliers.byId(id);
  if (!s) return;
  document.getElementById('supp-pay-amount').value = s.balance || 0;
  updateSupplierPayPreview();
}

function updateSupplierPayPreview() {
  const id      = document.getElementById('supp-pay-id').value;
  const s       = DB.Suppliers.byId(id);
  const amount  = parseFloat(document.getElementById('supp-pay-amount').value) || 0;
  const preview = document.getElementById('supp-pay-preview');
  if (!s || amount <= 0) { preview.style.display = 'none'; return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const remaining = Math.max(0, (s.balance||0) - amount);
  const isOver    = amount > (s.balance||0);
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="debt-preview-row">
      <span>المستحق قبل الدفع</span><span>${fmt(s.balance||0)} ${cur}</span>
    </div>
    <div class="debt-preview-row pay">
      <span>المبلغ المدفوع</span><span>− ${fmt(Math.min(amount, s.balance||0))} ${cur}</span>
    </div>
    <div class="debt-preview-row remain ${remaining === 0 ? 'clear' : ''}">
      <span>المستحق المتبقي</span><strong>${fmt(remaining)} ${cur}</strong>
    </div>
    ${isOver ? `<div class="debt-preview-warn"><i class="fas fa-triangle-exclamation"></i> المبلغ أكبر من المستحق — سيُسجَّل فقط ${fmt(s.balance||0)} ${cur}</div>` : ''}`;
}

function saveSupplierPayment() {
  const supplierId = document.getElementById('supp-pay-id').value;
  const amount     = parseFloat(document.getElementById('supp-pay-amount').value) || 0;
  const note       = document.getElementById('supp-pay-note').value.trim();
  const date       = document.getElementById('supp-pay-date').value;
  if (!supplierId || amount <= 0) { toast('أدخل مبلغ الدفعة', 'error'); return; }

  const payment = DB.SupplierPayments.add(supplierId, amount, note, date ? date + 'T12:00:00' : null);
  if (!payment) { toast('خطأ في تسجيل الدفعة', 'error'); return; }

  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  closeModal('modal-supplier-pay');
  renderSuppliers();
  toast(`✓ تم تسجيل دفعة ${fmt(payment.amount)} ${cur} لـ ${escHtml(payment.supplierName)}`, 'success');
}

function deleteSupplierPayment(paymentId, supplierId) {
  if (!confirm('إلغاء هذه الدفعة؟ سيعود المبلغ إلى مستحقات المورد')) return;
  DB.SupplierPayments.delete(paymentId);
  renderSuppliers();
  viewSupplierDetail(supplierId); // تحديث التفاصيل
  toast('تم إلغاء الدفعة وإعادة المستحق', 'info');
}

function viewSupplierStatement(supplierId) {
  const s = DB.Suppliers.byId(supplierId);
  if (!s) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  // جمع المشتريات (منها ينشأ ما يُستحق للمورد إن كانت آجلة، وتُحسب هنا كمرجع تاريخي)
  const purchases = DB.Purchases.all().filter(p => p.supplierId === supplierId).slice().reverse();
  // جمع الدفعات المسددة للمورد
  const payments  = DB.SupplierPayments.bySupplier(supplierId).slice().reverse();

  // بناء timeline مدمج
  const timeline = [
    ...purchases.map(p => ({ type: 'purchase', date: p.date, data: p })),
    ...payments.map(p  => ({ type: 'pay',      date: p.date, data: p }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  document.getElementById('stmt-title').innerHTML =
    `<i class="fas fa-file-invoice-dollar"></i> كشف حساب مورد: ${escHtml(s.name)}`;

  const totalPurchases = purchases.reduce((a, p) => a + (p.qty * p.unitPrice), 0);
  const totalPaid       = payments.reduce((a, p) => a + p.amount, 0);
  const currentBalance  = s.balance || 0;

  document.getElementById('stmt-body').innerHTML = `
    <div class="stmt-summary">
      <div class="stmt-kpi"><div class="stmt-kpi-val">${fmt(totalPurchases)} ${cur}</div><div class="stmt-kpi-lbl">إجمالي المشتريات</div></div>
      <div class="stmt-kpi"><div class="stmt-kpi-val paid">${fmt(totalPaid)} ${cur}</div><div class="stmt-kpi-lbl">إجمالي المدفوع</div></div>
      <div class="stmt-kpi ${currentBalance > 0 ? 'danger' : 'clear'}">
        <div class="stmt-kpi-val">${fmt(currentBalance)} ${cur}</div>
        <div class="stmt-kpi-lbl">المستحق المتبقي</div>
      </div>
      ${s.phone ? `<div class="stmt-kpi"><div class="stmt-kpi-val" style="font-size:14px">${escHtml(s.phone)}</div><div class="stmt-kpi-lbl">الهاتف</div></div>` : ''}
    </div>

    ${currentBalance > 0 ? `<div style="text-align:center;margin:12px 0">
      <button class="btn-primary" onclick="closeModal('modal-cust-statement');openSupplierPayModal('${s.id}')">
        <i class="fas fa-hand-holding-dollar"></i> تسديد المستحق الآن
      </button></div>` : ''}

    <h3 style="margin:20px 0 10px;color:var(--text1)"><i class="fas fa-history"></i> سجل المعاملات</h3>
    ${timeline.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>التفاصيل</th><th>المبلغ</th><th>حذف</th></tr></thead>
        <tbody>${timeline.map(t => {
          if (t.type === 'purchase') {
            const p = t.data;
            const prod = DB.Products.byId(p.productId);
            return `<tr>
              <td>${fmtDate(p.date)}</td>
              <td><span class="badge pay-credit">مشترى</span></td>
              <td>${prod ? escHtml(prod.nameAr) : '—'} × ${p.qty}</td>
              <td><strong>${fmt(p.qty*p.unitPrice)} ${cur}</strong></td>
              <td>—</td>
            </tr>`;
          } else {
            const p = t.data;
            return `<tr class="pay-row">
              <td>${fmtDate(p.date)}</td>
              <td><span class="badge-pay-tag">✓ دفعة</span></td>
              <td>${escHtml(p.note || 'دفعة للمورد')}</td>
              <td class="debt-cell-clear"><strong>− ${fmt(p.amount)} ${cur}</strong></td>
              <td><button class="btn-icon danger" onclick="deleteSupplierPayment('${p.id}','${supplierId}');closeModal('modal-cust-statement')" title="إلغاء الدفعة"><i class="fas fa-trash"></i></button></td>
            </tr>`;
          }
        }).join('')}</tbody>
      </table>
    </div>` : '<p class="empty-td">لا توجد معاملات بعد</p>'}`;

  openModal('modal-cust-statement');
}

// ─── تصنيف الزبائن (Customer Classification) ───────────────────────────────
// التصنيف يُحسب تلقائياً من إجمالي مشتريات الزبون (totalBought) — لا يُخزَّن
// في قاعدة البيانات، بل يُحسب عند العرض فقط، حتى يبقى متوافقاً دائماً مع
// آخر تعديل للحدود من صفحة الإعدادات دون الحاجة لأي ترحيل بيانات.
const CUSTOMER_TIERS = {
  vip:     { key: 'vip',     labelAr: 'ماسي / VIP', icon: 'fa-gem',    color: '#8b5cf6' },
  gold:    { key: 'gold',    labelAr: 'ذهبي',        icon: 'fa-award',  color: 'var(--gold)' },
  silver:  { key: 'silver',  labelAr: 'فضي',         icon: 'fa-medal',  color: 'var(--blue)' },
  regular: { key: 'regular', labelAr: 'عادي',        icon: 'fa-user',   color: 'var(--text3)' },
  new:     { key: 'new',     labelAr: 'جديد',        icon: 'fa-star',   color: 'var(--accent)' }
};

function classifyCustomer(c) {
  const S        = DB.Settings.get();
  const vipMin    = S.custTierVip    || 50000;
  const goldMin   = S.custTierGold   || 20000;
  const silverMin = S.custTierSilver || 5000;
  const bought    = (c && c.totalBought)    || 0;
  const visits    = (c && c.purchaseCount)  || 0;
  const order     = ['new', 'regular', 'silver', 'gold', 'vip'];

  // 1) تصنيف حسب إجمالي المبلغ المُنفق
  let amountTier;
  if (bought <= 0)              amountTier = 'new';
  else if (bought >= vipMin)    amountTier = 'vip';
  else if (bought >= goldMin)   amountTier = 'gold';
  else if (bought >= silverMin) amountTier = 'silver';
  else                          amountTier = 'regular';

  // 2) ترقية تلقائية حسب "الولاء" (عدد مرات الشراء) — حتى لو كان المبلغ لا يزال صغيراً:
  //    5 عمليات شراء فأكثر → فضي على الأقل، 15 → ذهبي على الأقل، 30 → ماسي على الأقل
  let loyaltyTier = 'new';
  if (visits >= 30)      loyaltyTier = 'vip';
  else if (visits >= 15) loyaltyTier = 'gold';
  else if (visits >= 5)  loyaltyTier = 'silver';
  else if (visits >= 1)  loyaltyTier = 'regular';

  // التصنيف النهائي = الأعلى بين تصنيف المبلغ وتصنيف الولاء (ترقية فقط، لا تراجع)
  const finalKey = order.indexOf(loyaltyTier) > order.indexOf(amountTier) ? loyaltyTier : amountTier;
  return CUSTOMER_TIERS[finalKey];
}

function customerTierBadge(c) {
  const t = classifyCustomer(c);
  return `<span class="cust-tier-badge" style="background:${t.color}20;color:${t.color}" title="${t.labelAr}">
    <i class="fas ${t.icon}"></i> ${t.labelAr}
  </span>`;
}

// يعرض تصنيف الزبون داخل نافذة إضافة/تعديل زبون
function renderCustomerTierInfo(c) {
  const box = document.getElementById('cust-tier-info-box');
  if (!box) return;
  if (!c) {
    const t = CUSTOMER_TIERS.new;
    box.innerHTML = `
      <div class="cust-tier-info-row">
        <span class="cust-tier-badge" style="background:${t.color}20;color:${t.color}"><i class="fas ${t.icon}"></i> ${t.labelAr}</span>
        <span class="cust-tier-info-note">زبون جديد — يُصنَّف ويُرقّى تلقائياً حسب مشترياته وعدد مرات شرائه</span>
      </div>`;
    return;
  }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const visits = c.purchaseCount || 0;
  box.innerHTML = `
    <div class="cust-tier-info-row">
      ${customerTierBadge(c)}
      <span class="cust-tier-info-note">${fmt(c.totalBought||0)} ${cur} إجمالي المشتريات • ${visits} عملية شراء</span>
    </div>`;
}

// ─── Customers ────────────────────────────────────────────────────────────────
function renderCustomers() {
  const q          = (document.getElementById('cust-search')?.value || '').toLowerCase();
  const debtFilter = document.getElementById('cust-debt-filter')?.value || '';
  const tierFilter = document.getElementById('cust-tier-filter')?.value || '';
  let list         = DB.Customers.all();
  if (q)          list = list.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q));
  if (debtFilter === 'debt')  list = list.filter(c => (c.debt||0) > 0);
  if (debtFilter === 'clear') list = list.filter(c => (c.debt||0) <= 0);
  if (tierFilter)             list = list.filter(c => classifyCustomer(c).key === tierFilter);
  list = list.slice().sort((a,b) => (b.debt||0) - (a.debt||0));
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('customers-body');
  if (!tbody) return;

  tbody.innerHTML = list.length ? list.map((c, i) => {
    const hasDebt = (c.debt||0) > 0;
    return `<tr class="${hasDebt ? 'row-debt' : ''}">
      <td>${i+1}</td>
      <td>
        <div style="font-weight:700;color:var(--text1)">${escHtml(c.name)}</div>
        ${c.address ? `<div style="font-size:11px;color:var(--text3)">${escHtml(c.address)}</div>` : ''}
      </td>
      <td>${c.phone ? `<a href="tel:${escHtml(c.phone)}" style="color:var(--accent)">${escHtml(c.phone)}</a>` : '—'}</td>
      <td>${customerTierBadge(c)}</td>
      <td class="${hasDebt ? 'debt-cell-danger' : 'debt-cell-clear'}">
        ${hasDebt
          ? `<div class="debt-amount-badge">${fmt(c.debt)} ${cur}</div>`
          : `<span class="debt-clear-badge"><i class="fas fa-check-circle"></i> مسدّد</span>`}
      </td>
      <td>${fmt(c.totalBought||0)} ${cur}</td>
      <td style="font-size:12px;color:var(--text3)">${c.lastPayment ? fmtDate(c.lastPayment) : '—'}</td>
      <td style="display:flex;gap:5px;flex-wrap:wrap">
        ${hasDebt ? `<button class="btn-icon pay-btn-icon" onclick="openDebtPayModal('${c.id}')" title="تسديد دين"><i class="fas fa-hand-holding-dollar"></i></button>` : ''}
        <button class="btn-icon" onclick="viewCustomerStatement('${c.id}')" title="كشف حساب"><i class="fas fa-file-invoice-dollar"></i></button>
        <button class="btn-icon edit" onclick="editCustomer('${c.id}')" title="تعديل"><i class="fas fa-pen"></i></button>
        <button class="btn-icon danger" onclick="deleteCustomer('${c.id}')" title="حذف"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('')
  : '<tr><td colspan="8" class="empty-td">لا يوجد زبائن — أضف أول زبون</td></tr>';

  // KPI الديون
  const kpiGrid    = document.getElementById('cust-kpi-grid');
  const allC       = DB.Customers.all();
  const totalDebt  = allC.reduce((a,c) => a + (c.debt||0), 0);
  const debtCount  = allC.filter(c => (c.debt||0) > 0).length;
  const totalBought= allC.reduce((a,c) => a + (c.totalBought||0), 0);
  if (kpiGrid) kpiGrid.innerHTML = `
    <div class="kpi-card kpi-customers">
      <div class="kpi-icon"><i class="fas fa-users"></i></div>
      <div class="kpi-info"><div class="kpi-value">${allC.length}</div><div class="kpi-label">إجمالي الزبائن</div></div>
    </div>
    <div class="kpi-card kpi-low">
      <div class="kpi-icon"><i class="fas fa-triangle-exclamation"></i></div>
      <div class="kpi-info"><div class="kpi-value">${debtCount}</div><div class="kpi-label">زبائن لديهم ديون</div></div>
    </div>
    <div class="kpi-card kpi-sales">
      <div class="kpi-icon"><i class="fas fa-sack-dollar"></i></div>
      <div class="kpi-info"><div class="kpi-value">${fmt(totalDebt)} ${cur}</div><div class="kpi-label">إجمالي الديون</div></div>
    </div>
    <div class="kpi-card kpi-profit">
      <div class="kpi-icon"><i class="fas fa-chart-line"></i></div>
      <div class="kpi-info"><div class="kpi-value">${fmt(totalBought)} ${cur}</div><div class="kpi-label">إجمالي مشتريات الزبائن</div></div>
    </div>`;

  const bar = document.getElementById('cust-summary-bar');
  if (bar && list.length) {
    const shownDebt = list.reduce((a,c) => a + (c.debt||0), 0);
    bar.innerHTML = `<span><i class="fas fa-users"></i> ${list.length} زبون</span>
      <span class="debt-cell-danger"><i class="fas fa-sack-dollar"></i> ديون: <strong>${fmt(shownDebt)} ${cur}</strong></span>`;
  } else if (bar) bar.innerHTML = '';

  // شريط توزيع تصنيف الزبائن — قابل للنقر للتصفية السريعة
  const tierBar = document.getElementById('cust-tier-stats');
  if (tierBar) {
    const counts = { vip: 0, gold: 0, silver: 0, regular: 0, new: 0 };
    allC.forEach(c => { counts[classifyCustomer(c).key]++; });
    tierBar.innerHTML = Object.values(CUSTOMER_TIERS).map(t => `
      <button type="button" class="cust-tier-chip ${tierFilter === t.key ? 'active' : ''}"
        style="--tier-color:${t.color}"
        onclick="document.getElementById('cust-tier-filter').value='${tierFilter === t.key ? '' : t.key}';renderCustomers()">
        <i class="fas ${t.icon}"></i> ${t.labelAr} <strong>${counts[t.key]}</strong>
      </button>`).join('');
  }
}



function editCustomer(id) {
  const c = DB.Customers.byId(id);
  if (!c) return;
  document.getElementById('cust-modal-title').textContent = 'تعديل زبون / Edit Customer';
  document.getElementById('cust-id').value      = c.id;
  document.getElementById('cust-name').value    = c.name;
  document.getElementById('cust-phone').value   = c.phone || '';
  document.getElementById('cust-address').value = c.address || '';
  document.getElementById('cust-notes').value   = c.notes || '';
  renderCustomerTierInfo(c);
  openModal('modal-customer');
}

function saveCustomer() {
  const name = document.getElementById('cust-name').value.trim();
  if (!name) { toast('أدخل اسم الزبون / Enter customer name', 'error'); return; }
  DB.Customers.save({
    id:      document.getElementById('cust-id').value || null,
    name,
    phone:   document.getElementById('cust-phone').value.trim(),
    address: document.getElementById('cust-address').value.trim(),
    notes:   document.getElementById('cust-notes').value.trim()
  });
  closeModal('modal-customer');
  renderCustomers();
  toast('تم حفظ الزبون / Customer saved ✓', 'success');
}

function deleteCustomer(id) {
  if (!confirm('حذف هذا الزبون؟')) return;
  DB.Customers.delete(id);
  renderCustomers();
  toast('تم الحذف', 'info');
}

// ─── Debt Payment Functions ───────────────────────────────────────────────────
function openDebtPayModal(customerId) {
  const c = DB.Customers.byId(customerId);
  if (!c) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  document.getElementById('debt-cust-id').value = customerId;
  document.getElementById('debt-amount').value  = '';
  document.getElementById('debt-note').value    = '';
  document.getElementById('debt-date').value    = DB.today();
  document.getElementById('debt-preview').style.display = 'none';

  // معلومات الدين
  document.getElementById('debt-cust-info').innerHTML = `
    <div class="debt-info-row"><span><i class="fas fa-user"></i> الزبون</span><strong>${escHtml(c.name)}</strong></div>
    <div class="debt-info-row"><span><i class="fas fa-sack-dollar"></i> الدين الكلي</span>
      <strong class="debt-total-val">${fmt(c.debt||0)} ${cur}</strong></div>
    ${c.phone ? `<div class="debt-info-row"><span><i class="fas fa-phone"></i> الهاتف</span><a href="tel:${escHtml(c.phone)}" style="color:var(--accent)">${escHtml(c.phone)}</a></div>` : ''}`;

  // أزرار سريعة للمبالغ الشائعة
  const debt = c.debt || 0;
  const quarters = [
    { label: 'ربع', val: Math.round(debt * 0.25) },
    { label: 'نصف', val: Math.round(debt * 0.5) },
    { label: 'ثلاثة أرباع', val: Math.round(debt * 0.75) },
    { label: 'كامل', val: debt }
  ].filter(q => q.val > 0);
  document.getElementById('debt-quick-btns').innerHTML = quarters.map(q =>
    `<button class="debt-quick-btn" onclick="setDebtAmount(${q.val})">${q.label}<br><small>${fmt(q.val)} ${cur}</small></button>`
  ).join('');

  openModal('modal-debt-pay');
}

function setDebtAmount(val) {
  document.getElementById('debt-amount').value = val;
  updateDebtPreview();
}

function payFullDebt() {
  const id   = document.getElementById('debt-cust-id').value;
  const c    = DB.Customers.byId(id);
  if (!c) return;
  document.getElementById('debt-amount').value = c.debt || 0;
  updateDebtPreview();
}

function updateDebtPreview() {
  const id      = document.getElementById('debt-cust-id').value;
  const c       = DB.Customers.byId(id);
  const amount  = parseFloat(document.getElementById('debt-amount').value) || 0;
  const preview = document.getElementById('debt-preview');
  if (!c || amount <= 0) { preview.style.display = 'none'; return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const remaining = Math.max(0, (c.debt||0) - amount);
  const isOver    = amount > (c.debt||0);
  preview.style.display = 'block';
  preview.innerHTML = `
    <div class="debt-preview-row">
      <span>الدين قبل السداد</span><span>${fmt(c.debt||0)} ${cur}</span>
    </div>
    <div class="debt-preview-row pay">
      <span>المبلغ المسدَّد</span><span>− ${fmt(Math.min(amount, c.debt||0))} ${cur}</span>
    </div>
    <div class="debt-preview-row remain ${remaining === 0 ? 'clear' : ''}">
      <span>الدين المتبقي</span><strong>${fmt(remaining)} ${cur}</strong>
    </div>
    ${isOver ? `<div class="debt-preview-warn"><i class="fas fa-triangle-exclamation"></i> المبلغ أكبر من الدين — سيُسجَّل فقط ${fmt(c.debt||0)} ${cur}</div>` : ''}`;
}

function saveDebtPayment() {
  const customerId = document.getElementById('debt-cust-id').value;
  const amount     = parseFloat(document.getElementById('debt-amount').value) || 0;
  const note       = document.getElementById('debt-note').value.trim();
  const date       = document.getElementById('debt-date').value;
  if (!customerId || amount <= 0) { toast('أدخل مبلغ السداد', 'error'); return; }

  const payment = DB.DebtPayments.add(customerId, amount, note, date ? date + 'T12:00:00' : null);
  if (!payment) { toast('خطأ في السداد', 'error'); return; }

  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  closeModal('modal-debt-pay');
  renderCustomers();
  toast(`✓ تم تسجيل سداد ${fmt(payment.amount)} ${cur} من ${escHtml(payment.customerName)}`, 'success');
}

function viewCustomerStatement(customerId) {
  const c = DB.Customers.byId(customerId);
  if (!c) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  // جمع الفواتير الآجلة
  const sales    = DB.Sales.all().filter(s => s.customerId === customerId).slice().reverse();
  // جمع مدفوعات الديون
  const payments = DB.DebtPayments.byCustomer(customerId).slice().reverse();

  // بناء timeline مدمج
  const timeline = [
    ...sales.map(s => ({ type: 'sale', date: s.date, data: s })),
    ...payments.map(p => ({ type: 'pay',  date: p.date, data: p }))
  ].sort((a, b) => new Date(b.date) - new Date(a.date));

  document.getElementById('stmt-title').innerHTML =
    `<i class="fas fa-file-invoice-dollar"></i> كشف حساب: ${escHtml(c.name)} ${customerTierBadge(c)}`;

  const totalSales   = sales.reduce((a, s) => a + s.total, 0);
  const totalPaid    = payments.reduce((a, p) => a + p.amount, 0);
  const currentDebt  = c.debt || 0;

  document.getElementById('stmt-body').innerHTML = `
    <div class="stmt-summary">
      <div class="stmt-kpi"><div class="stmt-kpi-val">${fmt(totalSales)} ${cur}</div><div class="stmt-kpi-lbl">إجمالي المشتريات</div></div>
      <div class="stmt-kpi"><div class="stmt-kpi-val paid">${fmt(totalPaid)} ${cur}</div><div class="stmt-kpi-lbl">إجمالي المسدَّد</div></div>
      <div class="stmt-kpi ${currentDebt > 0 ? 'danger' : 'clear'}">
        <div class="stmt-kpi-val">${fmt(currentDebt)} ${cur}</div>
        <div class="stmt-kpi-lbl">الدين المتبقي</div>
      </div>
      ${c.phone ? `<div class="stmt-kpi"><div class="stmt-kpi-val" style="font-size:14px">${escHtml(c.phone)}</div><div class="stmt-kpi-lbl">الهاتف</div></div>` : ''}
    </div>

    ${currentDebt > 0 ? `<div style="text-align:center;margin:12px 0">
      <button class="btn-primary" onclick="closeModal('modal-cust-statement');openDebtPayModal('${c.id}')">
        <i class="fas fa-hand-holding-dollar"></i> تسديد الدين الآن
      </button></div>` : ''}

    <h3 style="margin:20px 0 10px;color:var(--text1)"><i class="fas fa-history"></i> سجل المعاملات</h3>
    ${timeline.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>التاريخ</th><th>النوع</th><th>التفاصيل</th><th>المبلغ</th><th>حذف</th></tr></thead>
        <tbody>${timeline.map(t => {
          if (t.type === 'sale') {
            const s = t.data;
            const isDebtRelated = s.paymentMethod === 'credit' || s.paymentMethod === 'mixed';
            const debtPart = s.paymentMethod === 'mixed' ? (s.creditAmount || 0) : s.total;
            return `<tr>
              <td>${fmtDate(s.date)}</td>
              <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
              <td>${s.invoiceNo} — ${s.items.length} منتج${s.paymentMethod === 'mixed' ? ` <span style="color:var(--text3);font-size:11px">(آجل: ${fmt(debtPart)} ${cur})</span>` : ''}</td>
              <td class="${isDebtRelated ? 'debt-cell-danger' : ''}"><strong>${fmt(s.total)} ${cur}</strong></td>
              <td>—</td>
            </tr>`;
          } else {
            const p = t.data;
            return `<tr class="pay-row">
              <td>${fmtDate(p.date)}</td>
              <td><span class="badge-pay-tag">✓ سداد</span></td>
              <td>${escHtml(p.note || 'سداد دين')}</td>
              <td class="debt-cell-clear"><strong>+ ${fmt(p.amount)} ${cur}</strong></td>
              <td><button class="btn-icon danger" onclick="deleteDebtPayment('${p.id}','${customerId}')" title="إلغاء السداد"><i class="fas fa-trash"></i></button></td>
            </tr>`;
          }
        }).join('')}</tbody>
      </table>
    </div>` : '<p class="empty-td">لا توجد معاملات بعد</p>'}`;

  openModal('modal-cust-statement');
}

function deleteDebtPayment(paymentId, customerId) {
  if (!confirm('إلغاء هذا السداد؟ سيُعاد الدين للزبون')) return;
  DB.DebtPayments.delete(paymentId);
  renderCustomers();
  viewCustomerStatement(customerId); // تحديث الكشف
  toast('تم إلغاء السداد وإعادة الدين', 'info');
}

function printStatement() {
  const body   = document.getElementById('stmt-body')?.innerHTML;
  const title  = document.getElementById('stmt-title')?.textContent;
  const S = DB.Settings.get();
  const win = window.open('', '_blank', 'width=794,height=1123');
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head>
    <meta charset="UTF-8"><title>${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
    <style>
      *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      body{font-family:'Cairo',sans-serif;padding:20mm 16mm;color:#111;background:#fff}
      h1{font-size:20px;margin-bottom:4px}
      .stmt-summary{display:flex;gap:12px;margin:16px 0;flex-wrap:wrap}
      .stmt-kpi{flex:1;min-width:120px;background:#f8fafc;border-radius:10px;padding:12px;text-align:center;border:1px solid #e5e7eb}
      .stmt-kpi-val{font-size:16px;font-weight:900;color:#059669}
      .stmt-kpi-val.paid{color:#2563eb}
      .stmt-kpi.danger .stmt-kpi-val{color:#ef4444}
      .stmt-kpi.clear .stmt-kpi-val{color:#059669}
      .stmt-kpi-lbl{font-size:11px;color:#6b7280;margin-top:4px}
      table{width:100%;border-collapse:collapse;font-size:13px;margin-top:12px}
      th{background:#f8fafc;padding:8px;border-bottom:2px solid #e5e7eb;font-weight:700}
      td{padding:8px;border-bottom:1px solid #f1f5f9}
      .debt-cell-danger{color:#ef4444;font-weight:700}
      .debt-cell-clear{color:#059669;font-weight:700}
      .pay-row{background:#f0fdf4}
      .badge-pay-tag{background:#dcfce7;color:#059669;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700}
      h3{margin:20px 0 8px;font-size:15px}
      .no-print{display:none}
      @page{margin:12mm;size:A4}
    </style>
    </head><body>
    <h1><i class="fas fa-file-invoice-dollar"></i> ${title}</h1>
    <p style="color:#6b7280;font-size:12px">${S.storeName||'دكاني'} • ${new Date().toLocaleDateString('ar-DZ')}</p>
    ${body}
    </body></html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 600);
}


function renderInvoices() {
  const from   = document.getElementById('inv-date-from')?.value;
  const to     = document.getElementById('inv-date-to')?.value;
  const method = document.getElementById('inv-method-filter')?.value || '';
  const barcodeQ = (document.getElementById('inv-barcode-search')?.value || '').trim().toUpperCase();
  const customerQ = (document.getElementById('inv-customer-search')?.value || '').trim().toLowerCase();
  let list     = DB.Sales.all().slice().reverse();
  if (from && to) list = list.filter(s => s.date >= from && s.date <= to + 'T23:59:59');
  if (method) list = list.filter(s => s.paymentMethod === method);
  if (barcodeQ) list = list.filter(s => s.invoiceNo.toUpperCase().includes(barcodeQ));
  if (customerQ) list = list.filter(s => (s.customerName || '').toLowerCase().includes(customerQ));
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('invoices-body');
  if (!tbody) return;

  tbody.innerHTML = list.length ? list.map(s =>
    `<tr>
      <td><code>${s.invoiceNo}</code></td>
      <td>${escHtml(s.customerName)}</td>
      <td><strong>${fmt(s.total)} ${cur}</strong></td>
      <td>${s.discount || 0}%</td>
      <td class="profit-cell">${_hideIfCashier('+' + fmt(DB.Sales.netProfit(s)) + ' ' + cur)}</td>
      <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
      <td>${fmtDate(s.date)}</td>
      <td><button class="btn-icon edit" onclick="viewInvoice('${s.id}')"><i class="fas fa-eye"></i></button></td>
      <td><button class="btn-icon danger" onclick="deleteInvoice('${s.id}')"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('')
  : `<tr><td colspan="9" class="empty-td">لا توجد فواتير / No invoices</td></tr>`;

  // Summary bar
  // ⚠️ الأرباح هنا = الربح الصافي المحقَّق فقط (لا يشمل الجزء الآجل غير المُسدَّد)
  const totalRev    = list.reduce((a,s) => a + s.total, 0);
  const totalProfit = list.reduce((a,s) => a + DB.Sales.netProfit(s), 0);
  const bar = document.getElementById('inv-summary-bar');
  if (bar && list.length) {
    bar.innerHTML = `
      <span><i class="fas fa-receipt"></i> ${list.length} فاتورة</span>
      <span><i class="fas fa-sack-dollar"></i> الإجمالي: <strong>${fmt(totalRev)} ${cur}</strong></span>
      <span class="profit-cell"><i class="fas fa-trending-up"></i> الأرباح: <strong>${_hideIfCashier('+' + fmt(totalProfit) + ' ' + cur)}</strong></span>`;
  } else if (bar) { bar.innerHTML = ''; }
}

// ─── مسح باركود فاتورة من صفحة الفواتير: فتحها فوراً عند مطابقة تامة ─────────
function invBarcodeKeydown(e) {
  if (e.key !== 'Enter') return;
  const input = document.getElementById('inv-barcode-search');
  const val = (input?.value || '').trim().toUpperCase();
  if (!val) return;
  const match = DB.Sales.all().find(s => s.invoiceNo.toUpperCase() === val);
  if (match) {
    viewInvoice(match.id);
    if (input) input.value = '';
    renderInvoices();
  } else {
    toast(`❌ لم يتم العثور على فاتورة بهذا الرقم: ${val}`, 'error');
  }
}

// ─── current invoice id for delete-from-preview ───────────────────────────────
let _currentInvoiceId = null;

function viewInvoice(id) {
  const s = DB.Sales.byId(id);
  if (!s) return;
  _currentInvoiceId = id;
  const S  = DB.Settings.get();
  const cur = S.currency || 'دج';

  // Sidebar meta
  const meta = document.getElementById('inv-ctrl-meta');
  if (meta) meta.innerHTML = `
    <div class="inv-meta-chip"><i class="fas fa-hashtag"></i> ${s.invoiceNo}</div>
    <div class="inv-meta-chip"><i class="fas fa-user"></i> ${escHtml(s.customerName)}</div>
    <div class="inv-meta-chip pay-${s.paymentMethod}"><i class="fas fa-wallet"></i> ${payLabel(s.paymentMethod)}</div>
    <div class="inv-meta-chip total-chip"><i class="fas fa-coins"></i> ${fmt(s.total)} ${cur}</div>`;

  // Printable invoice content
  const el = document.getElementById('invoice-content');
  el.innerHTML = buildInvoiceHTML(s, S, cur);
  openModal('modal-invoice');
}

function buildInvoiceHTML(s, S, cur) {
  const logoIcon = S.logo
    ? `<div class="inv-logo-img-wrap"><img src="${S.logo}" class="inv-logo-img" alt="logo"/></div>`
    : `<div class="inv-logo-icon"><i class="fas fa-store"></i></div>`;
  const itemsRows = s.items.map((it, i) => `
    <tr>
      <td class="inv-td-num">${i + 1}</td>
      <td class="inv-td-name">${escHtml(it.nameAr)}${it.nameEn ? `<span class="inv-en">${escHtml(it.nameEn)}</span>` : ''}${(it.payType||'cash')==='credit' ? ' <span class="inv-item-credit-tag">آجل</span>' : ''}${(it.discount||0) > 0 ? ` <span class="inv-item-credit-tag" style="background:#ef444420;color:#ef4444">-${it.discount}%</span>` : ''}</td>
      <td class="inv-td-r">${fmt(it.price)}</td>
      <td class="inv-td-r">${it.qty}</td>
      <td class="inv-td-r inv-td-total">${fmt(it.total)}</td>
    </tr>`).join('');

  return `
  <div class="inv-paper-inner">
    <div class="inv-paper-header">
      ${logoIcon}
      <div class="inv-paper-store">
        <h1 class="inv-store-name">${S.storeName || 'دكاني'}</h1>
        ${S.address ? `<p class="inv-store-sub">${escHtml(S.address)}</p>` : ''}
        ${S.phone   ? `<p class="inv-store-sub"><i class="fas fa-phone"></i> ${escHtml(S.phone)}</p>` : ''}
      </div>
      <div class="inv-paper-meta">
        <div class="inv-badge-no">${s.invoiceNo}</div>
        <div class="inv-paper-date">${new Date(s.date).toLocaleDateString('ar-DZ', {year:'numeric',month:'long',day:'numeric'})}</div>
        <div class="inv-paper-time">${new Date(s.date).toLocaleTimeString('ar-DZ', {hour:'2-digit',minute:'2-digit'})}</div>
      </div>
    </div>

    <div class="inv-divider"></div>

    <div class="inv-paper-customer">
      <span class="inv-cust-label"><i class="fas fa-user-circle"></i> الزبون</span>
      <span class="inv-cust-name">${escHtml(s.customerName)}</span>
      <span class="inv-pay-badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span>
    </div>

    <table class="inv-paper-table">
      <thead>
        <tr>
          <th class="inv-td-num">#</th>
          <th>المنتج</th>
          <th class="inv-td-r">السعر (${cur})</th>
          <th class="inv-td-r">الكمية</th>
          <th class="inv-td-r">الإجمالي (${cur})</th>
        </tr>
      </thead>
      <tbody>${itemsRows}</tbody>
    </table>

    <div class="inv-paper-totals">
      <div class="inv-tot-row">
        <span>المجموع الفرعي</span>
        <span>${fmt(s.subtotal)} ${cur}</span>
      </div>
      ${s.itemsDiscountTotal ? `<div class="inv-tot-row discount">
        <span>خصم المنتجات</span>
        <span>− ${fmt(s.itemsDiscountTotal)} ${cur}</span>
      </div>` : ''}
      ${s.discount ? `<div class="inv-tot-row discount">
        <span>خصم الفاتورة (${s.discount}%)</span>
        <span>− ${fmt(s.subtotal * s.discount / 100)} ${cur}</span>
      </div>` : ''}
      ${s.paymentMethod === 'mixed' ? `
      <div class="inv-tot-row">
        <span><i class="fas fa-money-bill"></i> نقدي</span>
        <span>${fmt(s.cashAmount || 0)} ${cur}</span>
      </div>
      <div class="inv-tot-row">
        <span><i class="fas fa-clock"></i> آجل (دين)</span>
        <span>${fmt(s.creditAmount || 0)} ${cur}</span>
      </div>` : ''}
      <div class="inv-tot-row grand-total">
        <span>الإجمالي النهائي</span>
        <span>${fmt(s.total)} ${cur}</span>
      </div>
    </div>

    <div class="inv-paper-footer">
      <div class="inv-barcode-wrap">
        ${typeof DakaniBarcode !== 'undefined' ? DakaniBarcode.toSVG(s.invoiceNo, { unit: 2, height: 42, showText: false }) : ''}
        <div class="inv-barcode-line">${s.invoiceNo}</div>
      </div>
      <p class="inv-footer-thanks">${S.thankYouMessage || 'شكراً لتعاملكم معنا 🙏'}</p>
      <p class="inv-footer-credit">دكاني Dukani المصمم لتنظيم اعمال المحلات</p>
    </div>
  </div>`;
}

function handleInvoiceOverlayClick(e) {
  if (e.target === document.getElementById('modal-invoice')) closeModal('modal-invoice');
}

function deleteInvoice(id) {
  if (!confirm('⚠️ حذف هذه الفاتورة؟ سيتم استعادة المخزون / Delete invoice? Stock will be restored.')) return;
  DB.Sales.delete(id);
  DB.UndoManager.invalidate('sale', id);
  renderInvoices();
  checkAlerts();
  updateUndoButton();
  toast('تم حذف الفاتورة واستعادة المخزون / Invoice deleted, stock restored', 'info');
}

function deleteCurrentInvoice() {
  if (!_currentInvoiceId) return;
  deleteInvoice(_currentInvoiceId);
  closeModal('modal-invoice');
  _currentInvoiceId = null;
}

function printInvoice() {
  const content = document.getElementById('invoice-print-area')?.innerHTML;
  if (!content) return;

  // جلب CSS الخاص بالفاتورة فقط
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&display=swap');
    @import url('https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css');

    @page { margin: 12mm; size: A4 portrait; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    body { margin: 0; padding: 0; background: #fff; font-family: 'Cairo', sans-serif; direction: rtl; }

    .inv-paper-inner { background:#fff; border-radius:12px; padding:28px 24px; max-width:100%; margin:0 auto; font-family:'Cairo',sans-serif; color:#111827; }
    .inv-paper-header { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom:20px; }
    .inv-logo-icon { width:52px; height:52px; background:#059669 !important; border-radius:12px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:24px; flex-shrink:0; }
    .inv-logo-img-wrap { width:52px; height:52px; background:#fff !important; border:1px solid #e5e7eb; border-radius:12px; display:flex; align-items:center; justify-content:center; overflow:hidden; flex-shrink:0; }
    .inv-logo-img { width:100%; height:100%; object-fit:contain; }
    .inv-paper-store { flex:1; padding:0 14px; }
    .inv-store-name { font-size:20px; font-weight:900; margin:0 0 4px; color:#111827; }
    .inv-store-sub { font-size:12px; color:#6b7280; margin:2px 0; display:flex; align-items:center; gap:4px; }
    .inv-paper-meta { text-align:left; }
    .inv-badge-no { background:#1f2937 !important; color:#10b981 !important; border-radius:8px; padding:6px 12px; font-size:13px; font-weight:900; letter-spacing:1px; font-family:monospace; margin-bottom:6px; text-align:center; }
    .inv-paper-date { font-size:12px; color:#6b7280; text-align:center; }
    .inv-paper-time { font-size:11px; color:#9ca3af; text-align:center; }
    .inv-divider { height:1px; background:#e5e7eb; margin:16px 0; }
    .inv-paper-customer { display:flex; align-items:center; gap:10px; flex-wrap:wrap; background:#f8fafc !important; border-radius:8px; padding:10px 14px; margin-bottom:16px; }
    .inv-cust-label { font-size:12px; color:#9ca3af; }
    .inv-cust-name { font-size:15px; font-weight:700; color:#111827; flex:1; }
    .inv-pay-badge { border-radius:6px; padding:4px 10px; font-size:12px; font-weight:700; }
    .inv-pay-badge.pay-cash   { background:#dcfce7 !important; color:#059669 !important; }
    .inv-pay-badge.pay-card   { background:#dbeafe !important; color:#2563eb !important; }
    .inv-pay-badge.pay-credit { background:#fef3c7 !important; color:#d97706 !important; }
    .inv-paper-table { width:100%; border-collapse:collapse; font-size:13px; margin-bottom:20px; }
    .inv-paper-table th { background:#f8fafc !important; padding:10px; font-weight:700; color:#374151; border-bottom:2px solid #e5e7eb; font-size:12px; }
    .inv-paper-table td { padding:10px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
    .inv-td-num { text-align:center; color:#9ca3af; font-size:12px; width:32px; }
    .inv-td-name { color:#111827; font-weight:600; }
    .inv-en { display:block; font-size:11px; color:#9ca3af; font-weight:400; }
    .inv-td-r { text-align:center; color:#374151; }
    .inv-td-total { font-weight:700; color:#059669 !important; }
    .inv-paper-totals { background:#f8fafc !important; border-radius:10px; padding:14px 16px; margin-bottom:20px; }
    .inv-tot-row { display:flex; justify-content:space-between; align-items:center; padding:6px 0; font-size:14px; color:#374151; border-bottom:1px solid #f1f5f9; }
    .inv-tot-row:last-child { border-bottom:none; }
    .inv-tot-row.discount { color:#ef4444; }
    .inv-tot-row.grand-total { font-size:18px; font-weight:900; color:#059669 !important; border-top:2px dashed #e5e7eb; padding-top:12px; margin-top:4px; }
    .inv-paper-footer { text-align:center; padding-top:16px; border-top:1px dashed #e5e7eb; }
    .inv-barcode-wrap { display:flex; flex-direction:column; align-items:center; margin-bottom:10px; }
    .inv-barcode-wrap svg { max-width:220px; }
    .inv-barcode-line { font-family:monospace; font-size:11px; color:#9ca3af; letter-spacing:3px; margin-top:2px; }
    .inv-footer-thanks { font-size:13px; color:#6b7280; margin:0; }

    @media (max-width: 480px) {
      .inv-paper-inner { padding:18px 14px; }
      .inv-logo-icon, .inv-logo-img-wrap { width:40px; height:40px; font-size:18px; }
      .inv-store-name { font-size:16px; }
    }
  `;

  const win = window.open('', '_blank', 'width=794,height=1123');
  win.document.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <title>فاتورة</title>
  <style>${styles}</style>
</head>
<body>${content}</body>
</html>`);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); win.close(); }, 600);
}

// ─── نص موحّد للفاتورة (يُستخدم في واتساب والبريد الإلكتروني) ─────────────────
function _invoiceTextBody(s, S, cur, bold) {
  const b = bold ? '*' : '';
  let msg = `🧾 ${b}فاتورة ${s.invoiceNo}${b}\n`;
  msg += `📅 ${new Date(s.date).toLocaleDateString('ar-DZ')}\n`;
  msg += `👤 ${escHtml(s.customerName)}\n\n`;
  s.items.forEach((it,i) => { msg += `${i+1}. ${escHtml(it.nameAr)} × ${it.qty}${(it.discount||0)>0 ? ` (خصم ${it.discount}%)` : ''} = ${fmt(it.total)} ${cur}\n`; });
  msg += `\n━━━━━━━━━━━━\n`;
  if (s.itemsDiscountTotal) msg += `خصم منتجات: −${fmt(s.itemsDiscountTotal)} ${cur}\n`;
  if (s.discount) msg += `خصم الفاتورة: ${s.discount}%\n`;
  msg += `${b}الإجمالي: ${fmt(s.total)} ${cur}${b}\n\n`;
  msg += `${S.storeName || 'دكاني'} — شكراً لتعاملكم 🙏`;
  return msg;
}

function shareInvoiceWhatsApp() {
  const s = _currentInvoiceId ? DB.Sales.byId(_currentInvoiceId) : null;
  if (!s) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  window.open('https://wa.me/?text=' + encodeURIComponent(_invoiceTextBody(s, S, cur, true)), '_blank');
}

// ─── إرسال نص الفاتورة عبر البريد الإلكتروني (يفتح تطبيق البريد الافتراضي) ────
function emailInvoiceText() {
  const s = _currentInvoiceId ? DB.Sales.byId(_currentInvoiceId) : null;
  if (!s) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const subject = `فاتورة ${s.invoiceNo} — ${S.storeName || 'دكاني'}`;
  const body = _invoiceTextBody(s, S, cur, false);
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

// ─── توليد صورة/PDF من الفاتورة (لأغراض الحفظ والمشاركة) ──────────────────────
async function _renderInvoiceCanvas() {
  if (typeof html2canvas === 'undefined') {
    alert('تعذر تحميل مكتبة الصور، تأكد من الاتصال بالإنترنت عند أول استخدام ثم أعد المحاولة');
    return null;
  }
  const source = document.getElementById('invoice-print-area');
  if (!source) return null;
  return await html2canvas(source, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
}

async function _invoiceCanvasToPdfBlob(canvas) {
  if (typeof window.jspdf === 'undefined') {
    alert('تعذر تحميل مكتبة PDF، تأكد من الاتصال بالإنترنت عند أول استخدام ثم أعد المحاولة');
    return null;
  }
  const { jsPDF } = window.jspdf;
  const mmW = 210; // عرض A4 بالمليمتر
  const mmH = canvas.height * mmW / canvas.width;
  const pdf = new jsPDF({ orientation: 'p', unit: 'mm', format: [mmW, mmH] });
  pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, mmW, mmH);
  return pdf.output('blob');
}

function _invoiceFileName(s, ext) {
  return `فاتورة-${s.invoiceNo}.${ext}`;
}

function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ─── حفظ الفاتورة كصورة PNG على الجهاز ────────────────────────────────────────
async function downloadInvoiceImage(btn) {
  const s = _currentInvoiceId ? DB.Sales.byId(_currentInvoiceId) : null;
  if (!s) return;
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ التجهيز...'; }
  try {
    const canvas = await _renderInvoiceCanvas();
    if (!canvas) return;
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('تعذر إنشاء الصورة');
    _downloadBlob(blob, _invoiceFileName(s, 'png'));
    toast('تم حفظ الفاتورة كصورة ✓', 'success');
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء الصورة');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ─── حفظ الفاتورة كملف PDF على الجهاز ──────────────────────────────────────────
async function downloadInvoicePDF(btn) {
  const s = _currentInvoiceId ? DB.Sales.byId(_currentInvoiceId) : null;
  if (!s) return;
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ التجهيز...'; }
  try {
    const canvas = await _renderInvoiceCanvas();
    if (!canvas) return;
    const blob = await _invoiceCanvasToPdfBlob(canvas);
    if (!blob) return;
    _downloadBlob(blob, _invoiceFileName(s, 'pdf'));
    toast('تم حفظ الفاتورة كملف PDF ✓', 'success');
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء ملف PDF');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ─── مشاركة الفاتورة كملف (صورة أو PDF) عبر قائمة المشاركة في الجهاز ──────────
// تعمل هذه الطريقة على الهواتف (Android / iOS) وتفتح قائمة اختيار التطبيق
// (واتساب، البريد، تيليجرام...) مع إرفاق الملف تلقائياً.
// على الحواسيب أو المتصفحات التي لا تدعم مشاركة الملفات: يتم تنزيل الملف
// تلقائياً ثم فتح واتساب بنص الفاتورة، ليقوم المستخدم بإرفاقه يدوياً.
async function shareInvoiceFile(kind, btn) {
  const s = _currentInvoiceId ? DB.Sales.byId(_currentInvoiceId) : null;
  if (!s) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ التجهيز...'; }
  try {
    const canvas = await _renderInvoiceCanvas();
    if (!canvas) return;

    let blob, filename, mime;
    if (kind === 'pdf') {
      blob = await _invoiceCanvasToPdfBlob(canvas);
      filename = _invoiceFileName(s, 'pdf');
      mime = 'application/pdf';
    } else {
      blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      filename = _invoiceFileName(s, 'png');
      mime = 'image/png';
    }
    if (!blob) return;

    const file = new File([blob], filename, { type: mime });
    const shareData = {
      files: [file],
      title: `فاتورة ${s.invoiceNo}`,
      text: `فاتورة ${s.invoiceNo} — ${S.storeName || 'دكاني'}`
    };

    if (navigator.canShare && navigator.canShare(shareData)) {
      await navigator.share(shareData);
    } else {
      // المتصفح لا يدعم مشاركة الملفات مباشرة → نزّل الملف تلقائياً
      _downloadBlob(blob, filename);
      toast('تم تنزيل الملف، يمكنك إرفاقه يدوياً / File downloaded — attach it manually', 'info');
      if (kind === 'image') {
        window.open('https://wa.me/?text=' + encodeURIComponent(_invoiceTextBody(s, S, cur, true)), '_blank');
      } else {
        window.location.href = `mailto:?subject=${encodeURIComponent('فاتورة ' + s.invoiceNo)}&body=${encodeURIComponent(_invoiceTextBody(s, S, cur, false))}`;
      }
    }
  } catch (err) {
    if (err && err.name === 'AbortError') return; // المستخدم ألغى المشاركة بنفسه
    console.error(err);
    alert('حدث خطأ أثناء تجهيز الملف للمشاركة');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
}

// ─── قائمة "إرسال ومشاركة" المنسدلة ───────────────────────────────────────────
function toggleShareMenu(e) {
  e.stopPropagation();
  const menu = document.getElementById('inv-share-menu');
  if (!menu) return;
  const willOpen = !menu.classList.contains('open');
  closeShareMenu();
  if (willOpen) {
    menu.classList.add('open');
    setTimeout(() => document.addEventListener('click', _shareMenuOutsideClick), 0);
  }
}

function closeShareMenu() {
  document.getElementById('inv-share-menu')?.classList.remove('open');
  document.removeEventListener('click', _shareMenuOutsideClick);
}

function _shareMenuOutsideClick(e) {
  const menu = document.getElementById('inv-share-menu');
  const btn = document.getElementById('inv-share-btn');
  if (menu && !menu.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) closeShareMenu();
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function initReports() {
  const today = DB.today();
  const firstDay = today.slice(0,8) + '01';
  document.getElementById('rep-from').value = firstDay;
  document.getElementById('rep-to').value   = today;
  generateReport();
}

// حساب الفترة السابقة (نفس عدد الأيام مباشرة قبل الفترة الحالية) — لمقارنة النمو
function _reportPrevPeriod(from, to) {
  const fromD = new Date(from + 'T00:00:00');
  const toD   = new Date(to   + 'T00:00:00');
  const dayMs = 86400000;
  const spanDays = Math.max(1, Math.round((toD - fromD) / dayMs) + 1);
  const prevTo   = new Date(fromD.getTime() - dayMs);
  const prevFrom = new Date(prevTo.getTime() - (spanDays - 1) * dayMs);
  const toStr = d => d.toISOString().slice(0, 10);
  return { prevFrom: toStr(prevFrom), prevTo: toStr(prevTo) };
}

// شارة النمو مقارنة بالفترة السابقة
function _deltaBadge(curr, prev) {
  if (!prev && !curr) return '<span class="kpi-delta flat"><i class="fas fa-minus"></i> 0%</span>';
  if (!prev) return '<span class="kpi-delta up"><i class="fas fa-arrow-up"></i> جديد</span>';
  const pct = ((curr - prev) / prev) * 100;
  if (Math.abs(pct) < 0.05) return '<span class="kpi-delta flat"><i class="fas fa-minus"></i> 0%</span>';
  const cls = pct > 0 ? 'up' : 'down';
  const icon = pct > 0 ? 'arrow-up' : 'arrow-down';
  return `<span class="kpi-delta ${cls}"><i class="fas fa-${icon}"></i> ${Math.abs(pct).toFixed(1)}%</span>`;
}

function generateReport() {
  // صفحة التقارير بأكملها مبنية على أرقام الربح/التكلفة وغير متاحة أصلاً
  // للكاشير عبر التنقّل العادي (canAccessPage في accounts.js) — هذا الفحص
  // طبقة حماية إضافية تمنع توليد التقرير حتى لو استُدعيت الدالة مباشرة.
  if (_isCashierRole()) { toast('غير مصرح لك بعرض التقارير / Not authorized', 'error'); return; }
  const from  = document.getElementById('rep-from')?.value;
  const to    = document.getElementById('rep-to')?.value;
  if (!from || !to) return;
  const sales = DB.Sales.between(from, to);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  // ⚠️ الربح الصافي للفترة = ربح المبيعات النقدية/بالبطاقة + ربح الديون
  // المُحصَّلة خلال هذه الفترة (حتى لو كانت فاتورتها الأصلية من فترة سابقة).
  // الجزء الآجل غير المُسدَّد لا يُحتسب ضمن الأرباح حتى يُسدَّد فعلياً.
  const totalRev    = sales.reduce((a, s) => a + s.total, 0);
  const totalProfit = sales.reduce((a, s) => a + DB.Sales.netProfit(s), 0) + debtProfitCollectedBetween(from, to);
  const totalCost   = totalRev - totalProfit;
  const invoiceCount = sales.length;
  const avgBasket   = invoiceCount ? totalRev / invoiceCount : 0;

  // ─── مقارنة مع الفترة السابقة (نسبة النمو) ─────────────────────────────
  const { prevFrom, prevTo } = _reportPrevPeriod(from, to);
  const prevSales   = DB.Sales.between(prevFrom, prevTo);
  const prevRev     = prevSales.reduce((a, s) => a + s.total, 0);
  const prevProfit  = prevSales.reduce((a, s) => a + DB.Sales.netProfit(s), 0) + debtProfitCollectedBetween(prevFrom, prevTo);
  const prevCount   = prevSales.length;
  const prevAvg     = prevCount ? prevRev / prevCount : 0;

  const kpiEl = document.getElementById('report-kpis');
  if (kpiEl) kpiEl.innerHTML = [
    { icon:'sack-dollar', val: fmt(totalRev)+' '+cur,    label:'إجمالي المبيعات / Total Sales', cls:'kpi-sales',     delta:_deltaBadge(totalRev, prevRev) },
    { icon:'trending-up', val: fmt(totalProfit)+' '+cur, label:'إجمالي الأرباح / Total Profit',  cls:'kpi-profit',    delta:_deltaBadge(totalProfit, prevProfit) },
    { icon:'receipt',     val: invoiceCount,              label:'عدد الفواتير / Invoices',        cls:'kpi-invoices',  delta:_deltaBadge(invoiceCount, prevCount) },
    { icon:'chart-simple',val: fmt(avgBasket)+' '+cur,   label:'متوسط الفاتورة / Avg Basket',    cls:'kpi-customers', delta:_deltaBadge(avgBasket, prevAvg) }
  ].map(k => `<div class="kpi-card ${k.cls}"><div class="kpi-icon"><i class="fas fa-${k.icon}"></i></div><div class="kpi-info"><div class="kpi-value">${k.val}</div><div class="kpi-label">${k.label}</div>${k.delta}</div></div>`).join('');

  // Chart by day
  const dayMap = {};
  sales.forEach(s => {
    const d = s.date.slice(0,10);
    if (!dayMap[d]) dayMap[d] = { revenue: 0, profit: 0 };
    dayMap[d].revenue += s.total; dayMap[d].profit += DB.Sales.netProfit(s);
  });
  // إضافة ربح الديون المُحصَّلة إلى يوم تحصيلها فعلياً (وليس يوم البيع الأصلي)
  (DB.DebtPayments.all() || [])
    .filter(p => p.date >= from && p.date <= to + 'T23:59:59')
    .forEach(p => {
      const d = (p.date || '').slice(0, 10);
      if (!dayMap[d]) dayMap[d] = { revenue: 0, profit: 0 };
      dayMap[d].profit += (p.profit || 0);
    });
  const days = Object.keys(dayMap).sort();
  const ctx  = document.getElementById('chart-report');
  if (ctx) {
    if (chartReport) chartReport.destroy();
    chartReport = new Chart(ctx, {
      type: 'line',
      data: { labels: days,
        datasets: [
          { label:'مبيعات', data: days.map(d=>dayMap[d].revenue), borderColor:'#10b981', fill:true, backgroundColor:'#10b98122', tension:0.4 },
          { label:'أرباح',  data: days.map(d=>dayMap[d].profit),  borderColor:'#f59e0b', fill:false, tension:0.4 }
        ]},
      options: { responsive:true, plugins:{ legend:{ labels:{ color:'#94a3b8' } } }, scales:{
        x:{ ticks:{ color:'#94a3b8' }, grid:{ color:'#1e293b' } },
        y:{ ticks:{ color:'#94a3b8' }, grid:{ color:'#1e293b' } }
      }}
    });
  }

  // Top products in period
  // ملاحظة: الربح هنا هو الربح الإجمالي (المحتمل) لكل منتج على مستوى الأصناف —
  // وليس "الربح الصافي المُحقَّق" المعروض في كروت التقرير أعلاه. تقسيم الربح
  // المُحصَّل من الديون على مستوى كل منتج بمفرده غير ممكن تقنياً هنا (تحصيل
  // الدين يخصّ الزبون ككل وليس صنفاً بعينه)، لذا هذا العمود يبقى تقديرياً/كليّاً
  // ويُستخدم فقط لتحليل أداء المنتجات وليس كرقم مالي نهائي.
  const itemMap = {};
  sales.forEach(s => s.items.forEach(it => {
    if (!itemMap[it.productId]) itemMap[it.productId] = { nameAr: it.nameAr, qty: 0, revenue: 0, profit: 0 };
    itemMap[it.productId].qty += it.qty;
    itemMap[it.productId].revenue += it.total;
    itemMap[it.productId].profit  += it.profit;
  }));
  const topProds = Object.values(itemMap).sort((a,b)=>b.revenue-a.revenue).slice(0,8);
  const tpEl = document.getElementById('report-top-products');
  if (tpEl) tpEl.innerHTML = topProds.length ? topProds.map((p,i)=>
    `<div class="top-prod-row">
      <span class="top-rank">${i+1}</span>
      <span class="top-name">${escHtml(p.nameAr)}</span>
      <span class="top-qty">${p.qty}</span>
      <span class="top-rev">${fmt(p.revenue)} ${cur}</span>
    </div>`).join('') : '<div class="empty-state">لا توجد بيانات / No data</div>';

  // ─── طرق الدفع والديون ──────────────────────────────────────────────────
  const payMap = {};
  sales.forEach(s => {
    const m = s.paymentMethod || 'cash';
    if (!payMap[m]) payMap[m] = { count: 0, total: 0 };
    payMap[m].count++; payMap[m].total += s.total;
  });
  const debtCollected = (DB.DebtPayments.all() || [])
    .filter(p => p.date >= from && p.date <= to + 'T23:59:59')
    .reduce((a, p) => a + p.amount, 0);
  const creditGiven = sales.reduce((a, s) => a + (s.creditAmount || 0), 0);

  const pmEl = document.getElementById('report-payment-methods');
  if (pmEl) {
    const rows = Object.entries(payMap).sort((a, b) => b[1].total - a[1].total).map(([method, d]) => {
      const pct = totalRev ? (d.total / totalRev * 100) : 0;
      return `<div class="breakdown-row">
        <div class="breakdown-top">
          <span class="breakdown-label">${payLabel(method)} <span class="breakdown-count">(${d.count})</span></span>
          <span class="breakdown-value">${fmt(d.total)} ${cur}</span>
        </div>
        <div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
    }).join('');
    pmEl.innerHTML = (rows || '<div class="empty-state">لا توجد بيانات / No data</div>') +
      `<div class="report-mini-stat"><span><i class="fas fa-hand-holding-dollar"></i> ديون جديدة (آجل)</span><strong class="debt-cell">${fmt(creditGiven)} ${cur}</strong></div>
       <div class="report-mini-stat"><span><i class="fas fa-money-bill-wave"></i> ديون تم تحصيلها</span><strong class="profit-cell">${fmt(debtCollected)} ${cur}</strong></div>`;
  }

  // ─── المبيعات حسب الفئة ─────────────────────────────────────────────────
  const catMap = {};
  sales.forEach(s => s.items.forEach(it => {
    const prod = DB.Products.byId(it.productId);
    const catName = (prod && prod.category) || 'غير مصنف / Uncategorized';
    if (!catMap[catName]) catMap[catName] = { revenue: 0, qty: 0 };
    catMap[catName].revenue += it.total;
    catMap[catName].qty += it.qty;
  }));
  const catEl = document.getElementById('report-categories');
  if (catEl) {
    const catRows = Object.entries(catMap).sort((a, b) => b[1].revenue - a[1].revenue).map(([name, d]) => {
      const pct = totalRev ? (d.revenue / totalRev * 100) : 0;
      return `<div class="breakdown-row">
        <div class="breakdown-top">
          <span class="breakdown-label">${name} <span class="breakdown-count">(${fmt(d.qty)})</span></span>
          <span class="breakdown-value">${fmt(d.revenue)} ${cur}</span>
        </div>
        <div class="breakdown-bar"><div class="breakdown-bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
      </div>`;
    }).join('');
    catEl.innerHTML = catRows || '<div class="empty-state">لا توجد بيانات / No data</div>';
  }

  // ─── أفضل الزبائن خلال الفترة ───────────────────────────────────────────
  const custMap = {};
  sales.forEach(s => {
    const key = s.customerId || ('__guest__' + s.customerName);
    if (!custMap[key]) custMap[key] = { name: s.customerName || 'زبون عام', count: 0, total: 0 };
    custMap[key].count++; custMap[key].total += s.total;
  });
  const topCustomers = Object.values(custMap).sort((a, b) => b.total - a.total).slice(0, 8);
  const tcEl = document.getElementById('report-top-customers');
  if (tcEl) tcEl.innerHTML = topCustomers.length ? topCustomers.map((c, i) =>
    `<div class="top-prod-row">
      <span class="top-rank">${i+1}</span>
      <span class="top-name">${escHtml(c.name)}</span>
      <span class="top-qty">${c.count}</span>
      <span class="top-rev">${fmt(c.total)} ${cur}</span>
    </div>`).join('') : '<div class="empty-state">لا توجد بيانات / No data</div>';

  // ─── المرتجعات والمشتريات خلال الفترة ───────────────────────────────────
  const returnsInPeriod = (DB.Returns.all() || [])
    .filter(r => r.date >= from && r.date <= to + 'T23:59:59');
  const totalReturns  = returnsInPeriod.reduce((a, r) => a + r.totalRefund, 0);
  const returnsCount  = returnsInPeriod.length;

  // تقدير تأثير المرتجعات على الربح باستخدام سعر التكلفة الحالي للمنتج
  // (تقديري لأن سعر التكلفة قد يكون تغيّر منذ عملية البيع الأصلية)
  let estLostProfit = 0;
  returnsInPeriod.forEach(r => (r.items || []).forEach(it => {
    const p = DB.Products.byId(it.productId);
    const buy = p ? (p.buyPrice || 0) : 0;
    estLostProfit += (it.price - buy) * it.qty;
  }));

  const purchasesInPeriod = DB.Purchases.between(from, to);
  const totalPurchases = purchasesInPeriod.reduce((a, p) => a + (p.qty * p.unitPrice), 0);

  // خسائر المخزون الفعلية خلال الفترة (تلف، انتهاء صلاحية، فروقات جرد) — من سجل تسويات المخزون
  const stockLossInPeriod = DB.StockAdjustments.totalLoss(from, to + 'T23:59:59') || 0;

  // صافي الربح الحقيقي = ربح المبيعات − الربح الضائع بسبب المرتجعات − خسائر المخزون الفعلية
  const netProfitEst = totalProfit - estLostProfit - stockLossInPeriod;

  const rpEl = document.getElementById('report-returns-purchases');
  if (rpEl) rpEl.innerHTML = `
    <div class="report-mini-stat"><span><i class="fas fa-rotate-left"></i> عدد المرتجعات</span><strong>${returnsCount}</strong></div>
    <div class="report-mini-stat"><span><i class="fas fa-sack-xmark"></i> إجمالي المرتجعات</span><strong class="debt-cell">- ${fmt(totalReturns)} ${cur}</strong></div>
    <div class="report-mini-stat"><span><i class="fas fa-truck-ramp-box"></i> المشتريات (تكلفة البضاعة)</span><strong>${fmt(totalPurchases)} ${cur}</strong></div>
    <div class="report-mini-stat"><span><i class="fas fa-triangle-exclamation"></i> خسائر المخزون (تلف / صلاحية / جرد)</span><strong class="debt-cell">- ${fmt(stockLossInPeriod)} ${cur}</strong></div>
    <div class="report-mini-stat"><span><i class="fas fa-scale-balanced"></i> صافي الربح الحقيقي (بعد المرتجعات وخسائر المخزون)</span><strong class="profit-cell">${fmt(netProfitEst)} ${cur}</strong></div>`;

  // ─── المخزون الراكد (الميت) — لقطة حالية غير مرتبطة بالفترة المُختارة ────
  renderDeadStock();

  // Details table
  const tbody = document.getElementById('report-sales-body');
  if (tbody) tbody.innerHTML = sales.slice().reverse().map(s=>
    `<tr>
      <td>${fmtDate(s.date)}</td>
      <td>${escHtml(s.items.map(i=>i.nameAr).join(', ').slice(0,40))}</td>
      <td>${s.items.reduce((a,i)=>a+i.qty,0)}</td>
      <td>${fmt(s.total)} ${cur}</td>
      <td class="profit-cell">+${fmt(DB.Sales.netProfit(s))} ${cur}</td>
      <td>${escHtml(s.customerName)}</td>
      <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
    </tr>`).join('');
}

// ─── قراءة خيار المدة المُختار لتقرير المخزون الراكد ────────────────────────
// يدعم كلا الوضعين: اختيار جاهز (30/60/90/180 يوم) أو "مخصص" (يوم يدوي أو تاريخ محدد بنفسي)
// تُرجع دائماً قيمة صالحة لـ DB.Products.deadStock حتى لو لم يُكمل المستخدم اختيار المخصص بعد
function getDeadStockOpts() {
  const sel = document.getElementById('rep-dead-days');
  const val = sel?.value || '30';
  if (val === 'custom') {
    const mode = document.querySelector('input[name="rep-dead-custom-mode"]:checked')?.value || 'days';
    if (mode === 'date') {
      const dateVal = document.getElementById('rep-dead-custom-date')?.value;
      if (dateVal) return { sinceDate: dateVal };
      return 30; // لم يُختر تاريخ بعد → نفس الافتراضي الآمن
    }
    const customDays = parseInt(document.getElementById('rep-dead-custom-days')?.value, 10);
    return (customDays && customDays > 0) ? { days: customDays } : 30;
  }
  return parseInt(val, 10) || 30;
}

// يُظهر/يُخفي أدوات "مخصص" (عدد أيام يدوي أو تاريخ محدد) حسب اختيار القائمة المنسدلة
function toggleDeadStockCustom() {
  const sel = document.getElementById('rep-dead-days');
  const wrap = document.getElementById('rep-dead-custom-wrap');
  if (wrap) wrap.style.display = (sel?.value === 'custom') ? 'flex' : 'none';
  renderDeadStock();
}

// ─── المخزون الراكد / الميت (Dead Stock) ────────────────────────────────────
// لقطة حالية للمنتجات التي لم تتحرك منذ عدد أيام مُعيّن — لتحديد رأس المال المجمّد
function renderDeadStock() {
  const opts = getDeadStockOpts();
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const list = DB.Products.deadStock(opts);
  const totalTied = list.reduce((a, p) => a + p.tiedValue, 0);

  const sumEl = document.getElementById('report-dead-stock-summary');
  if (sumEl) sumEl.innerHTML = `
    <div class="report-mini-stat"><span><i class="fas fa-box-archive"></i> عدد الأصناف الراكدة</span><strong>${list.length}</strong></div>
    <div class="report-mini-stat"><span><i class="fas fa-vault"></i> رأس المال المجمّد في المخزون الراكد</span><strong class="debt-cell">${fmt(totalTied)} ${cur}</strong></div>`;

  const el = document.getElementById('report-dead-stock');
  if (el) el.innerHTML = list.length ? list.slice(0, 15).map((p, i) => `
    <div class="top-prod-row">
      <span class="top-rank">${i+1}</span>
      <span class="top-name">${escHtml(p.nameAr)} <small style="color:var(--text3)">(${p.neverSold ? 'لم يُباع أبداً' : `آخر بيع منذ ${p.daysIdle} يوم`})</small></span>
      <span class="top-qty">${fmt(p.stock)} ${p.unit}</span>
      <span class="top-rev">${fmt(p.tiedValue)} ${cur}</span>
    </div>`).join('') : '<div class="empty-state good"><i class="fas fa-check-circle"></i> لا يوجد مخزون راكد حالياً 🎉</div>';
}

function printReport() { window.print(); }

// ─── Export Report: Excel (احترافي) ─────────────────────────────────────────────
async function exportReportExcel() {
  if (_isCashierRole()) { toast('غير مصرح لك بتصدير التقارير / Not authorized', 'error'); return; }
  if (typeof ExcelJS === 'undefined') {
    alert('تعذر تحميل مكتبة Excel، تأكد من الاتصال بالإنترنت عند أول استخدام ثم أعد المحاولة');
    return;
  }
  const from = document.getElementById('rep-from')?.value;
  const to   = document.getElementById('rep-to')?.value;
  if (!from || !to) { alert('يرجى اختيار الفترة وإنشاء التقرير أولاً'); return; }

  const btn = document.querySelector('button[onclick="exportReportExcel()"]');
  const btnHtml = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري التصدير...'; }

  try {
    const sales = DB.Sales.between(from, to);
    const S = DB.Settings.get(); const cur = S.currency || 'دج';

    // ⚠️ نفس منطق الربح الصافي المستخدم في التقرير: ربح محقَّق فقط، مع إضافة
    // ربح الديون المُحصَّلة خلال الفترة (وليس الجزء الآجل غير المُسدَّد بعد)
    const totalRev     = sales.reduce((a, s) => a + s.total, 0);
    const totalProfit  = sales.reduce((a, s) => a + DB.Sales.netProfit(s), 0) + debtProfitCollectedBetween(from, to);
    const invoiceCount = sales.length;
    const avgBasket    = invoiceCount ? totalRev / invoiceCount : 0;

    // مقارنة مع الفترة السابقة
    const { prevFrom, prevTo } = _reportPrevPeriod(from, to);
    const prevSales    = DB.Sales.between(prevFrom, prevTo);
    const prevRev      = prevSales.reduce((a, s) => a + s.total, 0);
    const prevProfit   = prevSales.reduce((a, s) => a + DB.Sales.netProfit(s), 0) + debtProfitCollectedBetween(prevFrom, prevTo);
    const growthRev    = prevRev    ? ((totalRev - prevRev) / prevRev * 100)       : (totalRev ? 100 : 0);
    const growthProfit = prevProfit ? ((totalProfit - prevProfit) / prevProfit * 100) : (totalProfit ? 100 : 0);

    // طرق الدفع والديون
    const payMap = {};
    sales.forEach(s => {
      const m = s.paymentMethod || 'cash';
      if (!payMap[m]) payMap[m] = { count: 0, total: 0 };
      payMap[m].count++; payMap[m].total += s.total;
    });
    const debtCollected = (DB.DebtPayments.all() || [])
      .filter(p => p.date >= from && p.date <= to + 'T23:59:59')
      .reduce((a, p) => a + p.amount, 0);
    const creditGiven = sales.reduce((a, s) => a + (s.creditAmount || 0), 0);

    // المرتجعات والمشتريات
    const returnsInPeriod = (DB.Returns.all() || [])
      .filter(r => r.date >= from && r.date <= to + 'T23:59:59');
    const totalReturns = returnsInPeriod.reduce((a, r) => a + r.totalRefund, 0);
    let estLostProfit = 0;
    returnsInPeriod.forEach(r => (r.items || []).forEach(it => {
      const p = DB.Products.byId(it.productId);
      estLostProfit += (it.price - (p ? (p.buyPrice || 0) : 0)) * it.qty;
    }));
    const purchasesInPeriod = DB.Purchases.between(from, to);
    const totalPurchases = purchasesInPeriod.reduce((a, p) => a + (p.qty * p.unitPrice), 0);
    const stockLossInPeriod = DB.StockAdjustments.totalLoss(from, to + 'T23:59:59') || 0;
    const netProfitEst = totalProfit - estLostProfit - stockLossInPeriod;

    // مخزون راكد (لقطة حالية للمخزون المتجمّد رأسماله)
    const deadOpts = getDeadStockOpts();
    const deadStockList = DB.Products.deadStock(deadOpts);
    const deadStockTotal = deadStockList.reduce((a, p) => a + p.tiedValue, 0);
    // نص وصفي يوضح المعيار المُستخدم (سواء عدد أيام أو تاريخ محدد يدوياً) لعرضه في التقرير
    const deadLabel = (deadOpts && typeof deadOpts === 'object' && deadOpts.sinceDate)
      ? `منذ تاريخ ${deadOpts.sinceDate}`
      : `بدون حركة منذ ${(deadOpts && typeof deadOpts === 'object') ? deadOpts.days : deadOpts} يوم`;

    // ─── ألوان العلامة التجارية لدكاني (مطابقة لواجهة الموقع) ─────────────
    const BRAND = {
      dark:   'FF0A0F1E',
      accent: 'FF10B981',
      accent2:'FF059669',
      gold:   'FFF59E0B',
      white:  'FFFFFFFF',
      label:  'FF374151',
      border: 'FFD9DEE5',
      zebra:  'FFF3F5F8'
    };
    const numFmt = '#,##0.00';
    const thinBorder = {
      top:    { style: 'thin', color: { argb: BRAND.border } },
      bottom: { style: 'thin', color: { argb: BRAND.border } },
      left:   { style: 'thin', color: { argb: BRAND.border } },
      right:  { style: 'thin', color: { argb: BRAND.border } }
    };
    const periodLabel = `الفترة: من ${from} إلى ${to}    —    تاريخ الإصدار: ${fmtDate(new Date().toISOString())}`;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = S.storeName || 'دكاني';
    workbook.created = new Date();

    function newSheet(name) {
      return workbook.addWorksheet(name, { views: [{ rightToLeft: true, showGridLines: false }] });
    }

    // شريط العنوان العلوي (اسم المتجر + عنوان الورقة + الفترة الزمنية)
    function titleBanner(ws, colCount, subtitle) {
      ws.mergeCells(1, 1, 1, colCount);
      const t = ws.getCell(1, 1);
      t.value = `${S.storeName || 'دكاني'}  —  ${subtitle}`;
      t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: BRAND.white } };
      t.alignment = { horizontal: 'center', vertical: 'middle' };
      t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.dark } };
      ws.getRow(1).height = 32;

      ws.mergeCells(2, 1, 2, colCount);
      const p = ws.getCell(2, 1);
      p.value = periodLabel;
      p.font = { name: 'Calibri', size: 10, italic: true, color: { argb: BRAND.label } };
      p.alignment = { horizontal: 'center', vertical: 'middle' };
      p.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F2F5' } };
      ws.getRow(2).height = 20;
      ws.addRow([]);
    }

    function headerRow(ws, labels) {
      const r = ws.addRow(labels);
      r.eachCell(cell => {
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.white } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.accent } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
      });
      r.height = 24;
      return r;
    }

    function dataRow(ws, values, zebra) {
      const r = ws.addRow(values);
      r.eachCell(cell => {
        cell.font = { name: 'Calibri', size: 10.5, color: { argb: BRAND.label } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
        if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.zebra } };
      });
      r.height = 20;
      return r;
    }

    // ═══ ورقة 1: الملخص ═══════════════════════════════════════════════════
    const wsSummary = newSheet('الملخص');
    wsSummary.columns = [{ width: 34 }, { width: 20 }];
    titleBanner(wsSummary, 2, 'تقرير المبيعات / Sales Report');

    const kpis = [
      [`إجمالي المبيعات / Total Sales (${cur})`, Number(totalRev.toFixed(2)),    numFmt],
      [`إجمالي الأرباح / Total Profit (${cur})`, Number(totalProfit.toFixed(2)), numFmt],
      ['عدد الفواتير / Invoices',                 invoiceCount,                   '#,##0'],
      [`متوسط الفاتورة / Avg Basket (${cur})`,    Number(avgBasket.toFixed(2)),   numFmt],
      ['نمو المبيعات عن الفترة السابقة / Sales Growth (%)', Number(growthRev.toFixed(1)),    '#,##0.0"%"'],
      ['نمو الأرباح عن الفترة السابقة / Profit Growth (%)', Number(growthProfit.toFixed(1)), '#,##0.0"%"'],
      [`ديون جديدة (آجل) / New Credit (${cur})`,   Number(creditGiven.toFixed(2)),  numFmt],
      [`ديون تم تحصيلها / Debt Collected (${cur})`, Number(debtCollected.toFixed(2)), numFmt],
      [`إجمالي المرتجعات / Total Returns (${cur})`, Number(totalReturns.toFixed(2)), numFmt],
      [`المشتريات خلال الفترة / Purchases (${cur})`, Number(totalPurchases.toFixed(2)), numFmt],
      [`خسائر المخزون (تلف/صلاحية/جرد) / Stock Losses (${cur})`, Number(stockLossInPeriod.toFixed(2)), numFmt],
      [`صافي الربح الحقيقي (بعد المرتجعات وخسائر المخزون) / Real Net Profit (${cur})`, Number(netProfitEst.toFixed(2)), numFmt],
      [`رأس المال المجمّد بالمخزون الراكد / Dead Stock Value (${cur})`, Number(deadStockTotal.toFixed(2)), numFmt]
    ];
    kpis.forEach(([label, value, nf], i) => {
      const r = wsSummary.addRow([label, value]);
      r.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: BRAND.label } };
      r.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(2).font = { name: 'Calibri', size: 12, bold: true, color: { argb: BRAND.accent2 } };
      r.getCell(2).numFmt = nf;
      r.getCell(2).alignment = { horizontal: 'center', vertical: 'middle' };
      r.eachCell(cell => {
        cell.border = thinBorder;
        if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.zebra } };
      });
      r.height = 24;
    });
    wsSummary.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: 3 }];

    // ═══ ورقة 2: أفضل المنتجات ═══════════════════════════════════════════
    const itemMap = {};
    sales.forEach(s => s.items.forEach(it => {
      if (!itemMap[it.productId]) itemMap[it.productId] = { nameAr: it.nameAr, qty: 0, revenue: 0, profit: 0 };
      itemMap[it.productId].qty     += it.qty;
      itemMap[it.productId].revenue += it.total;
      itemMap[it.productId].profit  += it.profit;
    }));
    const topProds = Object.values(itemMap).sort((a, b) => b.revenue - a.revenue);

    const wsTop = newSheet('أفضل المنتجات');
    wsTop.columns = [{ width: 32 }, { width: 12 }, { width: 18 }, { width: 18 }];
    titleBanner(wsTop, 4, 'أفضل المنتجات مبيعاً / Top Products');
    const topHeader = headerRow(wsTop, ['المنتج / Product', 'الكمية / Qty', `المبيعات / Sales (${cur})`, `الربح / Profit (${cur})`]);
    topProds.forEach((p, i) => {
      const r = dataRow(wsTop, [p.nameAr, p.qty, Number(p.revenue.toFixed(2)), Number(p.profit.toFixed(2))], i % 2 === 1);
      r.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(3).numFmt = numFmt;
      r.getCell(4).numFmt = numFmt;
      r.getCell(4).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.accent2 } };
    });
    if (topProds.length) wsTop.autoFilter = { from: { row: topHeader.number, column: 1 }, to: { row: topHeader.number, column: 4 } };
    wsTop.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: topHeader.number }];

    // ═══ ورقة: طرق الدفع والديون ═══════════════════════════════════════════
    const wsPay = newSheet('طرق الدفع والديون');
    wsPay.columns = [{ width: 26 }, { width: 14 }, { width: 18 }];
    titleBanner(wsPay, 3, 'طرق الدفع والديون / Payment & Debt');
    const payHeader = headerRow(wsPay, ['طريقة الدفع / Method', 'عدد الفواتير / Count', `المبلغ / Total (${cur})`]);
    Object.entries(payMap).sort((a, b) => b[1].total - a[1].total).forEach(([method, d], i) => {
      const r = dataRow(wsPay, [payLabel(method), d.count, Number(d.total.toFixed(2))], i % 2 === 1);
      r.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(3).numFmt = numFmt;
      r.getCell(3).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.accent2 } };
    });
    const payExtraRow1 = dataRow(wsPay, [`ديون جديدة (آجل) / New Credit`, '', Number(creditGiven.toFixed(2))], true);
    payExtraRow1.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    payExtraRow1.getCell(3).numFmt = numFmt;
    const payExtraRow2 = dataRow(wsPay, [`ديون تم تحصيلها / Debt Collected`, '', Number(debtCollected.toFixed(2))], false);
    payExtraRow2.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    payExtraRow2.getCell(3).numFmt = numFmt;
    wsPay.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: payHeader.number }];

    // ═══ ورقة: المبيعات حسب الفئة ══════════════════════════════════════════
    const catMap = {};
    sales.forEach(s => s.items.forEach(it => {
      const prod = DB.Products.byId(it.productId);
      const catName = (prod && prod.category) || 'غير مصنف / Uncategorized';
      if (!catMap[catName]) catMap[catName] = { revenue: 0, qty: 0 };
      catMap[catName].revenue += it.total;
      catMap[catName].qty += it.qty;
    }));
    const wsCat = newSheet('المبيعات حسب الفئة');
    wsCat.columns = [{ width: 28 }, { width: 14 }, { width: 18 }];
    titleBanner(wsCat, 3, 'المبيعات حسب الفئة / Sales by Category');
    const catHeader = headerRow(wsCat, ['الفئة / Category', 'الكمية / Qty', `المبيعات / Sales (${cur})`]);
    Object.entries(catMap).sort((a, b) => b[1].revenue - a[1].revenue).forEach(([name, d], i) => {
      const r = dataRow(wsCat, [name, d.qty, Number(d.revenue.toFixed(2))], i % 2 === 1);
      r.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(3).numFmt = numFmt;
      r.getCell(3).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.accent2 } };
    });
    if (Object.keys(catMap).length) wsCat.autoFilter = { from: { row: catHeader.number, column: 1 }, to: { row: catHeader.number, column: 3 } };
    wsCat.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: catHeader.number }];

    // ═══ ورقة: أفضل الزبائن ═════════════════════════════════════════════════
    const custMap = {};
    sales.forEach(s => {
      const key = s.customerId || ('__guest__' + s.customerName);
      if (!custMap[key]) custMap[key] = { name: s.customerName || 'زبون عام', count: 0, total: 0 };
      custMap[key].count++; custMap[key].total += s.total;
    });
    const topCustomers = Object.values(custMap).sort((a, b) => b.total - a.total);
    const wsCust = newSheet('أفضل الزبائن');
    wsCust.columns = [{ width: 28 }, { width: 16 }, { width: 18 }];
    titleBanner(wsCust, 3, 'أفضل الزبائن / Top Customers');
    const custHeader = headerRow(wsCust, ['الزبون / Customer', 'عدد الفواتير / Invoices', `الإجمالي / Total (${cur})`]);
    topCustomers.forEach((c, i) => {
      const r = dataRow(wsCust, [c.name, c.count, Number(c.total.toFixed(2))], i % 2 === 1);
      r.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(3).numFmt = numFmt;
      r.getCell(3).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.accent2 } };
    });
    if (topCustomers.length) wsCust.autoFilter = { from: { row: custHeader.number, column: 1 }, to: { row: custHeader.number, column: 3 } };
    wsCust.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: custHeader.number }];

    // ═══ ورقة: المخزون الراكد ══════════════════════════════════════════════
    const wsDead = newSheet('المخزون الراكد');
    wsDead.columns = [{ width: 30 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 20 }];
    titleBanner(wsDead, 5, `المخزون الراكد (${deadLabel}) / Dead Stock`);
    const deadHeader = headerRow(wsDead, ['المنتج / Product', 'الكمية / Stock', 'الفئة / Category', 'آخر بيع / Last Sale', `القيمة المجمّدة / Tied Value (${cur})`]);
    deadStockList.forEach((p, i) => {
      const r = dataRow(wsDead, [
        p.nameAr,
        p.stock,
        p.category || '—',
        p.neverSold ? 'لم يُباع أبداً' : `${p.lastSaleDate} (منذ ${p.daysIdle} يوم)`,
        Number(p.tiedValue.toFixed(2))
      ], i % 2 === 1);
      r.getCell(1).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(3).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(4).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(5).numFmt = numFmt;
      r.getCell(5).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: 'FFDC2626' } };
    });
    if (deadStockList.length) wsDead.autoFilter = { from: { row: deadHeader.number, column: 1 }, to: { row: deadHeader.number, column: 5 } };
    wsDead.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: deadHeader.number }];

    // ═══ ورقة 3: تفاصيل المبيعات ═════════════════════════════════════════
    const wsDetails = newSheet('تفاصيل المبيعات');
    wsDetails.columns = [{ width: 16 }, { width: 40 }, { width: 10 }, { width: 16 }, { width: 16 }, { width: 20 }, { width: 16 }];
    titleBanner(wsDetails, 7, 'تفاصيل المبيعات / Sales Details');
    const detHeader = headerRow(wsDetails, [
      'التاريخ / Date', 'المنتجات / Products', 'الكمية / Qty',
      `المبلغ / Total (${cur})`, `الربح / Profit (${cur})`, 'الزبون / Customer', 'الدفع / Payment'
    ]);
    sales.slice().reverse().forEach((s, i) => {
      const r = dataRow(wsDetails, [
        fmtDate(s.date),
        s.items.map(it => it.nameAr).join(', '),
        s.items.reduce((a, it) => a + it.qty, 0),
        Number(s.total.toFixed(2)),
        Number(DB.Sales.netProfit(s).toFixed(2)),
        s.customerName,
        payLabel(s.paymentMethod)
      ], i % 2 === 1);
      r.getCell(2).alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
      r.getCell(4).numFmt = numFmt;
      r.getCell(5).numFmt = numFmt;
      r.getCell(5).font = { name: 'Calibri', size: 10.5, bold: true, color: { argb: BRAND.accent2 } };
    });
    if (sales.length) wsDetails.autoFilter = { from: { row: detHeader.number, column: 1 }, to: { row: detHeader.number, column: 7 } };
    wsDetails.views = [{ rightToLeft: true, showGridLines: false, state: 'frozen', ySplit: detHeader.number }];

    // ─── تنزيل الملف ───────────────────────────────────────────────────────
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `تقرير-المبيعات_${from}_${to}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء ملف Excel، حاول مرة أخرى');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
  }
}

// ─── Export Report: PDF ────────────────────────────────────────────────────────
async function exportReportPDF(btn) {
  if (_isCashierRole()) { toast('غير مصرح لك بتصدير التقارير / Not authorized', 'error'); return; }
  if (typeof html2canvas === 'undefined' || typeof window.jspdf === 'undefined') {
    alert('تعذر تحميل مكتبة PDF، تأكد من الاتصال بالإنترنت عند أول استخدام ثم أعد المحاولة');
    return;
  }
  const from = document.getElementById('rep-from')?.value;
  const to   = document.getElementById('rep-to')?.value;
  if (!from || !to) { alert('يرجى اختيار الفترة وإنشاء التقرير أولاً'); return; }

  const originalHTML = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جارٍ التجهيز...'; }

  const S = DB.Settings.get();
  const kpiHTML   = document.getElementById('report-kpis')?.innerHTML || '';
  const topHTML   = document.getElementById('report-top-products')?.innerHTML || '';
  const payHTML   = document.getElementById('report-payment-methods')?.innerHTML || '';
  const catHTML   = document.getElementById('report-categories')?.innerHTML || '';
  const custHTML  = document.getElementById('report-top-customers')?.innerHTML || '';
  const retHTML   = document.getElementById('report-returns-purchases')?.innerHTML || '';
  const deadSumHTML  = document.getElementById('report-dead-stock-summary')?.innerHTML || '';
  const deadListHTML = document.getElementById('report-dead-stock')?.innerHTML || '';
  const tableHTML = document.getElementById('report-sales-body')?.innerHTML || '';
  let chartImg = '';
  try { if (chartReport) chartImg = chartReport.toBase64Image(); } catch (e) {}

  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#ffffff;color:#111827;font-family:Cairo,sans-serif;padding:28px;direction:rtl;z-index:-1;';
  wrap.innerHTML = `
    <div style="text-align:center;margin-bottom:18px;border-bottom:2px solid #10b981;padding-bottom:12px">
      <h1 style="margin:0;font-size:20px;color:#111827">${S.storeName || 'دكاني'}</h1>
      <p style="margin:6px 0 0;font-size:13px;color:#6b7280">تقرير المبيعات — من ${from} إلى ${to}</p>
    </div>
    <div class="pdf-kpis" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">${kpiHTML}</div>
    ${chartImg ? `<img src="${chartImg}" style="width:100%;margin-bottom:20px;border:1px solid #e5e7eb;border-radius:8px"/>` : ''}
    <h3 style="font-size:15px;margin:0 0 8px;color:#111827">أفضل المنتجات / Top Products</h3>
    <div class="pdf-top" style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">${topHTML}</div>
    <div style="display:flex;gap:14px;margin-bottom:20px">
      <div style="flex:1">
        <h3 style="font-size:15px;margin:0 0 8px;color:#111827">طرق الدفع والديون / Payment &amp; Debt</h3>
        <div class="pdf-breakdown" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px 12px">${payHTML}</div>
      </div>
      <div style="flex:1">
        <h3 style="font-size:15px;margin:0 0 8px;color:#111827">حسب الفئة / By Category</h3>
        <div class="pdf-breakdown" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px 12px">${catHTML}</div>
      </div>
    </div>
    <div style="display:flex;gap:14px;margin-bottom:20px">
      <div style="flex:1">
        <h3 style="font-size:15px;margin:0 0 8px;color:#111827">أفضل الزبائن / Top Customers</h3>
        <div class="pdf-top" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">${custHTML}</div>
      </div>
      <div style="flex:1">
        <h3 style="font-size:15px;margin:0 0 8px;color:#111827">المرتجعات والمشتريات / Returns &amp; Purchases</h3>
        <div class="pdf-mini" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px 12px">${retHTML}</div>
      </div>
    </div>
    <h3 style="font-size:15px;margin:0 0 8px;color:#111827"><i class="fas fa-box-archive"></i> المخزون الراكد / Dead Stock</h3>
    <div class="pdf-mini" style="border:1px solid #e5e7eb;border-radius:8px;padding:6px 12px;margin-bottom:14px">${deadSumHTML}</div>
    <div class="pdf-top" style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">${deadListHTML}</div>
    <h3 style="font-size:15px;margin:0 0 8px;color:#111827">تفاصيل المبيعات / Sales Details</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px">
      <thead><tr>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">التاريخ</th>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">المنتج</th>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">الكمية</th>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">المبلغ</th>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">الربح</th>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">الزبون</th>
        <th style="padding:6px;background:#f8fafc;border-bottom:2px solid #e5e7eb;text-align:right">الدفع</th>
      </tr></thead>
      <tbody>${tableHTML}</tbody>
    </table>`;
  document.body.appendChild(wrap);

  // تحويل ألوان الوضع الداكن إلى ألوان مناسبة للطباعة على خلفية بيضاء
  wrap.querySelectorAll('.kpi-card').forEach(c => {
    c.style.cssText += 'background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:10px 14px;flex:1;min-width:150px;';
  });
  wrap.querySelectorAll('.kpi-value').forEach(c => { c.style.color = '#059669'; });
  wrap.querySelectorAll('.kpi-label').forEach(c => { c.style.color = '#6b7280'; });
  wrap.querySelectorAll('.kpi-delta').forEach(c => {
    c.style.cssText += 'display:inline-flex;background:#eef2f7;border-radius:20px;padding:2px 8px;';
    c.style.color = c.classList.contains('up') ? '#059669' : (c.classList.contains('down') ? '#dc2626' : '#6b7280');
  });
  wrap.querySelectorAll('.top-prod-row').forEach(c => {
    c.style.cssText += 'display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #f1f5f9;color:#111827;';
  });
  wrap.querySelectorAll('.top-rank').forEach(c => { c.style.cssText += 'background:#eef2f7;color:#059669;'; });
  wrap.querySelectorAll('.top-name, .top-qty').forEach(c => { c.style.color = '#111827'; });
  wrap.querySelectorAll('.top-rev').forEach(c => { c.style.color = '#059669'; });
  wrap.querySelectorAll('.breakdown-row').forEach(c => { c.style.cssText += 'border-bottom:1px solid #f1f5f9;padding:8px 0;'; });
  wrap.querySelectorAll('.breakdown-label, .breakdown-value').forEach(c => { c.style.color = '#111827'; });
  wrap.querySelectorAll('.breakdown-count').forEach(c => { c.style.color = '#6b7280'; });
  wrap.querySelectorAll('.breakdown-bar').forEach(c => { c.style.cssText += 'background:#eef2f7;'; });
  wrap.querySelectorAll('.breakdown-bar-fill').forEach(c => { c.style.cssText += 'background:#10b981;'; });
  wrap.querySelectorAll('.report-mini-stat').forEach(c => {
    c.style.cssText += 'display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;color:#111827;';
  });
  wrap.querySelectorAll('.report-mini-stat span').forEach(c => { c.style.color = '#6b7280'; });
  wrap.querySelectorAll('.profit-cell').forEach(c => { c.style.color = '#059669'; });
  wrap.querySelectorAll('.debt-cell').forEach(c => { c.style.color = '#dc2626'; });
  wrap.querySelectorAll('td, th').forEach(c => { c.style.color = '#111827'; c.style.borderBottom = '1px solid #f1f5f9'; });

  try {
    const canvas = await html2canvas(wrap, { scale: 2, backgroundColor: '#ffffff', useCORS: true });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgW  = pageW;
    const imgH  = canvas.height * imgW / canvas.width;
    const imgData = canvas.toDataURL('image/png');

    let heightLeft = imgH;
    let position   = 0;
    pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
    heightLeft -= pageH;
    while (heightLeft > 0) {
      position = heightLeft - imgH;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgW, imgH);
      heightLeft -= pageH;
    }
    pdf.save(`تقرير-المبيعات_${from}_${to}.pdf`);
  } catch (err) {
    console.error(err);
    alert('حدث خطأ أثناء إنشاء ملف PDF');
  } finally {
    wrap.remove();
    if (btn) { btn.disabled = false; btn.innerHTML = originalHTML; }
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const S = DB.Settings.get();
  document.getElementById('set-store-name').value   = S.storeName || '';
  document.getElementById('set-address').value      = S.address || '';
  document.getElementById('set-phone').value        = S.phone || '';
  document.getElementById('set-currency').value     = S.currency || 'دج';
  document.getElementById('set-low-stock').value    = S.lowStockThreshold || 5;
  document.getElementById('set-expiry-days').value  = S.expiryWarningDays || 15;
  const thanksEl = document.getElementById('set-thanks');
  if (thanksEl) thanksEl.value = S.thankYouMessage || '';
  renderLogoPreview();

  const tierSilverEl = document.getElementById('set-tier-silver');
  const tierGoldEl   = document.getElementById('set-tier-gold');
  const tierVipEl    = document.getElementById('set-tier-vip');
  if (tierSilverEl) tierSilverEl.value = S.custTierSilver || 5000;
  if (tierGoldEl)   tierGoldEl.value   = S.custTierGold   || 20000;
  if (tierVipEl)    tierVipEl.value    = S.custTierVip    || 50000;

  const alertLowStockEl     = document.getElementById('set-alert-lowstock');
  const alertExpiringSoonEl = document.getElementById('set-alert-expiringsoon');
  const alertExpiredEl      = document.getElementById('set-alert-expired');
  const alertCustomerDebtEl = document.getElementById('set-alert-customerdebt');
  const alertSupplierDebtEl = document.getElementById('set-alert-supplierdebt');
  if (alertLowStockEl)     alertLowStockEl.checked     = S.alertLowStock     !== false;
  if (alertExpiringSoonEl) alertExpiringSoonEl.checked = S.alertExpiringSoon !== false;
  if (alertExpiredEl)      alertExpiredEl.checked      = S.alertExpired      !== false;
  if (alertCustomerDebtEl) alertCustomerDebtEl.checked = S.alertCustomerDebt !== false;
  if (alertSupplierDebtEl) alertSupplierDebtEl.checked = S.alertSupplierDebt !== false;

  renderCategories();

  const st = DB.stats();
  const el = document.getElementById('db-stats');
  if (el) el.innerHTML = `
    <div class="db-stat"><span>المنتجات / Products</span><strong>${st.products}</strong></div>
    <div class="db-stat"><span>الزبائن / Customers</span><strong>${st.customers}</strong></div>
    <div class="db-stat"><span>المبيعات / Sales</span><strong>${st.sales}</strong></div>
    <div class="db-stat"><span>المشتريات / Purchases</span><strong>${st.purchases}</strong></div>
    <div class="db-stat"><span>حجم البيانات / DB Size</span><strong>${st.size}</strong></div>`;
}

function saveSettings() {
  const current = DB.Settings.get();

  // حدود تصنيف الزبائن — إن وُجدت الحقول في الصفحة نتحقق من ترتيبها المنطقي
  const tierSilverEl = document.getElementById('set-tier-silver');
  const tierGoldEl   = document.getElementById('set-tier-gold');
  const tierVipEl    = document.getElementById('set-tier-vip');
  let custTierSilver = current.custTierSilver || 5000;
  let custTierGold   = current.custTierGold   || 20000;
  let custTierVip    = current.custTierVip    || 50000;
  if (tierSilverEl && tierGoldEl && tierVipEl) {
    const silverVal = parseInt(tierSilverEl.value) || 0;
    const goldVal    = parseInt(tierGoldEl.value)   || 0;
    const vipVal     = parseInt(tierVipEl.value)    || 0;
    if (silverVal > 0 && goldVal > silverVal && vipVal > goldVal) {
      custTierSilver = silverVal; custTierGold = goldVal; custTierVip = vipVal;
    } else {
      toast('حدود تصنيف الزبائن غير صحيحة (يجب أن تكون: فضي < ذهبي < ماسي) — لم يتم تحديثها', 'error');
    }
  }

  DB.Settings.save({
    ...current,
    storeName:         document.getElementById('set-store-name').value.trim(),
    address:           document.getElementById('set-address').value.trim(),
    phone:             document.getElementById('set-phone').value.trim(),
    currency:          document.getElementById('set-currency').value,
    lowStockThreshold: parseInt(document.getElementById('set-low-stock').value) || 5,
    expiryWarningDays: parseInt(document.getElementById('set-expiry-days').value) || 15,
    thankYouMessage:   (document.getElementById('set-thanks')?.value || '').trim(),
    custTierSilver, custTierGold, custTierVip
  });
  toast('تم حفظ الإعدادات / Settings saved ✓', 'success');
  checkAlerts();
  if (document.getElementById('customers-body')) renderCustomers();
}

// ─── تخصيص التنبيهات: حفظ أنواع التنبيهات المفعّلة ─────────────────────────────
function saveNotificationSettings() {
  const current = DB.Settings.get();
  DB.Settings.save({
    ...current,
    alertLowStock:     document.getElementById('set-alert-lowstock')?.checked     !== false,
    alertExpiringSoon: document.getElementById('set-alert-expiringsoon')?.checked !== false,
    alertExpired:      document.getElementById('set-alert-expired')?.checked      !== false,
    alertCustomerDebt: document.getElementById('set-alert-customerdebt')?.checked !== false,
    alertSupplierDebt: document.getElementById('set-alert-supplierdebt')?.checked !== false
  });
  checkAlerts();
  toast('تم حفظ إعدادات التنبيهات / Notification settings saved ✓', 'success');
}

// ─── تخصيص الفاتورة: الشعار ─────────────────────────────────────────────────
function uploadLogo(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    toast('الرجاء اختيار صورة صالحة / Please select a valid image', 'error');
    return;
  }
  if (file.size > 1024 * 1024) {
    toast('حجم الصورة كبير جداً (الحد الأقصى 1MB) / Image too large (max 1MB)', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const current = DB.Settings.get();
    DB.Settings.save({ ...current, logo: e.target.result });
    renderLogoPreview();
    toast('تم رفع الشعار / Logo uploaded ✓', 'success');
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function removeLogo() {
  const current = DB.Settings.get();
  if (!current.logo) return;
  DB.Settings.save({ ...current, logo: '' });
  renderLogoPreview();
  toast('تم حذف الشعار / Logo removed', 'info');
}

function renderLogoPreview() {
  const box = document.getElementById('logo-preview-box');
  if (!box) return;
  const S = DB.Settings.get();
  box.innerHTML = S.logo
    ? `<img src="${S.logo}" class="logo-preview-img" alt="logo"/>`
    : `<i class="fas fa-store"></i><span>لا يوجد شعار</span>`;
}

function renderCategories() {
  const cats = DB.Categories.all();
  const el   = document.getElementById('cat-list');
  if (!el) return;
  el.innerHTML = cats.map(c =>
    `<div class="cat-row">
      <span>${escHtml(c.name)}</span>
      <button class="btn-icon danger" onclick="deleteCategory('${c.id}')"><i class="fas fa-xmark"></i></button>
    </div>`).join('');
}

function addCategory() {
  const inp = document.getElementById('new-cat-input');
  const name = inp.value.trim();
  if (!name) { toast('أدخل اسم الفئة / Enter category name', 'error'); return; }
  DB.Categories.add(name);
  inp.value = '';
  renderCategories();
  toast('تمت الإضافة / Category added ✓', 'success');
}

function deleteCategory(id) {
  DB.Categories.delete(id);
  renderCategories();
  toast('تم الحذف / Deleted', 'info');
}

function confirmReset() {
  if (confirm('⚠️ سيتم مسح جميع البيانات نهائياً! هل أنت متأكد؟\n⚠️ All data will be permanently deleted! Are you sure?')) {
    DB.resetAll();
  }
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
// نظام تنبيهات شامل: مخزون منخفض/نافذ، قرب/انتهاء الصلاحية، ديون الزبائن،
// مستحقات الموردين. كل نوع تنبيه قابل للتفعيل/الإيقاف من الإعدادات (settings)
// عبر مفاتيح alertLowStock / alertExpired / alertExpiringSoon /
// alertCustomerDebt / alertSupplierDebt — دون التأثير على باقي الأنواع.
function checkAlerts() {
  const S   = DB.Settings.get();
  const cur = S.currency || 'دج';

  const low             = S.alertLowStock     !== false ? DB.Products.lowStock()   : [];
  const expired         = S.alertExpired      !== false ? DB.Products.expired()    : [];
  const expiringSoon    = S.alertExpiringSoon !== false ? DB.Products.expiringSoon() : [];
  const customerDebtors = S.alertCustomerDebt !== false && DB.Customers.debtors ? DB.Customers.debtors() : [];
  const supplierDebtors = S.alertSupplierDebt !== false && DB.Suppliers.debtors ? DB.Suppliers.debtors() : [];

  const badge = document.getElementById('notif-badge');
  const list  = document.getElementById('notif-list');
  const total = low.length + expired.length + expiringSoon.length + customerDebtors.length + supplierDebtors.length;
  if (badge) badge.textContent = total;
  if (list) {
    const stockItems = low.map(p => `<div class="notif-item ${p.stock===0?'notif-out':'notif-low'}">
        <i class="fas fa-${p.stock===0?'ban':'triangle-exclamation'}"></i>
        <div><strong>${escHtml(p.nameAr)}</strong><br/>${p.stock===0?'نفذ / Out of stock':'مخزون منخفض: '+p.stock+' '+p.unit}</div>
      </div>`).join('');
    const expiredItems = expired.map(p => {
      const info = expiryInfo(p);
      return `<div class="notif-item notif-out">
        <i class="fas fa-skull-crossbones"></i>
        <div><strong>${escHtml(p.nameAr)}</strong><br/>منتهي الصلاحية: ${fmtDateOnly(p.expiryDate)} (${info.label})</div>
      </div>`;
    }).join('');
    const soonItems = expiringSoon.map(p => {
      const info = expiryInfo(p);
      return `<div class="notif-item notif-low">
        <i class="fas fa-hourglass-half"></i>
        <div><strong>${escHtml(p.nameAr)}</strong><br/>قرب الانتهاء: ${fmtDateOnly(p.expiryDate)} (${info.label})</div>
      </div>`;
    }).join('');
    const customerDebtItems = customerDebtors.map(c => `<div class="notif-item notif-debt">
        <i class="fas fa-hand-holding-dollar"></i>
        <div><strong>${escHtml(c.name || 'زبون')}</strong><br/>دين مستحق: ${fmt(c.debt)} ${cur}</div>
      </div>`).join('');
    const supplierDebtItems = supplierDebtors.map(s => `<div class="notif-item notif-debt">
        <i class="fas fa-truck-fast"></i>
        <div><strong>${escHtml(s.name || 'مورد')}</strong><br/>مستحق للمورد: ${fmt(s.balance)} ${cur}</div>
      </div>`).join('');
    list.innerHTML = total
      ? expiredItems + soonItems + stockItems + customerDebtItems + supplierDebtItems
      : '<div class="notif-empty"><i class="fas fa-check-circle"></i> لا توجد تنبيهات / No alerts</div>';
  }
}

function toggleNotif() {
  document.getElementById('notif-panel').classList.toggle('visible');
}
document.addEventListener('click', e => {
  if (!e.target.closest('.notif-bell') && !e.target.closest('.notif-panel'))
    document.getElementById('notif-panel')?.classList.remove('visible');
});

// ─── البحث السريع الذكي (Smart Global Search) ────────────────────────────────
// يكتشف تلقائياً إن كنت تبحث عن: صفحة (مثل "تسوية المخزون")، منتج، زبون، مورد أو فاتورة

// خريطة الصفحات وكلماتها المفتاحية (عربي/إنجليزي/مرادفات شائعة)
const GS_PAGES = [
  { page: 'dashboard', icon: 'fa-chart-pie',        title: 'لوحة التحكم', sub: 'Dashboard',
    kw: ['لوحة التحكم','لوحة تحكم','الرئيسية','رئيسية','dashboard','home'] },
  { page: 'products',  icon: 'fa-boxes-stacked',    title: 'المنتجات', sub: 'Products',
    kw: ['المنتجات','منتجات','منتج','products','product'] },
  { page: 'sell',      icon: 'fa-cash-register',    title: 'نقطة البيع', sub: 'Point of Sale',
    kw: ['نقطة البيع','بيع','مبيعات','كاشير','كاش','sell','pos','point of sale','cashier'] },
  { page: 'purchases', icon: 'fa-cart-arrow-down',  title: 'المشتريات', sub: 'Purchases',
    kw: ['المشتريات','مشتريات','شراء','شرا','purchases','purchase'] },
  { page: 'suppliers', icon: 'fa-truck',            title: 'الموردون', sub: 'Suppliers',
    kw: ['الموردون','الموردين','مورد','موردين','موردون','suppliers','supplier'] },
  { page: 'customers', icon: 'fa-users',            title: 'الزبائن', sub: 'Customers',
    kw: ['الزبائن','زبائن','زبون','عملاء','عميل','customers','customer','clients'] },
  { page: 'invoices',  icon: 'fa-file-invoice',     title: 'الفواتير', sub: 'Invoices',
    kw: ['الفواتير','فواتير','فاتورة','invoices','invoice'] },
  { page: 'returns',   icon: 'fa-rotate-left',      title: 'المرتجعات', sub: 'Returns & Refunds',
    kw: ['المرتجعات','مرتجعات','مرتجع','ارجاع','إرجاع','استرجاع','returns','return','refund'] },
  { page: 'inventory', icon: 'fa-boxes-stacked',    title: 'تسوية المخزون', sub: 'Inventory',
    kw: ['تسوية المخزون','تسوية','جرد المخزون','جرد','مخزون','inventory','stock adjustment','stock'] },
  { page: 'reports',   icon: 'fa-chart-line',       title: 'التقارير', sub: 'Reports',
    kw: ['التقارير','تقارير','تقرير','احصائيات','إحصائيات','reports','report','statistics'] },
  { page: 'settings',  icon: 'fa-gear',             title: 'الإعدادات', sub: 'Settings',
    kw: ['الإعدادات','اعدادات','إعدادات','ضبط','settings','setting'] }
];

// توحيد الحروف العربية المتقاربة لتفادي أخطاء البحث (أ/إ/آ/ا، ة/ه، ى/ي...)
function _gsNormalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[إأآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/[ىي]/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .trim();
}

let _gsHighlight = -1;

function globalSearch(q) {
  const box = document.getElementById('global-search-results');
  if (!box) return;
  const raw = (q || '').trim();
  _gsHighlight = -1;

  if (!raw) { box.classList.remove('visible'); box.innerHTML = ''; return; }

  const nq = _gsNormalize(raw);

  // 1️⃣ الصفحات — أولوية عليا لأنها تطابق أوضح نية المستخدم
  const pageHits = GS_PAGES
    .map(p => {
      let score = -1;
      for (const k of p.kw) {
        const nk = _gsNormalize(k);
        if (nk === nq) { score = Math.max(score, 100); }
        else if (nk.startsWith(nq)) { score = Math.max(score, 80); }
        else if (nk.includes(nq)) { score = Math.max(score, 60); }
      }
      return { ...p, score };
    })
    .filter(p => p.score > -1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  // 2️⃣ المنتجات (بالاسم أو الباركود)
  const productHits = DB.Products.search(raw).slice(0, 5);

  // 3️⃣ الزبائن (بالاسم أو الهاتف)
  const customerHits = DB.Customers.all()
    .filter(c => _gsNormalize(c.name).includes(nq) || (c.phone || '').includes(raw))
    .slice(0, 5);

  // 4️⃣ الموردون
  const supplierHits = DB.Suppliers.all()
    .filter(s => _gsNormalize(s.name).includes(nq))
    .slice(0, 4);

  // 5️⃣ الفواتير (برقم الفاتورة أو اسم الزبون)
  const invoiceHits = DB.Sales.all()
    .filter(s => s.invoiceNo.toUpperCase().includes(raw.toUpperCase()) || _gsNormalize(s.customerName || '').includes(nq))
    .slice(-4).reverse();

  const totalHits = pageHits.length + productHits.length + customerHits.length + supplierHits.length + invoiceHits.length;

  if (!totalHits) {
    box.innerHTML = `<div class="gsr-empty"><i class="fas fa-magnifying-glass"></i><br/>لا توجد نتائج مطابقة / No matches</div>`;
    box.classList.add('visible');
    return;
  }

  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  let html = '';

  if (pageHits.length) {
    html += `<div class="gsr-group-label">الصفحات / Pages</div>`;
    html += pageHits.map(p => `
      <div class="gsr-item" onclick="_gsGoPage('${p.page}')">
        <i class="fas ${p.icon}"></i>
        <div class="gsr-item-text">
          <div class="gsr-item-title">${escHtml(p.title)}</div>
          <div class="gsr-item-sub">${p.sub}</div>
        </div>
        <span class="gsr-item-badge">صفحة</span>
      </div>`).join('');
  }

  if (productHits.length) {
    html += `<div class="gsr-group-label">المنتجات / Products</div>`;
    html += productHits.map(p => `
      <div class="gsr-item" onclick="_gsGoProduct('${p.id}')">
        <i class="fas fa-box"></i>
        <div class="gsr-item-text">
          <div class="gsr-item-title">${escHtml(p.nameAr)}</div>
          <div class="gsr-item-sub">${fmt(p.sellPrice)} ${cur} · مخزون: ${DB.Products.totalStock(p)}</div>
        </div>
        <span class="gsr-item-badge">منتج</span>
      </div>`).join('');
  }

  if (customerHits.length) {
    html += `<div class="gsr-group-label">الزبائن / Customers</div>`;
    html += customerHits.map(c => `
      <div class="gsr-item" onclick="_gsGoCustomer('${c.id}')">
        <i class="fas fa-user"></i>
        <div class="gsr-item-text">
          <div class="gsr-item-title">${escHtml(c.name)}</div>
          <div class="gsr-item-sub">${escHtml(c.phone || '—')}${c.debt ? ' · دين: ' + fmt(c.debt) + ' ' + cur : ''}</div>
        </div>
        <span class="gsr-item-badge">زبون</span>
      </div>`).join('');
  }

  if (supplierHits.length) {
    html += `<div class="gsr-group-label">الموردون / Suppliers</div>`;
    html += supplierHits.map(s => `
      <div class="gsr-item" onclick="_gsGoSupplier('${s.id}')">
        <i class="fas fa-truck"></i>
        <div class="gsr-item-text">
          <div class="gsr-item-title">${escHtml(s.name)}</div>
          <div class="gsr-item-sub">${escHtml(s.phone || '—')}</div>
        </div>
        <span class="gsr-item-badge">مورد</span>
      </div>`).join('');
  }

  if (invoiceHits.length) {
    html += `<div class="gsr-group-label">الفواتير / Invoices</div>`;
    html += invoiceHits.map(s => `
      <div class="gsr-item" onclick="_gsGoInvoice('${s.id}')">
        <i class="fas fa-file-invoice"></i>
        <div class="gsr-item-text">
          <div class="gsr-item-title">${s.invoiceNo}</div>
          <div class="gsr-item-sub">${escHtml(s.customerName)} · ${fmt(s.total)} ${cur}</div>
        </div>
        <span class="gsr-item-badge">فاتورة</span>
      </div>`).join('');
  }

  box.innerHTML = html;
  box.classList.add('visible');
}

function _gsClose() {
  const box = document.getElementById('global-search-results');
  if (box) { box.classList.remove('visible'); box.innerHTML = ''; }
  _gsHighlight = -1;
}

function _gsClearInput() {
  const input = document.getElementById('global-search');
  if (input) input.value = '';
}

function _gsGoPage(page) {
  navigateTo(page);
  _gsClose(); _gsClearInput();
}

function _gsGoProduct(id) {
  navigateTo('products');
  renderProducts();
  editProduct(id);
  _gsClose(); _gsClearInput();
}

function _gsGoCustomer(id) {
  navigateTo('customers');
  renderCustomers();
  editCustomer(id);
  _gsClose(); _gsClearInput();
}

function _gsGoSupplier(id) {
  navigateTo('suppliers');
  const input = document.getElementById('supp-search');
  if (input) { input.value = ''; }
  if (typeof renderSuppliers === 'function') renderSuppliers();
  _gsClose(); _gsClearInput();
}

function _gsGoInvoice(id) {
  navigateTo('invoices');
  renderInvoices();
  viewInvoice(id);
  _gsClose(); _gsClearInput();
}

// ─── تنقل بالكيبورد داخل نتائج البحث السريع ───────────────────────────────────
function globalSearchKeydown(e) {
  const box = document.getElementById('global-search-results');
  if (!box || !box.classList.contains('visible')) {
    if (e.key === 'Escape') _gsClose();
    return;
  }
  const items = Array.from(box.querySelectorAll('.gsr-item'));
  if (!items.length) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    _gsHighlight = (_gsHighlight + 1) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === _gsHighlight));
    items[_gsHighlight].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    _gsHighlight = (_gsHighlight - 1 + items.length) % items.length;
    items.forEach((el, i) => el.classList.toggle('active', i === _gsHighlight));
    items[_gsHighlight].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const target = items[_gsHighlight > -1 ? _gsHighlight : 0];
    target?.click();
  } else if (e.key === 'Escape') {
    _gsClose();
    document.getElementById('global-search')?.blur();
  }
}

document.addEventListener('click', e => {
  if (!e.target.closest('#global-search-wrap')) _gsClose();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n)   { return (parseFloat(n)||0).toLocaleString('ar-DZ', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-DZ', { year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' }); }
  catch { return d; }
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ─── تاريخ الصلاحية: أدوات مساعدة ───────────────────────────────────────────
// يعرض تاريخاً بصيغة YYYY-MM-DD كتاريخ محلي دون أي انزياح بسبب المنطقة الزمنية
function fmtDateOnly(d) {
  if (!d) return '—';
  const parts = String(d).slice(0, 10).split('-');
  if (parts.length !== 3) return d;
  const dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString('ar-DZ', { year: 'numeric', month: 'short', day: 'numeric' });
}

// يحسب حالة صلاحية منتج: منتهي / قريب الانتهاء / سليم / بدون تاريخ
function expiryInfo(p) {
  const days = DB.Products.daysToExpiry(p);
  if (days === null) return null;
  const S = DB.Settings.get();
  const warnDays = S.expiryWarningDays || 15;
  if (days < 0)  return { status: 'expired', badge: 'badge-out', days, label: `منتهي منذ ${Math.abs(days)} يوم` };
  if (days === 0) return { status: 'expired', badge: 'badge-out', days, label: 'ينتهي اليوم' };
  if (days <= warnDays) return { status: 'soon', badge: 'badge-low', days, label: `باقي ${days} يوم` };
  return { status: 'ok', badge: 'badge-ok', days, label: `صالح` };
}
function payLabel(m) { return { cash:'نقدي / Cash', card:'بطاقة / Card', credit:'آجل / Credit', mixed:'نقدي + آجل / Split' }[m] || m; }

// ─── الربح المُحصَّل من سداد الديون خلال فترة مُعيّنة ─────────────────────────
// يُستخدم لإضافته إلى ربح المبيعات النقدية عند حساب "الربح الصافي" لأي فترة،
// لأن ربح البيع الآجل لا يُحتسب وقت البيع بل فقط عند تحصيل الدين فعلياً.
function debtProfitCollectedBetween(from, to) {
  return (DB.DebtPayments.all() || [])
    .filter(p => p.date >= from && p.date <= to + 'T23:59:59')
    .reduce((a, p) => a + (p.profit || 0), 0);
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  // نُنظّف نص الرسالة دائماً قبل الحقن في innerHTML (msg قد يحتوي بيانات
  // أدخلها المستخدم مثل اسم منتج/عميل/ملف)، مع إبقاء أيقونة الحالة كما هي
  // (الأيقونة نفسها ثابتة من الكود، وليست من مدخلات المستخدم).
  const safeMsg = (typeof escHtml === 'function') ? escHtml(msg) : msg;
  el.innerHTML = `<i class="fas fa-${type==='success'?'check-circle':type==='error'?'circle-xmark':type==='warning'?'triangle-exclamation':'circle-info'}"></i> ${safeMsg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 400); }, 3500);
}


// ════════════════════════════════════════════════════════════════════════════
// تقرير الموردين / Suppliers Report
// ════════════════════════════════════════════════════════════════════════════

function showSuppliersReport() {
  if (_isCashierRole()) { toast('غير مصرح لك بعرض هذا التقرير / Not authorized', 'error'); return; }
  const S      = DB.Settings.get();
  const cur    = S.currency || 'دج';
  const allPurchases = DB.Purchases.all();
  const allSuppliers = DB.Suppliers.all();

  // ── بناء إحصائيات لكل مورد ──
  const suppMap = {};

  // إضافة الموردين المسجّلين
  allSuppliers.forEach(s => {
    suppMap[s.id] = {
      id: s.id, name: s.name, phone: s.phone || '—', city: s.city || '—',
      totalAmount: 0, orderCount: 0, lastOrder: null, products: new Set()
    };
  });

  // حساب الإحصائيات من المشتريات
  allPurchases.forEach(p => {
    const key = p.supplierId || '__none__';
    if (!suppMap[key]) {
      suppMap[key] = {
        id: key, name: p.supplier || 'مورد غير محدد',
        phone: '—', city: '—',
        totalAmount: 0, orderCount: 0, lastOrder: null, products: new Set()
      };
    }
    const total = (p.qty || 0) * (p.unitPrice || 0);
    suppMap[key].totalAmount += total;
    suppMap[key].orderCount  += 1;
    if (!suppMap[key].lastOrder || p.date > suppMap[key].lastOrder)
      suppMap[key].lastOrder = p.date;
    const prod = DB.Products.byId(p.productId);
    if (prod) suppMap[key].products.add(prod.nameAr);
  });

  const rows = Object.values(suppMap)
    .filter(s => s.orderCount > 0 || allSuppliers.find(x => x.id === s.id))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  const grandTotal  = rows.reduce((a, s) => a + s.totalAmount, 0);
  const grandOrders = rows.reduce((a, s) => a + s.orderCount, 0);
  const activeSupp  = rows.filter(s => s.orderCount > 0).length;
  const topSupp     = rows.length ? rows[0] : null;

  // ── HTML التقرير ──
  const body = document.getElementById('supp-report-body');
  if (!body) return;

  body.innerHTML = `
    <!-- KPI سريع -->
    <div class="kpi-grid" style="margin-bottom:20px">
      <div class="kpi-card kpi-sales">
        <div class="kpi-icon"><i class="fas fa-truck"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${allSuppliers.length}</div>
          <div class="kpi-label">إجمالي الموردين</div>
        </div>
      </div>
      <div class="kpi-card kpi-profit">
        <div class="kpi-icon"><i class="fas fa-coins"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${fmt(grandTotal)} ${cur}</div>
          <div class="kpi-label">إجمالي المشتريات</div>
        </div>
      </div>
      <div class="kpi-card kpi-invoices">
        <div class="kpi-icon"><i class="fas fa-receipt"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${grandOrders}</div>
          <div class="kpi-label">إجمالي الطلبات</div>
        </div>
      </div>
      <div class="kpi-card kpi-products">
        <div class="kpi-icon"><i class="fas fa-star"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${topSupp ? escHtml(topSupp.name.slice(0, 14)) : '—'}</div>
          <div class="kpi-label">المورد الأول</div>
        </div>
      </div>
    </div>

    <!-- شريط البحث -->
    <div class="filter-bar" style="margin-bottom:16px">
      <input type="text" id="srep-search" placeholder="بحث في التقرير..." oninput="filterSuppReport(this.value)" style="flex:1"/>
    </div>

    <!-- الجدول -->
    <div class="table-wrap" id="srep-table-wrap">
      <table class="data-table" id="srep-table">
        <thead>
          <tr>
            <th>#</th>
            <th>المورد / Supplier</th>
            <th>الهاتف</th>
            <th>المدينة</th>
            <th>عدد الطلبات</th>
            <th>إجمالي المبلغ</th>
            <th>النسبة %</th>
            <th>آخر طلب</th>
            <th>المنتجات المشتراة</th>
          </tr>
        </thead>
        <tbody id="srep-body">
          ${rows.length ? rows.map((s, i) => {
            const pct = grandTotal > 0 ? ((s.totalAmount / grandTotal) * 100).toFixed(1) : '0.0';
            const barW = grandTotal > 0 ? Math.round((s.totalAmount / grandTotal) * 100) : 0;
            const prodsStr = [...s.products].slice(0, 3).join('، ') + (s.products.size > 3 ? ` +${s.products.size - 3}` : '');
            const rankColor = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#cd7c3a' : 'var(--text3)';
            return `<tr data-supp-name="${escHtml(s.name.toLowerCase())}">
              <td><span style="font-size:16px;font-weight:900;color:${rankColor}">${i+1}</span></td>
              <td>
                <div style="font-weight:700;color:var(--text1)">${escHtml(s.name)}</div>
                ${s.id !== '__none__' ? `<button class="btn-icon" style="margin-top:4px;padding:2px 8px;font-size:11px" onclick="closeModal('modal-supp-report');viewSupplierDetail('${s.id}')"><i class="fas fa-eye"></i> تفاصيل</button>` : ''}
              </td>
              <td>${s.phone !== '—' ? `<a href="tel:${escHtml(s.phone)}" style="color:var(--accent)">${escHtml(s.phone)}</a>` : '—'}</td>
              <td>${escHtml(s.city)}</td>
              <td><span class="badge-count">${s.orderCount}</span></td>
              <td><strong style="color:var(--accent)">${fmt(s.totalAmount)} ${cur}</strong></td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="flex:1;background:#1e293b;border-radius:4px;height:8px;overflow:hidden">
                    <div style="width:${barW}%;height:100%;background:linear-gradient(90deg,#10b981,#059669);border-radius:4px"></div>
                  </div>
                  <span style="font-size:12px;color:var(--text2);min-width:36px">${pct}%</span>
                </div>
              </td>
              <td style="font-size:12px;color:var(--text3)">${s.lastOrder ? fmtDate(s.lastOrder) : '—'}</td>
              <td style="font-size:12px;color:var(--text3);max-width:160px">${prodsStr || '—'}</td>
            </tr>`;
          }).join('')
          : `<tr><td colspan="9" class="empty-td"><i class="fas fa-info-circle"></i> لا توجد بيانات — أضف مشتريات أولاً</td></tr>`}
        </tbody>
        ${rows.length ? `
        <tfoot>
          <tr style="font-weight:700;background:#0d1117;border-top:2px solid var(--border)">
            <td colspan="4" style="text-align:right;padding:12px 16px;color:var(--text2)">
              <i class="fas fa-sigma"></i> الإجمالي / Total
            </td>
            <td><span class="badge-count">${grandOrders}</span></td>
            <td style="color:var(--accent);font-size:15px">${fmt(grandTotal)} ${cur}</td>
            <td>100%</td>
            <td colspan="2"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>`;

  openModal('modal-supp-report');
}

function filterSuppReport(q) {
  const tbody = document.getElementById('srep-body');
  if (!tbody) return;
  const term = q.toLowerCase();
  tbody.querySelectorAll('tr[data-supp-name]').forEach(row => {
    const name = row.dataset.suppName || '';
    row.style.display = (!term || name.includes(term)) ? '' : 'none';
  });
}

function printSuppliersReport() {
  const content = document.getElementById('supp-report-body')?.innerHTML || '';
  const S = DB.Settings.get();
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head>
    <meta charset="UTF-8"/><title>تقرير الموردين — ${S.storeName || 'دكاني'}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet"/>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
    <style>
      *{box-sizing:border-box}
      body{font-family:'Cairo',sans-serif;background:#fff;color:#111;padding:24px;direction:rtl}
      h2{margin:0 0 16px;color:#059669}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{background:#059669;color:#fff;padding:10px 12px;text-align:right}
      td{padding:8px 12px;border-bottom:1px solid #e5e7eb}
      tr:nth-child(even)td{background:#f9fafb}
      tfoot td{font-weight:700;background:#ecfdf5;border-top:2px solid #059669}
      .no-print{display:none}
      @media print{body{padding:0}}
    </style>
  </head><body>
    <h2><i class="fas fa-chart-bar"></i> تقرير الموردين — ${S.storeName || 'دكاني'}</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px">تاريخ التقرير: ${new Date().toLocaleDateString('ar-DZ',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
    ${content}
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

// ════════════════════════════════════════════════════════════════════════════
// تقرير ديون الموردين / Suppliers Debts Report
// ─────────────────────────────────────────────────────────────────────────────
// على عكس "تقرير الموردين" أعلاه (الذي يلخّص إجمالي المشتريات من كل مورد)،
// هذا التقرير مخصص فقط لعرض المبالغ المالية المستحقة التوريد لكل مورد،
// أي حقل s.balance المُدار عبر DB.Suppliers.addBalance/reduceBalance
// و DB.SupplierPayments — بشكل مستقل تماماً، دون أي تعديل على تلك الدوال.
// ════════════════════════════════════════════════════════════════════════════

function showSuppliersDebtReport() {
  const S   = DB.Settings.get();
  const cur = S.currency || 'دج';

  // فقط الموردون الذين لديهم مبلغ مستحق (دين) أكبر من صفر
  const rows = DB.Suppliers.all()
    .filter(s => (s.balance || 0) > 0)
    .sort((a, b) => (b.balance || 0) - (a.balance || 0));

  const grandTotal = rows.reduce((a, s) => a + (s.balance || 0), 0);
  const avgDebt    = rows.length ? grandTotal / rows.length : 0;
  const topDebtor  = rows.length ? rows[0] : null;

  const body = document.getElementById('supp-debt-report-body');
  if (!body) return;

  body.innerHTML = `
    <!-- KPI سريع -->
    <div class="kpi-grid" style="margin-bottom:20px">
      <div class="kpi-card kpi-low">
        <div class="kpi-icon"><i class="fas fa-triangle-exclamation"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${rows.length}</div>
          <div class="kpi-label">موردون لديهم مستحقات</div>
        </div>
      </div>
      <div class="kpi-card kpi-profit">
        <div class="kpi-icon"><i class="fas fa-sack-dollar"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${fmt(grandTotal)} ${cur}</div>
          <div class="kpi-label">إجمالي المستحق للموردين</div>
        </div>
      </div>
      <div class="kpi-card kpi-invoices">
        <div class="kpi-icon"><i class="fas fa-truck"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${topDebtor ? fmt(topDebtor.balance) + ' ' + cur : '—'}</div>
          <div class="kpi-label">أعلى مستحق${topDebtor ? ' (' + escHtml(topDebtor.name.slice(0, 14)) + ')' : ''}</div>
        </div>
      </div>
      <div class="kpi-card kpi-sales">
        <div class="kpi-icon"><i class="fas fa-calculator"></i></div>
        <div class="kpi-info">
          <div class="kpi-value">${fmt(avgDebt)} ${cur}</div>
          <div class="kpi-label">متوسط المستحق لكل مورد</div>
        </div>
      </div>
    </div>

    <!-- شريط البحث -->
    <div class="filter-bar" style="margin-bottom:16px">
      <input type="text" id="sdrep-search" placeholder="بحث في تقرير الديون..." oninput="filterSuppDebtReport(this.value)" style="flex:1"/>
    </div>

    <!-- الجدول -->
    <div class="table-wrap" id="sdrep-table-wrap">
      <table class="data-table" id="sdrep-table">
        <thead>
          <tr>
            <th>#</th>
            <th>المورد / Supplier</th>
            <th>الهاتف</th>
            <th>المدينة</th>
            <th>إجمالي المشتريات</th>
            <th>المبلغ المستحق</th>
            <th>آخر طلب</th>
            <th>آخر دفعة</th>
            <th>إجراءات</th>
          </tr>
        </thead>
        <tbody id="sdrep-body">
          ${rows.length ? rows.map((s, i) => `
            <tr data-supp-name="${escHtml(s.name.toLowerCase())}">
              <td>${i + 1}</td>
              <td><div style="font-weight:700;color:var(--text1)">${escHtml(s.name)}</div></td>
              <td>${s.phone ? `<a href="tel:${escHtml(s.phone)}" style="color:var(--accent)">${escHtml(s.phone)}</a>` : '—'}</td>
              <td>${escHtml(s.city || s.address || '—')}</td>
              <td>${fmt(s.totalPurchased || 0)} ${cur}</td>
              <td class="debt-cell-danger"><div class="debt-amount-badge">${fmt(s.balance)} ${cur}</div></td>
              <td style="font-size:12px;color:var(--text3)">${s.lastOrder ? fmtDate(s.lastOrder) : '—'}</td>
              <td style="font-size:12px;color:var(--text3)">${s.lastPayment ? fmtDate(s.lastPayment) : '—'}</td>
              <td style="display:flex;gap:6px;flex-wrap:wrap">
                <button class="btn-icon pay-btn-icon" onclick="closeModal('modal-supp-debt-report');openSupplierPayModal('${s.id}')" title="تسديد دفعة"><i class="fas fa-hand-holding-dollar"></i></button>
                <button class="btn-icon" onclick="closeModal('modal-supp-debt-report');viewSupplierStatement('${s.id}')" title="كشف حساب"><i class="fas fa-file-invoice-dollar"></i></button>
              </td>
            </tr>`).join('')
            : `<tr><td colspan="9" class="empty-td"><i class="fas fa-circle-check"></i> لا توجد مبالغ مستحقة لأي مورد حالياً 🎉</td></tr>`}
        </tbody>
        ${rows.length ? `
        <tfoot>
          <tr style="font-weight:700;background:#0d1117;border-top:2px solid var(--border)">
            <td colspan="5" style="text-align:right;padding:12px 16px;color:var(--text2)">
              <i class="fas fa-sigma"></i> الإجمالي / Total
            </td>
            <td style="color:#ef4444;font-size:15px">${fmt(grandTotal)} ${cur}</td>
            <td colspan="3"></td>
          </tr>
        </tfoot>` : ''}
      </table>
    </div>`;

  openModal('modal-supp-debt-report');
}

function filterSuppDebtReport(q) {
  const tbody = document.getElementById('sdrep-body');
  if (!tbody) return;
  const term = q.toLowerCase();
  tbody.querySelectorAll('tr[data-supp-name]').forEach(row => {
    const name = row.dataset.suppName || '';
    row.style.display = (!term || name.includes(term)) ? '' : 'none';
  });
}

function printSuppliersDebtReport() {
  const content = document.getElementById('supp-debt-report-body')?.innerHTML || '';
  const S = DB.Settings.get();
  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head>
    <meta charset="UTF-8"/><title>تقرير ديون الموردين — ${S.storeName || 'دكاني'}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap" rel="stylesheet"/>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css"/>
    <style>
      *{box-sizing:border-box}
      body{font-family:'Cairo',sans-serif;background:#fff;color:#111;padding:24px;direction:rtl}
      h2{margin:0 0 16px;color:#dc2626}
      table{width:100%;border-collapse:collapse;font-size:13px}
      th{background:#dc2626;color:#fff;padding:10px 12px;text-align:right}
      td{padding:8px 12px;border-bottom:1px solid #e5e7eb}
      tr:nth-child(even)td{background:#f9fafb}
      tfoot td{font-weight:700;background:#fef2f2;border-top:2px solid #dc2626}
      .no-print{display:none}
      @media print{body{padding:0} button{display:none}}
    </style>
  </head><body>
    <h2><i class="fas fa-triangle-exclamation"></i> تقرير ديون الموردين — ${S.storeName || 'دكاني'}</h2>
    <p style="color:#6b7280;font-size:13px;margin:0 0 16px">تاريخ التقرير: ${new Date().toLocaleDateString('ar-DZ',{weekday:'long',year:'numeric',month:'long',day:'numeric'})}</p>
    ${content}
    <script>window.onload=()=>{window.print();}<\/script>
  </body></html>`);
  win.document.close();
}

// ─── تسجيل نظام العمل دون اتصال الديناميكي (Dakani PWA Active) ───────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('دكاني جاهز للعمل دون اتصال بنجاح! / Scope:', reg.scope))
      .catch(err => console.error('خطأ في تسجيل نظام الـ PWA:', err));
  });
}
// ════════════════════════════════════════════════════════════════════════════
// تسوية المخزون / Inventory Adjustment
// ════════════════════════════════════════════════════════════════════════════

function renderInventory() {
  const cur = DB.Settings.get().currency || 'دج';
  const products = DB.Products.all();
  const adjs     = DB.StockAdjustments.all();
  const q        = (document.getElementById('inv-search')?.value || '').toLowerCase();

  // ── بطاقات الملخص ──
  const totalProds   = products.length;
  const outOfStock   = products.filter(p => DB.Products.totalStock(p) === 0).length;
  const lowStock     = products.filter(p => { const s = DB.Products.totalStock(p); return s > 0 && s <= (DB.Settings.get().lowStockThreshold || 5); }).length;
  const adjToday     = adjs.filter(a => a.date && a.date.startsWith(DB.today())).length;
  const lossToday    = adjs.filter(a => a.date && a.date.startsWith(DB.today())).reduce((s,a) => s + (a.costImpact || 0), 0);
  const expiredCount = DB.Products.expired().length;

  document.getElementById('inv-summary').innerHTML = `
    <div class="inv-stat-card">
      <i class="fas fa-boxes-stacked" style="color:#6366f1"></i>
      <div>
        <div class="inv-stat-val">${totalProds}</div>
        <div class="inv-stat-lbl">إجمالي المنتجات / Total Products</div>
      </div>
    </div>
    <div class="inv-stat-card">
      <i class="fas fa-circle-xmark" style="color:#ef4444"></i>
      <div>
        <div class="inv-stat-val" style="color:#ef4444">${outOfStock}</div>
        <div class="inv-stat-lbl">نفد المخزون / Out of Stock</div>
      </div>
    </div>
    <div class="inv-stat-card">
      <i class="fas fa-triangle-exclamation" style="color:#f59e0b"></i>
      <div>
        <div class="inv-stat-val" style="color:#f59e0b">${lowStock}</div>
        <div class="inv-stat-lbl">مخزون منخفض / Low Stock</div>
      </div>
    </div>
    <div class="inv-stat-card">
      <i class="fas fa-clock-rotate-left" style="color:#10b981"></i>
      <div>
        <div class="inv-stat-val">${adjToday}</div>
        <div class="inv-stat-lbl">تسويات اليوم / Today's Adjustments</div>
      </div>
    </div>
    <div class="inv-stat-card">
      <i class="fas fa-sack-dollar" style="color:#ef4444"></i>
      <div>
        <div class="inv-stat-val" style="color:#ef4444">${fmt(lossToday)} ${cur}</div>
        <div class="inv-stat-lbl">خسائر اليوم / Today's Losses</div>
      </div>
    </div>
    <div class="inv-stat-card ${expiredCount ? 'inv-stat-clickable' : ''}" ${expiredCount ? `onclick="navigateTo('dashboard')"` : ''}>
      <i class="fas fa-skull-crossbones" style="color:#ef4444"></i>
      <div>
        <div class="inv-stat-val" style="color:#ef4444">${expiredCount}</div>
        <div class="inv-stat-lbl">بانتظار تسوية الصلاحية / Awaiting Expiry Write-off</div>
      </div>
    </div>`;

  // ── سجل التسويات ──
  const filtered = q
    ? adjs.filter(a => a.productName?.toLowerCase().includes(q) || (a.reason||'').includes(q) || (a.note||'').toLowerCase().includes(q))
    : adjs;

  const wrap = document.getElementById('inv-log-wrap');
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><i class="fas fa-clipboard-list"></i> لا توجد تسويات بعد / No adjustments yet</div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>التاريخ / Date</th>
            <th>المنتج / Product</th>
            <th>الكمية القديمة</th>
            <th>الكمية الجديدة</th>
            <th>الفرق / Δ</th>
            <th>السبب / Reason</th>
            <th>الخسارة / Loss</th>
            <th>ملاحظة / Note</th>
          </tr>
        </thead>
        <tbody>
          ${filtered.map(a => {
            const d    = new Date(a.date);
            const dateStr = d.toLocaleDateString('ar-DZ') + ' ' + d.toLocaleTimeString('ar-DZ', {hour:'2-digit',minute:'2-digit'});
            const delta   = a.delta >= 0
              ? `<span style="color:#10b981;font-weight:700">+${a.delta}</span>`
              : `<span style="color:#ef4444;font-weight:700">${a.delta}</span>`;
            const lossCell = a.costImpact > 0
              ? `<span style="color:#ef4444;font-weight:700">${fmt(a.costImpact)} ${cur}</span>`
              : '<span style="color:#6b7280">—</span>';
            return `<tr>
              <td style="font-size:12px;white-space:nowrap">${dateStr}</td>
              <td><strong>${a.productName || ''}</strong>${a.unit ? ' <small>('+a.unit+')</small>' : ''}</td>
              <td style="text-align:center">${a.oldQty}</td>
              <td style="text-align:center;font-weight:700">${a.newQty}</td>
              <td style="text-align:center">${delta}</td>
              <td><span class="adj-reason-badge">${escHtml(a.reason || '')}</span></td>
              <td style="text-align:center">${lossCell}</td>
              <td style="color:#6b7280;font-size:13px">${escHtml(a.note || '—')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Modal ──
let _adjSelectedProd = null;

function openAdjModal(prefill) {
  _adjSelectedProd = null;
  document.getElementById('adj-prod-search').value = '';
  document.getElementById('adj-prod-id').value = '';
  document.getElementById('adj-prod-results').innerHTML = '';
  document.getElementById('adj-prod-info').style.display = 'none';
  document.getElementById('adj-new-qty').value = '';
  document.getElementById('adj-reason').value = 'جرد يدوي';
  document.getElementById('adj-note').value = '';
  document.getElementById('adj-preview').style.display = 'none';
  document.getElementById('modal-inventory').classList.add('active');

  if (prefill && prefill.productId) {
    adjSelectProduct(prefill.productId);
    if (prefill.reason != null) document.getElementById('adj-reason').value = prefill.reason;
    if (prefill.newQty != null) document.getElementById('adj-new-qty').value = prefill.newQty;
    if (prefill.note   != null) document.getElementById('adj-note').value   = prefill.note;
    adjUpdatePreview();
  } else {
    setTimeout(() => document.getElementById('adj-prod-search')?.focus(), 100);
  }
}

// ─── تسوية سريعة لمنتج منتهي/قريب الانتهاء الصلاحية (زر "تسوية الآن") ────────
function writeOffExpired(productId) {
  const p = DB.Products.byId(productId);
  if (!p) return;
  const info = expiryInfo(p);
  const note = info ? `${info.label} — ${fmtDateOnly(p.expiryDate)}` : 'منتج منتهي الصلاحية';
  openAdjModal({ productId, reason: 'انتهاء الصلاحية', newQty: 0, note });
}

function adjSearchProducts() {
  const q   = document.getElementById('adj-prod-search').value.trim();
  const res = document.getElementById('adj-prod-results');
  if (!q) { res.innerHTML = ''; return; }
  const allHits = DB.Products.search(q);
  const hits = allHits.filter(p => !DB.Products.hasVariants(p)).slice(0, 8);
  if (!hits.length) {
    res.innerHTML = allHits.length
      ? '<div class="adj-no-result">هذا المنتج له متغيّرات — عدّل مخزونه من صفحة المنتجات / This product has variants — edit its stock from the Products page</div>'
      : '<div class="adj-no-result">لا نتائج / No results</div>';
    return;
  }
  res.innerHTML = hits.map(p => `
    <div class="adj-result-item" onclick="adjSelectProduct('${p.id}')">
      <strong>${escHtml(p.nameAr)}</strong>
      ${p.nameEn ? `<span style="color:#6b7280"> · ${escHtml(p.nameEn)}</span>` : ''}
      <span class="adj-stock-badge ${(p.stock||0)===0?'out':(p.stock||0)<=5?'low':'ok'}">
        ${p.stock || 0} ${p.unit || ''}
      </span>
    </div>`).join('');
}

function adjSelectProduct(id) {
  const p = DB.Products.byId(id);
  if (!p) return;
  _adjSelectedProd = p;
  document.getElementById('adj-prod-id').value = id;
  document.getElementById('adj-prod-search').value = p.nameAr + (p.nameEn ? ' / ' + p.nameEn : '');
  document.getElementById('adj-prod-results').innerHTML = '';
  document.getElementById('adj-new-qty').value = p.stock || 0;

  const cur = DB.Settings.get().currency || 'دج';
  const info = document.getElementById('adj-prod-info');
  info.style.display = 'block';
  const expLine = p.expiryDate
    ? `<div class="adj-info-row"><span>تاريخ الصلاحية:</span> <strong>${fmtDateOnly(p.expiryDate)}</strong></div>`
    : '';
  info.innerHTML = `
    <div class="adj-info-row"><span>الرصيد الحالي:</span> <strong>${p.stock || 0} ${p.unit || ''}</strong></div>
    <div class="adj-info-row"><span>سعر البيع:</span> <strong>${fmt(p.sellPrice || 0)} ${cur}</strong></div>
    <div class="adj-info-row"><span>سعر التكلفة:</span> <strong>${_hideIfCashier(fmt(p.buyPrice || 0) + ' ' + cur)}</strong></div>
    ${expLine}`;

  adjUpdatePreview();
}

function adjUpdatePreview() {
  if (!_adjSelectedProd) return;
  const newQty = parseFloat(document.getElementById('adj-new-qty').value);
  const preview = document.getElementById('adj-preview');
  if (isNaN(newQty)) { preview.style.display = 'none'; return; }
  const delta = newQty - (_adjSelectedProd.stock || 0);
  const sign  = delta >= 0 ? '+' : '';
  const color = delta > 0 ? '#10b981' : delta < 0 ? '#ef4444' : '#6b7280';
  const cur   = DB.Settings.get().currency || 'دج';
  // القيمة المالية الدقيقة للخسارة = الكمية الناقصة × سعر التكلفة
  const lossValue = delta < 0 ? Math.abs(delta) * (_adjSelectedProd.buyPrice || 0) : 0;
  preview.style.display = 'block';
  preview.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span>${_adjSelectedProd.stock || 0} ${_adjSelectedProd.unit || ''}</span>
      <i class="fas fa-arrow-left" style="color:#6b7280"></i>
      <span style="font-size:18px;font-weight:700">${newQty} ${_adjSelectedProd.unit || ''}</span>
      <span style="color:${color};font-weight:700;font-size:15px">(${sign}${delta})</span>
    </div>
    ${lossValue > 0 ? `<div style="margin-top:10px;color:#ef4444;font-weight:700;font-size:13px">
      <i class="fas fa-circle-exclamation"></i> القيمة المقدّرة للخسارة: ${_hideIfCashier(fmt(lossValue) + ' ' + cur)}
    </div>` : ''}`;
}

// اربط حدث تغيير الكمية بالمعاينة
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('adj-new-qty')?.addEventListener('input', adjUpdatePreview);
});

function saveAdjustment() {
  const prodId = document.getElementById('adj-prod-id').value;
  const newQty = parseFloat(document.getElementById('adj-new-qty').value);
  const reason = document.getElementById('adj-reason').value;
  const note   = document.getElementById('adj-note').value.trim();

  if (!prodId)       { toast('اختر منتجاً أولاً / Select a product', 'warning'); return; }
  if (isNaN(newQty) || newQty < 0) { toast('أدخل كمية صحيحة / Enter valid quantity', 'warning'); return; }

  DB.StockAdjustments.add(prodId, newQty, reason, note);
  closeModal('modal-inventory');
  toast('تم تسوية المخزون بنجاح ✓', 'success');
  renderInventory();
  updateUndoButton();
  if (typeof renderProducts === 'function' && document.getElementById('page-products')?.classList.contains('active')) renderProducts();
  if (typeof loadDashboard  === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard();
  if (typeof checkAlerts    === 'function') checkAlerts();
}

// ══════════════════════════════════════════════════════════════════════════════
//  RETURNS & REFUNDS
// ══════════════════════════════════════════════════════════════════════════════

// ─── حالة المودال ─────────────────────────────────────────────────────────────
let _retSelectedSale     = null;  // الفاتورة المختارة
let _retCheckedItems     = [];    // عناصر محددة من الفاتورة
let _retManualItems      = [];    // عناصر يدوية (بدون فاتورة)
let _retManualProdId     = null;
let _retMode             = 'invoice'; // 'invoice' | 'manual'

// ─── فتح مودال الإنشاء ────────────────────────────────────────────────────────
function openReturnModal() {
  _retSelectedSale  = null;
  _retCheckedItems  = [];
  _retManualItems   = [];
  _retManualProdId  = null;
  _retMode          = 'invoice';

  const inp = document.getElementById('ret-inv-input');
  if (inp) inp.value = '';
  const res = document.getElementById('ret-inv-results');
  if (res) { res.innerHTML = ''; res.classList.remove('open'); }
  const info = document.getElementById('ret-inv-info');
  if (info) info.style.display = 'none';
  const iw = document.getElementById('ret-items-wrap');
  if (iw) iw.style.display = 'none';
  const mw = document.getElementById('ret-manual-wrap');
  if (mw) mw.style.display = 'none';
  const mb = document.getElementById('ret-manual-btn');
  if (mb) { mb.innerHTML = '<i class="fas fa-pen"></i> بدون فاتورة'; mb.onclick = retUseManual; }
  retUpdateTotal();
  openModal('modal-return');
}

// ─── البحث عن فاتورة ─────────────────────────────────────────────────────────
function retSearchInvoice() {
  const q   = (document.getElementById('ret-inv-input')?.value || '').trim().toUpperCase();
  const res = document.getElementById('ret-inv-results');
  if (!res) return;
  if (!q) { res.innerHTML = ''; res.classList.remove('open'); return; }

  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  const all = DB.Sales.all().slice().reverse();
  const matches = all.filter(s =>
    s.invoiceNo.includes(q) ||
    (s.customerName || '').includes(q)
  ).slice(0, 8);

  if (!matches.length) {
    res.innerHTML = '<div class="ret-inv-result-row" style="color:var(--text3);cursor:default">لا توجد نتائج / No results</div>';
    res.classList.add('open');
    return;
  }

  res.innerHTML = matches.map(s => `
    <div class="ret-inv-result-row" onclick="retSelectInvoice('${s.id}')">
      <span class="inv-no">${s.invoiceNo}</span>
      <span class="inv-customer">${escHtml(s.customerName)}</span>
      <span class="inv-total">${fmt(s.total)} ${cur}</span>
    </div>`).join('');
  res.classList.add('open');
}

// ─── مسح باركود الفاتورة داخل نافذة "مرتجع جديد": اختيار فوري عند التطابق ────
function retInvKeydown(e) {
  if (e.key !== 'Enter') return;
  const q = (document.getElementById('ret-inv-input')?.value || '').trim().toUpperCase();
  if (!q) return;
  const exact = DB.Sales.all().find(s => s.invoiceNo.toUpperCase() === q);
  if (exact) {
    retSelectInvoice(exact.id);
  } else {
    // لا توجد مطابقة تامة (باركود غير معروف) — أبقِ نتائج البحث الجزئي المعروضة
    retSearchInvoice();
    toast(`❌ لم يتم العثور على فاتورة بهذا الرقم: ${q}`, 'error');
  }
}

// ─── اختيار فاتورة ───────────────────────────────────────────────────────────
function retSelectInvoice(saleId) {
  const s = DB.Sales.byId(saleId);
  if (!s) return;
  _retSelectedSale = s;
  _retMode = 'invoice';

  // إخفاء نتائج البحث
  const res = document.getElementById('ret-inv-results');
  if (res) { res.innerHTML = ''; res.classList.remove('open'); }
  const inp = document.getElementById('ret-inv-input');
  if (inp) inp.value = s.invoiceNo;

  // إخفاء الإدخال اليدوي
  const mw = document.getElementById('ret-manual-wrap');
  if (mw) mw.style.display = 'none';

  // عرض chip معلومات الفاتورة
  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  const chip = document.getElementById('ret-inv-chip');
  if (chip) chip.innerHTML = `
    <span><span class="chip-label">رقم الفاتورة</span><br/><strong>${s.invoiceNo}</strong></span>
    <span><span class="chip-label">الزبون</span><br/>${escHtml(s.customerName)}</span>
    <span><span class="chip-label">الإجمالي</span><br/>${fmt(s.total)} ${cur}</span>
    <span><span class="chip-label">الدفع</span><br/><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></span>
    <span><span class="chip-label">التاريخ</span><br/>${fmtDate(s.date)}</span>`;
  document.getElementById('ret-inv-info').style.display = 'block';

  // بناء جدول الاختيار
  const tbody = document.getElementById('ret-items-body');
  if (tbody) {
    tbody.innerHTML = s.items.map((it, idx) => `
      <tr>
        <td><input type="checkbox" class="ret-item-chk" data-idx="${idx}" onchange="retUpdateChecked()"/></td>
        <td>${escHtml(it.nameAr)}</td>
        <td>${it.qty}</td>
        <td><input type="number" class="ret-qty-inp" data-idx="${idx}" value="${it.qty}"
            min="1" max="${it.qty}" step="${it.isWeight ? '0.001' : '1'}"
            style="width:70px;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:4px 6px;color:var(--text1)"
            onchange="retUpdateChecked()"/></td>
        <td>${fmt(it.price)} ${cur}</td>
        <td id="ret-item-total-${idx}">${fmt(it.total)} ${cur}</td>
      </tr>`).join('');
  }
  document.getElementById('ret-items-wrap').style.display = 'block';
  retUpdateChecked();
}

// ─── تحديث الكميات المختارة ───────────────────────────────────────────────────
function retUpdateChecked() {
  if (!_retSelectedSale) return;
  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  _retCheckedItems = [];

  document.querySelectorAll('.ret-item-chk').forEach(chk => {
    const idx = parseInt(chk.dataset.idx);
    const it  = _retSelectedSale.items[idx];
    const qtyInp = document.querySelector(`.ret-qty-inp[data-idx="${idx}"]`);
    const qty = parseFloat(qtyInp?.value || it.qty);
    const unitPrice = it.price;
    const total = +(qty * unitPrice).toFixed(2);

    // تحديث إجمالي الصف
    const totCell = document.getElementById(`ret-item-total-${idx}`);
    if (totCell) totCell.textContent = fmt(total) + ' ' + cur;

    if (chk.checked && qty > 0) {
      _retCheckedItems.push({
        productId: it.productId,
        variantId: it.variantId || null,
        nameAr:    it.nameAr,
        qty,
        price:     unitPrice,
        total,
        restoreStock: true
      });
    }
  });

  retUpdateTotal();
}

// ─── تحديد/إلغاء الكل ────────────────────────────────────────────────────────
function retToggleAll(masterChk) {
  document.querySelectorAll('.ret-item-chk').forEach(chk => {
    chk.checked = masterChk.checked;
  });
  retUpdateChecked();
}

// ─── تحديث إجمالي الاسترداد ──────────────────────────────────────────────────
function retUpdateTotal() {
  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  let total = 0;
  if (_retMode === 'invoice') {
    total = _retCheckedItems.reduce((a, it) => a + it.total, 0);
  } else {
    total = _retManualItems.reduce((a, it) => a + it.total, 0);
  }
  const el = document.getElementById('ret-total-val');
  if (el) el.textContent = fmt(total) + ' ' + cur;
}

// ─── وضع الإدخال اليدوي ──────────────────────────────────────────────────────
function retUseManual() {
  _retMode = 'manual';
  _retSelectedSale = null;
  _retManualItems  = [];
  _retManualProdId = null;

  document.getElementById('ret-inv-info').style.display      = 'none';
  document.getElementById('ret-items-wrap').style.display    = 'none';
  document.getElementById('ret-manual-wrap').style.display   = 'block';
  document.getElementById('ret-manual-items').innerHTML      = '';
  document.getElementById('ret-manual-btn').innerHTML        = '<i class="fas fa-file-invoice"></i> من فاتورة';
  document.getElementById('ret-manual-btn').onclick          = retUseInvoice;
  retUpdateTotal();
}

function retUseInvoice() {
  _retMode = 'invoice';
  _retManualItems = [];
  document.getElementById('ret-manual-wrap').style.display = 'none';
  document.getElementById('ret-manual-btn').innerHTML = '<i class="fas fa-pen"></i> بدون فاتورة';
  document.getElementById('ret-manual-btn').onclick = retUseManual;
  retUpdateTotal();
}

// ─── البحث في وضع اليدوي ─────────────────────────────────────────────────────
function retManualSearch() {
  const q   = (document.getElementById('ret-manual-prod')?.value || '').toLowerCase();
  const res = document.getElementById('ret-manual-results');
  if (!res) return;
  if (q.length < 1) { res.innerHTML = ''; res.style.display = 'none'; return; }

  const prods = DB.Products.search(q).slice(0, 6);
  if (!prods.length) { res.innerHTML = ''; res.style.display = 'none'; return; }

  res.style.display = 'block';
  res.innerHTML = prods.map(p => `
    <div class="adj-result-row" onclick="retManualSelectProd('${p.id}')">
      <span>${escHtml(p.nameAr)}</span>
      <span style="color:var(--text3);font-size:12px">${fmt(p.price)} دج • مخزون: ${p.stock}</span>
    </div>`).join('');
}

function retManualSelectProd(id) {
  const p = DB.Products.byId(id);
  if (!p) return;
  _retManualProdId = id;
  document.getElementById('ret-manual-prod').value = p.nameAr;
  document.getElementById('ret-manual-price').value = p.price || 0;
  document.getElementById('ret-manual-results').style.display = 'none';
  retCalcManual();
}

function retCalcManual() {
  // لا تُضيف تلقائياً — فقط حساب مرئي
}

function retAddManualItem() {
  if (!_retManualProdId) { toast('اختر منتجاً أولاً / Select a product first', 'error'); return; }
  const qty   = parseFloat(document.getElementById('ret-manual-qty')?.value || 1);
  const price = parseFloat(document.getElementById('ret-manual-price')?.value || 0);
  if (qty <= 0 || price < 0) { toast('الكمية والسعر يجب أن يكونا صحيحين / Invalid qty or price', 'error'); return; }
  const p = DB.Products.byId(_retManualProdId);
  _retManualItems.push({
    productId: _retManualProdId,
    nameAr: p.nameAr,
    qty,
    price,
    total: +(qty * price).toFixed(2),
    restoreStock: true
  });
  retRenderManualItems();
  document.getElementById('ret-manual-prod').value  = '';
  document.getElementById('ret-manual-qty').value   = '1';
  document.getElementById('ret-manual-price').value = '0';
  _retManualProdId = null;
  retUpdateTotal();
}

function retRenderManualItems() {
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const el = document.getElementById('ret-manual-items');
  if (!el) return;
  el.innerHTML = _retManualItems.length
    ? _retManualItems.map((it, i) => `
        <div class="ret-manual-item">
          <span>${escHtml(it.nameAr)} × ${it.qty}</span>
          <span>${fmt(it.total)} ${cur}</span>
          <button onclick="retRemoveManualItem(${i})"><i class="fas fa-xmark"></i></button>
        </div>`).join('')
    : '';
}

function retRemoveManualItem(i) {
  _retManualItems.splice(i, 1);
  retRenderManualItems();
  retUpdateTotal();
}

// ─── حفظ المرتجع ─────────────────────────────────────────────────────────────
function saveReturn() {
  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  const reason       = document.getElementById('ret-reason')?.value || 'أخرى';
  const refundMethod = document.getElementById('ret-refund-method')?.value || 'cash';

  let items = [];
  let totalRefund = 0;

  if (_retMode === 'invoice') {
    if (!_retSelectedSale) { toast('اختر فاتورة أولاً / Select an invoice first', 'error'); return; }
    if (!_retCheckedItems.length) { toast('اختر منتجاً واحداً على الأقل / Select at least one item', 'error'); return; }
    items = _retCheckedItems;
    totalRefund = items.reduce((a, it) => a + it.total, 0);
  } else {
    if (!_retManualItems.length) { toast('أضف منتجاً واحداً على الأقل / Add at least one item', 'error'); return; }
    items = _retManualItems;
    totalRefund = items.reduce((a, it) => a + it.total, 0);
  }

  const data = {
    saleId:   _retSelectedSale?.id   || null,
    invoiceNo: _retSelectedSale?.invoiceNo || '',
    customerId:   _retSelectedSale?.customerId   || null,
    customerName: _retSelectedSale?.customerName || 'زبون عام',
    originalPaymentMethod: _retSelectedSale?.paymentMethod || null,
    items,
    totalRefund: +totalRefund.toFixed(2),
    reason,
    refundMethod
  };

  DB.Returns.create(data);
  closeModal('modal-return');
  renderReturns();
  checkAlerts();
  updateUndoButton();
  toast(`✅ تم تسجيل المرتجع — ${fmt(totalRefund)} ${cur}`, 'success');
}

// ─── عرض صفحة المرتجعات ──────────────────────────────────────────────────────
function renderReturns() {
  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  const from = document.getElementById('ret-date-from')?.value;
  const to   = document.getElementById('ret-date-to')?.value;
  const q    = (document.getElementById('ret-search')?.value || '').toLowerCase();

  let list = DB.Returns.all().slice().reverse();
  if (from && to) list = list.filter(r => r.date >= from && r.date <= to + 'T23:59:59');
  if (q) list = list.filter(r =>
    r.returnNo.toLowerCase().includes(q) ||
    r.customerName.toLowerCase().includes(q) ||
    r.invoiceNo.toLowerCase().includes(q)
  );

  // KPI
  const kpiEl = document.getElementById('ret-kpi-row');
  const allRet = DB.Returns.all();
  const totalRef = allRet.reduce((a, r) => a + r.totalRefund, 0);
  const todayRet = allRet.filter(r => r.date && r.date.startsWith(DB.today()));
  const todayRef = todayRet.reduce((a, r) => a + r.totalRefund, 0);
  if (kpiEl) kpiEl.innerHTML = `
    <div class="ret-kpi-card">
      <div class="ret-kpi-icon red"><i class="fas fa-rotate-left"></i></div>
      <div><div class="ret-kpi-val">${allRet.length}</div><div class="ret-kpi-lbl">إجمالي المرتجعات</div></div>
    </div>
    <div class="ret-kpi-card">
      <div class="ret-kpi-icon gold"><i class="fas fa-coins"></i></div>
      <div><div class="ret-kpi-val">${fmt(totalRef)}</div><div class="ret-kpi-lbl">إجمالي الاسترداد (${cur})</div></div>
    </div>
    <div class="ret-kpi-card">
      <div class="ret-kpi-icon blue"><i class="fas fa-calendar-day"></i></div>
      <div><div class="ret-kpi-val">${todayRet.length}</div><div class="ret-kpi-lbl">مرتجعات اليوم • ${fmt(todayRef)} ${cur}</div></div>
    </div>`;

  // جدول
  const tbody = document.getElementById('returns-body');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map(r => `
    <tr>
      <td><code>${r.returnNo}</code></td>
      <td>${r.invoiceNo ? `<code>${r.invoiceNo}</code>` : '<span style="color:var(--text3)">—</span>'}</td>
      <td>${escHtml(r.customerName)}</td>
      <td style="font-size:12px;color:var(--text2)">${escHtml(r.items.map(it => it.nameAr + ' ×' + it.qty).join(' ، '))}</td>
      <td><strong style="color:var(--red)">- ${fmt(r.totalRefund)} ${cur}</strong></td>
      <td style="font-size:12px">${escHtml(r.reason)}</td>
      <td>${fmtDate(r.date)}</td>
      <td><button class="btn-icon edit" onclick="viewReturn('${r.id}')"><i class="fas fa-eye"></i></button></td>
      <td><button class="btn-icon danger" onclick="deleteReturn('${r.id}')"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('')
  : `<tr><td colspan="9" class="empty-td"><i class="fas fa-rotate-left"></i> لا توجد مرتجعات / No returns yet</td></tr>`;

  // شريط الملخص
  const totalF  = list.reduce((a, r) => a + r.totalRefund, 0);
  const bar = document.getElementById('ret-summary-bar');
  if (bar && list.length) {
    bar.innerHTML = `
      <span><i class="fas fa-rotate-left"></i> ${list.length} مرتجع</span>
      <span><i class="fas fa-coins"></i> إجمالي الاسترداد: <strong style="color:var(--red)">- ${fmt(totalF)} ${cur}</strong></span>`;
  } else if (bar) bar.innerHTML = '';
}

// ─── مسح باركود (مرتجع أو فاتورة أصلية) من قائمة المرتجعات: فتح فوري ────────
function retListKeydown(e) {
  if (e.key !== 'Enter') return;
  const q = (document.getElementById('ret-search')?.value || '').trim().toUpperCase();
  if (!q) return;
  const all = DB.Returns.all();
  const exact = all.find(r => r.returnNo.toUpperCase() === q || (r.invoiceNo || '').toUpperCase() === q);
  if (exact) {
    viewReturn(exact.id);
  } else {
    const matches = all.filter(r => r.returnNo.toUpperCase().includes(q) || (r.invoiceNo || '').toUpperCase().includes(q));
    if (matches.length === 1) viewReturn(matches[0].id);
  }
}

// ─── عرض تفاصيل مرتجع ────────────────────────────────────────────────────────
function viewReturn(id) {
  const r = DB.Returns.byId(id);
  if (!r) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  const refundLabel = r.refundMethod === 'cash' ? 'نقدي / Cash' : 'رصيد للزبون / Credit Note';
  const refundClass = `refund-${r.refundMethod}`;

  const rows = r.items.map((it, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escHtml(it.nameAr)}</td>
      <td>${it.qty}</td>
      <td>${fmt(it.price)} ${cur}</td>
      <td><strong>${fmt(it.total)} ${cur}</strong></td>
    </tr>`).join('');

  document.getElementById('ret-detail-body').innerHTML = `
    <div class="ret-detail-header">
      <div>
        <div class="ret-no">${r.returnNo}</div>
        <div style="color:var(--text3);font-size:12px;margin-top:4px">${fmtDate(r.date)}</div>
      </div>
      <span class="refund-badge"><i class="fas fa-rotate-left"></i> مرتجع</span>
    </div>
    <div class="ret-barcode-row">
      <div class="ret-barcode-box">
        <span class="ret-barcode-lbl">باركود المرتجع / Return Barcode</span>
        ${typeof DakaniBarcode !== 'undefined' ? DakaniBarcode.toSVG(r.returnNo, { unit: 2, height: 42, showText: false }) : ''}
      </div>
      ${r.invoiceNo ? `<div class="ret-barcode-box" style="cursor:pointer" onclick="closeModal('modal-return-detail');retOpenOriginalInvoice('${r.invoiceNo}')" title="اضغط لفتح الفاتورة الأصلية / Click to open original invoice">
        <span class="ret-barcode-lbl">باركود الفاتورة الأصلية / Original Invoice</span>
        ${typeof DakaniBarcode !== 'undefined' ? DakaniBarcode.toSVG(r.invoiceNo, { unit: 2, height: 42, showText: false }) : ''}
      </div>` : ''}
    </div>
    <div class="ret-info-grid">
      <div class="ret-info-cell"><div class="lbl">الزبون</div><div class="val">${escHtml(r.customerName)}</div></div>
      <div class="ret-info-cell"><div class="lbl">الفاتورة الأصلية</div><div class="val">${r.invoiceNo || '—'}</div></div>
      <div class="ret-info-cell"><div class="lbl">سبب الإرجاع</div><div class="val">${escHtml(r.reason)}</div></div>
      <div class="ret-info-cell"><div class="lbl">طريقة الاسترداد</div>
        <div class="val"><span class="badge ${refundClass}">${refundLabel}</span></div></div>
    </div>
    <div class="table-wrap" style="margin-bottom:14px">
      <table class="data-table">
        <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="ret-total-box">
      <span>إجمالي الاسترداد / Total Refund</span>
      <strong>- ${fmt(r.totalRefund)} ${cur}</strong>
    </div>`;

  openModal('modal-return-detail');
}

// ─── فتح الفاتورة الأصلية من شاشة تفاصيل المرتجع ─────────────────────────────
function retOpenOriginalInvoice(invoiceNo) {
  const s = DB.Sales.all().find(x => x.invoiceNo === invoiceNo);
  if (!s) { toast('❌ الفاتورة الأصلية غير موجودة (ربما تم حذفها) / Original invoice not found', 'error'); return; }
  viewInvoice(s.id);
}

// ─── حذف مرتجع ───────────────────────────────────────────────────────────────
function deleteReturn(id) {
  if (!confirm('⚠️ حذف هذا المرتجع؟ سيتم عكس المخزون / Delete return? Stock will be reversed.')) return;
  DB.Returns.delete(id);
  DB.UndoManager.invalidate('return', id);
  renderReturns();
  checkAlerts();
  updateUndoButton();
  toast('تم حذف المرتجع / Return deleted', 'info');
}

// ─── طباعة المرتجع ───────────────────────────────────────────────────────────
function printReturn() {
  const content = document.getElementById('ret-detail-body')?.innerHTML;
  if (!content) return;
  const S = DB.Settings.get();
  const w = window.open('', '_blank');
  w.document.write(`<!DOCTYPE html><html dir="rtl"><head>
    <meta charset="UTF-8"><title>مرتجع</title>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&display=swap">
    <style>
      body { font-family:'Cairo',sans-serif; padding:20mm; direction:rtl; color:#111; }
      .ret-detail-header { display:flex; justify-content:space-between; margin-bottom:16px; }
      .ret-no { font-size:22px; font-weight:900; }
      .refund-badge { background:#fee2e2; color:#dc2626; padding:4px 12px; border-radius:20px; font-size:12px; font-weight:700; }
      .ret-barcode-row { display:flex; flex-wrap:wrap; gap:14px; justify-content:center; align-items:flex-start; margin-bottom:16px; background:#f9fafb; border-radius:10px; padding:12px; }
      .ret-barcode-box { display:flex; flex-direction:column; align-items:center; gap:4px; }
      .ret-barcode-box svg { max-width:180px; }
      .ret-barcode-lbl { font-size:10px; color:#6b7280; text-transform:uppercase; }
      .ret-info-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:16px; }
      .ret-info-cell { border:1px solid #e5e7eb; border-radius:6px; padding:8px 12px; }
      .lbl { font-size:10px; color:#6b7280; text-transform:uppercase; }
      .val { font-size:13px; font-weight:600; }
      table { width:100%; border-collapse:collapse; margin-bottom:14px; }
      th,td { border:1px solid #e5e7eb; padding:6px 10px; font-size:12px; text-align:right; }
      th { background:#f9fafb; }
      .ret-total-box { display:flex; justify-content:space-between; padding:10px 14px;
        border:2px solid #fca5a5; border-radius:8px; }
      .ret-total-box strong { color:#dc2626; font-size:18px; }
      .badge { padding:3px 10px; border-radius:20px; font-size:11px; font-weight:700; }
      .refund-cash { background:#d1fae5; color:#065f46; }
      .refund-credit_note { background:#fef3c7; color:#92400e; }
    </style>
  </head><body>
    <h2 style="text-align:center;margin-bottom:16px">${S.storeName || 'دكاني'} — مرتجع / Return</h2>
    ${content}
  </body></html>`);
  w.document.close();
  setTimeout(() => { w.print(); w.close(); }, 400);
}

// ─── زر إضافة في وضع اليدوي (يُضاف في HTML لكن نربطه هنا) ──────────────────
// ملاحظة: الزر موجود في المودال بـ onclick="retAddManualItem()"

// ─── منتقي اللغة في صفحة الإعدادات ───────────────────────────────────────────
function renderLangPicker() {
  const wrap = document.getElementById("lang-picker");
  if (!wrap || !window.DakaniI18n) return;
  const current = DakaniI18n.getLang();
  wrap.querySelectorAll(".lang-opt").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lang === current);
  });
}