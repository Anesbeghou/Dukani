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

  // ─── مساعد الأسئلة متعدد اللغات (عربي / English / Français / Español / 中文) ──────────
  // قواعد كلمات مفتاحية (وليست نموذج لغة): يفهم السؤال بأي لغة من الخمس ويجيب بلغة السؤال.
  const MSG = {
    ar: { example: 'مثال: كم ربحت هذا الشهر؟', empty: 'اكتب سؤالك، مثلاً: «كم ربحت هذا الشهر؟»',
      unknown: 'لم أفهم سؤالك. جرّب: مبيعات اليوم؟ / كم ربحت هذا الشهر؟ / ما الديون؟ / من أفضل زبون؟ / أفضل منتج؟ / أفضل موظف؟ / توقع الأسبوع القادم؟ / قيمة المخزون؟',
      per: { today: 'اليوم', yesterday: 'أمس', week: 'آخر 7 أيام', month: 'هذا الشهر', lastmonth: 'الشهر الماضي', year: 'هذه السنة' },
      forecastNo: 'البيانات غير كافية للتوقع بعد (أحتاج 5 أيام بيع على الأقل).',
      forecast: (o) => `المتوقع خلال 7 أيام: مبيعات ≈ ${o.sales} ${o.c} (بين ${o.lo} و${o.hi}) وربح ≈ ${o.profit} ${o.c}.`,
      debts: (o) => `ديون الزبائن: ${o.cd} ${o.c} (${o.cn} زبون). ديون الموردين علينا: ${o.sd} ${o.c} (${o.sn} مورد).`,
      profit: (o) => `${o.p}: الربح المحقَّق ${o.profit} ${o.c}، وصافي النتيجة بعد المصاريف والخسائر ${o.net} ${o.c}. (ربح معلَّق على الديون: ${o.pend} ${o.c})`,
      expenses: (o) => `${o.p}: المصاريف ${o.v} ${o.c}.`,
      returns: (o) => `${o.p}: ${o.n} مرتجع بقيمة ${o.v} ${o.c} (ربح ضائع ${o.lost} ${o.c}).`,
      bestCust: (o) => `أفضل زبون ${o.p}: ${o.name} بمشتريات ${o.v} ${o.c} في ${o.n} فاتورة.`, noCust: 'لا توجد مبيعات لزبائن مسجَّلين في هذه الفترة.',
      bestProd: (o) => `الأكثر مبيعاً ${o.p}: ${o.name} (${o.q} وحدة، ${o.v} ${o.c}).`, noSales: 'لا مبيعات في هذه الفترة.',
      bestEmp: (o) => `أفضل بائع ${o.p}: ${o.name} بمبيعات صافية ${o.v} ${o.c} في ${o.n} فاتورة.`,
      stock: (o) => `قيمة المخزون بسعر الشراء ${o.cost} ${o.c} وبسعر البيع ${o.sell} ${o.c} (ربح كامن ${o.pot} ${o.c}).`,
      sales: (o) => `${o.p}: المبيعات الصافية ${o.net} ${o.c} (إجمالي ${o.gross} − مرتجعات ${o.ret}) في ${o.n} فاتورة، وتكلفتها ${o.cost} ${o.c}.` },
    en: { example: 'Example: How much profit did I make this month?', empty: 'Type your question, e.g. "How much profit did I make this month?"',
      unknown: "I didn't understand. Try: today's sales? / profit this month? / what are the debts? / best customer? / best product? / best employee? / forecast next week? / stock value?",
      per: { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'This month', lastmonth: 'Last month', year: 'This year' },
      forecastNo: 'Not enough data to forecast yet (I need at least 5 days of sales).',
      forecast: (o) => `Expected over the next 7 days: sales ≈ ${o.sales} ${o.c} (range ${o.lo} – ${o.hi}) and profit ≈ ${o.profit} ${o.c}.`,
      debts: (o) => `Customer debts: ${o.cd} ${o.c} (${o.cn} customers). Supplier debts we owe: ${o.sd} ${o.c} (${o.sn} suppliers).`,
      profit: (o) => `${o.p}: realized profit ${o.profit} ${o.c}; net result after expenses and losses ${o.net} ${o.c}. (Pending profit on debts: ${o.pend} ${o.c})`,
      expenses: (o) => `${o.p}: expenses ${o.v} ${o.c}.`,
      returns: (o) => `${o.p}: ${o.n} returns worth ${o.v} ${o.c} (lost profit ${o.lost} ${o.c}).`,
      bestCust: (o) => `Best customer (${o.p}): ${o.name} with purchases of ${o.v} ${o.c} across ${o.n} invoices.`, noCust: 'No sales to registered customers in this period.',
      bestProd: (o) => `Best seller (${o.p}): ${o.name} (${o.q} units, ${o.v} ${o.c}).`, noSales: 'No sales in this period.',
      bestEmp: (o) => `Best salesperson (${o.p}): ${o.name} with net sales of ${o.v} ${o.c} across ${o.n} invoices.`,
      stock: (o) => `Stock value at cost ${o.cost} ${o.c} and at selling price ${o.sell} ${o.c} (potential profit ${o.pot} ${o.c}).`,
      sales: (o) => `${o.p}: net sales ${o.net} ${o.c} (gross ${o.gross} − returns ${o.ret}) across ${o.n} invoices, costing ${o.cost} ${o.c}.` },
    fr: { example: 'Exemple : Combien ai-je gagné ce mois-ci ?', empty: 'Écrivez votre question, par ex. « Combien ai-je gagné ce mois-ci ? »',
      unknown: "Je n'ai pas compris. Essayez : ventes du jour ? / bénéfice du mois ? / quelles sont les dettes ? / meilleur client ? / meilleur produit ? / meilleur employé ? / prévision de la semaine prochaine ? / valeur du stock ?",
      per: { today: "Aujourd'hui", yesterday: 'Hier', week: '7 derniers jours', month: 'Ce mois-ci', lastmonth: 'Le mois dernier', year: 'Cette année' },
      forecastNo: "Données insuffisantes pour prévoir (il faut au moins 5 jours de ventes).",
      forecast: (o) => `Prévu sur les 7 prochains jours : ventes ≈ ${o.sales} ${o.c} (entre ${o.lo} et ${o.hi}) et bénéfice ≈ ${o.profit} ${o.c}.`,
      debts: (o) => `Dettes des clients : ${o.cd} ${o.c} (${o.cn} clients). Dettes envers les fournisseurs : ${o.sd} ${o.c} (${o.sn} fournisseurs).`,
      profit: (o) => `${o.p} : bénéfice réalisé ${o.profit} ${o.c} ; résultat net après dépenses et pertes ${o.net} ${o.c}. (Bénéfice en attente sur les dettes : ${o.pend} ${o.c})`,
      expenses: (o) => `${o.p} : dépenses ${o.v} ${o.c}.`,
      returns: (o) => `${o.p} : ${o.n} retours d'une valeur de ${o.v} ${o.c} (bénéfice perdu ${o.lost} ${o.c}).`,
      bestCust: (o) => `Meilleur client (${o.p}) : ${o.name} avec ${o.v} ${o.c} d'achats sur ${o.n} factures.`, noCust: 'Aucune vente à des clients enregistrés sur cette période.',
      bestProd: (o) => `Meilleure vente (${o.p}) : ${o.name} (${o.q} unités, ${o.v} ${o.c}).`, noSales: 'Aucune vente sur cette période.',
      bestEmp: (o) => `Meilleur vendeur (${o.p}) : ${o.name} avec ${o.v} ${o.c} de ventes nettes sur ${o.n} factures.`,
      stock: (o) => `Valeur du stock au prix d'achat ${o.cost} ${o.c} et au prix de vente ${o.sell} ${o.c} (bénéfice potentiel ${o.pot} ${o.c}).`,
      sales: (o) => `${o.p} : ventes nettes ${o.net} ${o.c} (brut ${o.gross} − retours ${o.ret}) sur ${o.n} factures, pour un coût de ${o.cost} ${o.c}.` },
    es: { example: 'Ejemplo: ¿Cuánto gané este mes?', empty: 'Escribe tu pregunta, por ejemplo «¿Cuánto gané este mes?»',
      unknown: 'No entendí. Prueba: ¿ventas de hoy? / ¿ganancia de este mes? / ¿cuáles son las deudas? / ¿mejor cliente? / ¿mejor producto? / ¿mejor empleado? / ¿pronóstico de la próxima semana? / ¿valor del inventario?',
      per: { today: 'Hoy', yesterday: 'Ayer', week: 'Últimos 7 días', month: 'Este mes', lastmonth: 'El mes pasado', year: 'Este año' },
      forecastNo: 'No hay datos suficientes para pronosticar (necesito al menos 5 días de ventas).',
      forecast: (o) => `Previsto para los próximos 7 días: ventas ≈ ${o.sales} ${o.c} (entre ${o.lo} y ${o.hi}) y ganancia ≈ ${o.profit} ${o.c}.`,
      debts: (o) => `Deudas de clientes: ${o.cd} ${o.c} (${o.cn} clientes). Deudas con proveedores: ${o.sd} ${o.c} (${o.sn} proveedores).`,
      profit: (o) => `${o.p}: ganancia realizada ${o.profit} ${o.c}; resultado neto tras gastos y pérdidas ${o.net} ${o.c}. (Ganancia pendiente en deudas: ${o.pend} ${o.c})`,
      expenses: (o) => `${o.p}: gastos ${o.v} ${o.c}.`,
      returns: (o) => `${o.p}: ${o.n} devoluciones por ${o.v} ${o.c} (ganancia perdida ${o.lost} ${o.c}).`,
      bestCust: (o) => `Mejor cliente (${o.p}): ${o.name} con compras de ${o.v} ${o.c} en ${o.n} facturas.`, noCust: 'No hay ventas a clientes registrados en este período.',
      bestProd: (o) => `Más vendido (${o.p}): ${o.name} (${o.q} unidades, ${o.v} ${o.c}).`, noSales: 'No hay ventas en este período.',
      bestEmp: (o) => `Mejor vendedor (${o.p}): ${o.name} con ventas netas de ${o.v} ${o.c} en ${o.n} facturas.`,
      stock: (o) => `Valor del inventario a precio de compra ${o.cost} ${o.c} y a precio de venta ${o.sell} ${o.c} (ganancia potencial ${o.pot} ${o.c}).`,
      sales: (o) => `${o.p}: ventas netas ${o.net} ${o.c} (bruto ${o.gross} − devoluciones ${o.ret}) en ${o.n} facturas, con un costo de ${o.cost} ${o.c}.` },
    zh: { example: '例如：这个月我赚了多少钱？', empty: '请输入问题，例如“这个月我赚了多少钱？”',
      unknown: '我没听懂。可以试试：今天的销售？/ 本月利润？/ 欠款有多少？/ 最佳客户？/ 最畅销产品？/ 最佳员工？/ 下周预测？/ 库存价值？',
      per: { today: '今天', yesterday: '昨天', week: '最近7天', month: '本月', lastmonth: '上个月', year: '今年' },
      forecastNo: '数据不足，暂时无法预测（至少需要5天的销售记录）。',
      forecast: (o) => `未来7天预计：销售额约 ${o.sales} ${o.c}（区间 ${o.lo}–${o.hi}），利润约 ${o.profit} ${o.c}。`,
      debts: (o) => `客户欠款：${o.cd} ${o.c}（${o.cn} 位客户）。我们欠供应商：${o.sd} ${o.c}（${o.sn} 家供应商）。`,
      profit: (o) => `${o.p}：已实现利润 ${o.profit} ${o.c}；扣除支出与损失后的净结果 ${o.net} ${o.c}。（赊账中的待实现利润：${o.pend} ${o.c}）`,
      expenses: (o) => `${o.p}：支出 ${o.v} ${o.c}。`,
      returns: (o) => `${o.p}：${o.n} 笔退货，金额 ${o.v} ${o.c}（损失利润 ${o.lost} ${o.c}）。`,
      bestCust: (o) => `最佳客户（${o.p}）：${o.name}，共 ${o.n} 张发票，消费 ${o.v} ${o.c}。`, noCust: '该时间段内没有登记客户的销售记录。',
      bestProd: (o) => `最畅销（${o.p}）：${o.name}（${o.q} 件，${o.v} ${o.c}）。`, noSales: '该时间段内没有销售。',
      bestEmp: (o) => `最佳销售员（${o.p}）：${o.name}，净销售额 ${o.v} ${o.c}，共 ${o.n} 张发票。`,
      stock: (o) => `库存价值：按采购价 ${o.cost} ${o.c}，按销售价 ${o.sell} ${o.c}（潜在利润 ${o.pot} ${o.c}）。`,
      sales: (o) => `${o.p}：净销售额 ${o.net} ${o.c}（总额 ${o.gross} − 退货 ${o.ret}），共 ${o.n} 张发票，成本 ${o.cost} ${o.c}。` }
  };
  const KW = {
    forecast: ['توقع', 'متوقع', 'القادم', 'forecast', 'predict', 'next week', 'expect', 'prevision', 'prevoir', 'prochain', 'pronostico', 'prediccion', 'proxima', '预测', '预计', '下周', '未来'],
    emp:      ['موظف', 'بائع', 'كاشير', 'employee', 'staff', 'salesperson', 'cashier', 'employe', 'vendeur', 'caissier', 'empleado', 'vendedor', 'cajero', '员工', '销售员', '收银'],
    cust:     ['زبون', 'عميل', 'customer', 'client', 'cliente', '客户', '顾客'],
    prod:     ['أفضل منتج', 'افضل منتج', 'الأكثر مبيع', 'الاكثر مبيع', 'منتج', 'best product', 'best seller', 'best-selling', 'top product', 'best selling', 'produit', 'plus vendu', 'producto', 'mas vendido', '畅销', '产品', '商品'],
    debts:    ['دين', 'ديون', 'مدين', 'debt', 'owe', 'credit', 'dette', 'creance', 'deuda', 'fiado', 'adeuda', '欠款', '债务', '赊账', '欠'],
    profit:   ['ربح', 'أرباح', 'ارباح', 'ربحت', 'profit', 'earn', 'made', 'benefice', 'gagne', 'ganancia', 'gane', 'beneficio', 'utilidad', '利润', '赚', '盈利'],
    expenses: ['مصروف', 'مصاريف', 'expense', 'spent', 'spend', 'depense', 'gasto', '支出', '费用', '开销'],
    returns:  ['مرتجع', 'return', 'refund', 'retour', 'remboursement', 'devolucion', 'reembolso', '退货', '退款'],
    stock:    ['مخزون', 'بضاعة', 'inventory', 'stock', 'inventaire', 'inventario', 'existencias', '库存'],
    sales:    ['مبيعات', 'بعت', 'مبيع', 'sales', 'sold', 'revenue', 'ventes', 'vendu', "chiffre d'affaires", 'ventas', 'vendi', 'ingresos', '销售', '卖', '营业额']
  };
  const PER = [
    ['lastmonth', ['الشهر الماضي', 'last month', 'mois dernier', 'mes pasado', 'dernier mois', '上个月', '上月']],
    ['yesterday', ['أمس', 'امس', 'yesterday', 'hier', 'ayer', '昨天']],
    ['today',     ['اليوم', 'today', "aujourd", 'hoy', '今天']],
    ['week',      ['أسبوع', 'اسبوع', 'week', 'semaine', 'semana', '周', '星期', '本周']],
    ['year',      ['سنة', 'عام', 'year', 'annee', 'an ', 'ano', '年', '今年']]
  ];
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasAny = (q, list) => list.some(w => q.includes(norm(w)));

  function detectLang(raw) {
    if (/[\u4e00-\u9fff]/.test(raw)) return 'zh';
    if (/[\u0600-\u06FF]/.test(raw)) return 'ar';
    const q = ' ' + norm(raw) + ' ';
    const score = { en: 0, fr: 0, es: 0 };
    ['how much', 'what', ' my ', 'this month', 'today', 'profit', 'debts', 'best ', 'who ', 'sales', 'forecast'].forEach(w => { if (q.includes(w)) score.en++; });
    ['combien', 'quel', ' mon ', ' ma ', 'ce mois', "aujourd", 'benefice', 'dette', 'meilleur', 'ventes', 'prevision', ' est ', ' les '].forEach(w => { if (q.includes(w)) score.fr++; });
    ['cuanto', 'cual', ' mi ', 'este mes', ' hoy', 'ganancia', 'deuda', 'mejor ', 'ventas', 'pronostico', ' el ', ' los '].forEach(w => { if (q.includes(w)) score.es++; });
    const best = Object.keys(score).sort((a, b) => score[b] - score[a])[0];
    if (score[best] > 0) return best;
    const ui = (typeof DakaniI18n !== 'undefined' && DakaniI18n.getLang()) || 'ar';
    return MSG[ui] ? ui : 'en';
  }
  function uiMsg() { const ui = (typeof DakaniI18n !== 'undefined' && DakaniI18n.getLang()) || 'ar'; return MSG[ui] || MSG.ar; }

  function answer(raw) {
    const s = String(raw || '').trim();
    if (!s) return uiMsg().empty;
    const L = detectLang(s), M = MSG[L], q = norm(s), c = cur();
    let key = 'month';
    for (const [k, words] of PER) { if (hasAny(q, words)) { key = k; break; } }
    const range = DakaniFin.preset(key), p = M.per[key];
    const F = DakaniFin.compute(range.from, range.to);
    const v = n => f(n);
    if (hasAny(q, KW.forecast)) {
      const fc = forecast(7, 60);
      return fc ? M.forecast({ sales: v(fc.sales), lo: v(fc.lo), hi: v(fc.hi), profit: v(fc.profit), c }) : M.forecastNo;
    }
    // الأسئلة "الأفضل": نتحقق من (أفضل/best/meilleur/mejor/最) مع نوع الكيان
    const isBest = /افضل|أفضل|best|top|meilleur|mejor|最|plus vendu|mas vendido|الاكثر|الأكثر/.test(s.toLowerCase()) || /افضل|best|top|meilleur|mejor/.test(q);
    if (isBest && hasAny(q, KW.emp)) {
      const b = Object.values(F.bySeller).sort((a, b) => (b.gross - b.returns) - (a.gross - a.returns))[0];
      return b ? M.bestEmp({ p, name: b.name, v: v(b.gross - b.returns), n: b.count, c }) : M.noSales;
    }
    if (isBest && hasAny(q, KW.cust)) {
      const b = Object.values(F.byCustomer).filter(x => x.id).sort((a, b) => b.total - a.total)[0];
      return b ? M.bestCust({ p, name: b.name, v: v(b.total), n: b.count, c }) : M.noCust;
    }
    if (isBest && (hasAny(q, KW.prod) || !hasAny(q, KW.cust))) {
      const b = Object.values(F.byProduct).sort((a, b) => b.revenue - a.revenue)[0];
      return b ? M.bestProd({ p, name: b.name, q: v(b.qty), v: v(b.revenue), c }) : M.noSales;
    }
    if (hasAny(q, KW.debts)) return M.debts({ cd: v(F.debts.customers), cn: F.debts.customersCount, sd: v(F.debts.suppliers), sn: F.debts.suppliersCount, c });
    if (hasAny(q, KW.profit)) return M.profit({ p, profit: v(F.profitRealized), net: v(F.netResult), pend: v(F.debts.pendingProfit), c });
    if (hasAny(q, KW.expenses)) return M.expenses({ p, v: v(F.expenses.total), c });
    if (hasAny(q, KW.returns)) return M.returns({ p, n: F.returns.count, v: v(F.returns.total), lost: v(F.returns.profitLost), c });
    if (hasAny(q, KW.stock)) { const iv = DakaniFin.inventoryValue(); return M.stock({ cost: v(iv.cost), sell: v(iv.sell), pot: v(iv.potential), c }); }
    if (hasAny(q, KW.sales)) return M.sales({ p, net: v(F.netSales), gross: v(F.sales.gross), ret: v(F.returns.total), n: F.sales.count, cost: v(F.netCost), c });
    return M.unknown;
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
        <div style="display:flex;gap:8px"><input type="text" id="ai-q" placeholder="${esc(uiMsg().example)}" style="flex:1" onkeydown="if(event.key==='Enter')DakaniAIAdv.ask()"/>
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