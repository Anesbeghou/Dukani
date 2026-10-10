/**
 * DAKANI ANALYTICS CENTER — مركز التحليلات
 * ─────────────────────────────────────────────────────────────
 * بطاقات منفصلة (مبيعات بسعر البيع / بسعر الشراء / ربح / ديون / مصاريف ...) +
 * مخططات متعددة بأزرار تبديل. يعتمد كلياً على DakaniFin (قراءة فقط).
 * يُحقن داخل لوحة التحكم والتقارير دون تعديل عناصرها القديمة. للمدير فقط.
 */
(function () {
  const COL = { sell: '#10b981', buy: '#6366f1', profit: '#f59e0b', red: '#ef4444', blue: '#3b82f6', teal: '#14b8a6', pink: '#ec4899', grey: '#94a3b8' };
  const PALETTE = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#8b5cf6', '#f97316', '#84cc16'];
  const charts = {};
  const state = { dash: { preset: '30d', tab: 'sales' }, rep: { tab: 'sales' } };

  const fmtN = n => (typeof fmt === 'function') ? fmt(n) : (Math.round(n * 100) / 100).toLocaleString('ar-DZ');
  const cur = () => { try { return DB.Settings.get().currency || 'دج'; } catch (e) { return 'دج'; } };
  const esc = v => (typeof escHtml === 'function') ? escHtml(v) : String(v == null ? '' : v);
  const isCashier = () => { try { return typeof _isCashierRole === 'function' && _isCashierRole(); } catch (e) { return false; } };
  const pct = v => (isFinite(v) ? v : 0).toFixed(1) + '%';
  const PAY = { cash: 'نقدي', card: 'بطاقة', credit: 'آجل', mixed: 'مختلط' };

  function destroy(id) { if (charts[id]) { try { charts[id].destroy(); } catch (e) {} delete charts[id]; } }
  function mk(id, cfg) {
    const el = document.getElementById(id);
    if (!el || typeof Chart === 'undefined') return;
    destroy(id);
    cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false }, cfg.options || {});
    charts[id] = new Chart(el, cfg);
  }
  const axis = { x: { ticks: { color: COL.grey, maxRotation: 0, autoSkip: true }, grid: { color: 'rgba(148,163,184,.12)' } },
                 y: { ticks: { color: COL.grey }, grid: { color: 'rgba(148,163,184,.12)' }, beginAtZero: true } };
  const legend = { labels: { color: COL.grey, font: { family: 'Cairo' } } };
  const labelsOf = S => S.keys.map(k => S.monthly ? k : k.slice(5));

  function delta(curV, prevV) {
    if (prevV == null) return '';
    if (!prevV && !curV) return '';
    if (!prevV) return '<span class="kpi-delta up"><i class="fas fa-arrow-up"></i> جديد</span>';
    const p = (curV - prevV) / Math.abs(prevV) * 100;
    if (Math.abs(p) < 0.05) return '<span class="kpi-delta flat"><i class="fas fa-minus"></i> 0%</span>';
    return `<span class="kpi-delta ${p > 0 ? 'up' : 'down'}"><i class="fas fa-arrow-${p > 0 ? 'up' : 'down'}"></i> ${Math.abs(p).toFixed(1)}%</span>`;
  }

  function card(icon, label, value, cls, extra, sub) {
    return `<div class="kpi-card ${cls || ''}"><div class="kpi-icon"><i class="fas fa-${icon}"></i></div>
      <div class="kpi-info"><div class="kpi-value">${value}</div><div class="kpi-label">${label}</div>
      ${sub ? `<div class="kpi-sub" style="font-size:11px;color:var(--text3);margin-top:2px">${sub}</div>` : ''}${extra || ''}</div></div>`;
  }

  function cardsHtml(F, P, inv) {
    const c = cur();
    const v = n => `${fmtN(n)} ${c}`;
    const d = (a, b) => P ? delta(a, b) : '';
    const cards = [
      card('sack-dollar', 'المبيعات بسعر البيع (الصافية)', v(F.netSales), 'kpi-sales', d(F.netSales, P && P.netSales), `إجمالي ${v(F.sales.gross)} − مرتجعات ${v(F.returns.total)}`),
      card('tags', 'المبيعات بسعر الشراء (التكلفة)', v(F.netCost), 'kpi-customers', d(F.netCost, P && P.netCost), 'تكلفة البضاعة المباعة بعد المرتجعات'),
      card('chart-line', 'الربح المحقَّق (الصافي)', v(F.profitRealized), 'kpi-profit', d(F.profitRealized, P && P.profitRealized), 'نقدي + ديون محصَّلة − أرباح المرتجعات'),
      card('hourglass-half', 'الربح المعلَّق (على الديون)', v(F.debts.pendingProfit), 'kpi-invoices', '', 'يتحقق عند سداد الزبائن'),
      card('percent', 'هامش الربح على سعر البيع', pct(F.margins.onSell), 'kpi-profit', '', `زيادة على التكلفة: ${pct(F.margins.onCost)}`),
      card('rotate-left', 'المرتجعات', v(F.returns.total), 'kpi-low', d(F.returns.total, P && P.returns.total), `${F.returns.count} عملية — خسارة ربح ${v(F.returns.profitLost)}`),
      card('file-invoice-dollar', 'إجمالي المصاريف', v(F.expenses.total), 'kpi-low', d(F.expenses.total, P && P.expenses.total), 'إيجار + رواتب + فواتير + عامة'),
      card('hand-holding-dollar', 'إيرادات أخرى', v(F.income.total), 'kpi-sales', d(F.income.total, P && P.income.total), 'خارج المبيعات'),
      card('triangle-exclamation', 'خسائر المخزون', v(F.losses.total), 'kpi-low', '', `منها انتهاء صلاحية ${v(F.losses.expiry)}`),
      card('scale-balanced', 'صافي النتيجة', `<span style="color:${F.netResult >= 0 ? COL.sell : COL.red}">${v(F.netResult)}</span>`, 'kpi-profit', d(F.netResult, P && P.netResult), 'ربح محقَّق + إيرادات − مصاريف − خسائر'),
      card('user-clock', 'ديون الزبائن', v(F.debts.customers), 'kpi-low', '', `${F.debts.customersCount} زبون — ديون جديدة بالفترة ${v(F.debts.newCredit)}`),
      card('truck-ramp-box', 'ديون الموردين', v(F.debts.suppliers), 'kpi-low', '', `${F.debts.suppliersCount} مورد — مشتريات آجلة بالفترة ${v(F.purchases.credit)}`),
      card('cart-flatbed', 'المشتريات', v(F.purchases.total), 'kpi-customers', d(F.purchases.total, P && P.purchases.total), `${F.purchases.count} عملية`),
      card('boxes-stacked', 'قيمة المخزون', v(inv.cost), 'kpi-invoices', '', `بسعر البيع ${v(inv.sell)} — ربح كامن ${v(inv.potential)}`),
      card('receipt', 'الفواتير', F.sales.count, 'kpi-invoices', d(F.sales.count, P && P.sales.count), `متوسط الفاتورة ${v(F.sales.avgBasket)}`)
    ];
    if (F.pendingCostRevenue > 0) cards.push(card('circle-exclamation', 'مبيعات بانتظار سعر الشراء', v(F.pendingCostRevenue), 'kpi-low', '', `${F.pendingCostSales} فاتورة — لا ربح محتسب حتى تُدخل سعر الشراء`));
    return cards.join('');
  }

  const TABS = [
    ['sales', 'chart-line', 'المبيعات والأرباح'],
    ['profit', 'layer-group', 'الربح: سعر البيع / الشراء'],
    ['debts', 'user-clock', 'الديون'],
    ['cash', 'coins', 'المصاريف والإيرادات'],
    ['loss', 'triangle-exclamation', 'الخسائر والمرتجعات'],
    ['mix', 'chart-pie', 'التوزيعات'],
    ['time', 'clock', 'أوقات الذروة']
  ];

  function tabsHtml(scope, active) {
    return `<div class="dk-an-tabs">${TABS.map(t => `<button class="dk-an-tab ${t[0] === active ? 'active' : ''}" onclick="DakaniAnalytics.setTab('${scope}','${t[0]}')"><i class="fas fa-${t[1]}"></i> ${t[2]}</button>`).join('')}</div>`;
  }

  function chartArea(prefix) {
    return `<div class="dk-an-charts"><div class="dk-an-main"><canvas id="${prefix}-main"></canvas></div><div class="dk-an-side"><canvas id="${prefix}-side"></canvas></div></div>`;
  }

  function draw(prefix, tab, F, S) {
    const L = labelsOf(S);
    const main = prefix + '-main', side = prefix + '-side';
    const doughnut = (id, labels, data, title) => mk(id, { type: 'doughnut',
      data: { labels, datasets: [{ data, backgroundColor: PALETTE, borderColor: 'rgba(0,0,0,0)' }] },
      options: { plugins: { legend: { position: 'bottom', labels: { color: COL.grey, boxWidth: 12 } }, title: { display: !!title, text: title, color: COL.grey } } } });
    const line = (label, data, color, fill) => ({ label, data, borderColor: color, backgroundColor: color + '22', fill: !!fill, tension: .35, pointRadius: S.keys.length > 45 ? 0 : 3 });

    if (tab === 'sales') {
      mk(main, { type: 'line', data: { labels: L, datasets: [
        line('المبيعات بسعر البيع (صافي)', S.net, COL.sell, true),
        line('بسعر الشراء (التكلفة)', S.cost, COL.buy, false),
        line('الربح المحقَّق', S.profitRealized, COL.profit, false) ] },
        options: { plugins: { legend }, scales: axis } });
      doughnut(side, ['تكلفة', 'ربح'], [Math.max(0, F.netCost), Math.max(0, F.profitAccrual)], 'تركيب المبيعات');
    } else if (tab === 'profit') {
      // سعر البيع = تكلفة (سعر الشراء) + ربح  → عمود مكدّس يُظهر الربح بالسعرين
      const profitAcc = S.net.map((n, i) => +(n - S.cost[i]).toFixed(2));
      mk(main, { type: 'bar', data: { labels: L, datasets: [
        { label: 'سعر الشراء (تكلفة)', data: S.cost, backgroundColor: COL.buy, stack: 's' },
        { label: 'الربح', data: profitAcc, backgroundColor: COL.profit, stack: 's' } ] },
        options: { plugins: { legend, tooltip: { callbacks: { footer: items => 'سعر البيع: ' + fmtN(items.reduce((a, i) => a + i.parsed.y, 0)) } } },
                   scales: { x: Object.assign({}, axis.x, { stacked: true }), y: Object.assign({}, axis.y, { stacked: true }) } } });
      doughnut(side, ['هامش على سعر البيع %', 'متبقٍ'], [Math.max(0, +F.margins.onSell.toFixed(1)), Math.max(0, 100 - Math.max(0, F.margins.onSell))], `الهامش ${pct(F.margins.onSell)} | زيادة على التكلفة ${pct(F.margins.onCost)}`);
    } else if (tab === 'debts') {
      mk(main, { type: 'line', data: { labels: L, datasets: [
        line('ديون جديدة (آجل)', S.newCredit, COL.red, true),
        line('تحصيلات الزبائن', S.collected, COL.sell, false) ] },
        options: { plugins: { legend }, scales: axis } });
      doughnut(side, ['ديون الزبائن لنا', 'ديون الموردين علينا'], [F.debts.customers, F.debts.suppliers], 'الذمم الحالية');
    } else if (tab === 'cash') {
      mk(main, { type: 'bar', data: { labels: L, datasets: [
        { label: 'المصاريف', data: S.expenses, backgroundColor: COL.red },
        { label: 'إيرادات أخرى', data: S.income, backgroundColor: COL.sell },
        { label: 'المشتريات', data: S.purchases, backgroundColor: COL.buy } ] },
        options: { plugins: { legend }, scales: axis } });
      const cats = Object.keys(F.expenses.byCat);
      doughnut(side, cats.map(k => (typeof DakaniCashbox !== 'undefined' ? DakaniCashbox.categoryLabel(k) : k).split('/')[0].trim()), cats.map(k => F.expenses.byCat[k]), 'المصاريف حسب النوع');
    } else if (tab === 'loss') {
      mk(main, { type: 'bar', data: { labels: L, datasets: [
        { label: 'المرتجعات', data: S.returns, backgroundColor: COL.pink },
        { label: 'خسائر المخزون', data: S.losses, backgroundColor: COL.red } ] },
        options: { plugins: { legend }, scales: axis } });
      const rs = Object.keys(F.losses.byReason);
      doughnut(side, rs, rs.map(k => F.losses.byReason[k]), 'خسائر المخزون حسب السبب');
    } else if (tab === 'mix') {
      const pm = Object.keys(F.byPayment);
      doughnut(main, pm.map(k => PAY[k] || k), pm.map(k => F.byPayment[k]), 'طرق الدفع');
      const cats = Object.entries(F.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8);
      doughnut(side, cats.map(x => x[0]), cats.map(x => x[1]), 'المبيعات حسب الفئة');
    } else if (tab === 'time') {
      mk(main, { type: 'bar', data: { labels: F.byHour.map((_, h) => h + ':00'), datasets: [{ label: 'المبيعات حسب الساعة', data: F.byHour.map(x => +x.toFixed(2)), backgroundColor: COL.teal }] },
        options: { plugins: { legend }, scales: axis } });
      const wd = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
      mk(side, { type: 'bar', data: { labels: wd, datasets: [{ label: 'حسب اليوم', data: F.byWeekday.map(x => +x.toFixed(2)), backgroundColor: COL.blue }] },
        options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: axis } });
    }
  }

  function injectStyles() {
    if (document.getElementById('dk-an-style')) return;
    const st = document.createElement('style'); st.id = 'dk-an-style';
    st.textContent = `
      .dk-an-wrap{margin:18px 0 22px;min-width:0}
      .dk-an-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:12px}
      .dk-an-head h2{margin:0;font-size:17px}
      .dk-an-head select{background:var(--surface2);color:var(--text);border:1px solid var(--border2);border-radius:8px;padding:7px 10px;font-family:inherit}
      .dk-an-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 10px}
      .dk-an-tab{background:var(--surface2);border:1px solid var(--border2);color:var(--text2);border-radius:999px;padding:7px 14px;font-family:inherit;font-size:12.5px;cursor:pointer;transition:.15s}
      .dk-an-tab:hover{border-color:var(--accent)}
      .dk-an-tab.active{background:var(--accent);color:#fff;border-color:var(--accent)}
      .dk-an-charts{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:14px;background:var(--surface);border:1px solid var(--border);border-radius:var(--radius,12px);padding:14px}
      .dk-an-main,.dk-an-side{position:relative;height:300px;min-width:0}
      .dk-an-wrap .kpi-grid{margin-top:0}
      @media(max-width:900px){.dk-an-charts{grid-template-columns:minmax(0,1fr)}.dk-an-main,.dk-an-side{height:260px}}
    `;
    document.head.appendChild(st);
  }

  function rangeFor(scope) {
    if (scope === 'dash') return DakaniFin.preset(state.dash.preset);
    return { from: document.getElementById('rep-from')?.value || DakaniFin.preset('month').from, to: document.getElementById('rep-to')?.value || DakaniFin.today() };
  }

  function render(scope) {
    if (isCashier()) {            // الكاشير لا يرى الأرباح: أزل أي لوحة بقيت من جلسة مدير سابقة
      document.getElementById('dk-an-dash')?.remove(); document.getElementById('dk-an-rep')?.remove();
      Object.keys(charts).forEach(destroy);
      return;
    }
    if (typeof DakaniFin === 'undefined') return;
    const host = scope === 'dash' ? document.getElementById('dk-an-dash') : document.getElementById('dk-an-rep');
    if (!host) return;
    injectStyles();
    const { from, to } = rangeFor(scope);
    const st = state[scope];
    const F = DakaniFin.compute(from, to);
    const pp = DakaniFin.prevPeriod(from, to);
    const P = pp ? DakaniFin.compute(pp.from, pp.to) : null;
    const S = DakaniFin.series(from === '0000-00-00' ? (DB.Sales.all()[0]?.date || DakaniFin.today()).slice(0, 10) : from, to > DakaniFin.today() ? DakaniFin.today() : to);
    const inv = DakaniFin.inventoryValue();
    const prefix = 'dk-an-' + scope;
    const presets = [['today', 'اليوم'], ['yesterday', 'أمس'], ['7d', 'آخر 7 أيام'], ['30d', 'آخر 30 يوماً'], ['month', 'هذا الشهر'], ['lastmonth', 'الشهر الماضي'], ['year', 'هذه السنة'], ['all', 'كل الفترات']];
    host.innerHTML = `<div class="dk-an-wrap">
      <div class="dk-an-head"><h2><i class="fas fa-chart-pie"></i> مركز التحليلات <small style="color:var(--text3);font-weight:400">Analytics Center</small></h2>
        ${scope === 'dash' ? `<select onchange="DakaniAnalytics.setPreset(this.value)">${presets.map(p => `<option value="${p[0]}" ${p[0] === st.preset ? 'selected' : ''}>${p[1]}</option>`).join('')}</select>` : `<small style="color:var(--text3)">${from} → ${to}</small>`}
      </div>
      <div class="kpi-grid">${cardsHtml(F, P, inv)}</div>
      ${tabsHtml(scope, st.tab)}
      ${chartArea(prefix)}
    </div>`;
    draw(prefix, st.tab, F, S);
  }

  function ensureHosts() {
    if (isCashier()) return;
    const dash = document.getElementById('page-dashboard');
    if (dash && !document.getElementById('dk-an-dash')) {
      const h = document.createElement('div'); h.id = 'dk-an-dash';
      const grid = dash.querySelector('.kpi-grid');
      if (grid && grid.parentNode) grid.parentNode.insertBefore(h, grid.nextSibling); else dash.appendChild(h);
    }
    const rep = document.getElementById('page-reports');
    if (rep && !document.getElementById('dk-an-rep')) {
      const h = document.createElement('div'); h.id = 'dk-an-rep';
      const k = document.getElementById('report-kpis');
      if (k && k.parentNode) k.parentNode.insertBefore(h, k); else rep.appendChild(h);
    }
  }

  window.DakaniAnalytics = {
    renderDashboard() { ensureHosts(); render('dash'); },
    renderReports() { ensureHosts(); render('rep'); },
    setPreset(p) { state.dash.preset = p; render('dash'); },
    setTab(scope, t) { state[scope].tab = t; render(scope); }
  };
})();