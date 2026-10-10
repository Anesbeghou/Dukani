/**
 * DAKANI PRO FEATURES — ميزات مساندة (ملف مستقل)
 * ─────────────────────────────────────────────────────────────
 *  1) إشعار المدير بالمنتجات التي أضافها موظف بدون سعر شراء + نافذة إدخال سريعة
 *     (عند الحفظ تُحتسب أرباح كل المبيعات السابقة لهذه المنتجات تلقائياً).
 *  2) تعديل/حذف تسويات الجرد من سجل التسويات.
 */
(function () {
  const esc = v => (typeof escHtml === 'function') ? escHtml(v) : String(v == null ? '' : v);
  const isCashier = () => { try { return typeof _isCashierRole === 'function' && _isCashierRole(); } catch (e) { return false; } };
  const cur = () => DB.Settings.get().currency || 'دج';
  let _toastShown = false;

  // ═══════════ 1) سعر الشراء المعلَّق ═══════════
  function soldQty(pid) {
    let q = 0, rev = 0;
    DB.Sales.all().forEach(s => (s.items || []).forEach(it => { if (it.productId === pid && it.costPending) { q += it.qty; rev += it.total; } }));
    return { q, rev };
  }

  function refresh() {
    if (isCashier()) { document.getElementById('dk-pending-cost')?.remove(); return; }
    let list = [];
    try { list = DB.Products.pendingCost(); } catch (e) {}
    const host = document.getElementById('page-dashboard');
    let bar = document.getElementById('dk-pending-cost');
    if (!list.length) { bar?.remove(); return; }
    if (host && !bar) {
      bar = document.createElement('div'); bar.id = 'dk-pending-cost';
      bar.style.cssText = 'margin:0 0 14px;padding:12px 16px;border-radius:12px;background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4);display:flex;align-items:center;gap:12px;flex-wrap:wrap';
      host.insertBefore(bar, host.firstChild.nextSibling || null);
    }
    if (bar) bar.innerHTML = `<i class="fas fa-triangle-exclamation" style="color:#f59e0b;font-size:20px"></i>
      <div style="flex:1;min-width:200px"><strong>${list.length} منتج بدون سعر شراء</strong>
      <div style="font-size:12px;color:var(--text3)">أضافها موظفون — لا تُحتسب أرباحها حتى تُدخل سعر الشراء، وعندها تُحسب كل مبيعاتها السابقة تلقائياً.</div></div>
      <button class="btn-primary" onclick="proOpenPendingCost()"><i class="fas fa-pen"></i> إدخال الأسعار الآن</button>`;
    if (!_toastShown && typeof toast === 'function') {
      _toastShown = true;
      toast(`⚠️ ${list.length} منتج بانتظار سعر الشراء — أدخله ليُحتسب الربح`, 'warning');
    }
  }

  window.proRefreshPendingCost = refresh;

  window.proOpenPendingCost = function () {
    if (isCashier()) return;
    const list = DB.Products.pendingCost();
    let ov = document.getElementById('modal-pro-cost');
    if (!ov) { ov = document.createElement('div'); ov.id = 'modal-pro-cost'; ov.className = 'modal-overlay'; document.body.appendChild(ov); }
    const c = cur();
    ov.innerHTML = `<div class="modal modal-lg"><div class="modal-header"><h2><i class="fas fa-tags"></i> منتجات بانتظار سعر الشراء</h2>
      <button onclick="closeModal('modal-pro-cost')"><i class="fas fa-xmark"></i></button></div>
      <div class="modal-body">
        ${list.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>المنتج</th><th>سعر البيع</th><th>المخزون</th><th>مبيعات معلَّقة</th><th>سعر الشراء (${c})</th></tr></thead><tbody>
        ${list.map(p => { const s = soldQty(p.id); return `<tr>
          <td><strong>${esc(p.nameAr)}</strong>${p.barcode ? `<br><small>${esc(p.barcode)}</small>` : ''}</td>
          <td>${fmt(p.sellPrice || 0)}</td><td>${DB.Products.totalStock(p)}</td>
          <td>${s.q ? fmt(s.q) + ' وحدة / ' + fmt(s.rev) + ' ' + c : '—'}</td>
          <td><input type="number" class="pro-cost-inp" data-id="${p.id}" min="0" step="0.01" placeholder="0.00" style="width:110px"/></td></tr>`; }).join('')}
        </tbody></table></div>` : '<div class="empty-state good"><i class="fas fa-check-circle"></i> لا توجد منتجات معلَّقة</div>'}
      </div>
      <div class="modal-footer"><button class="btn-secondary" onclick="closeModal('modal-pro-cost')">لاحقاً</button>
        <button class="btn-primary" onclick="proSavePendingCost()"><i class="fas fa-check"></i> حفظ وحساب الأرباح</button></div></div>`;
    ov.classList.add('active');
  };

  window.proSavePendingCost = function () {
    let n = 0, fixed = 0;
    document.querySelectorAll('.pro-cost-inp').forEach(inp => {
      const v = parseFloat(inp.value);
      if (!(v > 0)) return;
      const before = DB.Sales.all().filter(s => s.hasPendingCost).length;
      DB.Products.setCost(inp.dataset.id, v);
      fixed += before - DB.Sales.all().filter(s => s.hasPendingCost).length;
      n++;
    });
    if (!n) { if (typeof toast === 'function') toast('أدخل سعر شراء واحداً على الأقل', 'warning'); return; }
    closeModal('modal-pro-cost');
    if (typeof toast === 'function') toast(`✅ حُفظت أسعار ${n} منتج — وأُعيد احتساب أرباح ${fixed} فاتورة`, 'success');
    refresh();
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof loadDashboard === 'function' && document.getElementById('page-dashboard')?.classList.contains('active')) loadDashboard();
    if (window.DakaniAnalytics) { DakaniAnalytics.renderDashboard(); }
  };

  // ═══════════ 2) تعديل / حذف تسوية جرد ═══════════
  const REASONS = ['جرد يدوي', 'انتهاء الصلاحية', 'تلف', 'فقدان', 'تصحيح خطأ', 'عينة', 'إضافة يدوية', 'أخرى'];
  window.proEditAdjustment = function (id) {
    const a = DB.StockAdjustments.all().find(x => x.id === id);
    if (!a) return;
    let ov = document.getElementById('modal-pro-adj');
    if (!ov) { ov = document.createElement('div'); ov.id = 'modal-pro-adj'; ov.className = 'modal-overlay'; document.body.appendChild(ov); }
    ov.innerHTML = `<div class="modal"><div class="modal-header"><h2><i class="fas fa-pen"></i> تعديل تسوية جرد</h2>
      <button onclick="closeModal('modal-pro-adj')"><i class="fas fa-xmark"></i></button></div>
      <div class="modal-body">
        <input type="hidden" id="pro-adj-id" value="${a.id}"/>
        <div class="form-group"><label>المنتج</label><input type="text" value="${esc(a.productName)}" disabled/></div>
        <div class="form-row">
          <div class="form-group"><label>الكمية القديمة</label><input type="text" value="${a.oldQty}" disabled/></div>
          <div class="form-group"><label>الكمية الفعلية (الجديدة)</label><input type="number" id="pro-adj-qty" min="0" step="any" value="${a.newQty}"/></div>
        </div>
        <div class="form-group"><label>السبب</label><select id="pro-adj-reason">${REASONS.map(r => `<option ${r === a.reason ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
        <div class="form-group"><label>ملاحظة</label><input type="text" id="pro-adj-note" value="${esc(a.note || '')}"/></div>
        <div class="dk-hint" style="font-size:12px;color:var(--text3)">تعديل الكمية يغيّر مخزون المنتج الحالي بالفرق فقط، وتُحدَّث الخسارة المالية تلقائياً.</div>
      </div>
      <div class="modal-footer"><button class="btn-secondary" onclick="closeModal('modal-pro-adj')">إلغاء</button>
        <button class="btn-primary" onclick="proSaveAdjustment()"><i class="fas fa-check"></i> حفظ</button></div></div>`;
    ov.classList.add('active');
  };
  window.proSaveAdjustment = function () {
    const id = document.getElementById('pro-adj-id').value;
    const q = parseFloat(document.getElementById('pro-adj-qty').value);
    if (isNaN(q) || q < 0) { toast('أدخل كمية صحيحة', 'warning'); return; }
    DB.StockAdjustments.update(id, { newQty: q, reason: document.getElementById('pro-adj-reason').value, note: document.getElementById('pro-adj-note').value.trim() });
    closeModal('modal-pro-adj');
    toast('تم تعديل التسوية ✓', 'success');
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof checkAlerts === 'function') checkAlerts();
  };
  window.proDeleteAdjustment = function (id) {
    if (!confirm('حذف هذه التسوية؟ سيُعكس أثرها على مخزون المنتج.')) return;
    DB.StockAdjustments.delete(id);
    try { DB.UndoManager.invalidate('stock_adjustment', id); } catch (e) {}
    toast('تم حذف التسوية ✓', 'success');
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof checkAlerts === 'function') checkAlerts();
    if (typeof updateUndoButton === 'function') updateUndoButton();
  };

  // ─── ربط التنقّل: تحديث الإشعار بعد كل تنقّل وعند الإقلاع ───
  function hook() {
    if (typeof window.navigateTo !== 'function' || window.navigateTo.__proWrapped) return;
    const orig = window.navigateTo;
    const wrapped = function (page) { const r = orig.apply(this, arguments); setTimeout(refresh, 60); return r; };
    wrapped.__proWrapped = true;
    window.navigateTo = wrapped;
  }
  document.addEventListener('DOMContentLoaded', () => { hook(); setTimeout(refresh, 800); setInterval(refresh, 60000); });
  if (document.readyState !== 'loading') { hook(); setTimeout(refresh, 800); }
})();