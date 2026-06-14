/**
 * DAKANI – Main Application Script
 */

// ─── State ───────────────────────────────────────────────────────────────────
let cart = [];
let selectedPayment = 'cash';
let chartWeekly = null, chartProfit = null, chartReport = null;

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  updateTopbarDate();
  setInterval(updateTopbarDate, 60000);
  navigateTo('dashboard');
  setupPaymentButtons();
  document.querySelectorAll('.nav-item').forEach(el =>
    el.addEventListener('click', e => { e.preventDefault(); navigateTo(el.dataset.page); })
  );
  checkAlerts();
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
  customers: 'الزبائن / Customers',
  invoices:  'الفواتير / Invoices',
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
    purchases: renderPurchases, customers: renderCustomers,
    invoices: renderInvoices, reports: initReports, settings: loadSettings
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
    stock:     parseInt(document.getElementById('prod-stock').value) || 0,
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
        <i class="fas fa-box"></i> ${p.stock} ${p.unit || ''}
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

function posSearch(val) { renderPOSProducts(val); }

function populatePOSCustomers() {
  const sel = document.getElementById('pos-customer');
  if (!sel) return;
  sel.innerHTML = '<option value="">زبون عام / Walk-in</option>' +
    DB.Customers.all().map(c => `<option value="${c.id}">${c.name} – ${c.phone||''}</option>`).join('');
}

function addToCart(productId) {
  const p = DB.Products.byId(productId);
  if (!p || p.stock <= 0) { toast('المنتج غير متوفر / Out of stock', 'error'); return; }
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

function renderCart() {
  const el = document.getElementById('pos-cart');
  if (!el) return;
  if (!cart.length) { el.innerHTML = '<div class="cart-empty"><i class="fas fa-cart-shopping"></i><br/>السلة فارغة / Cart is empty</div>'; updateTotals(); return; }
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  el.innerHTML = cart.map((it, i) =>
    `<div class="cart-item">
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
    </div>`).join('');
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

  const sale = DB.Sales.create({
    customerId: custId || null, customerName: cust ? cust.name : 'زبون عام',
    items: [...cart], subtotal, discount: disc, total, profit,
    paymentMethod: selectedPayment
  });

  toast(`✓ تم البيع! الفاتورة ${sale.invoiceNo} – ربح: ${fmt(profit)} ${DB.Settings.get().currency||'دج'}`, 'success');
  clearCart();
  document.getElementById('pos-discount').value = 0;
  renderPOSProducts();
  checkAlerts();
}

// ─── Purchases ────────────────────────────────────────────────────────────────
function renderPurchases() {
  const from = document.getElementById('purch-date-from')?.value;
  const to   = document.getElementById('purch-date-to')?.value;
  let list   = DB.Purchases.all();
  if (from && to) list = list.filter(p => p.date >= from && p.date <= to);
  list = list.slice().reverse();
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('purchases-body');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map((p, i) => {
    const prod = DB.Products.byId(p.productId);
    return `<tr>
      <td>${i+1}</td>
      <td>${prod ? prod.nameAr : '—'}</td>
      <td>${p.supplier || '—'}</td>
      <td>${p.qty} ${prod?.unit || ''}</td>
      <td>${fmt(p.unitPrice)} ${cur}</td>
      <td>${fmt(p.qty * p.unitPrice)} ${cur}</td>
      <td>${fmtDate(p.date)}</td>
      <td><button class="btn-icon danger" onclick="deletePurchase('${p.id}')"><i class="fas fa-trash"></i></button></td>
    </tr>`;
  }).join('') : '<tr><td colspan="8" class="empty-td">لا توجد مشتريات / No purchases</td></tr>';
}

function populatePurchaseModal() {
  const sel = document.getElementById('purch-product');
  if (!sel) return;
  sel.innerHTML = DB.Products.all().map(p => `<option value="${p.id}">${p.nameAr}</option>`).join('');
  document.getElementById('purch-date').value = DB.today();
}

function savePurchase() {
  const productId = document.getElementById('purch-product').value;
  const qty       = parseInt(document.getElementById('purch-qty').value) || 0;
  const unitPrice = parseFloat(document.getElementById('purch-price').value) || 0;
  if (!productId || qty < 1) { toast('أدخل المنتج والكمية / Enter product and qty', 'error'); return; }
  DB.Purchases.save({
    productId, qty, unitPrice,
    supplier: document.getElementById('purch-supplier').value.trim(),
    date:     document.getElementById('purch-date').value,
    notes:    document.getElementById('purch-notes').value.trim()
  });
  closeModal('modal-purchase');
  renderPurchases();
  renderProducts();
  toast('تم تسجيل المشترى وتحديث المخزون / Purchase saved ✓', 'success');
}

function deletePurchase(id) {
  if (!confirm('حذف هذا المشترى؟ سيتم تقليل المخزون / Delete this purchase? Stock will decrease')) return;
  DB.Purchases.delete(id);
  renderPurchases();
  renderProducts();
  toast('تم الحذف / Deleted', 'info');
}

// ─── Customers ────────────────────────────────────────────────────────────────
function renderCustomers() {
  const q    = (document.getElementById('cust-search')?.value || '').toLowerCase();
  let list   = DB.Customers.all();
  if (q) list = list.filter(c => c.name.toLowerCase().includes(q) || (c.phone||'').includes(q));
  const S = DB.Settings.get(); const cur = S.currency || 'دج';
  const tbody = document.getElementById('customers-body');
  if (!tbody) return;
  tbody.innerHTML = list.length ? list.map((c, i) =>
    `<tr>
      <td>${i+1}</td>
      <td><strong>${c.name}</strong></td>
      <td>${c.phone || '—'}</td>
      <td>${c.address || '—'}</td>
      <td class="${c.debt > 0 ? 'debt-cell' : ''}">${fmt(c.debt||0)} ${cur}</td>
      <td>${fmt(c.totalBought||0)} ${cur}</td>
      <td>
        <button class="btn-icon edit" onclick="editCustomer('${c.id}')"><i class="fas fa-pen"></i></button>
        <button class="btn-icon danger" onclick="deleteCustomer('${c.id}')"><i class="fas fa-trash"></i></button>
      </td>
    </tr>`).join('')
  : '<tr><td colspan="7" class="empty-td">لا يوجد زبائن / No customers</td></tr>';
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
  if (!confirm('حذف هذا الزبون؟ / Delete this customer?')) return;
  DB.Customers.delete(id);
  renderCustomers();
  toast('تم الحذف / Deleted', 'info');
}

// ─── Invoices ─────────────────────────────────────────────────────────────────
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
      <td>${fmt(s.total)} ${cur}</td>
      <td>${s.discount || 0}%</td>
      <td class="profit-cell">+${fmt(s.profit)} ${cur}</td>
      <td><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></td>
      <td>${fmtDate(s.date)}</td>
      <td><button class="btn-icon edit" onclick="viewInvoice('${s.id}')"><i class="fas fa-eye"></i></button></td>
    </tr>`).join('')
  : '<tr><td colspan="8" class="empty-td">لا توجد فواتير / No invoices</td></tr>';
}

function viewInvoice(id) {
  const s   = DB.Sales.byId(id);
  if (!s) return;
  const S   = DB.Settings.get(); const cur = S.currency || 'دج';
  const el  = document.getElementById('invoice-content');
  el.innerHTML = `
    <div class="invoice-view">
      <div class="inv-header">
        <div class="inv-store"><h2>${S.storeName || 'دكاني'}</h2><p>${S.address || ''}</p><p>${S.phone || ''}</p></div>
        <div class="inv-meta">
          <div class="inv-no">${s.invoiceNo}</div>
          <div class="inv-date">${fmtDate(s.date)}</div>
          <div class="inv-pay"><span class="badge pay-${s.paymentMethod}">${payLabel(s.paymentMethod)}</span></div>
        </div>
      </div>
      <div class="inv-customer">
        <strong>الزبون / Customer:</strong> ${s.customerName}
      </div>
      <table class="inv-table">
        <thead><tr><th>#</th><th>المنتج / Product</th><th>سعر الوحدة</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
        <tbody>
          ${s.items.map((it, i) => `<tr><td>${i+1}</td><td>${it.nameAr}</td><td>${fmt(it.price)} ${cur}</td><td>${it.qty}</td><td>${fmt(it.total)} ${cur}</td></tr>`).join('')}
        </tbody>
      </table>
      <div class="inv-totals">
        <div class="inv-total-row"><span>المجموع / Subtotal</span><span>${fmt(s.subtotal)} ${cur}</span></div>
        ${s.discount ? `<div class="inv-total-row"><span>خصم / Discount</span><span>−${s.discount}%</span></div>` : ''}
        <div class="inv-total-row grand"><span>الإجمالي / Total</span><span>${fmt(s.total)} ${cur}</span></div>
      </div>
    </div>`;
  openModal('modal-invoice');
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
  DB.Settings.save({
    storeName:         document.getElementById('set-store-name').value.trim(),
    address:           document.getElementById('set-address').value.trim(),
    phone:             document.getElementById('set-phone').value.trim(),
    currency:          document.getElementById('set-currency').value,
    lowStockThreshold: parseInt(document.getElementById('set-low-stock').value) || 5
  });
  toast('تم حفظ الإعدادات / Settings saved ✓', 'success');
  checkAlerts();
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




/**
 * DAKANI DATABASE ENGINE
 * localStorage-based relational store mimicking SQL tables.
 * Tables: products, categories, customers, sales, sale_items, purchases, settings
 */

const DB = (() => {
  const PREFIX = 'dakani_';

  // ─── Core ───────────────────────────────────────────────────────────────────
  const read  = key => { try { return JSON.parse(localStorage.getItem(PREFIX + key)) || []; } catch { return []; } };
  const write = (key, val) => localStorage.setItem(PREFIX + key, JSON.stringify(val));
  const uid   = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now   = () => new Date().toISOString();
  const today = () => new Date().toISOString().slice(0, 10);

  // ─── Seed defaults ──────────────────────────────────────────────────────────
  function seed() {
    if (!read('seeded').length) {
      const cats = ['مواد غذائية','مشروبات','منظفات','مخبوزات','ألبان','تحلية','أخرى'];
      write('categories', cats.map(n => ({ id: uid(), name: n })));
      write('settings', {
        storeName: 'دكاني', address: '', phone: '',
        currency: 'دج', lowStockThreshold: 5
      });
      write('seeded', [1]);
    }
  }

  // ─── SETTINGS ───────────────────────────────────────────────────────────────
  const Settings = {
    get: () => { try { return JSON.parse(localStorage.getItem(PREFIX + 'settings')) || {}; } catch { return {}; } },
    save: obj => localStorage.setItem(PREFIX + 'settings', JSON.stringify(obj))
  };

  // ─── CATEGORIES ─────────────────────────────────────────────────────────────
  const Categories = {
    all:    () => read('categories'),
    add:    name => {
      const cats = read('categories');
      const cat = { id: uid(), name };
      cats.push(cat); write('categories', cats); return cat;
    },
    delete: id => write('categories', read('categories').filter(c => c.id !== id))
  };

  // ─── PRODUCTS ───────────────────────────────────────────────────────────────
  const Products = {
    all:      () => read('products'),
    byId:     id => read('products').find(p => p.id === id),
    byBarcode: bc => read('products').find(p => p.barcode === bc),
    search:   q => {
      q = q.toLowerCase();
      return read('products').filter(p =>
        p.nameAr.toLowerCase().includes(q) ||
        (p.nameEn || '').toLowerCase().includes(q) ||
        (p.barcode || '').includes(q)
      );
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
    adjustStock: (id, delta) => {
      const list = read('products');
      const i = list.findIndex(p => p.id === id);
      if (i > -1) { list[i].stock = Math.max(0, (list[i].stock || 0) + delta); list[i].updatedAt = now(); write('products', list); }
    },
    delete: id => write('products', read('products').filter(p => p.id !== id)),
    lowStock: () => {
      const s = Settings.get();
      return read('products').filter(p => p.stock <= (s.lowStockThreshold || 5));
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
      const cust = { ...data, id: uid(), debt: 0, totalBought: 0, createdAt: now() };
      list.push(cust); write('customers', list); return cust;
    },
    addDebt: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) { list[i].debt = (list[i].debt || 0) + amount; write('customers', list); }
    },
    addTotal: (id, amount) => {
      const list = read('customers');
      const i = list.findIndex(c => c.id === id);
      if (i > -1) { list[i].totalBought = (list[i].totalBought || 0) + amount; write('customers', list); }
    },
    delete: id => write('customers', read('customers').filter(c => c.id !== id))
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
      const sale = {
        id: uid(),
        invoiceNo: 'INV-' + String(sales.length + 1).padStart(5, '0'),
        customerId: saleData.customerId || null,
        customerName: saleData.customerName || 'زبون عام',
        items: saleData.items,
        subtotal: saleData.subtotal,
        discount: saleData.discount || 0,
        total: saleData.total,
        profit: saleData.profit,
        paymentMethod: saleData.paymentMethod || 'cash',
        date: now(),
        createdAt: now()
      };
      sales.push(sale); write('sales', sales);

      // store items flat too for fast querying
      saleData.items.forEach(it => {
        items.push({ ...it, saleId: sale.id, date: sale.date });
        Products.adjustStock(it.productId, -it.qty);
      });
      write('sale_items', items);

      if (saleData.customerId) {
        Customers.addTotal(saleData.customerId, sale.total);
        if (saleData.paymentMethod === 'credit') Customers.addDebt(saleData.customerId, sale.total);
      }
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
    weeklySales: () => {
      const days = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const daySales = read('sales').filter(s => s.date && s.date.startsWith(ds));
        days.push({
          label: d.toLocaleDateString('ar-DZ', { weekday: 'short' }),
          total: daySales.reduce((a, s) => a + s.total, 0),
          profit: daySales.reduce((a, s) => a + s.profit, 0)
        });
      }
      return days;
    }
  };

  // ─── PURCHASES ──────────────────────────────────────────────────────────────
  const Purchases = {
    all:  () => read('purchases'),
    between: (from, to) => read('purchases').filter(p => p.date >= from && p.date <= to),
    save: data => {
      const list = read('purchases');
      const purchase = { ...data, id: uid(), createdAt: now() };
      list.push(purchase); write('purchases', list);
      Products.adjustStock(data.productId, data.qty);
      return purchase;
    },
    delete: id => {
      const p = read('purchases').find(p => p.id === id);
      if (p) Products.adjustStock(p.productId, -p.qty);
      write('purchases', read('purchases').filter(p => p.id !== id));
    }
  };

  // ─── EXPORT / IMPORT ────────────────────────────────────────────────────────
  function exportData() {
    const data = {
      version: '1.0', exportedAt: now(),
      products: read('products'), categories: read('categories'),
      customers: read('customers'), sales: read('sales'),
      sale_items: read('sale_items'), purchases: read('purchases'),
      settings: Settings.get()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `dakani-backup-${today()}.json`;
    a.click();
    toast('تم تصدير البيانات بنجاح / Data exported!', 'success');
  }

  function importData(event) {
    const file = event.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.products)   write('products', data.products);
        if (data.categories) write('categories', data.categories);
        if (data.customers)  write('customers', data.customers);
        if (data.sales)      write('sales', data.sales);
        if (data.sale_items) write('sale_items', data.sale_items);
        if (data.purchases)  write('purchases', data.purchases);
        if (data.settings)   Settings.save(data.settings);
        toast('تم الاستيراد بنجاح! جارٍ إعادة التحميل... / Import success!', 'success');
        setTimeout(() => location.reload(), 1500);
      } catch { toast('ملف غير صالح / Invalid file', 'error'); }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    ['products','categories','customers','sales','sale_items','purchases','settings','seeded']
      .forEach(k => localStorage.removeItem(PREFIX + k));
    location.reload();
  }

  function stats() {
    return {
      products:  read('products').length,
      customers: read('customers').length,
      sales:     read('sales').length,
      purchases: read('purchases').length,
      size:      (new Blob([JSON.stringify(Object.fromEntries(
        Object.keys(localStorage).filter(k => k.startsWith(PREFIX))
          .map(k => [k, localStorage.getItem(k)])
      ))]).size / 1024).toFixed(1) + ' KB'
    };
  }

  seed();

  return { Settings, Categories, Products, Customers, Sales, Purchases,
           exportData, importData, resetAll, stats, uid, today, now };
})();