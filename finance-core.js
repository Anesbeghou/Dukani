/**
 * DAKANI FINANCE CORE — المحرّك المحاسبي المركزي
 * ─────────────────────────────────────────────────────────────
 * ملف مستقل (قراءة فقط من DB و DakaniCashbox — لا يكتب أي بيانات إطلاقاً).
 * هدفه: مصدر واحد للحقيقة لكل الأرقام في لوحة التحكم والتقارير والذكاء
 * الاصطناعي وأداء الموظفين، حتى لا يختلف رقم بين صفحة وأخرى.
 *
 * قواعد الحساب (مصفّاة):
 *   • المبيعات (بسعر البيع)  = مجموع الفواتير − المرتجعات
 *   • المبيعات (بسعر الشراء) = تكلفة البضاعة المباعة − تكلفة البضاعة المُرتجعة
 *   • الربح المحقَّق          = ربح المبيعات النقدية + ربح الديون المُحصَّلة − ربح المرتجعات النقدية
 *   • الربح المعلَّق          = ربح الجزء الآجل الذي لم يُسدَّد بعد (لا يُحسب ربحاً محقَّقاً)
 *   • بنود بلا سعر شراء بعد (أضافها موظف) تُحسب في المبيعات لكن لا يُحسب لها ربح
 *     حتى يُدخل المدير سعر الشراء، فتُعاد الأرباح تلقائياً (انظر database.js).
 *   • صافي النتيجة = الربح المحقَّق + إيرادات أخرى − المصاريف − خسائر المخزون
 *
 * الاستخدام:  DakaniFin.compute('2026-10-01', '2026-10-31')
 */
(function (global) {

  const num = v => (typeof v === 'number' && isFinite(v)) ? v : (parseFloat(v) || 0);
  const day = d => (d || '').slice(0, 10);
  const r2  = v => Math.round(num(v) * 100) / 100;

  function today() { return new Date().toISOString().slice(0, 10); }
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }

  function _cb() { return (typeof DakaniCashbox !== 'undefined') ? DakaniCashbox : null; }

  // ─── مساعدات المرتجعات (متوافقة مع المرتجعات القديمة التي لا تحمل حقول التكلفة) ───
  function returnCost(r) {
    if (typeof r.cost === 'number') return r.cost;
    return (r.items || []).reduce((a, it) => {
      const p = DB.Products.byId(it.productId);
      const bp = typeof it.buyPrice === 'number' ? it.buyPrice : (p ? DB.Products.effectiveBuyPrice(p, it.variantId) : 0);
      return a + bp * num(it.qty);
    }, 0);
  }
  function returnCreditPart(r) {
    // الجزء الآجل من المرتجع (المسجَّل أو المستنتج من الفاتورة الأصلية للمرتجعات القديمة)
    if (typeof r.creditRefund === 'number') return { refund: r.creditRefund, cost: num(r.creditCost) };
    const sale = r.saleId ? DB.Sales.byId(r.saleId) : null;
    if (sale && sale.paymentMethod === 'credit') return { refund: num(r.totalRefund), cost: returnCost(r) };
    return { refund: 0, cost: 0 };
  }

  // ─── الحساب الرئيسي لفترة ─────────────────────────────────────────────────────
  function compute(from, to) {
    from = from || '0000-00-00'; to = to || '9999-12-31';
    const inR = d => { const x = day(d); return x >= from && x <= to; };

    const allSales = DB.Sales.all();
    const sales = allSales.filter(s => inR(s.date));
    const rets  = DB.Returns.all().filter(r => inR(r.date));
    const debtPays = DB.DebtPayments.all().filter(p => inR(p.date));
    const suppPays = DB.SupplierPayments.all().filter(p => inR(p.date));
    const purchases = DB.Purchases.all().filter(p => inR(p.date || p.createdAt));
    const adjs = DB.StockAdjustments.all().filter(a => inR(a.date));
    const cb = _cb();
    const expenses = cb ? cb.Expenses.all().filter(e => inR(e.date)) : [];
    const incomes  = cb ? cb.OtherIncome.all().filter(e => inR(e.date)) : [];

    const out = {
      from, to,
      sales: { count: sales.length, gross: 0, subtotal: 0, discount: 0, cash: 0, card: 0, credit: 0, itemsQty: 0, avgBasket: 0 },
      returns: { count: rets.length, total: 0, cost: 0, profitLost: 0, profitLostCash: 0 },
      costGross: 0,           // تكلفة البضاعة المباعة (بدون بنود التكلفة المعلَّقة)
      pendingCostRevenue: 0,  // إيراد بنود بلا سعر شراء بعد
      pendingCostSales: 0,    // عدد الفواتير المتأثرة
      profitGross: 0,         // ربح كل الفواتير (نقدي + آجل) قبل المرتجعات
      profitCashSales: 0,     // الجزء النقدي (محقَّق)
      profitCredit: 0,        // ربح الجزء الآجل المسجَّل في الفترة (معلَّق)
      profitDebtCollected: 0, // ربح الديون المُحصَّلة في الفترة
      expenses: { total: 0, byCat: {} },
      income: { total: 0, byCat: {} },
      losses: { total: 0, byReason: {}, expiry: 0 },
      purchases: { total: 0, count: purchases.length, credit: 0, cash: 0 },
      debts: { customers: 0, customersCount: 0, pendingProfit: 0, suppliers: 0, suppliersCount: 0,
               collected: 0, suppPaid: 0, newCredit: 0 },
      byPayment: {}, byCategory: {}, byHour: new Array(24).fill(0), byWeekday: new Array(7).fill(0),
      byProduct: {}, byCustomer: {}, bySeller: {}
    };

    // المبيعات
    const catOf = pid => { const p = DB.Products.byId(pid); return (p && p.category) || 'غير مصنّف'; };
    sales.forEach(s => {
      const k = 1 - num(s.discount) / 100;
      out.sales.gross += num(s.total);
      out.sales.subtotal += num(s.subtotal);
      out.sales.discount += num(s.subtotal) - num(s.total);
      out.sales.credit += num(s.creditAmount != null ? s.creditAmount : (s.paymentMethod === 'credit' ? s.total : 0));
      const cashPart = num(s.cashAmount != null ? s.cashAmount : (s.paymentMethod === 'credit' ? 0 : s.total));
      if (s.paymentMethod === 'card') out.sales.card += cashPart; else out.sales.cash += cashPart;
      out.profitGross += num(s.profit);
      out.profitCashSales += DB.Sales.netProfit(s);
      out.profitCredit += num(s.creditProfit);
      let pend = false;
      (s.items || []).forEach(it => {
        const qty = num(it.qty);
        out.sales.itemsQty += qty;
        if (it.costPending) { pend = true; out.pendingCostRevenue += num(it.total) * k; }
        else out.costGross += num(it.buyPrice) * qty;
        const rev = num(it.total) * k;
        const cat = catOf(it.productId);
        out.byCategory[cat] = (out.byCategory[cat] || 0) + rev;
        const pk = it.productId + (it.variantId ? '#' + it.variantId : '');
        const bp = out.byProduct[pk] || (out.byProduct[pk] = { productId: it.productId, name: it.nameAr, qty: 0, revenue: 0, cost: 0, profit: 0 });
        bp.qty += qty; bp.revenue += rev;
        if (!it.costPending) { bp.cost += num(it.buyPrice) * qty; bp.profit += rev - num(it.buyPrice) * qty; }
      });
      if (pend) out.pendingCostSales++;
      const pm = s.paymentMethod || 'cash';
      out.byPayment[pm] = (out.byPayment[pm] || 0) + num(s.total);
      const dt = new Date(s.date);
      if (!isNaN(dt)) { out.byHour[dt.getHours()] += num(s.total); out.byWeekday[dt.getDay()] += num(s.total); }
      const ck = s.customerId || 'walkin';
      const bc = out.byCustomer[ck] || (out.byCustomer[ck] = { id: s.customerId, name: s.customerName || 'زبون عام', total: 0, count: 0, profit: 0 });
      bc.total += num(s.total); bc.count++; bc.profit += DB.Sales.netProfit(s);
      const sk = s.sellerId || (s.sellerName ? 'n:' + s.sellerName : 'unknown');
      const bs = out.bySeller[sk] || (out.bySeller[sk] = { id: s.sellerId || null, name: s.sellerName || 'غير محدد', role: s.sellerRole || '',
        count: 0, gross: 0, profit: 0, items: 0, returns: 0, returnsCount: 0, credit: 0, discount: 0, firstDate: s.date, lastDate: s.date });
      bs.count++; bs.gross += num(s.total); bs.profit += DB.Sales.netProfit(s) + num(s.creditProfit);
      bs.items += (s.items || []).reduce((a, it) => a + num(it.qty), 0);
      bs.credit += num(s.creditAmount); bs.discount += num(s.subtotal) - num(s.total);
      if (s.date < bs.firstDate) bs.firstDate = s.date; if (s.date > bs.lastDate) bs.lastDate = s.date;
    });
    out.sales.avgBasket = sales.length ? out.sales.gross / sales.length : 0;

    // المرتجعات
    rets.forEach(r => {
      const refund = num(r.totalRefund), cost = returnCost(r), cr = returnCreditPart(r);
      out.returns.total += refund; out.returns.cost += cost;
      const lost = refund - cost;
      out.returns.profitLost += lost;
      out.returns.profitLostCash += lost - (cr.refund - cr.cost);
      const sale = r.saleId ? DB.Sales.byId(r.saleId) : null;
      const sk = (sale && (sale.sellerId || (sale.sellerName ? 'n:' + sale.sellerName : null))) || 'unknown';
      if (out.bySeller[sk]) { out.bySeller[sk].returns += refund; out.bySeller[sk].returnsCount++; out.bySeller[sk].profit -= lost; }
    });

    // المبيعات الصافية
    out.netSales = out.sales.gross - out.returns.total;                // بسعر البيع
    out.netCost  = out.costGross - out.returns.cost;                   // بسعر الشراء
    out.profitRealized = out.profitCashSales + 0; // يُكمَّل أدناه
    // الديون
    debtPays.forEach(p => { out.debts.collected += num(p.amount); out.profitDebtCollected += num(p.profit); });
    suppPays.forEach(p => { out.debts.suppPaid += num(p.amount); });
    out.debts.newCredit = out.sales.credit;
    DB.Customers.all().forEach(c => { const d = num(c.debt); if (d > 0) { out.debts.customers += d; out.debts.customersCount++; } out.debts.pendingProfit += num(c.debtProfit); });
    DB.Suppliers.all().forEach(s => { const b = num(s.balance); if (b > 0) { out.debts.suppliers += b; out.debts.suppliersCount++; } });

    out.profitRealized = out.profitCashSales + out.profitDebtCollected - out.returns.profitLostCash;
    out.profitAccrual  = out.profitGross - out.returns.profitLost;       // ربح الاستحقاق (يشمل الآجل)

    // المشتريات
    purchases.forEach(p => {
      const t = num(p.qty) * num(p.unitPrice);
      const cr = (typeof DB.Purchases.creditPortion === 'function') ? DB.Purchases.creditPortion(p) : 0;
      out.purchases.total += t; out.purchases.credit += cr; out.purchases.cash += t - cr;
    });

    // المصاريف والإيرادات
    expenses.forEach(e => { out.expenses.total += num(e.amount); out.expenses.byCat[e.category] = (out.expenses.byCat[e.category] || 0) + num(e.amount); });
    incomes.forEach(e => { out.income.total += num(e.amount); out.income.byCat[e.category] = (out.income.byCat[e.category] || 0) + num(e.amount); });

    // خسائر المخزون (تسويات الجرد: تلف/فقدان/انتهاء صلاحية...)
    adjs.forEach(a => {
      const c = num(a.costImpact);
      if (c > 0) {
        out.losses.total += c;
        const rs = a.reason || 'أخرى';
        out.losses.byReason[rs] = (out.losses.byReason[rs] || 0) + c;
        if (rs === 'انتهاء الصلاحية') out.losses.expiry += c;
      }
    });

    // مقاييس مشتقة
    out.margins = {
      // الهامش على سعر البيع = الربح ÷ المبيعات | الزيادة على التكلفة = الربح ÷ التكلفة
      onSell: (out.netSales - out.pendingCostRevenue) > 0 ? out.profitAccrual / (out.netSales - out.pendingCostRevenue) * 100 : 0,
      onCost: out.netCost > 0 ? out.profitAccrual / out.netCost * 100 : 0
    };
    out.netResult = out.profitRealized + out.income.total - out.expenses.total - out.losses.total;
    out.netResultAccrual = out.profitAccrual + out.income.total - out.expenses.total - out.losses.total;
    // تقريب نهائي لأرقام العرض الرئيسية
    ['netSales', 'netCost', 'profitRealized', 'profitAccrual', 'netResult', 'netResultAccrual'].forEach(k => { out[k] = r2(out[k]); });
    return out;
  }

  // ─── السلاسل الزمنية للمخططات ───────────────────────────────────────────────
  function series(from, to) {
    const span = daysBetween(from, to) + 1;
    const monthly = span > 92;
    const keyOf = d => monthly ? day(d).slice(0, 7) : day(d);
    const keys = [];
    if (monthly) {
      let cur = from.slice(0, 7);
      const end = to.slice(0, 7);
      while (cur <= end) { keys.push(cur); const [y, m] = cur.split('-').map(Number); cur = (m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0')); }
    } else {
      for (let i = 0; i < span; i++) keys.push(addDays(from, i));
    }
    const idx = {}; keys.forEach((k, i) => { idx[k] = i; });
    const z = () => keys.map(() => 0);
    const S = { keys, monthly,
      sales: z(), returns: z(), net: z(), cost: z(), profit: z(), profitRealized: z(),
      expenses: z(), income: z(), purchases: z(), newCredit: z(), collected: z(), losses: z(), invoices: z(), result: z() };
    const put = (arr, d, v) => { const i = idx[keyOf(d)]; if (i !== undefined) arr[i] += v; };
    const inR = d => { const x = day(d); return x >= from && x <= to; };

    DB.Sales.all().forEach(s => {
      if (!inR(s.date)) return;
      put(S.sales, s.date, num(s.total)); put(S.invoices, s.date, 1);
      put(S.profit, s.date, num(s.profit));
      put(S.profitRealized, s.date, DB.Sales.netProfit(s));
      put(S.newCredit, s.date, num(s.creditAmount));
      (s.items || []).forEach(it => { if (!it.costPending) put(S.cost, s.date, num(it.buyPrice) * num(it.qty)); });
    });
    DB.Returns.all().forEach(r => {
      if (!inR(r.date)) return;
      const refund = num(r.totalRefund), cost = returnCost(r), cr = returnCreditPart(r);
      put(S.returns, r.date, refund);
      put(S.cost, r.date, -cost);
      put(S.profit, r.date, -(refund - cost));
      put(S.profitRealized, r.date, -((refund - cost) - (cr.refund - cr.cost)));
    });
    DB.DebtPayments.all().forEach(p => { if (inR(p.date)) { put(S.collected, p.date, num(p.amount)); put(S.profitRealized, p.date, num(p.profit)); } });
    DB.Purchases.all().forEach(p => { const d = p.date || p.createdAt; if (inR(d)) put(S.purchases, d, num(p.qty) * num(p.unitPrice)); });
    DB.StockAdjustments.all().forEach(a => { if (inR(a.date) && num(a.costImpact) > 0) put(S.losses, a.date, num(a.costImpact)); });
    const cb = _cb();
    if (cb) {
      cb.Expenses.all().forEach(e => { if (inR(e.date)) put(S.expenses, e.date, num(e.amount)); });
      cb.OtherIncome.all().forEach(e => { if (inR(e.date)) put(S.income, e.date, num(e.amount)); });
    }
    keys.forEach((k, i) => {
      S.net[i] = S.sales[i] - S.returns[i];
      S.result[i] = S.profitRealized[i] + S.income[i] - S.expenses[i] - S.losses[i];
    });
    ['sales','returns','net','cost','profit','profitRealized','expenses','income','purchases','newCredit','collected','losses','result']
      .forEach(k => { S[k] = S[k].map(r2); });
    return S;
  }

  // ─── قيمة المخزون (لقطة حالية) ───────────────────────────────────────────────
  function inventoryValue() {
    let cost = 0, sell = 0, units = 0, pendingCost = 0;
    DB.Products.all().forEach(p => {
      if (Array.isArray(p.variants) && p.variants.length) {
        p.variants.forEach(v => {
          const st = num(v.stock);
          cost += st * DB.Products.effectiveBuyPrice(p, v.id); sell += st * DB.Products.effectiveSellPrice(p, v.id); units += st;
        });
        if (p.sellBase) { const st = num(p.stock); cost += st * num(p.buyPrice); sell += st * num(p.sellPrice); units += st; }
      } else {
        const st = num(p.stock);
        cost += st * num(p.buyPrice); sell += st * num(p.sellPrice); units += st;
      }
      if (p.needsCost) pendingCost++;
    });
    return { cost: r2(cost), sell: r2(sell), potential: r2(sell - cost), units, pendingCost };
  }

  // فترات جاهزة
  function preset(name) {
    const t = today();
    switch (name) {
      case 'today': return { from: t, to: t };
      case 'yesterday': { const y = addDays(t, -1); return { from: y, to: y }; }
      case '7d': return { from: addDays(t, -6), to: t };
      case '30d': return { from: addDays(t, -29), to: t };
      case 'month': return { from: t.slice(0, 8) + '01', to: t };
      case 'lastmonth': {
        const d = new Date(t.slice(0, 8) + '01T00:00:00Z'); d.setUTCDate(0);
        const last = d.toISOString().slice(0, 10);
        return { from: last.slice(0, 8) + '01', to: last };
      }
      case 'year': return { from: t.slice(0, 4) + '-01-01', to: t };
      case 'all': return { from: '0000-00-00', to: '9999-12-31' };
      default: return { from: addDays(t, -29), to: t };
    }
  }
  // الفترة السابقة المماثلة (للمقارنة)
  function prevPeriod(from, to) {
    if (from === '0000-00-00') return null;
    const n = daysBetween(from, to) + 1;
    return { from: addDays(from, -n), to: addDays(from, -1) };
  }

  global.DakaniFin = { compute, series, inventoryValue, preset, prevPeriod, today, addDays, daysBetween, returnCost };
})(window);