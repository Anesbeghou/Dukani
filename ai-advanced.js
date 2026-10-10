/**
 * DAKANI AI ADVANCED — الذكاء الاصطناعي المتقدّم (محلي بالكامل، بلا إنترنت)
 * ─────────────────────────────────────────────────────────────
 * يُضيف فوق ai-insights.js (دون تعديله) لوحة «دكاني الذكي — متقدّم» داخل صفحة
 * التقارير ولوحة التحكم، تشمل:
 *   • درجة صحة المحل (0–100) بعوامل واضحة قابلة للتفسير
 *   • توقع المبيعات والربح لـ 7 و30 يوماً + إسقاط نهاية الشهر + نطاق ثقة
 *   • توقع التدفق النقدي (تحصيلات الديون المتوقعة مقابل مستحقات الموردين)
 *   • تصنيف ABC للمنتجات (باريتو) + منتجات تُباع بهامش ضعيف/بخسارة
 *   • زبائن معرّضون للفقد + ديون عالية المخاطر
 *   • كشف الأيام الشاذة (z-score) + أفضل ساعات/أيام
 *   • مساعد أسئلة بالعربية («كم ربحت هذا الشهر؟»، «من أفضل زبون؟»...)
 * كل الحسابات إحصائية بسيطة (انحدار خطي + موسمية أسبوعية) وليست «نموذجاً مدرَّباً»؛
 * هي توقعات تقريبية تتحسن بكثرة البيانات، وتُعرض مع نطاق عدم يقين.
 * قراءة فقط — لا يكتب أي بيانات. للمدير فقط.
 */
(function () {
  const esc = v => (typeof escHtml === 'function') ? escHtml(v) : String(v == null ? '' : v);
  const isCashier = () => { try { return typeof _isCashierRole === 'function' && _isCashierRole(); } catch (e) { return false; } };
  const cur = () => DB.Settings.get().currency || 'دج';
  const f = n => (typeof fmt === 'function') ? fmt(n) : String(Math.round(n));
  const today = () => DakaniFin.today();
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ─── انحدار خطي بسيط + موسمية يوم الأسبوع ───────────────────────────────────
  function linreg(ys) {
    const n = ys.length; if (n < 2) return { a: ys[0] || 0, b: 0, sd: 0 };
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    ys.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x; });
    const den = n * sxx - sx * sx || 1;
    const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
    const sd = Math.sqrt(ys.reduce((t, y, x) => t + Math.pow(y - (a + b * x), 2), 0) / Math.max(1, n - 2));
    return { a, b, sd };
  }

  function forecast(days, history) {
    history = history || 60;
    const t = today();
    const S = DakaniFin.series(DakaniFin.addDays(t, -(history - 1)), t);
    const sales = S.net, prof = S.profitRealized;
    const nz = sales.filter(x => x > 0).length;
    if (nz < 5) return null;                                  // بيانات غير كافية
    const wd = k => new Date(k + 'T00:00:00Z').getUTCDay();
    const wdAvg = new Array(7).fill(0), wdCnt = new Array(7).fill(0);
    S.keys.forEach((k, i) => { wdAvg[wd(k)] += sales[i]; wdCnt[wd(k)]++; });
    const mean = sales.reduce((a, b) => a + b, 0) / sales.length || 1;
    const season = wdAvg.map((s, i) => wdCnt[i] ? (s / wdCnt[i]) / mean : 1);
    const des = sales.map((v, i) => v / (season[wd(S.keys[i])] || 1));
    const L = linreg(des);
    const margin = sales.reduce((a, b) => a + b, 0) ? prof.reduce((a, b) => a + b, 0) / sales.reduce((a, b) => a + b, 0) : 0;
    const out = [];
    for (let i = 0; i < days; i++) {
      const date = DakaniFin.addDays(t, i + 1);
      const base = Math.max(0, L.a + L.b * (sales.length + i));
      const v = base * (season[wd(date)] || 1);
      out.push({ date, sales: v, profit: v * margin, lo: Math.max(0, v - 1.28 * L.sd), hi: v + 1.28 * L.sd });
    }
    const sum = k => out.reduce((a, x) => a + x[k], 0);
    return { days: out, sales: sum('sales'), profit: sum('profit'), lo: sum('lo'), hi: sum('hi'), slope: L.b, margin, mean };
  }

  function monthProjection() {
    const t = today(), first = t.slice(0, 8) + '01';
    const F = DakaniFin.compute(first, t);
    const elapsed = DakaniFin.daysBetween(first, t) + 1;
    const dim = new Date(+t.slice(0, 4), +t.slice(5, 7), 0).getDate();
    const fc = forecast(Math.max(0, dim - elapsed), 60);
    return { sofar: F.netSales, profitSoFar: F.profitRealized, elapsed, dim,
      projSales: F.netSales + (fc ? fc.sales : F.netSales / elapsed * (dim - elapsed)),
      projProfit: F.profitRealized + (fc ? fc.profit : F.profitRealized / elapsed * (dim - elapsed)), expenses: F.expenses.total };
  }

  // ─── التدفق النقدي المتوقع (30 يوماً) ───────────────────────────────────────
  function cashflow() {
    const t = today();
    const past = DakaniFin.compute(DakaniFin.addDays(t, -29), t);
    const fc = forecast(30, 60);
    const cashSalesShare = past.sales.gross ? (past.sales.cash + past.sales.card) / past.sales.gross : 1;
    const inSales = fc ? fc.sales * cashSalesShare : (past.sales.cash + past.sales.card);
    const inDebt = Math.min(DB.Customers.all().reduce((a, c) => a + (c.debt || 0), 0), past.debts.collected * 1.0 || 0);
    const outExp = past.expenses.total;             // نفترض نفس وتيرة آخر 30 يوماً
    const outPurch = past.purchases.cash;
    const outSupp = Math.min(past.debts.suppliers, past.debts.suppPaid || past.debts.suppliers);
    return { inSales, inDebt, outExp, outPurch, outSupp,
      net: inSales + inDebt - outExp - outPurch - outSupp,
      custDebt: past.debts.customers, suppDebt: past.debts.suppliers };
  }

  // ─── تصنيف ABC وهوامش ضعيفة ─────────────────────────────────────────────────
  function abc() {
    const t = today();
    const F = DakaniFin.compute(DakaniFin.addDays(t, -89), t);
    const arr = Object.values(F.byProduct).sort((a, b) => b.revenue - a.revenue);
    const total = arr.reduce((a, x) => a + x.revenue, 0) || 1;
    let acc = 0; const cls = { A: [], B: [], C: [] };
    arr.forEach(x => { acc += x.revenue; const p = acc / total; (p <= .8 ? cls.A : p <= .95 ? cls.B : cls.C).push(x); });
    const lowMargin = arr.filter(x => x.cost > 0 && x.revenue > 0 && (x.revenue - x.cost) / x.revenue < 0.05 && x.qty >= 3)
      .map(x => Object.assign({ margin: (x.revenue - x.cost) / x.revenue * 100 }, x)).slice(0, 8);
    const losing = arr.filter(x => x.cost > 0 && x.revenue < x.cost);
    return { cls, total, count: arr.length, lowMargin, losing };
  }

  // ─── الزبائن ───────────────────────────────────────────────────────────────
  function customersRisk() {
    const t = new Date();
    const sales = DB.Sales.all().filter(s => s.customerId);
    const by = {};
    sales.forEach(s => { (by[s.customerId] = by[s.customerId] || []).push(new Date(s.date)); });
    const churn = [];
    Object.keys(by).forEach(id => {
      const ds = by[id].sort((a, b) => a - b);
      if (ds.length < 3) return;
      const gaps = []; for (let i = 1; i < ds.length; i++) gaps.push((ds[i] - ds[i - 1]) / 864e5);
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const since = (t - ds[ds.length - 1]) / 864e5;
      if (since > Math.max(14, avg * 2.5)) {
        const c = DB.Customers.byId(id);
        if (c) churn.push({ name: c.name, since: Math.round(since), avg: Math.round(avg), total: c.totalBought || 0 });
      }
    });
    churn.sort((a, b) => b.total - a.total);
    // ديون عالية المخاطر: دين كبير + آخر سداد/شراء قديم
    const risky = DB.Customers.all().filter(c => (c.debt || 0) > 0).map(c => {
      const last = DB.DebtPayments.all().filter(p => p.customerId === c.id).map(p => p.date).sort().pop();
      const days = last ? (t - new Date(last)) / 864e5 : (c.createdAt ? (t - new Date(c.createdAt)) / 864e5 : 999);
      return { name: c.name, debt: c.debt, days: Math.round(days) };
    }).filter(x => x.days > 30).sort((a, b) => b.debt - a.debt);
    return { churn: churn.slice(0, 6), risky: risky.slice(0, 6) };
  }

  // ─── الأيام الشاذة ──────────────────────────────────────────────────────────
  function anomalies() {
    const t = today();
    const S = DakaniFin.series(DakaniFin.addDays(t, -59), t);
    const v = S.net; const m = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + Math.pow(b - m, 2), 0) / v.length) || 1;
    return S.keys.map((k, i) => ({ date: k, v: v[i], z: (v[i] - m) / sd })).filter(x => Math.abs(x.z) > 2 && x.v !== m).sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).slice(0, 4);
  }

  // ─── درجة صحة المحل ────────────────────────────────────────────────────────
  function health() {
    const t = today();
    const F = DakaniFin.compute(DakaniFin.addDays(t, -29), t);
    const P = DakaniFin.compute(DakaniFin.addDays(t, -59), DakaniFin.addDays(t, -30));
    const inv = DakaniFin.inventoryValue();
    const factors = [];
    const add = (name, score, note) => factors.push({ name, score: Math.round(clamp(score, 0, 100)), note });
    add('الربحية', F.netSales > 0 ? (F.margins.onSell / 25) * 100 : 40, `هامش ${F.margins.onSell.toFixed(1)}%`);
    add('نمو المبيعات', P.netSales > 0 ? 50 + ((F.netSales - P.netSales) / P.netSales) * 100 : 60, P.netSales > 0 ? `${((F.netSales - P.netSales) / P.netSales * 100).toFixed(1)}% عن الفترة السابقة` : 'لا فترة سابقة');
    add('الذمم (الديون)', F.netSales > 0 ? 100 - (F.debts.customers / (F.netSales || 1)) * 100 : 70, `ديون الزبائن ${f(F.debts.customers)}`);
    add('ضبط المصاريف', F.profitRealized > 0 ? 100 - (F.expenses.total / F.profitRealized) * 60 : (F.expenses.total ? 25 : 70), `مصاريف ${f(F.expenses.total)} من ربح ${f(F.profitRealized)}`);
    const low = DB.Products.lowStock().length, n = DB.Products.all().length || 1;
    add('توفر المخزون', 100 - (low / n) * 200, `${low} منتج منخفض`);
    add('نظافة البيانات', 100 - (inv.pendingCost / n) * 300 - F.pendingCostSales * 3, inv.pendingCost ? `${inv.pendingCost} منتج بلا سعر شراء` : 'سعر الشراء مكتمل');
    const score = Math.round(factors.reduce((a, x) => a + x.score, 0) / factors.length);
    return { score, factors, F };
  }

  // ─── مساعد الأسئلة (قواعد كلمات مفتاحية — ليس نموذج لغة) ──────────────────────
  function answer(q) {
    const s = String(q || '').trim(); if (!s) return 'اكتب سؤالك، مثلاً: «كم ربحت هذا الشهر؟»';
    const c = cur();
    const has = (...w) => w.some(x => s.includes(x));
    let range = DakaniFin.preset('month'), label = 'هذا الشهر';
    if (has('اليوم')) { range = DakaniFin.preset('today'); label = 'اليوم'; }
    else if (has('أمس', 'امس')) { range = DakaniFin.preset('yesterday'); label = 'أمس'; }
    else if (has('أسبوع', 'اسبوع', '7')) { range = DakaniFin.preset('7d'); label = 'آخر 7 أيام'; }
    else if (has('الشهر الماضي')) { range = DakaniFin.preset('lastmonth'); label = 'الشهر الماضي'; }
    else if (has('سنة', 'عام')) { range = DakaniFin.preset('year'); label = 'هذه السنة'; }
    const F = DakaniFin.compute(range.from, range.to);
    if (has('توقع', 'متوقع', 'القادم')) { const fc = forecast(7, 60); return fc ? `المتوقع خلال 7 أيام: مبيعات ≈ ${f(fc.sales)} ${c} (بين ${f(fc.lo)} و${f(fc.hi)}) وربح ≈ ${f(fc.profit)} ${c}.` : 'البيانات غير كافية للتوقع بعد (أحتاج 5 أيام بيع على الأقل).'; }
    if (has('دين', 'ديون', 'مدين')) return `ديون الزبائن: ${f(F.debts.customers)} ${c} (${F.debts.customersCount} زبون). ديون الموردين علينا: ${f(F.debts.suppliers)} ${c} (${F.debts.suppliersCount} مورد).`;
    if (has('ربح', 'أرباح', 'ارباح', 'ربحت')) return `${label}: الربح المحقَّق ${f(F.profitRealized)} ${c}، وصافي النتيجة بعد المصاريف والخسائر ${f(F.netResult)} ${c}. (ربح معلَّق على الديون: ${f(F.debts.pendingProfit)} ${c})`;
    if (has('مصروف', 'مصاريف')) return `${label}: المصاريف ${f(F.expenses.total)} ${c}.`;
    if (has('مرتجع', 'مرتجعات')) return `${label}: ${F.returns.count} مرتجع بقيمة ${f(F.returns.total)} ${c} (ربح ضائع ${f(F.returns.profitLost)} ${c}).`;
    if (has('أفضل زبون', 'افضل زبون', 'أفضل عميل')) { const b = Object.values(F.byCustomer).filter(x => x.id).sort((a, b) => b.total - a.total)[0]; return b ? `أفضل زبون ${label}: ${b.name} بمشتريات ${f(b.total)} ${c} في ${b.count} فاتورة.` : 'لا توجد مبيعات لزبائن مسجَّلين في هذه الفترة.'; }
    if (has('أفضل منتج', 'افضل منتج', 'الأكثر مبيعا', 'الاكثر مبيعا')) { const b = Object.values(F.byProduct).sort((a, b) => b.revenue - a.revenue)[0]; return b ? `الأكثر مبيعاً ${label}: ${b.name} (${f(b.qty)} وحدة، ${f(b.revenue)} ${c}).` : 'لا مبيعات في هذه الفترة.'; }
    if (has('أفضل موظف', 'افضل موظف', 'أفضل بائع')) { const b = Object.values(F.bySeller).sort((a, b) => (b.gross - b.returns) - (a.gross - a.returns))[0]; return b ? `أفضل بائع ${label}: ${b.name} بمبيعات صافية ${f(b.gross - b.returns)} ${c} في ${b.count} فاتورة.` : 'لا مبيعات في هذه الفترة.'; }
    if (has('مخزون', 'بضاعة')) { const v = DakaniFin.inventoryValue(); return `قيمة المخزون بسعر الشراء ${f(v.cost)} ${c} وبسعر البيع ${f(v.sell)} ${c} (ربح كامن ${f(v.potential)} ${c}).`; }
    if (has('مبيعات', 'بعت', 'مبيع')) return `${label}: المبيعات الصافية ${f(F.netSales)} ${c} (إجمالي ${f(F.sales.gross)} − مرتجعات ${f(F.returns.total)}) في ${F.sales.count} فاتورة، وتكلفتها ${f(F.netCost)} ${c}.`;
    return 'لم أفهم سؤالك. جرّب: مبيعات اليوم؟ / كم ربحت هذا الشهر؟ / ما الديون؟ / من أفضل زبون؟ / أفضل منتج؟ / توقع الأسبوع القادم؟ / قيمة المخزون؟';
  }

  // ─── العرض ─────────────────────────────────────────────────────────────────
  function bar(score) {
    const col = score >= 70 ? '#10b981' : score >= 45 ? '#f59e0b' : '#ef4444';
    return `<div style="height:8px;background:var(--surface3,#1e2d3d);border-radius:6px;overflow:hidden"><div style="width:${score}%;height:100%;background:${col}"></div></div>`;
  }

  function html() {
    const c = cur();
    const H = health(), fc7 = forecast(7, 60), fc30 = forecast(30, 60), mp = monthProjection(), cf = cashflow(), A = abc(), CR = customersRisk(), AN = anomalies();
    const grade = H.score >= 75 ? ['ممتازة', '#10b981'] : H.score >= 55 ? ['جيدة', '#84cc16'] : H.score >= 40 ? ['تحتاج انتباهاً', '#f59e0b'] : ['حرجة', '#ef4444'];
    const fcBox = (title, fc) => fc ? `<div class="ai-quick-box"><div class="ai-quick-label">${title}</div>
      <div class="ai-quick-value">${f(fc.sales)} ${c}</div>
      <div style="font-size:11.5px;color:var(--text3)">نطاق: ${f(fc.lo)} – ${f(fc.hi)} | ربح ≈ ${f(fc.profit)}</div>
      <div style="font-size:11.5px;margin-top:3px;color:${fc.slope >= 0 ? '#10b981' : '#ef4444'}"><i class="fas fa-arrow-${fc.slope >= 0 ? 'trend-up' : 'trend-down'}"></i> ${fc.slope >= 0 ? 'اتجاه صاعد' : 'اتجاه هابط'}</div></div>`
      : `<div class="ai-quick-box"><div class="ai-quick-label">${title}</div><div class="ai-quick-value">—</div><div style="font-size:11.5px;color:var(--text3)">بيانات غير كافية</div></div>`;
    const list = (arr, fn, empty) => arr.length ? arr.map(fn).join('') : `<div class="empty-state good" style="padding:10px">${empty}</div>`;
    return `
    <div class="card-title"><i class="fas fa-wand-magic-sparkles"></i> دكاني الذكي — متقدّم <small style="display:block;margin-top:4px;color:var(--text3);font-weight:400">توقعات وتحليلات إحصائية تقريبية محسوبة داخل الجهاز — تتحسن بزيادة بيانات المبيعات</small></div>

    <div class="dash-grid" style="margin-bottom:14px">
      <div class="dash-card" style="min-width:0">
        <div class="card-title"><i class="fas fa-heart-pulse"></i> صحة المحل</div>
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:12px">
          <div style="font-size:42px;font-weight:900;color:${grade[1]}">${H.score}</div>
          <div><div style="font-weight:700;color:${grade[1]}">${grade[0]}</div><div style="font-size:12px;color:var(--text3)">من 100 — متوسط 6 عوامل</div></div>
        </div>
        ${H.factors.map(x => `<div style="margin-bottom:9px"><div style="display:flex;justify-content:space-between;font-size:12.5px"><span>${x.name}</span><span style="color:var(--text3)">${x.note} — <strong>${x.score}</strong></span></div>${bar(x.score)}</div>`).join('')}
      </div>
      <div class="dash-card" style="min-width:0">
        <div class="card-title"><i class="fas fa-calendar-check"></i> إسقاط نهاية الشهر</div>
        <div class="ai-quick-grid">
          <div class="ai-quick-box"><div class="ai-quick-label">المبيعات المتوقعة</div><div class="ai-quick-value">${f(mp.projSales)} ${c}</div><div style="font-size:11.5px;color:var(--text3)">حتى الآن ${f(mp.sofar)} (${mp.elapsed}/${mp.dim} يوم)</div></div>
          <div class="ai-quick-box"><div class="ai-quick-label">الربح المتوقع</div><div class="ai-quick-value">${f(mp.projProfit)} ${c}</div><div style="font-size:11.5px;color:var(--text3)">قبل المصاريف (${f(mp.expenses)} حتى الآن)</div></div>
        </div>
        <div class="ai-quick-grid">${fcBox('توقع 7 أيام', fc7)}${fcBox('توقع 30 يوماً', fc30)}</div>
      </div>
    </div>

    <div class="dash-grid" style="margin-bottom:14px">
      <div class="dash-card" style="min-width:0">
        <div class="card-title"><i class="fas fa-money-bill-transfer"></i> التدفق النقدي المتوقع (30 يوماً)</div>
        <div class="report-mini-stat"><span>＋ مبيعات نقدية متوقعة</span><strong class="profit-cell">${f(cf.inSales)} ${c}</strong></div>
        <div class="report-mini-stat"><span>＋ تحصيل ديون الزبائن (تقدير بوتيرة آخر 30 يوماً)</span><strong class="profit-cell">${f(cf.inDebt)} ${c}</strong></div>
        <div class="report-mini-stat"><span>− مصاريف (بوتيرة آخر 30 يوماً)</span><strong class="debt-cell">${f(cf.outExp)} ${c}</strong></div>
        <div class="report-mini-stat"><span>− مشتريات نقدية</span><strong class="debt-cell">${f(cf.outPurch)} ${c}</strong></div>
        <div class="report-mini-stat"><span>− سداد الموردين (تقدير)</span><strong class="debt-cell">${f(cf.outSupp)} ${c}</strong></div>
        <div class="report-mini-stat"><span><strong>صافي التدفق المتوقع</strong></span><strong style="color:${cf.net >= 0 ? '#10b981' : '#ef4444'}">${f(cf.net)} ${c}</strong></div>
        <div style="font-size:11.5px;color:var(--text3);margin-top:6px">ديون الزبائن القائمة ${f(cf.custDebt)} — ديون الموردين ${f(cf.suppDebt)} ${c}</div>
      </div>
      <div class="dash-card" style="min-width:0">
        <div class="card-title"><i class="fas fa-layer-group"></i> تصنيف المنتجات ABC (آخر 90 يوماً)</div>
        <div class="ai-quick-grid">
          <div class="ai-quick-box"><div class="ai-quick-label">A — 80% من المبيعات</div><div class="ai-quick-value">${A.cls.A.length}</div></div>
          <div class="ai-quick-box"><div class="ai-quick-label">B — 15%</div><div class="ai-quick-value">${A.cls.B.length}</div></div>
          <div class="ai-quick-box"><div class="ai-quick-label">C — 5%</div><div class="ai-quick-value">${A.cls.C.length}</div></div>
        </div>
        <div style="font-size:12.5px;margin-bottom:6px;color:var(--text3)">منتجات بهامش أقل من 5% (راجع تسعيرها):</div>
        ${list(A.lowMargin, x => `<div class="top-prod-row"><span class="top-name">${esc(x.name)}</span><span class="top-qty">${x.margin.toFixed(1)}%</span><span class="top-rev">${f(x.revenue)} ${c}</span></div>`, 'لا منتجات بهامش ضعيف')}
        ${A.losing.length ? `<div class="ai-tip ai-tip-warn" style="margin-top:8px"><i class="fas fa-triangle-exclamation"></i><span>${A.losing.length} منتج يُباع بأقل من التكلفة: ${A.losing.slice(0, 3).map(x => esc(x.name)).join('، ')}</span></div>` : ''}
      </div>
    </div>

    <div class="dash-grid" style="margin-bottom:14px">
      <div class="dash-card" style="min-width:0">
        <div class="card-title"><i class="fas fa-user-slash"></i> زبائن معرّضون للفقد</div>
        ${list(CR.churn, x => `<div class="top-prod-row"><span class="top-name">${esc(x.name)}</span><span class="top-qty">غائب ${x.since} يوماً</span><span class="top-rev">معتاد كل ${x.avg} يوماً</span></div>`, 'لا زبائن معرّضون للفقد')}
        <div class="card-title" style="margin-top:14px"><i class="fas fa-user-clock"></i> ديون عالية المخاطر</div>
        ${list(CR.risky, x => `<div class="top-prod-row"><span class="top-name">${esc(x.name)}</span><span class="top-qty">${x.days >= 999 ? 'بلا سداد' : 'منذ ' + x.days + ' يوماً'}</span><span class="top-rev debt-cell">${f(x.debt)} ${c}</span></div>`, 'لا ديون متأخرة')}
      </div>
      <div class="dash-card" style="min-width:0">
        <div class="card-title"><i class="fas fa-magnifying-glass-chart"></i> أيام شاذّة (آخر 60 يوماً)</div>
        ${list(AN, x => `<div class="top-prod-row"><span class="top-name">${x.date}</span><span class="top-qty" style="color:${x.z > 0 ? '#10b981' : '#ef4444'}">${x.z > 0 ? 'أعلى' : 'أقل'} من المعتاد</span><span class="top-rev">${f(x.v)} ${c}</span></div>`, 'لا أيام شاذّة')}
        <div class="card-title" style="margin-top:14px"><i class="fas fa-comments"></i> اسأل دكاني</div>
        <div style="display:flex;gap:8px"><input type="text" id="ai-q" placeholder="مثال: كم ربحت هذا الشهر؟" style="flex:1" onkeydown="if(event.key==='Enter')DakaniAIAdv.ask()"/>
          <button class="btn-primary" onclick="DakaniAIAdv.ask()"><i class="fas fa-paper-plane"></i></button></div>
        <div id="ai-a" style="margin-top:10px;font-size:13px;line-height:1.8;min-height:24px;color:var(--text2)"></div>
      </div>
    </div>`;
  }

  function mount(pageId, id) {
    if (isCashier() || typeof DakaniFin === 'undefined') { document.getElementById(id)?.remove(); return; }
    const page = document.getElementById(pageId); if (!page) return;
    let w = document.getElementById(id);
    if (!w) { w = document.createElement('div'); w.id = id; w.className = 'dash-card full-width ai-insights-card'; page.appendChild(w); }
    try { w.innerHTML = html(); } catch (e) { console.error('AI advanced error', e); w.innerHTML = ''; }
  }

  function renderAll() { mount('page-reports', 'ai-adv-reports'); }

  function hook() {
    if (typeof window.navigateTo !== 'function' || window.navigateTo.__aiAdvWrapped) return;
    const orig = window.navigateTo;
    const w = function (page) { const r = orig.apply(this, arguments); try { if (page === 'reports') setTimeout(renderAll, 80); } catch (e) {} return r; };
    w.__aiAdvWrapped = true; window.navigateTo = w;
  }
  document.addEventListener('DOMContentLoaded', hook);
  if (document.readyState !== 'loading') hook();

  window.DakaniAIAdv = {
    render: renderAll,
    ask() { const q = document.getElementById('ai-q')?.value; const el = document.getElementById('ai-a'); if (el) el.textContent = answer(q); },
    _debug: { forecast, monthProjection, cashflow, abc, customersRisk, anomalies, health, answer }
  };
})();