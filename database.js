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