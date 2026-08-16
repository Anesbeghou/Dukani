/**
 * DAKANI AI INSIGHTS
 * ─────────────────────────────────────────────────────────────
 * شاشة "دكاني الذكي" — توصيات تلقائية مبنية بالكامل على بيانات المحل نفسه
 * (المبيعات، المخزون) المخزَّنة محلياً على الجهاز. لا يتصل بأي خادم خارجي
 * ولا يرسل أي بيانات إلى الإنترنت — كل الحسابات تتم داخل المتصفح فقط.
 *
 * ⚠️ ملف مستقل تماماً (نفس مبدأ camera-scanner.js / keyboard-shortcuts.js /
 *    security-utils.js): لا يعدّل أي دالة أو ملف موجود إطلاقاً. فقط:
 *      1) يقرأ من DB (Products, Sales) — قراءة فقط، بدون أي كتابة إطلاقاً.
 *      2) يبني عناصره الخاصة ديناميكياً ويحقنها داخل صفحتي "لوحة التحكم"
 *         و"التقارير" (page-dashboard / page-reports) دون تعديل أي عنصر
 *         موجود فيهما مسبقاً.
 *      3) "يلفّ" (wrap) دالة navigateTo الموجودة أصلاً بدل تعديلها، لكي يعرف
 *         متى يعيد رسم نفسه — نفس أسلوب الاعتراض الآمن (interceptor) المستخدم
 *         في database.js مع document.addEventListener.
 *
 * ما تعرضه الشاشة:
 *   • توقع المبيعات لِـ 7 أيام قادمة (اتجاه عام + تأثير يوم الأسبوع)
 *   • اقتراح كمية الطلب لكل منتج مقبل على النفاد (بناءً على متوسط سرعة البيع)
 *   • عروض مقترحة لتحريك المخزون الراكد (نسبة الخصم تتناسب مع مدة الركود)
 *   • نصائح عامة تلقائية حسب حالة المحل الحالية
 *
 * حماية الأرباح/التكلفة: نفس منطق بقية النظام (_isCashierRole) — كل هذه
 * الشاشة تعتمد بيانات مالية حساسة (تكلفة، قيمة مخزون)، لذا تُخفى بالكامل عن
 * دور "كاشير" تماماً مثل صفحة التقارير ورسم الأرباح في لوحة التحكم.
 */
(function () {

  // ─── الإعدادات القابلة للضبط ────────────────────────────────────────────
  const CFG = {
    historyDays:        60,  // نافذة البيانات التاريخية المستخدمة في توقع المبيعات
    velocityDays:        30, // نافذة حساب متوسط سرعة البيع لكل منتج
    forecastDays:        7,  // عدد الأيام القادمة المُتوقَّعة
    coverageDays:        14, // عدد أيام التغطية المطلوبة عند اقتراح كمية الطلب
    leadTimeDays:        3,  // مهلة توريد افتراضية (أيام) تُضاف لحساب كمية الطلب
    reorderHorizonDays:  14, // نعرض فقط المنتجات المقبلة على النفاد خلال هذه المدة
    deadStockDays:       30, // نفس الحد الأدنى الافتراضي المستخدم في شاشة المخزون الراكد
    maxReorderRows:       8,
    maxDeadStockRows:     6
  };

  // ─── أدوات مساعدة عامة ──────────────────────────────────────────────────
  function isReady() {
    return typeof DB !== 'undefined' && typeof DB.Sales === 'object' && typeof DB.Products === 'object';
  }

  function isCashier() {
    try { return typeof _isCashierRole === 'function' && _isCashierRole(); }
    catch (e) { return false; }
  }

  function esc(v) {
    return (typeof escHtml === 'function') ? escHtml(v) : String(v == null ? '' : v);
  }

  // رقمان عشريان (نفس تنسيق fmt() الأصلية في script.js) مع fallback آمن
  function fmt2(n) {
    if (typeof fmt === 'function') return fmt(n);
    return (parseFloat(n) || 0).toLocaleString('ar-DZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function currency() {
    try { return (DB.Settings.get() || {}).currency || 'دج'; }
    catch (e) { return 'دج'; }
  }

  // ─── تجميع المبيعات اليومية لآخر N يوم (بما فيها الأيام بلا أي بيع = صفر) ──
  function dailySeries(days) {
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const map = {};
    const order = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today0); d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      map[key] = { date: key, dow: d.getDay(), total: 0, qty: 0, count: 0 };
      order.push(key);
    }
    (DB.Sales.all() || []).forEach(s => {
      const key = (s.date || '').slice(0, 10);
      const row = map[key];
      if (!row) return;
      row.total += s.total || 0;
      row.count += 1;
      (s.items || []).forEach(it => { row.qty += (it.qty || 0); });
    });
    return order.map(k => map[k]);
  }

  // ─── توقع المبيعات: انحدار خطي بسيط (اتجاه عام) × معامل يوم الأسبوع ────────
  // لا يعتمد على أي مكتبة خارجية — طريقة "المربعات الصغرى" (Least Squares)
  // الكلاسيكية المستخدمة عادة كخط أساس (baseline) في توقع السلاسل الزمنية.
  function computeForecast() {
    if (!isReady()) return null;
    const series = dailySeries(CFG.historyDays);
    const daysWithSales = series.filter(d => d.count > 0).length;
    if (daysWithSales < 7) return null; // بيانات غير كافية بعد لتوليد توقع موثوق

    const n = series.length;
    const ys = series.map(d => d.total);
    const xMean = (n - 1) / 2;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (ys[i] - yMean);
      den += (i - xMean) * (i - xMean);
    }
    const slope     = den ? num / den : 0;
    const intercept = yMean - slope * xMean;

    // معامل يوم الأسبوع: متوسط ذلك اليوم مقارنة بالمتوسط العام (محدود بين 0.5 و1.6
    // حتى لا يبالغ التوقع عندما تكون البيانات التاريخية قليلة)
    const dowTotal = Array(7).fill(0), dowCount = Array(7).fill(0);
    series.forEach(d => { dowTotal[d.dow] += d.total; dowCount[d.dow] += 1; });
    const overallAvg = yMean || 1;
    const dowFactor = dowTotal.map((sum, i) => {
      if (!dowCount[i]) return 1;
      const avg = sum / dowCount[i];
      return Math.min(1.6, Math.max(0.5, avg / overallAvg));
    });

    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const days = [];
    let totalPredicted = 0;
    for (let i = 1; i <= CFG.forecastDays; i++) {
      const d = new Date(today0); d.setDate(d.getDate() + i);
      const x = (n - 1) + i;
      let base = intercept + slope * x;
      if (!isFinite(base) || base < 0) base = 0;
      const predicted = Math.round(base * dowFactor[d.getDay()]);
      totalPredicted += predicted;
      days.push({ date: d.toISOString().slice(0, 10), label: d.toLocaleDateString('ar-DZ', { weekday: 'short' }), predicted });
    }

    // نسبة النمو: متوسط آخر 7 أيام فعلية مقابل الأسبوع الذي قبله
    const last7 = series.slice(-7).reduce((a, d) => a + d.total, 0) / 7;
    const prev7 = series.slice(-14, -7).reduce((a, d) => a + d.total, 0) / 7;
    const trendPct = prev7 > 0 ? ((last7 - prev7) / prev7) * 100 : null;

    return { days, totalPredicted, trendPct };
  }

  // ─── اقتراح كميات الطلب: حسب متوسط سرعة البيع اليومي لكل منتج ─────────────
  function computeReorderSuggestions() {
    if (!isReady()) return [];
    const series = dailySeries(CFG.velocityDays);
    const since  = series[0] ? series[0].date : null;
    const windowDays = series.length || CFG.velocityDays;

    const qtyByProduct = {};
    (DB.Sales.all() || []).forEach(s => {
      const d = (s.date || '').slice(0, 10);
      if (!since || d < since) return;
      (s.items || []).forEach(it => {
        if (!it.productId) return;
        qtyByProduct[it.productId] = (qtyByProduct[it.productId] || 0) + (it.qty || 0);
      });
    });

    const rows = [];
    (DB.Products.all() || []).forEach(p => {
      // نستثني المنتجات ذات المتغيّرات (Variants) لأن مخزونها موزَّع على كل
      // متغيّر على حدة وليس على p.stock — بنفس منطق DB.Products.lowStock()
      if (DB.Products.hasVariants(p)) return;
      const soldQty = qtyByProduct[p.id] || 0;
      if (soldQty <= 0) return; // لا توجد بيانات مبيعات كافية لهذا المنتج بعد
      const velocity = soldQty / windowDays;
      if (velocity <= 0) return;
      const stock = p.stock || 0;
      const daysLeft = stock / velocity;
      if (daysLeft > CFG.reorderHorizonDays) return;
      const suggestedQty = Math.max(1, Math.ceil(velocity * (CFG.coverageDays + CFG.leadTimeDays) - stock));
      rows.push({
        id: p.id, nameAr: p.nameAr, unit: p.unit || '',
        stock, velocity, daysLeft: Math.max(0, Math.round(daysLeft)), suggestedQty
      });
    });

    rows.sort((a, b) => a.daysLeft - b.daysLeft);
    return rows.slice(0, CFG.maxReorderRows);
  }

  // ─── عروض مقترحة للمخزون الراكد: تُعيد استخدام DB.Products.deadStock ──────
  // الموجودة أصلاً (لا إعادة اختراع)، وتضيف فقط نسبة خصم مقترحة تتناسب مع
  // عدد أيام الركود.
  function discountFor(daysIdle) {
    if (daysIdle >= 180) return 30;
    if (daysIdle >= 90)  return 20;
    if (daysIdle >= 60)  return 15;
    return 10;
  }
  function computeDeadStockPromotions() {
    if (!isReady() || typeof DB.Products.deadStock !== 'function') return [];
    const list = DB.Products.deadStock({ days: CFG.deadStockDays }) || [];
    return list.slice(0, CFG.maxDeadStockRows).map(p => ({ ...p, discount: discountFor(p.daysIdle || 0) }));
  }

  // ─── نصائح تلقائية حسب حالة المحل الحالية ──────────────────────────────
  function computeTips(fc, reorder, dead) {
    const out = [];
    if (fc && fc.trendPct != null) {
      if (fc.trendPct >= 10) {
        out.push({ icon: 'arrow-trend-up', cls: 'good',
          text: `مبيعاتك في ارتفاع (${fc.trendPct > 0 ? '+' : ''}${fc.trendPct.toFixed(0)}%) مقارنة بالأسبوع السابق — استغل الزخم بزيادة مخزون المنتجات الأكثر مبيعاً` });
      } else if (fc.trendPct <= -10) {
        out.push({ icon: 'arrow-trend-down', cls: 'warn',
          text: `مبيعاتك تراجعت (${fc.trendPct.toFixed(0)}%) مقارنة بالأسبوع السابق — قد يكون الوقت مناسباً لعرض ترويجي أو تذكير للزبائن` });
      }
    }
    if (reorder.length) {
      out.push({ icon: 'triangle-exclamation', cls: 'warn',
        text: `${reorder.length} منتج مقبل على النفاد خلال ${CFG.reorderHorizonDays} يوم — راجع اقتراحات كمية الطلب أدناه` });
    }
    if (dead.length) {
      const tied = dead.reduce((a, p) => a + (p.tiedValue || 0), 0);
      out.push({ icon: 'box-archive', cls: 'info',
        text: `${fmt2(tied)} ${currency()} من رأس المال متجمّد في مخزون راكد — جرّب العروض المقترحة أدناه لتحريكه` });
    }
    if (!fc && !reorder.length && !dead.length) {
      out.push({ icon: 'circle-info', cls: 'info',
        text: 'لا توجد بيانات كافية بعد لتوليد توصيات دقيقة — استمر بالبيع اليومي وستتحسن دقة التوقعات والاقتراحات تلقائياً' });
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ─── العرض (Rendering) ───────────────────────────────────────────────────
  // ═══════════════════════════════════════════════════════════════════════

  function trendBadge(pct) {
    const cls  = pct > 0 ? 'up' : (pct < 0 ? 'down' : 'flat');
    const icon = pct > 0 ? 'arrow-up' : (pct < 0 ? 'arrow-down' : 'minus');
    return `<span class="kpi-delta ${cls}"><i class="fas fa-${icon}"></i> ${Math.abs(pct).toFixed(0)}%</span>`;
  }

  function renderTipsList(tips) {
    return `<div class="ai-tips-list">${tips.map(t =>
      `<div class="ai-tip ai-tip-${t.cls}"><i class="fas fa-${t.icon}"></i><span>${esc(t.text)}</span></div>`
    ).join('')}</div>`;
  }

  function renderForecastBlock(fc, cur) {
    if (!fc) {
      return `<div class="empty-state" data-i18n="بيانات غير كافية بعد للتوقع (يلزم أسبوع مبيعات على الأقل) / Not enough data yet (at least a week of sales needed)">بيانات غير كافية بعد للتوقع (يلزم أسبوع مبيعات على الأقل) / Not enough data yet (at least a week of sales needed)</div>`;
    }
    const max = Math.max(1, ...fc.days.map(d => d.predicted));
    return `
      <div class="ai-forecast-total">
        <span>${fmt2(fc.totalPredicted)} ${cur}</span>
        ${fc.trendPct != null ? trendBadge(fc.trendPct) : ''}
        <small data-i18n="إجمالي متوقع للأيام السبعة القادمة / total predicted for the next 7 days">إجمالي متوقع للأيام السبعة القادمة / total predicted for the next 7 days</small>
      </div>
      <div class="ai-bars">
        ${fc.days.map(d => `
          <div class="ai-bar-col" title="${esc(d.label)}: ${fmt2(d.predicted)} ${cur}">
            <div class="ai-bar" style="height:${Math.max(4, Math.round((d.predicted / max) * 100))}%"></div>
            <div class="ai-bar-label">${esc(d.label)}</div>
          </div>`).join('')}
      </div>`;
  }

  function renderReorderTable(rows) {
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th data-i18n="المنتج / Product">المنتج / Product</th>
        <th data-i18n="المخزون الحالي / Current stock">المخزون الحالي / Current stock</th>
        <th data-i18n="متوسط البيع اليومي / Avg daily sales">متوسط البيع اليومي / Avg daily sales</th>
        <th data-i18n="ينفد خلال / Runs out in">ينفد خلال / Runs out in</th>
        <th data-i18n="الكمية المقترحة للطلب / Suggested order qty">الكمية المقترحة للطلب / Suggested order qty</th>
      </tr></thead>
      <tbody>
        ${rows.map(r => `<tr>
          <td>${esc(r.nameAr)}</td>
          <td>${fmt2(r.stock)} ${esc(r.unit)}</td>
          <td>${r.velocity.toFixed(1)} ${esc(r.unit)}</td>
          <td class="${r.daysLeft <= 3 ? 'alert-out' : ''}">${r.daysLeft} <span data-i18n="يوم / day(s)">يوم / day(s)</span></td>
          <td><strong>${r.suggestedQty}</strong> ${esc(r.unit)}</td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  function renderDeadStockTable(rows, cur) {
    return `<div class="table-wrap"><table class="data-table">
      <thead><tr>
        <th data-i18n="المنتج / Product">المنتج / Product</th>
        <th data-i18n="راكد منذ / Idle for">راكد منذ / Idle for</th>
        <th data-i18n="الكمية / Qty">الكمية / Qty</th>
        <th data-i18n="رأس مال متجمّد / Tied capital">رأس مال متجمّد / Tied capital</th>
        <th data-i18n="خصم مقترح / Suggested discount">خصم مقترح / Suggested discount</th>
      </tr></thead>
      <tbody>
        ${rows.map(p => `<tr>
          <td>${esc(p.nameAr)}</td>
          <td>${p.neverSold
              ? `<span data-i18n="لم يُباع أبداً / Never sold">لم يُباع أبداً / Never sold</span>`
              : `${p.daysIdle} <span data-i18n="يوم / day(s)">يوم / day(s)</span>`}</td>
          <td>${fmt2(p.stock)} ${esc(p.unit)}</td>
          <td>${fmt2(p.tiedValue)} ${cur}</td>
          <td><span class="badge" style="background:#f59e0b20;color:#f59e0b">-${p.discount}%</span></td>
        </tr>`).join('')}
      </tbody>
    </table></div>`;
  }

  // ─── تأكد من وجود حاوية الحقن داخل صفحة معيّنة (تُنشأ مرة واحدة فقط) ───────
  function ensureContainer(pageId, wrapId) {
    const page = document.getElementById(pageId);
    if (!page) return null;
    let wrap = document.getElementById(wrapId);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = wrapId;
      page.appendChild(wrap);
    }
    return wrap;
  }

  // نسخة مختصرة داخل لوحة التحكم (KPIs سريعة + أهم 3 نصائح + رابط للتفاصيل)
  function renderDashboardWidget() {
    const wrap = ensureContainer('page-dashboard', 'ai-dash-widget');
    if (!wrap) return;
    if (isCashier() || !isReady()) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    wrap.className = 'dash-card full-width ai-insights-card';

    const fc      = computeForecast();
    const reorder = computeReorderSuggestions();
    const dead    = computeDeadStockPromotions();
    const tips    = computeTips(fc, reorder, dead);
    const cur     = currency();

    wrap.innerHTML = `
      <div class="card-title" style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px">
        <span><i class="fas fa-brain"></i> <span data-i18n="دكاني الذكي / Dakani AI">دكاني الذكي / Dakani AI</span></span>
        <button class="btn-secondary" style="padding:6px 12px;font-size:12px" onclick="DakaniAI.goToFullInsights()">
          <span data-i18n="عرض التفاصيل الكاملة / View full insights">عرض التفاصيل الكاملة / View full insights</span> <i class="fas fa-arrow-left"></i>
        </button>
      </div>
      <div class="ai-quick-grid">
        <div class="ai-quick-box">
          <div class="ai-quick-label" data-i18n="توقع مبيعات ٧ أيام / 7-day sales forecast">توقع مبيعات ٧ أيام / 7-day sales forecast</div>
          <div class="ai-quick-value">${fc ? fmt2(fc.totalPredicted) + ' ' + cur : '—'}</div>
          ${fc && fc.trendPct != null ? trendBadge(fc.trendPct) : ''}
        </div>
        <div class="ai-quick-box">
          <div class="ai-quick-label" data-i18n="منتجات مقبلة على النفاد / Items running low soon">منتجات مقبلة على النفاد / Items running low soon</div>
          <div class="ai-quick-value">${reorder.length}</div>
        </div>
        <div class="ai-quick-box">
          <div class="ai-quick-label" data-i18n="مخزون راكد قابل للتنشيط / Dead stock to move">مخزون راكد قابل للتنشيط / Dead stock to move</div>
          <div class="ai-quick-value">${dead.length}</div>
        </div>
      </div>
      ${renderTipsList(tips.slice(0, 3))}
    `;
  }

  // النسخة الكاملة داخل صفحة التقارير
  function renderReportsWidget() {
    const wrap = ensureContainer('page-reports', 'ai-reports-widget');
    if (!wrap) return;
    if (isCashier() || !isReady()) { wrap.innerHTML = ''; wrap.style.display = 'none'; return; }
    wrap.style.display = '';
    wrap.className = 'dash-card full-width ai-insights-card ai-insights-full';

    const fc      = computeForecast();
    const reorder = computeReorderSuggestions();
    const dead    = computeDeadStockPromotions();
    const tips    = computeTips(fc, reorder, dead);
    const cur     = currency();

    wrap.innerHTML = `
      <div class="card-title">
        <i class="fas fa-brain"></i> <span data-i18n="دكاني الذكي — تحليلات وتوقعات / Dakani AI — Insights &amp; Forecasts">دكاني الذكي — تحليلات وتوقعات / Dakani AI — Insights &amp; Forecasts</span>
        <small style="display:block;margin-top:4px;color:var(--text3);font-weight:400" data-i18n="توصيات تلقائية مبنية على بيانات مبيعاتك الفعلية، محسوبة بالكامل داخل الجهاز / Automatic recommendations based on your real sales data, computed fully on-device">توصيات تلقائية مبنية على بيانات مبيعاتك الفعلية، محسوبة بالكامل داخل الجهاز / Automatic recommendations based on your real sales data, computed fully on-device</small>
      </div>

      ${renderTipsList(tips)}

      <div class="dash-grid" style="margin-top:16px">
        <div class="dash-card ai-block">
          <div class="card-title"><i class="fas fa-chart-line"></i> <span data-i18n="توقع المبيعات (٧ أيام قادمة) / Sales Forecast (next 7 days)">توقع المبيعات (٧ أيام قادمة) / Sales Forecast (next 7 days)</span></div>
          ${renderForecastBlock(fc, cur)}
        </div>
        <div class="dash-card ai-block">
          <div class="card-title"><i class="fas fa-dolly"></i> <span data-i18n="اقتراح كميات الطلب / Suggested Reorder Quantities">اقتراح كميات الطلب / Suggested Reorder Quantities</span></div>
          ${reorder.length ? renderReorderTable(reorder)
            : `<div class="empty-state good"><i class="fas fa-check-circle"></i> <span data-i18n="لا توجد منتجات مقبلة على النفاد حالياً / Nothing urgent right now">لا توجد منتجات مقبلة على النفاد حالياً / Nothing urgent right now</span></div>`}
        </div>
      </div>

      <div class="dash-card full-width ai-block" style="margin-top:16px">
        <div class="card-title"><i class="fas fa-tags"></i> <span data-i18n="عروض مقترحة لتحريك المخزون الراكد / Suggested Promotions for Dead Stock">عروض مقترحة لتحريك المخزون الراكد / Suggested Promotions for Dead Stock</span></div>
        ${dead.length ? renderDeadStockTable(dead, cur)
          : `<div class="empty-state good"><i class="fas fa-check-circle"></i> <span data-i18n="لا يوجد مخزون راكد حالياً / No dead stock right now">لا يوجد مخزون راكد حالياً / No dead stock right now</span></div>`}
      </div>
    `;
  }

  function goToFullInsights() {
    if (typeof navigateTo === 'function') navigateTo('reports');
    setTimeout(() => {
      const el = document.getElementById('ai-reports-widget');
      if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  // ─── حقن التنسيقات الخاصة بالشاشة مرة واحدة فقط ────────────────────────
  function injectStyles() {
    if (document.getElementById('ai-insights-style')) return;
    const style = document.createElement('style');
    style.id = 'ai-insights-style';
    style.textContent = `
      .ai-insights-card .card-title { margin-bottom: 14px; }
      .ai-quick-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:16px; }
      .ai-quick-box { background:var(--surface2, #16202f); border:1px solid var(--border, #1e293b); border-radius:var(--radius, 10px); padding:14px 16px; }
      .ai-quick-label { font-size:12px; color:var(--text3, #64748b); margin-bottom:6px; }
      .ai-quick-value { font-size:20px; font-weight:800; color:var(--text, #e2e8f0); margin-bottom:4px; }
      .ai-tips-list { display:flex; flex-direction:column; gap:8px; }
      .ai-tip { display:flex; align-items:flex-start; gap:10px; padding:10px 14px; border-radius:var(--radius, 10px); font-size:13px; line-height:1.6; background:var(--surface2, #16202f); border:1px solid var(--border, #1e293b); }
      .ai-tip i { margin-top:2px; }
      .ai-tip-good { border-color:#10b98140; }
      .ai-tip-good i { color:var(--accent, #10b981); }
      .ai-tip-warn { border-color:#f59e0b40; }
      .ai-tip-warn i { color:#f59e0b; }
      .ai-tip-info { border-color:#3b82f640; }
      .ai-tip-info i { color:#3b82f6; }
      .ai-forecast-total { display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:20px; font-weight:800; color:var(--text, #e2e8f0); margin-bottom:14px; }
      .ai-forecast-total small { font-size:12px; font-weight:400; color:var(--text3, #64748b); }
      .ai-bars { display:flex; align-items:flex-end; gap:10px; height:120px; padding-top:10px; }
      .ai-bar-col { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:flex-end; height:100%; gap:6px; }
      .ai-bar { width:100%; max-width:34px; border-radius:6px 6px 0 0; background:linear-gradient(180deg,var(--accent,#10b981),#10b98155); }
      .ai-bar-label { font-size:11px; color:var(--text3, #64748b); }
    `;
    document.head.appendChild(style);
  }

  // ─── الاعتراض الآمن على navigateTo (بدون تعديل script.js إطلاقاً) ─────────
  function hookNavigation() {
    if (typeof window.navigateTo !== 'function' || window.navigateTo.__dakaniAIWrapped) return;
    const original = window.navigateTo;
    function wrapped(page) {
      original(page);
      try {
        if (page === 'dashboard') renderDashboardWidget();
        else if (page === 'reports') renderReportsWidget();
      } catch (e) {
        // لا نكسر التنقل العادي إطلاقاً إن فشل حساب أي توصية لأي سبب
        console.error('DakaniAI render error:', e);
      }
    }
    wrapped.__dakaniAIWrapped = true;
    window.navigateTo = wrapped;
  }

  function init() {
    injectStyles();
    hookNavigation();
    // إن كانت إحدى الصفحتين مفتوحة بالفعل لحظة تحميل هذا الملف (تنقّل سابق)، ارسمها فوراً
    try {
      if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboardWidget();
      if (document.getElementById('page-reports')?.classList.contains('active')) renderReportsWidget();
    } catch (e) {}
  }

  // إعادة الرسم تلقائياً عند تبديل اللغة حتى تُحدَّث الأرقام والتواريخ فوراً
  document.addEventListener('dakani-lang-changed', () => {
    try {
      if (document.getElementById('page-dashboard')?.classList.contains('active')) renderDashboardWidget();
      if (document.getElementById('page-reports')?.classList.contains('active')) renderReportsWidget();
    } catch (e) {}
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.DakaniAI = {
    render: () => { renderDashboardWidget(); renderReportsWidget(); },
    goToFullInsights,
    // مفيد للتشخيص اليدوي عند الحاجة فقط
    _debug: { computeForecast, computeReorderSuggestions, computeDeadStockPromotions, computeTips }
  };

})();