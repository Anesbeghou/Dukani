/**
 * DAKANI – Main Application Script
 */

// ─── State ───────────────────────────────────────────────────────────────────
let cart = [];
let selectedPayment = 'cash';
let chartWeekly = null, chartProfit = null, chartReport = null;

// ─── License Gate ─────────────────────────────────────────────────────────────
// فحص دوري كل 60 ثانية — يكشف انتهاء الصلاحية أثناء الاستخدام
setInterval(() => {
  if (!DakaniLicense.info()) DakaniLicense.gate();
}, 60000);

// ─── دالة تشغيل التطبيق ──────────────────────────────────────────────────────
function _bootApp() {
  updateTopbarDate();
  setInterval(updateTopbarDate, 60000);
  navigateTo('dashboard');
  setupPaymentButtons();
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.page); })
  );
  checkAlerts();
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
    settings: loadSettings, inventory: renderInventory
  };
  if (handlers[page]) handlers[page]();
  if (window.innerWidth < 900) document.getElementById('sidebar').classList.remove('open');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function loadDashboard() {
  const todaySales   = DB.Sales.today();
  const todayTotal   = todaySales.reduce((a, s) => a + s.total, 0);
  const todayProfit  = todaySales.reduce((a, s) => a + s.profit, 0);
  const products     = DB.Products.all();
  const customers    = DB.Customers.all();
  const low          = DB.Products.lowStock();
  const S            = DB.Settings.get();
  const cur          = S.currency || 'دج';

  setText('kpi-sales',     fmt(todayTotal) + ' ' + cur);
  setText('kpi-profit',    fmt(todayProfit) + ' ' + cur);
  setText('kpi-products',  products.length);
  setText('kpi-customers', customers.length);
  setText('kpi-low',       low.length);
  setText('kpi-invoices',  todaySales.length);

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
        <span class="top-name">${p.nameAr}</span>
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
        <span>${p.nameAr}</span>
        <span class="alert-stock">${p.stock} ${p.unit || ''}</span>
      </div>`).join('');
  }

  // Recent sales
  const recent = DB.Sales.all().slice(-10).reverse();
  const tbody = document.getElementById('recent-sales-body');
  if (tbody) {
    tbody.innerHTML = recent.length ? recent.map((s, i) =>
      `<tr>
        <td>${s.invoiceNo}</td>
        <td>${s.items.map(it => it.nameAr).join(', ').slice(0,40)}</td>
        <td>${s.customerName}</td>
        <td>${s.items.reduce((a, it) => a + it.qty, 0)}</td>
        <td>${fmt(s.total)} ${cur}</td>
        <td class="profit-cell">+${fmt(s.profit)} ${cur}</td>
        <td>${fmtDate(s.date)}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" class="empty-td">لا توجد مبيعات / No sales yet</td></tr>';
  }
}

function buildWeeklyChart(weekly, cur) {
  const ctx = document.getElementById('chart-weekly');
  if (!ctx) return;
  if (chartWeekly) chartWeekly.destroy();
  chartWeekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weekly.map(d => d.label),
      datasets: [
        { label: 'مبيعات', data: weekly.map(d => d.total), backgroundColor: '#10b98133', borderColor: '#10b981', borderWidth: 2, borderRadius: 6 },
        { label: 'أرباح',  data: weekly.map(d => d.profit), backgroundColor: '#f59e0b33', borderColor: '#f59e0b', borderWidth: 2, borderRadius: 6 }
      ]
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
  if (stk === 'low') prods = prods.filter(p => p.stock > 0 && p.stock <= low);
  else if (stk === 'ok') prods = prods.filter(p => p.stock > low);
  else if (stk === 'out') prods = prods.filter(p => p.stock === 0);

  const tbody = document.getElementById('products-body');
  if (!tbody) return;
  tbody.innerHTML = prods.length ? prods.map((p, i) => {
    const stockStatus = p.stock === 0 ? 'badge-out' : p.stock <= low ? 'badge-low' : 'badge-ok';
    const stockLabel  = p.stock === 0 ? 'نفذ' : p.stock <= low ? 'منخفض' : 'متوفر';
    return `<tr>
      <td>${i+1}</td>
      <td><strong>${p.nameAr}</strong>${p.nameEn ? `<br/><small>${p.nameEn}</small>` : ''}</td>
      <td><code>${p.barcode || '—'}</code></td>
      <td>${p.category || '—'}</td>
      <td>${fmt(p.buyPrice)} ${cur}</td>
      <td>${fmt(p.sellPrice)} ${cur}</td>
      <td><strong>${p.stock}</strong> ${p.unit || ''}</td>
      <td>${p.minStock || 5}</td>
      <td><span class="badge ${stockStatus}">${stockLabel}</span></td>
      <td>
        <button class="btn-icon edit" onclick="editProduct('${p.id}')"><i class="fas fa-pen"></i></button>
        <button class="btn-icon danger" onclick="deleteProduct('${p.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="10" class="empty-td">لا توجد منتجات / No products</td></tr>';
}

function openModal(id) {
  document.getElementById(id).classList.add('active');
  if (id === 'modal-product') populateProductModal();
  if (id === 'modal-purchase') populatePurchaseModal();
  if (id === 'modal-customer') { document.getElementById('cust-id').value = ''; }
}
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

function populateProductModal(prod) {
  const cats = DB.Categories.all();
  const sel  = document.getElementById('prod-cat');
  sel.innerHTML = cats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  if (prod) {
    document.getElementById('prod-modal-title').textContent = 'تعديل منتج / Edit Product';
    document.getElementById('prod-id').value       = prod.id;
    document.getElementById('prod-name-ar').value  = prod.nameAr;
    document.getElementById('prod-name-en').value  = prod.nameEn || '';
    document.getElementById('prod-barcode').value  = prod.barcode || '';
    document.getElementById('prod-cat').value      = prod.category || '';
    document.getElementById('prod-buy').value      = prod.buyPrice;
    document.getElementById('prod-sell').value     = prod.sellPrice;
    document.getElementById('prod-stock').value    = prod.stock;
    document.getElementById('prod-min').value      = prod.minStock || 5;
    document.getElementById('prod-unit').value     = prod.unit || 'قطعة';
    toggleWeightFields();
  } else {
    document.getElementById('prod-modal-title').textContent = 'إضافة منتج / Add Product';
    ['prod-id','prod-name-ar','prod-name-en','prod-barcode','prod-buy','prod-sell','prod-stock'].forEach(id => { document.getElementById(id).value = ''; });
    document.getElementById('prod-min').value = 5;
  }
}

function editProduct(id) {
  const p = DB.Products.byId(id);
  if (!p) return;
  populateProductModal(p);
  openModal('modal-product');
}

function saveProduct() {
  const data = {
    id:        document.getElementById('prod-id').value || null,
    nameAr:    document.getElementById('prod-name-ar').value.trim(),
    nameEn:    document.getElementById('prod-name-en').value.trim(),
    barcode:   document.getElementById('prod-barcode').value.trim(),
    category:  document.getElementById('prod-cat').value,
    buyPrice:  parseFloat(document.getElementById('prod-buy').value) || 0,
    sellPrice: parseFloat(document.getElementById('prod-sell').value) || 0,
    stock:     (() => {
      const u = document.getElementById('prod-cat')?.value;
      const v = document.getElementById('prod-stock').value;
      return u === 'بالميزان' ? (parseFloat(v) || 0) : (parseInt(v) || 0);
    })(),
    minStock:  parseInt(document.getElementById('prod-min').value) || 5,
    unit:      document.getElementById('prod-unit').value
  };
  if (!data.nameAr) { toast('أدخل اسم المنتج / Enter product name', 'error'); return; }
  if (data.sellPrice < data.buyPrice) { toast('سعر البيع أقل من سعر الشراء! / Sell < Buy!', 'warning'); }
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

// ─── Point of Sale ────────────────────────────────────────────────────────────
function loadPOS() {
  renderPOSProducts();
  renderPOSCategories();
  populatePOSCustomers();
  renderCart();
}

function renderPOSProducts(filter = '', cat = '') {
  let prods = filter ? DB.Products.search(filter) : DB.Products.all();
  if (cat) prods = prods.filter(p => p.category === cat);
  prods = prods.filter(p => p.stock > 0);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const grid = document.getElementById('pos-products-grid');
  if (!grid) return;
  grid.innerHTML = prods.length ? prods.map(p =>
    `<div class="pos-prod-card ${p.stock <= 0 ? 'out-stock' : ''}" onclick="addToCart('${p.id}')">
      <div class="pos-prod-name">${p.nameAr}</div>
      ${p.nameEn ? `<div class="pos-prod-en">${p.nameEn}</div>` : ''}
      <div class="pos-prod-price">${fmt(p.sellPrice)} ${cur}</div>
      <div class="pos-prod-stock ${p.stock <= (DB.Settings.get().lowStockThreshold||5) ? 'low' : ''}">
        ${p.category === 'بالميزان' ? '<i class="fas fa-scale-balanced"></i>' : '<i class="fas fa-box"></i>'} ${p.category === 'بالميزان' ? (p.stock + ' كغ') : (p.stock + ' ' + (p.unit || ''))}
      </div>
    </div>`).join('')
  : '<div class="empty-state">لا توجد منتجات / No products</div>';
}

function renderPOSCategories() {
  const bar = document.getElementById('pos-cat-bar');
  if (!bar) return;
  const cats = DB.Categories.all();
  bar.innerHTML = `<button class="cat-btn active" onclick="filterPOSCat('', this)">الكل / All</button>` +
    cats.map(c => `<button class="cat-btn" onclick="filterPOSCat('${c.name}', this)">${c.name}</button>`).join('');
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
      addToCart(byBarcode.id);
      posInput.value = '';
      renderPOSProducts('');
      posInput.focus();
      return;
    }

    // 2️⃣ Try search — if only one result, add it automatically
    const results = DB.Products.search(val);
    const available = results.filter(p => p.stock > 0);
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

function populatePOSCustomers() {
  const sel = document.getElementById('pos-customer');
  if (!sel) return;
  sel.innerHTML = '<option value="">زبون عام / Walk-in</option>' +
    DB.Customers.all().map(c => {
      const debtLabel = (c.debt||0) > 0 ? ` ⚠️ دين: ${fmt(c.debt)} دج` : '';
      return `<option value="${c.id}">${c.name}${c.phone ? ' – ' + c.phone : ''}${debtLabel}</option>`;
    }).join('');
}

function posCustomerChanged() {
  const custId = document.getElementById('pos-customer')?.value || '';
  const banner = document.getElementById('pos-debt-banner');
  if (!banner) return;
  if (!custId) { banner.style.display = 'none'; return; }
  const cust = DB.Customers.byId(custId);
  if (!cust || !(cust.debt > 0)) { banner.style.display = 'none'; return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  document.getElementById('pos-debt-label').textContent = `⚠️ ${cust.name} لديه دين غير مسدَّد`;
  document.getElementById('pos-debt-amount').textContent = `الدين الحالي: ${fmt(cust.debt)} ${cur} — البيع الآجل سيزيد هذا الدين`;
  banner.style.display = 'flex';
}

// ─── Weight modal state ───────────────────────────────────────────────────────
let _weightProductId = null;
let _weightMode = 'amount'; // 'amount' | 'grams' | 'kg'

function addToCart(productId) {
  const p = DB.Products.byId(productId);
  if (!p || p.stock <= 0) { toast('المنتج غير متوفر / Out of stock', 'error'); return; }

  // ⚖️ منتجات الميزان — فتح نافذة إدخال الوزن/المبلغ
  if (p.category === 'بالميزان') {
    openWeightModal(productId);
    return;
  }

  const existing = cart.find(i => i.productId === productId);
  if (existing) {
    if (existing.qty >= p.stock) { toast('لا يوجد مخزون كافٍ / Not enough stock', 'warning'); return; }
    existing.qty++;
    existing.total = existing.qty * existing.price;
    existing.profit = (existing.price - p.buyPrice) * existing.qty;
  } else {
    cart.push({ productId: p.id, nameAr: p.nameAr, nameEn: p.nameEn, price: p.sellPrice, buyPrice: p.buyPrice,
      qty: 1, total: p.sellPrice, profit: p.sellPrice - p.buyPrice, unit: p.unit });
  }
  renderCart(); updateTotals();
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
    weightGrams: Math.round(kg * 1000)
  });

  closeModal('modal-weight-input');
  renderCart(); updateTotals();
  toast(`تمت الإضافة: ${(kg * 1000).toFixed(0)} غ — ${fmt(total)} دج ✓`, 'success');
}

// ─── Toggle weight hint in product modal ─────────────────────────────────────
function toggleWeightFields() {
  const cat = document.getElementById('prod-cat')?.value;
  const hint = document.getElementById('weight-hint');
  if (hint) hint.style.display = cat === 'بالميزان' ? 'block' : 'none';
}

function renderCart() {
  const el = document.getElementById('pos-cart');
  if (!el) return;
  if (!cart.length) { el.innerHTML = '<div class="cart-empty"><i class="fas fa-cart-shopping"></i><br/>السلة فارغة / Cart is empty</div>'; updateTotals(); return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  el.innerHTML = cart.map((it, i) => {
    if (it.isWeighed) {
      // عرض منتجات الميزان بشكل مختلف
      return `<div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">⚖️ ${it.nameAr}</div>
          <div class="cart-item-price">${fmt(it.price)} ${cur}/كغ</div>
          <div class="cart-weight-label">${it.weightGrams} غ = ${(it.qty).toFixed(3)} كغ</div>
        </div>
        <div class="cart-item-controls">
          <button onclick="removeFromCart(${i})" title="حذف" class="remove-btn"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="cart-item-total">${fmt(it.total)} ${cur}</div>
      </div>`;
    }
    return `<div class="cart-item">
      <div class="cart-item-info">
        <div class="cart-item-name">${it.nameAr}</div>
        <div class="cart-item-price">${fmt(it.price)} ${cur}</div>
      </div>
      <div class="cart-item-controls">
        <button onclick="changeQty(${i}, -1)"><i class="fas fa-minus"></i></button>
        <span>${it.qty}</span>
        <button onclick="changeQty(${i}, 1)"><i class="fas fa-plus"></i></button>
        <button class="remove-btn" onclick="removeFromCart(${i})"><i class="fas fa-xmark"></i></button>
      </div>
      <div class="cart-item-total">${fmt(it.total)} ${cur}</div>
    </div>`;
  }).join('');
  updateTotals();
}

function changeQty(index, delta) {
  const it = cart[index];
  if (!it) return;
  const p = DB.Products.byId(it.productId);
  const newQty = it.qty + delta;
  if (newQty < 1) { removeFromCart(index); return; }
  if (newQty > (p?.stock || 0)) { toast('لا يوجد مخزون كافٍ / Not enough stock', 'warning'); return; }
  it.qty = newQty; it.total = it.qty * it.price; it.profit = (it.price - it.buyPrice) * it.qty;
  renderCart();
}

function removeFromCart(index) { cart.splice(index, 1); renderCart(); }
function clearCart() { cart = []; renderCart(); }

function updateTotals() {
  const subtotal = cart.reduce((a, it) => a + it.total, 0);
  const disc     = parseFloat(document.getElementById('pos-discount')?.value || 0);
  const total    = subtotal * (1 - disc / 100);
  const profit   = cart.reduce((a, it) => a + it.profit, 0) * (1 - disc / 100);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  setText('pos-subtotal', fmt(subtotal) + ' ' + cur);
  setText('pos-total',    fmt(total)    + ' ' + cur);
  setText('pos-profit',   '+' + fmt(profit) + ' ' + cur);
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

  // ⚠️ تحذير: بيع آجل لزبون عليه دين
  if (selectedPayment === 'credit') {
    if (!custId) {
      toast('⚠️ البيع الآجل يتطلب تحديد زبون / Credit sale requires a customer', 'error');
      return;
    }
    if (cust && (cust.debt || 0) > 0) {
      const S = DB.Settings.get(); const cur = S.currency || 'دج';
      const newDebt = (cust.debt || 0) + total;
      if (!confirm(
        `⚠️ تحذير — ${cust.name} لديه دين غير مسدَّد!\n\n` +
        `الدين الحالي: ${fmt(cust.debt)} ${cur}\n` +
        `قيمة هذه الفاتورة: ${fmt(total)} ${cur}\n` +
        `الدين الجديد بعد البيع: ${fmt(newDebt)} ${cur}\n\n` +
        `هل تريد المتابعة وإضافة دين جديد؟`
      )) return;
    }
  }

  const sale = DB.Sales.create({
    customerId: custId || null, customerName: cust ? cust.name : 'زبون عام',
    items: [...cart], subtotal, discount: disc, total, profit,
    paymentMethod: selectedPayment
  });

  clearCart();
  document.getElementById('pos-discount').value = 0;
  document.getElementById('pos-debt-banner').style.display = 'none';
  renderPOSProducts();
  checkAlerts();
  showQuickReceipt(sale);
}

function showQuickReceipt(sale) {
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const el = document.getElementById('receipt-content');
  if (!el) { toast(`✓ تم البيع! ${sale.invoiceNo}`, 'success'); return; }
  el.innerHTML = `
    <div class="receipt-body">
      <div class="receipt-success-icon"><i class="fas fa-circle-check"></i></div>
      <div class="receipt-inv-no">${sale.invoiceNo}</div>
      <div class="receipt-customer"><i class="fas fa-user"></i> ${sale.customerName}</div>
      <div class="receipt-items">
        ${sale.items.map(it => `<div class="receipt-item">
          <span>${it.nameAr} × ${it.qty}</span>
          <span>${fmt(it.total)} ${cur}</span>
        </div>`).join('')}
      </div>
      ${sale.discount ? `<div class="receipt-disc">خصم ${sale.discount}% — −${fmt(sale.subtotal * sale.discount / 100)} ${cur}</div>` : ''}
      <div class="receipt-total">
        <span>الإجمالي</span>
        <span>${fmt(sale.total)} ${cur}</span>
      </div>
      <div class="receipt-profit">ربح هذه الفاتورة: +${fmt(sale.profit)} ${cur}</div>
      <div class="receipt-method"><span class="badge pay-${sale.paymentMethod}">${payLabel(sale.paymentMethod)}</span></div>
      ${(() => {
        if (sale.paymentMethod === 'credit' && sale.customerId) {
          const c = DB.Customers.byId(sale.customerId);
          if (c && (c.debt||0) > 0) {
            const S = DB.Settings.get(); const cur = S.currency || 'دج';
            return `<div style="margin-top:10px;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:10px;font-size:13px;color:#f87171;text-align:center">
              <i class="fas fa-triangle-exclamation"></i> إجمالي دين ${c.name}: <strong>${fmt(c.debt)} ${cur}</strong>
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
      <td>${prod ? prod.nameAr : '—'}</td>
      <td>${supp ? `<span class="badge-supp" onclick="viewSupplierDetail('${supp.id}')">${supp.name}</span>` : (p.supplier || '—')}</td>
      <td>${p.qty} ${prod?.unit || ''}</td>
      <td>${fmt(p.unitPrice)} ${cur}</td>
      <td><strong>${fmt(total)} ${cur}</strong></td>
      <td>${fmtDate(p.date)}</td>
      <td class="text-muted">${p.notes || '—'}</td>
      <td><button class="btn-icon danger" onclick="deletePurchase('${p.id}')"><i class="fas fa-trash"></i></button></td>
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

function populatePurchaseModal() {
  const sel = document.getElementById('purch-product');
  if (!sel) return;
  sel.innerHTML = DB.Products.all().map(p => `<option value="${p.id}">${p.nameAr}</option>`).join('');
  // populate supplier select
  const suppSel = document.getElementById('purch-supplier');
  if (suppSel) {
    suppSel.innerHTML = '<option value="">— بدون مورد —</option>' +
      DB.Suppliers.all().map(s => `<option value="${s.id}">${s.name}</option>`).join('');
  }
  document.getElementById('purch-date').value = DB.today();
}

function savePurchase() {
  const productId  = document.getElementById('purch-product').value;
  const qty        = parseInt(document.getElementById('purch-qty').value) || 0;
  const unitPrice  = parseFloat(document.getElementById('purch-price').value) || 0;
  const supplierId = document.getElementById('purch-supplier').value;
  if (!productId || qty < 1) { toast('أدخل المنتج والكمية', 'error'); return; }
  DB.Purchases.save({
    productId, qty, unitPrice, supplierId,
    supplier:  supplierId ? (DB.Suppliers.byId(supplierId)?.name || '') : '',
    date:      document.getElementById('purch-date').value,
    notes:     document.getElementById('purch-notes')?.value.trim() || ''
  });
  closeModal('modal-purchase');
  renderPurchases();
  renderProducts();
  toast('تم تسجيل المشترى وتحديث المخزون ✓', 'success');
}

function deletePurchase(id) {
  if (!confirm('حذف هذا المشترى؟ سيتم تقليل المخزون')) return;
  DB.Purchases.delete(id);
  renderPurchases();
  renderProducts();
  renderSuppliers();
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

  tbody.innerHTML = list.length ? list.map((s, i) => `
    <tr>
      <td>${i+1}</td>
      <td>
        <div style="font-weight:700;color:var(--text1)">${s.name}</div>
        ${s.products ? `<div style="font-size:11px;color:var(--text3)">${s.products}</div>` : ''}
      </td>
      <td>${s.phone ? `<a href="tel:${s.phone}" style="color:var(--accent)">${s.phone}</a>` : '—'}</td>
      <td>${s.city || s.address || '—'}</td>
      <td><strong>${fmt(s.totalPurchased || 0)} ${cur}</strong></td>
      <td><span class="badge-count">${s.orderCount || 0}</span></td>
      <td>${s.lastOrder ? fmtDate(s.lastOrder) : '—'}</td>
      <td style="display:flex;gap:6px">
        <button class="btn-icon" onclick="viewSupplierDetail('${s.id}')" title="تفاصيل"><i class="fas fa-eye"></i></button>
        <button class="btn-icon edit" onclick="openSupplierModal('${s.id}')" title="تعديل"><i class="fas fa-edit"></i></button>
        <button class="btn-icon danger" onclick="deleteSupplier('${s.id}')" title="حذف"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('')
  : '<tr><td colspan="8" class="empty-td">لا يوجد موردون — أضف أول مورد</td></tr>';

  // KPI cards
  const kpiGrid = document.getElementById('supp-kpi-grid');
  if (kpiGrid) {
    const totalSpent  = list.reduce((a, s) => a + (s.totalPurchased || 0), 0);
    const totalOrders = list.reduce((a, s) => a + (s.orderCount    || 0), 0);
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
      </div>`;
  }

  // Summary bar
  const bar = document.getElementById('supp-summary-bar');
  if (bar && list.length) {
    const totalSpent = list.reduce((a, s) => a + (s.totalPurchased || 0), 0);
    bar.innerHTML = `<span><i class="fas fa-truck"></i> ${list.length} مورد</span>
      <span><i class="fas fa-coins"></i> إجمالي: <strong>${fmt(totalSpent)} ${cur}</strong></span>`;
  } else if (bar) bar.innerHTML = '';

  // Populate supplier filter in purchases page
  const suppFilter = document.getElementById('purch-supplier-filter');
  if (suppFilter) {
    const all = DB.Suppliers.all();
    suppFilter.innerHTML = '<option value="">كل الموردين</option>' +
      all.map(s => `<option value="${s.id}">${s.name}</option>`).join('');
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
    notes:    document.getElementById('supp-notes').value.trim()
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
  // تحقق هل لديه مشتريات
  const hasPurchases = DB.Purchases.all().some(p => p.supplierId === id);
  if (hasPurchases) {
    if (!confirm(`⚠️ المورد "${s.name}" لديه مشتريات مسجّلة. حذفه لن يحذف المشتريات. هل تريد المتابعة؟`)) return;
  } else {
    if (!confirm(`حذف المورد "${s.name}"؟`)) return;
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

  document.getElementById('supp-detail-title').innerHTML = `<i class="fas fa-truck"></i> ${s.name}`;
  document.getElementById('supp-detail-edit-btn').onclick = () => {
    closeModal('modal-supplier-detail');
    openSupplierModal(id);
  };

  const body = document.getElementById('supp-detail-body');
  body.innerHTML = `
    <div class="supp-detail-grid">
      <div class="supp-detail-info">
        <h3 style="margin:0 0 14px;color:var(--text1)"><i class="fas fa-info-circle"></i> معلومات المورد</h3>
        <div class="detail-row"><span><i class="fas fa-user"></i> الاسم</span><strong>${s.name}</strong></div>
        ${s.phone    ? `<div class="detail-row"><span><i class="fas fa-phone"></i> الهاتف</span><a href="tel:${s.phone}" style="color:var(--accent)">${s.phone}</a></div>` : ''}
        ${s.city     ? `<div class="detail-row"><span><i class="fas fa-city"></i> المدينة</span><span>${s.city}</span></div>` : ''}
        ${s.address  ? `<div class="detail-row"><span><i class="fas fa-map-marker-alt"></i> العنوان</span><span>${s.address}</span></div>` : ''}
        ${s.email    ? `<div class="detail-row"><span><i class="fas fa-envelope"></i> البريد</span><a href="mailto:${s.email}" style="color:var(--accent)">${s.email}</a></div>` : ''}
        ${s.products ? `<div class="detail-row"><span><i class="fas fa-boxes-stacked"></i> المنتجات</span><span>${s.products}</span></div>` : ''}
        ${s.notes    ? `<div class="detail-row"><span><i class="fas fa-note-sticky"></i> ملاحظات</span><span>${s.notes}</span></div>` : ''}
        <div class="supp-stat-row">
          <div class="supp-stat"><div class="supp-stat-val">${fmt(s.totalPurchased||0)} ${cur}</div><div class="supp-stat-lbl">إجمالي المشتريات</div></div>
          <div class="supp-stat"><div class="supp-stat-val">${s.orderCount||0}</div><div class="supp-stat-lbl">عدد الطلبات</div></div>
          <div class="supp-stat"><div class="supp-stat-val">${s.lastOrder ? fmtDate(s.lastOrder) : '—'}</div><div class="supp-stat-lbl">آخر طلب</div></div>
        </div>
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
            <td>${prod ? prod.nameAr : '—'}</td>
            <td>${p.qty} ${prod?.unit||''}</td>
            <td>${fmt(p.unitPrice)} ${cur}</td>
            <td><strong>${fmt(p.qty*p.unitPrice)} ${cur}</strong></td>
            <td>${fmtDate(p.date)}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : '<p class="empty-td">لا توجد مشتريات من هذا المورد بعد</p>'}`;

  openModal('modal-supplier-detail');
}

// ─── Customers ────────────────────────────────────────────────────────────────
function renderCustomers() {
  const q          = (document.getElementById('cust-search')?.value || '').toLowerCase();
  const debtFilter = document.getElementById('cust-debt-filter')?.value || '';
  let list         = DB.Customers.all();
  if (q)          list = list.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q));
  if (debtFilter === 'debt')  list = list.filter(c => (c.debt||0) > 0);
  if (debtFilter === 'clear') list = list.filter(c => (c.debt||0) <= 0);
  list = list.slice().sort((a,b) => (b.debt||0) - (a.debt||0));
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('customers-body');
  if (!tbody) return;

  tbody.innerHTML = list.length ? list.map((c, i) => {
    const hasDebt = (c.debt||0) > 0;
    return `<tr class="${hasDebt ? 'row-debt' : ''}">
      <td>${i+1}</td>
      <td>
        <div style="font-weight:700;color:var(--text1)">${c.name}</div>
        ${c.address ? `<div style="font-size:11px;color:var(--text3)">${c.address}</div>` : ''}
      </td>
      <td>${c.phone ? `<a href="tel:${c.phone}" style="color:var(--accent)">${c.phone}</a>` : '—'}</td>
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
  : '<tr><td colspan="7" class="empty-td">لا يوجد زبائن — أضف أول زبون</td></tr>';

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
    <div class="debt-info-row"><span><i class="fas fa-user"></i> الزبون</span><strong>${c.name}</strong></div>
    <div class="debt-info-row"><span><i class="fas fa-sack-dollar"></i> الدين الكلي</span>
      <strong class="debt-total-val">${fmt(c.debt||0)} ${cur}</strong></div>
    ${c.phone ? `<div class="debt-info-row"><span><i class="fas fa-phone"></i> الهاتف</span><a href="tel:${c.phone}" style="color:var(--accent)">${c.phone}</a></div>` : ''}`;

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
  toast(`✓ تم تسجيل سداد ${fmt(payment.amount)} ${cur} من ${payment.customerName}`, 'success');
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
    `<i class="fas fa-file-invoice-dollar"></i> كشف حساب: ${c.name}`;

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
      ${c.phone ? `<div class="stmt-kpi"><div class="stmt-kpi-val" style="font-size:14px">${c.phone}</div><div class="stmt-kpi-lbl">الهاتف</div></div>` : ''}
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
            return `<tr>
              <td>${fmtDate(s.date)}</td>
              <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
              <td>${s.invoiceNo} — ${s.items.length} منتج</td>
              <td class="${s.paymentMethod==='credit' ? 'debt-cell-danger' : ''}"><strong>${fmt(s.total)} ${cur}</strong></td>
              <td>—</td>
            </tr>`;
          } else {
            const p = t.data;
            return `<tr class="pay-row">
              <td>${fmtDate(p.date)}</td>
              <td><span class="badge-pay-tag">✓ سداد</span></td>
              <td>${p.note || 'سداد دين'}</td>
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
  let list     = DB.Sales.all().slice().reverse();
  if (from && to) list = list.filter(s => s.date >= from && s.date <= to + 'T23:59:59');
  if (method) list = list.filter(s => s.paymentMethod === method);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('invoices-body');
  if (!tbody) return;

  tbody.innerHTML = list.length ? list.map(s =>
    `<tr>
      <td><code>${s.invoiceNo}</code></td>
      <td>${s.customerName}</td>
      <td><strong>${fmt(s.total)} ${cur}</strong></td>
      <td>${s.discount || 0}%</td>
      <td class="profit-cell">+${fmt(s.profit)} ${cur}</td>
      <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
      <td>${fmtDate(s.date)}</td>
      <td><button class="btn-icon edit" onclick="viewInvoice('${s.id}')"><i class="fas fa-eye"></i></button></td>
      <td><button class="btn-icon danger" onclick="deleteInvoice('${s.id}')"><i class="fas fa-trash"></i></button></td>
    </tr>`).join('')
  : `<tr><td colspan="9" class="empty-td">لا توجد فواتير / No invoices</td></tr>`;

  // Summary bar
  const totalRev    = list.reduce((a,s) => a + s.total, 0);
  const totalProfit = list.reduce((a,s) => a + s.profit, 0);
  const bar = document.getElementById('inv-summary-bar');
  if (bar && list.length) {
    bar.innerHTML = `
      <span><i class="fas fa-receipt"></i> ${list.length} فاتورة</span>
      <span><i class="fas fa-sack-dollar"></i> الإجمالي: <strong>${fmt(totalRev)} ${cur}</strong></span>
      <span class="profit-cell"><i class="fas fa-trending-up"></i> الأرباح: <strong>+${fmt(totalProfit)} ${cur}</strong></span>`;
  } else if (bar) { bar.innerHTML = ''; }
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
    <div class="inv-meta-chip"><i class="fas fa-user"></i> ${s.customerName}</div>
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
      <td class="inv-td-name">${it.nameAr}${it.nameEn ? `<span class="inv-en">${it.nameEn}</span>` : ''}</td>
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
        ${S.address ? `<p class="inv-store-sub">${S.address}</p>` : ''}
        ${S.phone   ? `<p class="inv-store-sub"><i class="fas fa-phone"></i> ${S.phone}</p>` : ''}
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
      <span class="inv-cust-name">${s.customerName}</span>
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
      ${s.discount ? `<div class="inv-tot-row discount">
        <span>خصم (${s.discount}%)</span>
        <span>− ${fmt(s.subtotal * s.discount / 100)} ${cur}</span>
      </div>` : ''}
      <div class="inv-tot-row grand-total">
        <span>الإجمالي النهائي</span>
        <span>${fmt(s.total)} ${cur}</span>
      </div>
    </div>

    <div class="inv-paper-footer">
      <div class="inv-barcode-line">${s.invoiceNo}</div>
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
  renderInvoices();
  checkAlerts();
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
    .inv-barcode-line { font-family:monospace; font-size:11px; color:#9ca3af; letter-spacing:3px; margin-bottom:8px; }
    .inv-footer-thanks { font-size:13px; color:#6b7280; margin:0; }
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

function shareInvoiceWhatsApp() {
  const s = _currentInvoiceId ? DB.Sales.byId(_currentInvoiceId) : null;
  if (!s) return;
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  let msg = `🧾 *فاتورة ${s.invoiceNo}*\n`;
  msg += `📅 ${new Date(s.date).toLocaleDateString('ar-DZ')}\n`;
  msg += `👤 ${s.customerName}\n\n`;
  s.items.forEach((it,i) => { msg += `${i+1}. ${it.nameAr} × ${it.qty} = ${fmt(it.total)} ${cur}\n`; });
  msg += `\n━━━━━━━━━━━━\n`;
  if (s.discount) msg += `خصم: ${s.discount}%\n`;
  msg += `*الإجمالي: ${fmt(s.total)} ${cur}*\n\n`;
  msg += `${S.storeName || 'دكاني'} — شكراً لتعاملكم 🙏`;
  window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
}

// ─── Reports ──────────────────────────────────────────────────────────────────
function initReports() {
  const today = DB.today();
  const firstDay = today.slice(0,8) + '01';
  document.getElementById('rep-from').value = firstDay;
  document.getElementById('rep-to').value   = today;
  generateReport();
}

function generateReport() {
  const from  = document.getElementById('rep-from')?.value;
  const to    = document.getElementById('rep-to')?.value;
  if (!from || !to) return;
  const sales = DB.Sales.between(from, to);
  const S = DB.Settings.get(); const cur = S.currency || 'دج';

  const totalRev    = sales.reduce((a, s) => a + s.total, 0);
  const totalProfit = sales.reduce((a, s) => a + s.profit, 0);
  const totalCost   = totalRev - totalProfit;
  const invoiceCount = sales.length;
  const avgBasket   = invoiceCount ? totalRev / invoiceCount : 0;

  const kpiEl = document.getElementById('report-kpis');
  if (kpiEl) kpiEl.innerHTML = [
    { icon:'sack-dollar', val: fmt(totalRev)+' '+cur,    label:'إجمالي المبيعات / Total Sales', cls:'kpi-sales' },
    { icon:'trending-up', val: fmt(totalProfit)+' '+cur, label:'إجمالي الأرباح / Total Profit',  cls:'kpi-profit' },
    { icon:'receipt',     val: invoiceCount,              label:'عدد الفواتير / Invoices',        cls:'kpi-invoices' },
    { icon:'chart-simple',val: fmt(avgBasket)+' '+cur,   label:'متوسط الفاتورة / Avg Basket',    cls:'kpi-customers' }
  ].map(k => `<div class="kpi-card ${k.cls}"><div class="kpi-icon"><i class="fas fa-${k.icon}"></i></div><div class="kpi-info"><div class="kpi-value">${k.val}</div><div class="kpi-label">${k.label}</div></div></div>`).join('');

  // Chart by day
  const dayMap = {};
  sales.forEach(s => {
    const d = s.date.slice(0,10);
    if (!dayMap[d]) dayMap[d] = { revenue: 0, profit: 0 };
    dayMap[d].revenue += s.total; dayMap[d].profit += s.profit;
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
      <span class="top-name">${p.nameAr}</span>
      <span class="top-qty">${p.qty}</span>
      <span class="top-rev">${fmt(p.revenue)} ${cur}</span>
    </div>`).join('') : '<div class="empty-state">لا توجد بيانات / No data</div>';

  // Details table
  const tbody = document.getElementById('report-sales-body');
  if (tbody) tbody.innerHTML = sales.slice().reverse().map(s=>
    `<tr>
      <td>${fmtDate(s.date)}</td>
      <td>${s.items.map(i=>i.nameAr).join(', ').slice(0,40)}</td>
      <td>${s.items.reduce((a,i)=>a+i.qty,0)}</td>
      <td>${fmt(s.total)} ${cur}</td>
      <td class="profit-cell">+${fmt(s.profit)} ${cur}</td>
      <td>${s.customerName}</td>
      <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
    </tr>`).join('');
}

function printReport() { window.print(); }

// ─── Settings ─────────────────────────────────────────────────────────────────
function loadSettings() {
  const S = DB.Settings.get();
  document.getElementById('set-store-name').value   = S.storeName || '';
  document.getElementById('set-address').value      = S.address || '';
  document.getElementById('set-phone').value        = S.phone || '';
  document.getElementById('set-currency').value     = S.currency || 'دج';
  document.getElementById('set-low-stock').value    = S.lowStockThreshold || 5;
  const thanksEl = document.getElementById('set-thanks');
  if (thanksEl) thanksEl.value = S.thankYouMessage || '';
  renderLogoPreview();

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
  DB.Settings.save({
    ...current,
    storeName:         document.getElementById('set-store-name').value.trim(),
    address:           document.getElementById('set-address').value.trim(),
    phone:             document.getElementById('set-phone').value.trim(),
    currency:          document.getElementById('set-currency').value,
    lowStockThreshold: parseInt(document.getElementById('set-low-stock').value) || 5,
    thankYouMessage:   (document.getElementById('set-thanks')?.value || '').trim()
  });
  toast('تم حفظ الإعدادات / Settings saved ✓', 'success');
  checkAlerts();
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
      <span>${c.name}</span>
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
function checkAlerts() {
  const low = DB.Products.lowStock();
  const badge = document.getElementById('notif-badge');
  const list  = document.getElementById('notif-list');
  if (badge) badge.textContent = low.length;
  if (list) {
    list.innerHTML = low.length
      ? low.map(p => `<div class="notif-item ${p.stock===0?'notif-out':'notif-low'}">
          <i class="fas fa-${p.stock===0?'ban':'triangle-exclamation'}"></i>
          <div><strong>${p.nameAr}</strong><br/>${p.stock===0?'نفذ / Out of stock':'مخزون منخفض: '+p.stock+' '+p.unit}</div>
        </div>`).join('')
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

// ─── Global Search ────────────────────────────────────────────────────────────
function globalSearch(q) {
  if (!q) return;
  const prods = DB.Products.search(q);
  if (prods.length) { navigateTo('products'); document.getElementById('prod-search').value = q; renderProducts(); }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function fmt(n)   { return (parseFloat(n)||0).toLocaleString('ar-DZ', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
function fmtDate(d) {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('ar-DZ', { year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' }); }
  catch { return d; }
}
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function payLabel(m) { return { cash:'نقدي / Cash', card:'بطاقة / Card', credit:'آجل / Credit' }[m] || m; }

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<i class="fas fa-${type==='success'?'check-circle':type==='error'?'circle-xmark':type==='warning'?'triangle-exclamation':'circle-info'}"></i> ${msg}`;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('fade-out'); setTimeout(() => el.remove(), 400); }, 3500);
}


// ════════════════════════════════════════════════════════════════════════════
// تقرير الموردين / Suppliers Report
// ════════════════════════════════════════════════════════════════════════════

function showSuppliersReport() {
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
          <div class="kpi-value">${topSupp ? topSupp.name.slice(0, 14) : '—'}</div>
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
            return `<tr data-supp-name="${s.name.toLowerCase()}">
              <td><span style="font-size:16px;font-weight:900;color:${rankColor}">${i+1}</span></td>
              <td>
                <div style="font-weight:700;color:var(--text1)">${s.name}</div>
                ${s.id !== '__none__' ? `<button class="btn-icon" style="margin-top:4px;padding:2px 8px;font-size:11px" onclick="closeModal('modal-supp-report');viewSupplierDetail('${s.id}')"><i class="fas fa-eye"></i> تفاصيل</button>` : ''}
              </td>
              <td>${s.phone !== '—' ? `<a href="tel:${s.phone}" style="color:var(--accent)">${s.phone}</a>` : '—'}</td>
              <td>${s.city}</td>
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
  const outOfStock   = products.filter(p => (p.stock || 0) === 0).length;
  const lowStock     = products.filter(p => (p.stock || 0) > 0 && (p.stock || 0) <= (DB.Settings.get().lowStockThreshold || 5)).length;
  const adjToday     = adjs.filter(a => a.date && a.date.startsWith(DB.today())).length;

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
            return `<tr>
              <td style="font-size:12px;white-space:nowrap">${dateStr}</td>
              <td><strong>${a.productName || ''}</strong>${a.unit ? ' <small>('+a.unit+')</small>' : ''}</td>
              <td style="text-align:center">${a.oldQty}</td>
              <td style="text-align:center;font-weight:700">${a.newQty}</td>
              <td style="text-align:center">${delta}</td>
              <td><span class="adj-reason-badge">${a.reason || ''}</span></td>
              <td style="color:#6b7280;font-size:13px">${a.note || '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

// ── Modal ──
let _adjSelectedProd = null;

function openAdjModal() {
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
  setTimeout(() => document.getElementById('adj-prod-search')?.focus(), 100);
}

function adjSearchProducts() {
  const q   = document.getElementById('adj-prod-search').value.trim();
  const res = document.getElementById('adj-prod-results');
  if (!q) { res.innerHTML = ''; return; }
  const hits = DB.Products.search(q).slice(0, 8);
  if (!hits.length) { res.innerHTML = '<div class="adj-no-result">لا نتائج / No results</div>'; return; }
  res.innerHTML = hits.map(p => `
    <div class="adj-result-item" onclick="adjSelectProduct('${p.id}')">
      <strong>${p.nameAr}</strong>
      ${p.nameEn ? `<span style="color:#6b7280"> · ${p.nameEn}</span>` : ''}
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
  info.innerHTML = `
    <div class="adj-info-row"><span>الرصيد الحالي:</span> <strong>${p.stock || 0} ${p.unit || ''}</strong></div>
    <div class="adj-info-row"><span>سعر البيع:</span> <strong>${(p.price || 0).toFixed(2)} ${cur}</strong></div>
    <div class="adj-info-row"><span>سعر التكلفة:</span> <strong>${(p.cost || 0).toFixed(2)} ${cur}</strong></div>`;

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
  preview.style.display = 'block';
  preview.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <span>${_adjSelectedProd.stock || 0} ${_adjSelectedProd.unit || ''}</span>
      <i class="fas fa-arrow-left" style="color:#6b7280"></i>
      <span style="font-size:18px;font-weight:700">${newQty} ${_adjSelectedProd.unit || ''}</span>
      <span style="color:${color};font-weight:700;font-size:15px">(${sign}${delta})</span>
    </div>`;
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
      <span class="inv-customer">${s.customerName}</span>
      <span class="inv-total">${fmt(s.total)} ${cur}</span>
    </div>`).join('');
  res.classList.add('open');
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
    <span><span class="chip-label">الزبون</span><br/>${s.customerName}</span>
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
        <td>${it.nameAr}</td>
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
      <span>${p.nameAr}</span>
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
          <span>${it.nameAr} × ${it.qty}</span>
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
      <td>${r.customerName}</td>
      <td style="font-size:12px;color:var(--text2)">${r.items.map(it => it.nameAr + ' ×' + it.qty).join(' ، ')}</td>
      <td><strong style="color:var(--red)">- ${fmt(r.totalRefund)} ${cur}</strong></td>
      <td style="font-size:12px">${r.reason}</td>
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
      <td>${it.nameAr}</td>
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
    <div class="ret-info-grid">
      <div class="ret-info-cell"><div class="lbl">الزبون</div><div class="val">${r.customerName}</div></div>
      <div class="ret-info-cell"><div class="lbl">الفاتورة الأصلية</div><div class="val">${r.invoiceNo || '—'}</div></div>
      <div class="ret-info-cell"><div class="lbl">سبب الإرجاع</div><div class="val">${r.reason}</div></div>
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

// ─── حذف مرتجع ───────────────────────────────────────────────────────────────
function deleteReturn(id) {
  if (!confirm('⚠️ حذف هذا المرتجع؟ سيتم عكس المخزون / Delete return? Stock will be reversed.')) return;
  DB.Returns.delete(id);
  renderReturns();
  checkAlerts();
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
