/**
 * DAKANI STAFF PERFORMANCE — أداء الموظفين والمدراء
 * ─────────────────────────────────────────────────────────────
 * يظهر داخل صفحة «الحسابات» (تبويب أداء الموظفين). يعتمد على حقل البائع
 * (sellerId / sellerName) المسجَّل في كل فاتورة، ويحسب لكل بائع: عدد الفواتير،
 * المبيعات الصافية (بعد مرتجعاته)، الأرباح، متوسط الفاتورة، الخصومات، المبيعات
 * الآجلة، ساعات الذروة، أفضل منتجاته، مع ترتيب وأفضل موظف. قراءة فقط.
 */
(function () {
  const COLORS = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6'];
  let _range = '30d';
  let _host = null;
  const charts = {};
  const cur = () => DB.Settings.get().currency || 'دج';
  const esc = v => (typeof escHtml === 'function') ? escHtml(v) : String(v == null ? '' : v);
  const f = n => (typeof fmt === 'function') ? fmt(n) : String(Math.round(n * 100) / 100);
  const roleLabel = r => r === 'manager' ? 'مدير' : (r === 'cashier' ? 'موظف' : '—');

  function killCharts() { Object.keys(charts).forEach(k => { try { charts[k].destroy(); } catch (e) {} delete charts[k]; }); }

  function rows(F) {
    const list = Object.values(F.bySeller).map(s => {
      const net = s.gross - s.returns;
      return Object.assign({}, s, { net, avg: s.count ? s.gross / s.count : 0, retRate: s.gross ? s.returns / s.gross * 100 : 0 });
    });
    // أضف الموظفين/المدراء الذين لم يبيعوا في الفترة (بصفر) ليظهروا في القائمة
    const have = new Set(list.map(x => x.id).filter(Boolean));
    try {
      DakaniAccounts.getEmployees().filter(e => e.active !== false).forEach(e => { if (!have.has(e.id)) list.push({ id: e.id, name: e.name, role: 'cashier', count: 0, gross: 0, profit: 0, items: 0, returns: 0, returnsCount: 0, credit: 0, discount: 0, net: 0, avg: 0, retRate: 0 }); });
      DakaniAccounts.getManagers().forEach(m => { if (!have.has(m.id)) list.push({ id: m.id, name: m.name, role: 'manager', count: 0, gross: 0, profit: 0, items: 0, returns: 0, returnsCount: 0, credit: 0, discount: 0, net: 0, avg: 0, retRate: 0 }); });
    } catch (e) {}
    return list.sort((a, b) => b.net - a.net);
  }

  function render(host) {
    _host = host || _host;
    if (!_host) return;
    killCharts();
    const { from, to } = DakaniFin.preset(_range);
    const F = DakaniFin.compute(from, to);
    const list = rows(F);
    const totalNet = list.reduce((a, x) => a + x.net, 0);
    const c = cur();
    const best = list.find(x => x.count > 0);
    const bestProfit = list.slice().sort((a, b) => b.profit - a.profit).find(x => x.count > 0);
    const bestAvg = list.slice().sort((a, b) => b.avg - a.avg).find(x => x.count >= 3);
    const presets = [['today', 'اليوم'], ['7d', '7 أيام'], ['30d', '30 يوماً'], ['month', 'هذا الشهر'], ['lastmonth', 'الشهر الماضي'], ['year', 'هذه السنة'], ['all', 'الكل']];

    _host.innerHTML = `
      <div class="dk-an-head" style="margin-top:14px">
        <h2><i class="fas fa-ranking-star"></i> أداء الموظفين <small style="color:var(--text3);font-weight:400">${from === '0000-00-00' ? 'كل الفترات' : from + ' → ' + to}</small></h2>
        <select id="dk-perf-range" style="background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:8px;padding:7px 10px;font-family:inherit">
          ${presets.map(p => `<option value="${p[0]}" ${p[0] === _range ? 'selected' : ''}>${p[1]}</option>`).join('')}
        </select>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card kpi-sales"><div class="kpi-icon"><i class="fas fa-trophy"></i></div><div class="kpi-info">
          <div class="kpi-value">${best ? esc(best.name) : '—'}</div><div class="kpi-label">أفضل بائع (مبيعات صافية)</div>
          ${best ? `<div style="font-size:11px;color:var(--text3)">${f(best.net)} ${c} — ${best.count} فاتورة</div>` : ''}</div></div>
        <div class="kpi-card kpi-profit"><div class="kpi-icon"><i class="fas fa-medal"></i></div><div class="kpi-info">
          <div class="kpi-value">${bestProfit ? esc(bestProfit.name) : '—'}</div><div class="kpi-label">الأعلى ربحاً</div>
          ${bestProfit ? `<div style="font-size:11px;color:var(--text3)">${f(bestProfit.profit)} ${c}</div>` : ''}</div></div>
        <div class="kpi-card kpi-customers"><div class="kpi-icon"><i class="fas fa-basket-shopping"></i></div><div class="kpi-info">
          <div class="kpi-value">${bestAvg ? esc(bestAvg.name) : '—'}</div><div class="kpi-label">أعلى متوسط فاتورة</div>
          ${bestAvg ? `<div style="font-size:11px;color:var(--text3)">${f(bestAvg.avg)} ${c}</div>` : ''}</div></div>
        <div class="kpi-card kpi-invoices"><div class="kpi-icon"><i class="fas fa-receipt"></i></div><div class="kpi-info">
          <div class="kpi-value">${F.sales.count}</div><div class="kpi-label">إجمالي الفواتير</div>
          <div style="font-size:11px;color:var(--text3)">صافي ${f(F.netSales)} ${c}</div></div></div>
      </div>
      <div class="dk-an-charts" style="margin:14px 0">
        <div class="dk-an-main"><canvas id="dk-perf-bar"></canvas></div>
        <div class="dk-an-side"><canvas id="dk-perf-pie"></canvas></div>
      </div>
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>#</th><th>الاسم</th><th>الدور</th><th>الفواتير</th><th>القطع</th><th>المبيعات</th><th>المرتجعات</th><th>الصافي</th><th>الربح</th><th>متوسط الفاتورة</th><th>آجل</th><th>الحصة</th><th></th></tr></thead>
        <tbody>${list.length ? list.map((x, i) => `<tr>
          <td>${i === 0 && x.count ? '<i class="fas fa-crown" style="color:#f59e0b"></i>' : i + 1}</td>
          <td><strong>${esc(x.name)}</strong></td><td>${roleLabel(x.role)}</td>
          <td>${x.count}</td><td>${f(x.items)}</td><td>${f(x.gross)} ${c}</td>
          <td class="debt-cell">${x.returns ? '- ' + f(x.returns) + ' (' + x.returnsCount + ')' : '—'}</td>
          <td><strong>${f(x.net)} ${c}</strong></td><td class="profit-cell">${f(x.profit)} ${c}</td>
          <td>${f(x.avg)} ${c}</td><td>${x.credit ? f(x.credit) + ' ' + c : '—'}</td>
          <td>${totalNet > 0 ? (x.net / totalNet * 100).toFixed(1) + '%' : '—'}</td>
          <td>${x.count ? `<button class="btn-secondary" style="padding:4px 10px;font-size:12px" data-id="${esc(x.id || '')}" data-name="${esc(x.name)}" onclick="DakaniStaffPerf.detail(this.dataset.id,this.dataset.name)"><i class="fas fa-chart-simple"></i> تفاصيل</button>` : ''}</td>
        </tr>`).join('') : '<tr><td colspan="13" class="empty-td">لا توجد مبيعات في هذه الفترة</td></tr>'}</tbody>
      </table></div>
      <p style="font-size:12px;color:var(--text3);margin-top:8px"><i class="fas fa-circle-info"></i> المبيعات القديمة المسجَّلة قبل هذا التحديث تظهر تحت «غير محدد». الربح يشمل الجزء الآجل (استحقاقاً) ويُطرح منه ربح المرتجعات.</p>`;

    document.getElementById('dk-perf-range').onchange = e => { _range = e.target.value; render(); };
    if (typeof Chart === 'undefined') return;
    const axisCol = '#94a3b8';
    const top = list.filter(x => x.count > 0).slice(0, 10);
    charts.bar = new Chart(document.getElementById('dk-perf-bar'), { type: 'bar',
      data: { labels: top.map(x => x.name), datasets: [
        { label: 'المبيعات الصافية', data: top.map(x => +x.net.toFixed(2)), backgroundColor: '#10b981' },
        { label: 'الربح', data: top.map(x => +x.profit.toFixed(2)), backgroundColor: '#f59e0b' } ] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: axisCol } } },
        scales: { x: { ticks: { color: axisCol }, grid: { display: false } }, y: { ticks: { color: axisCol }, grid: { color: 'rgba(148,163,184,.12)' }, beginAtZero: true } } } });
    charts.pie = new Chart(document.getElementById('dk-perf-pie'), { type: 'doughnut',
      data: { labels: top.map(x => x.name), datasets: [{ data: top.map(x => Math.max(0, x.net)), backgroundColor: COLORS, borderColor: 'rgba(0,0,0,0)' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: axisCol } }, title: { display: true, text: 'حصة كل بائع من المبيعات', color: axisCol } } } });
  }

  // ─── تفاصيل بائع واحد ────────────────────────────────────────────────────────
  function detail(id, name) {
    const { from, to } = DakaniFin.preset(_range);
    const mine = DB.Sales.all().filter(s => {
      const d = (s.date || '').slice(0, 10);
      if (d < from || d > to) return false;
      return id ? s.sellerId === id : (!s.sellerId && (s.sellerName || 'غير محدد') === name);
    });
    const c = cur();
    const gross = mine.reduce((a, s) => a + s.total, 0);
    const profit = mine.reduce((a, s) => a + (s.profit || 0), 0);
    const items = {};
    const hours = new Array(24).fill(0);
    const days = {};
    mine.forEach(s => {
      const h = new Date(s.date).getHours(); if (!isNaN(h)) hours[h] += s.total;
      const d = s.date.slice(0, 10); days[d] = (days[d] || 0) + s.total;
      (s.items || []).forEach(it => { const o = items[it.nameAr] || (items[it.nameAr] = { qty: 0, rev: 0 }); o.qty += it.qty; o.rev += it.total; });
    });
    const topItems = Object.entries(items).sort((a, b) => b[1].rev - a[1].rev).slice(0, 8);
    const peak = hours.indexOf(Math.max(...hours));
    const discount = mine.reduce((a, s) => a + ((s.subtotal || s.total) - s.total), 0);
    let ov = document.getElementById('dk-perf-detail');
    if (!ov) { ov = document.createElement('div'); ov.id = 'dk-perf-detail'; ov.className = 'modal-overlay'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="modal modal-lg"><div class="modal-header"><h2><i class="fas fa-user-chart"></i> ${esc(name)}</h2>
      <button onclick="closeModal('dk-perf-detail')"><i class="fas fa-xmark"></i></button></div>
      <div class="modal-body">
        <div class="kpi-grid" style="margin-bottom:12px">
          <div class="kpi-card kpi-sales"><div class="kpi-icon"><i class="fas fa-receipt"></i></div><div class="kpi-info"><div class="kpi-value">${mine.length}</div><div class="kpi-label">فواتير</div></div></div>
          <div class="kpi-card kpi-profit"><div class="kpi-icon"><i class="fas fa-sack-dollar"></i></div><div class="kpi-info"><div class="kpi-value">${f(gross)} ${c}</div><div class="kpi-label">المبيعات</div></div></div>
          <div class="kpi-card kpi-customers"><div class="kpi-icon"><i class="fas fa-chart-line"></i></div><div class="kpi-info"><div class="kpi-value">${f(profit)} ${c}</div><div class="kpi-label">الربح (استحقاق)</div></div></div>
          <div class="kpi-card kpi-invoices"><div class="kpi-icon"><i class="fas fa-clock"></i></div><div class="kpi-info"><div class="kpi-value">${gross > 0 ? peak + ':00' : '—'}</div><div class="kpi-label">ساعة الذروة</div></div></div>
        </div>
        <div class="dk-an-charts" style="grid-template-columns:minmax(0,1fr);margin-bottom:12px"><div class="dk-an-main" style="height:220px"><canvas id="dk-perf-days"></canvas></div></div>
        <div class="report-mini-stat"><span>إجمالي الخصومات الممنوحة</span><strong>${f(discount)} ${c}</strong></div>
        <h4 style="margin:14px 0 6px">أكثر المنتجات مبيعاً لديه</h4>
        ${topItems.length ? topItems.map((x, i) => `<div class="top-prod-row"><span class="top-rank">${i + 1}</span><span class="top-name">${esc(x[0])}</span><span class="top-qty">${f(x[1].qty)}</span><span class="top-rev">${f(x[1].rev)} ${c}</span></div>`).join('') : '<div class="empty-state">لا بيانات</div>'}
        <h4 style="margin:14px 0 6px">آخر فواتيره</h4>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>الفاتورة</th><th>التاريخ</th><th>الزبون</th><th>المبلغ</th><th>الدفع</th></tr></thead><tbody>
          ${mine.slice(-12).reverse().map(s => `<tr><td>${esc(s.invoiceNo)}</td><td>${typeof fmtDate === 'function' ? fmtDate(s.date) : s.date}</td><td>${esc(s.customerName)}</td><td>${f(s.total)} ${c}</td><td>${typeof payLabel === 'function' ? payLabel(s.paymentMethod) : s.paymentMethod}</td></tr>`).join('')}
        </tbody></table></div>
      </div></div>`;
    ov.classList.add('active');
    if (typeof Chart !== 'undefined') {
      const ks = Object.keys(days).sort();
      if (charts.days) { try { charts.days.destroy(); } catch (e) {} }
      charts.days = new Chart(document.getElementById('dk-perf-days'), { type: 'line',
        data: { labels: ks.map(k => k.slice(5)), datasets: [{ label: 'مبيعاته اليومية', data: ks.map(k => +days[k].toFixed(2)), borderColor: '#10b981', backgroundColor: '#10b98122', fill: true, tension: .35 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#94a3b8' } } },
          scales: { x: { ticks: { color: '#94a3b8' } }, y: { ticks: { color: '#94a3b8' }, beginAtZero: true } } } });
    }
  }

  window.DakaniStaffPerf = { render, detail };
})();