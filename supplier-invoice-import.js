/**
 * DAKANI SUPPLIER INVOICE IMPORT
 * ─────────────────────────────────────────────────────────────
 * استيراد منتجات عبر مسح باركود فاتورة المورد.
 *
 * الفكرة: عند استلام فاتورة من المورد، كل منتج فيها له باركود خاص به.
 * بدل إدخال كل منتج يدوياً، يقوم المستخدم بمسح باركود كل سطر في الفاتورة
 * تباعاً (عبر الكاميرا في وضع "المسح المتتالي" الموجود أصلاً في
 * DakaniScanner)، ثم يراجع القائمة المجمَّعة مرة واحدة:
 *   - باركود موجود مسبقاً في المنتجات   → تحديث سعر الشراء/البيع وإضافة
 *                                          الكمية الواردة إلى المخزون.
 *   - باركود جديد غير موجود             → يُطلب اسم المنتج وسعره لإنشائه
 *                                          كمنتج جديد بنفس الباركود الممسوح.
 * يمكن أيضاً إضافة الباركود يدوياً (بدون كاميرا) لضمان عمل الميزة دائماً
 * حتى لو تعذّر استخدام الكاميرا.
 *
 * هذا الملف مستقل تماماً (لا يعدّل أي ملف آخر) ويعتمد فقط على الواجهات
 * العامة الموجودة أصلاً: DB (database.js) و DakaniScanner (camera-scanner.js).
 *
 * الاستخدام:
 *   SupplierInvoiceImport.showPanel()
 */

const SupplierInvoiceImport = (() => {

  let _codes = [];        // الأكواد الممسوحة/المُضافة في الجلسة الحالية (بدون تكرار)
  let _reviewData = null; // تُبنى فقط عند فتح شاشة المراجعة

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _num(v, fallback) {
    const n = parseFloat(v);
    return (isNaN(n) || n < 0) ? fallback : n;
  }

  // ─── الأنماط ─────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('sii-styles')) return;
    const style = document.createElement('style');
    style.id = 'sii-styles';
    style.textContent = `
      #sii-overlay {
        position:fixed;inset:0;z-index:900;
        background:rgba(0,0,0,.75);backdrop-filter:blur(4px);
        display:flex;align-items:center;justify-content:center;
        font-family:'Cairo',sans-serif;padding:16px;
      }
      .sii-panel {
        background:#111827;border:1px solid #1f2937;border-radius:18px;
        padding:26px;width:100%;max-width:720px;color:#fff;
        box-shadow:0 25px 60px rgba(0,0,0,.5);max-height:92vh;overflow-y:auto;
      }
      .sii-header { display:flex;justify-content:space-between;align-items:center;font-size:17px;font-weight:700;color:#6366f1;margin-bottom:16px; }
      .sii-header button { background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer; }
      .sii-intro { color:#9ca3af;font-size:13px;margin-bottom:16px;line-height:1.8; }
      .sii-scan-row { display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px; }
      .sii-btn-scan {
        background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;color:#fff;
        padding:12px 20px;border-radius:12px;font-family:'Cairo',sans-serif;
        font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;
      }
      .sii-btn-scan:hover { opacity:.9; }
      .sii-manual-row { display:flex;gap:8px;flex:1;min-width:220px; }
      .sii-manual-row input {
        flex:1;background:#1f2937;border:1px solid #374151;color:#fff;
        border-radius:10px;padding:10px 14px;font-size:13px;outline:none;
      }
      .sii-manual-row input:focus { border-color:#6366f1; }
      .sii-manual-row button {
        background:#1f2937;border:1px solid #374151;color:#d1d5db;border-radius:10px;
        padding:0 16px;cursor:pointer;font-size:13px;
      }
      .sii-manual-row button:hover { border-color:#6366f1;color:#fff; }
      .sii-count-box {
        background:#0d1117;border:1px dashed #374151;border-radius:10px;
        padding:12px 16px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;
      }
      .sii-count-box strong { color:#10b981;font-size:20px; }
      .sii-review-btn {
        background:#10b981;border:none;color:#fff;padding:8px 16px;border-radius:8px;
        font-family:'Cairo',sans-serif;font-size:13px;font-weight:700;cursor:pointer;
      }
      .sii-review-btn:hover { opacity:.9; }
      .sii-review-btn:disabled { opacity:.4;cursor:not-allowed; }
      .sii-table-wrap { max-height:50vh;overflow-y:auto;margin-bottom:14px; }
      table.sii-table { width:100%;border-collapse:collapse;font-size:12px; }
      table.sii-table th { background:#1f2937;color:#9ca3af;font-weight:600;padding:8px 6px;text-align:right;position:sticky;top:0; }
      table.sii-table td { padding:6px;border-bottom:1px solid #1f2937;color:#d1d5db;vertical-align:middle; }
      table.sii-table input, table.sii-table select {
        width:100%;box-sizing:border-box;background:#1f2937;border:1px solid #374151;color:#fff;
        border-radius:6px;padding:6px 8px;font-size:12px;outline:none;
      }
      table.sii-table input:focus, table.sii-table select:focus { border-color:#6366f1; }
      .sii-badge { padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap; }
      .sii-badge-existing { background:rgba(59,130,246,.15);color:#3b82f6; }
      .sii-badge-new { background:rgba(16,185,129,.15);color:#10b981; }
      .sii-row-remove { background:none;border:none;color:#f87171;cursor:pointer;font-size:14px; }
      .sii-row-remove:hover { color:#ef4444; }
      .sii-footer { display:flex;justify-content:flex-end;gap:10px;margin-top:12px;border-top:1px solid #1f2937;padding-top:16px; }
      .sii-btn-cancel { background:#1f2937;border:none;color:#9ca3af;padding:10px 20px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:14px;cursor:pointer; }
      .sii-btn-save { background:linear-gradient(135deg,#10b981,#059669);border:none;color:#fff;padding:10px 22px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px; }
      .sii-btn-save:hover { opacity:.9; }
      .sii-result-box { background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:14px 18px;margin-top:10px; }
      .sii-result-row { display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:4px 0; }
      .sii-result-val { font-weight:700;font-size:16px; }
      .sii-empty { color:#6b7280;text-align:center;padding:20px;font-size:13px; }

      /* شارة عائمة أثناء المسح المتتالي — أعلى من نافذة الكاميرا (z-index 10000) */
      #sii-scan-badge {
        position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:10050;
        background:#111827;border:1px solid #1f2937;border-radius:14px;
        padding:10px 16px;display:flex;align-items:center;gap:12px;
        box-shadow:0 10px 30px rgba(0,0,0,.5);font-family:'Cairo',sans-serif;
      }
      #sii-scan-badge .sii-badge-count { color:#10b981;font-weight:800;font-size:15px; }
      #sii-scan-badge button {
        border:none;border-radius:8px;padding:7px 14px;font-size:12px;font-weight:700;
        cursor:pointer;font-family:'Cairo',sans-serif;
      }
      #sii-scan-badge .sii-badge-finish { background:#10b981;color:#fff; }
      #sii-scan-badge .sii-badge-cancel { background:#1f2937;color:#9ca3af; }
    `;
    document.head.appendChild(style);
  }

  // ─── اللوحة الرئيسية ─────────────────────────────────────
  function showPanel() {
    document.getElementById('sii-overlay')?.remove();
    _injectStyles();
    _codes = [];
    _reviewData = null;

    const overlay = document.createElement('div');
    overlay.id = 'sii-overlay';
    overlay.innerHTML = `
      <div class="sii-panel">
        <div class="sii-header">
          <span><i class="fas fa-file-invoice"></i> استيراد من فاتورة المورد / Supplier Invoice Import</span>
          <button onclick="document.getElementById('sii-overlay').remove()"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="sii-intro">
          امسح باركود كل منتج في فاتورة المورد بالكاميرا واحداً تلو الآخر، أو أدخله يدوياً.
          بعد الانتهاء، راجع القائمة: المنتجات الموجودة تُحدَّث أسعارها ومخزونها، والمنتجات الجديدة تُنشَأ مباشرة.
        </div>

        <div class="sii-scan-row">
          <button class="sii-btn-scan" onclick="SupplierInvoiceImport._startScan()">
            <i class="fas fa-camera"></i> مسح بالكاميرا / Scan with Camera
          </button>
          <div class="sii-manual-row">
            <input type="text" id="sii-manual-input" placeholder="أو أدخل الباركود يدوياً واضغط Enter"
              onkeydown="if(event.key==='Enter'){SupplierInvoiceImport._addManual();}"/>
            <button onclick="SupplierInvoiceImport._addManual()"><i class="fas fa-plus"></i> إضافة</button>
          </div>
        </div>

        <div class="sii-count-box">
          <span>عدد الأكواد المجمَّعة حتى الآن / Codes collected so far</span>
          <strong id="sii-live-count">0</strong>
        </div>

        <div id="sii-review-wrap"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    _renderReviewSection();
    setTimeout(() => document.getElementById('sii-manual-input')?.focus(), 100);
  }

  // ─── إضافة كود (يدوياً أو عبر الكاميرا) ────────────────
  function _pushCode(code) {
    code = String(code || '').trim();
    if (!code) return false;
    if (_codes.includes(code)) return false;
    _codes.push(code);
    return true;
  }

  function _addManual() {
    const input = document.getElementById('sii-manual-input');
    const code = (input?.value || '').trim();
    if (!code) return;
    if (!_pushCode(code)) {
      if (typeof toast === 'function') toast('هذا الباركود مضاف مسبقاً في هذه الجلسة / Already added', 'warning');
      input.value = '';
      return;
    }
    input.value = '';
    _updateLiveCount();
    if (_reviewData) _renderReviewSection(); // إن كانت المراجعة مفتوحة، أضفه إليها مباشرة
  }

  function _updateLiveCount() {
    const el = document.getElementById('sii-live-count');
    if (el) el.textContent = String(_codes.length);
    const badgeCount = document.getElementById('sii-scan-badge-count');
    if (badgeCount) badgeCount.textContent = String(_codes.length);
  }

  // ─── جلسة المسح بالكاميرا (وضع متتالي — لا يُغلق بعد كل كود) ──────────
  function _startScan() {
    if (typeof DakaniScanner === 'undefined') {
      if (typeof toast === 'function') toast('الماسح بالكاميرا غير متاح / Camera scanner unavailable', 'error');
      return;
    }
    document.getElementById('sii-scan-badge')?.remove();
    const badge = document.createElement('div');
    badge.id = 'sii-scan-badge';
    badge.innerHTML = `
      <span>تم المسح: <span class="sii-badge-count" id="sii-scan-badge-count">${_codes.length}</span></span>
      <button class="sii-badge-finish" onclick="SupplierInvoiceImport._finishScanSession()">
        <i class="fas fa-check"></i> إنهاء ومراجعة / Finish &amp; Review
      </button>`;
    document.body.appendChild(badge);

    DakaniScanner.open(code => {
      const added = _pushCode(code);
      _updateLiveCount();
      if (typeof toast === 'function') {
        toast(added ? `تم مسح: ${code} (${_codes.length})` : `مكرر: ${code}`, added ? 'success' : 'info');
      }
    }, { continuous: true, title: 'مسح فاتورة المورد / Scan Supplier Invoice' });
  }

  function _finishScanSession() {
    document.getElementById('sii-scan-badge')?.remove();
    _renderReviewSection();
    const wrap = document.getElementById('sii-review-wrap');
    if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ─── بناء/عرض جدول المراجعة ──────────────────────────────
  function _buildReviewData() {
    _reviewData = _codes.map(code => {
      const existing = DB.Products.byBarcode(code);
      if (existing) {
        return {
          code, isNew: false, productId: existing.id,
          nameAr: existing.nameAr, nameEn: existing.nameEn || '',
          category: existing.category || '',
          buyPrice: existing.buyPrice || 0, sellPrice: existing.sellPrice || 0,
          unit: existing.unit || 'قطعة', qty: 0
        };
      }
      return {
        code, isNew: true, productId: null,
        nameAr: '', nameEn: '', category: '',
        buyPrice: 0, sellPrice: 0, unit: 'قطعة', qty: 0
      };
    });
  }

  function _renderReviewSection() {
    const wrap = document.getElementById('sii-review-wrap');
    if (!wrap) return;
    _updateLiveCount();

    if (!_codes.length) {
      wrap.innerHTML = '<p class="sii-empty">لم تُضَف أي أكواد بعد. ابدأ بالمسح أو الإدخال اليدوي أعلاه.</p>';
      return;
    }

    // نعيد بناء بيانات المراجعة فقط إن لم تكن موجودة، أو إن أُضيف كود جديد لم يُدرَج بعد
    if (!_reviewData || _reviewData.length !== _codes.length) {
      const prevById = {};
      (_reviewData || []).forEach(r => { prevById[r.code] = r; });
      _buildReviewData();
      // نحافظ على أي تعديلات يدوية أدخلها المستخدم سابقاً على الأكواد المكرَّرة
      _reviewData = _reviewData.map(r => prevById[r.code] ? { ...prevById[r.code] } : r);
    }

    const cats = DB.Categories.all();
    const rows = _reviewData.map((r, i) => {
      const badge = r.isNew
        ? '<span class="sii-badge sii-badge-new">جديد / New</span>'
        : '<span class="sii-badge sii-badge-existing">موجود / Existing</span>';

      const nameCell = r.isNew
        ? `<input type="text" data-f="nameAr" data-i="${i}" placeholder="اسم المنتج (مطلوب)" value="${_esc(r.nameAr)}"/>`
        : `<strong>${_esc(r.nameAr)}</strong>`;

      const catCell = r.isNew
        ? `<select data-f="category" data-i="${i}">
             <option value="">— بدون فئة —</option>
             ${cats.map(c => `<option value="${_esc(c.name)}" ${r.category === c.name ? 'selected' : ''}>${_esc(c.name)}</option>`).join('')}
           </select>`
        : `${_esc(r.category) || '—'}`;

      return `<tr data-row="${i}">
        <td>${badge}</td>
        <td><code>${_esc(r.code)}</code></td>
        <td>${nameCell}</td>
        <td>${catCell}</td>
        <td><input type="number" step="0.01" min="0" data-f="buyPrice" data-i="${i}" value="${r.buyPrice}"/></td>
        <td><input type="number" step="0.01" min="0" data-f="sellPrice" data-i="${i}" value="${r.sellPrice}"/></td>
        <td><input type="number" step="0.01" min="0" data-f="qty" data-i="${i}" value="${r.qty}" title="${r.isNew ? 'المخزون الابتدائي' : 'الكمية الواردة تُضاف للمخزون الحالي'}"/></td>
        <td><button class="sii-row-remove" onclick="SupplierInvoiceImport._removeRow(${i})" title="حذف / Remove"><i class="fas fa-trash"></i></button></td>
      </tr>`;
    }).join('');

    wrap.innerHTML = `
      <div class="sii-table-wrap">
        <table class="sii-table">
          <thead><tr>
            <th>الحالة</th><th>الباركود</th><th>الاسم</th><th>الفئة</th>
            <th>سعر الشراء</th><th>سعر البيع</th><th>الكمية</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="sii-error-box" style="display:none;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:12px 16px;color:#f87171;font-size:12px;margin-bottom:10px;white-space:pre-line"></div>
      <div id="sii-result-box"></div>
      <div class="sii-footer">
        <button class="sii-btn-cancel" onclick="document.getElementById('sii-overlay').remove()">إلغاء / Cancel</button>
        <button class="sii-btn-save" onclick="SupplierInvoiceImport._saveAll()">
          <i class="fas fa-check-double"></i> حفظ الكل (${_reviewData.length}) / Save All
        </button>
      </div>`;

    // ربط التغييرات بحقول الجدول مباشرة بالبيانات الداخلية
    wrap.querySelectorAll('table.sii-table input, table.sii-table select').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt(el.dataset.i, 10);
        const field = el.dataset.f;
        if (!_reviewData[idx]) return;
        _reviewData[idx][field] = (field === 'buyPrice' || field === 'sellPrice' || field === 'qty')
          ? (el.value === '' ? 0 : parseFloat(el.value))
          : el.value;
      });
    });
  }

  function _removeRow(idx) {
    if (!_reviewData) return;
    const removed = _reviewData[idx];
    _reviewData.splice(idx, 1);
    if (removed) _codes = _codes.filter(c => c !== removed.code);
    _renderReviewSection();
  }

  // ─── الحفظ النهائي ───────────────────────────────────────
  function _saveAll() {
    if (!_reviewData || !_reviewData.length) return;

    const errBox = document.getElementById('sii-error-box');
    const resBox = document.getElementById('sii-result-box');
    const catCache = {};
    DB.Categories.all().forEach(c => { catCache[c.name] = c.id; });

    const acc = { added: 0, updated: 0, skipped: 0, errors: [] };

    _reviewData.forEach(r => {
      try {
        if (r.isNew) {
          const nameAr = (r.nameAr || '').trim();
          if (!nameAr) {
            acc.skipped++;
            acc.errors.push(`الباركود ${r.code}: تم تجاوزه — لم يُدخَل اسم المنتج`);
            return;
          }
          let catName = (r.category || '').trim();
          if (catName && !catCache[catName]) {
            const newCat = DB.Categories.add(catName);
            catCache[catName] = newCat.id;
          }
          DB.Products.save({
            nameAr,
            nameEn: (r.nameEn || '').trim(),
            barcode: r.code,
            category: catName,
            buyPrice: _num(r.buyPrice, 0),
            sellPrice: _num(r.sellPrice, 0),
            stock: _num(r.qty, 0),
            minStock: 5,
            unit: r.unit || 'قطعة'
          });
          acc.added++;
        } else {
          DB.Products.save({
            id: r.productId,
            buyPrice: _num(r.buyPrice, 0),
            sellPrice: _num(r.sellPrice, 0)
          });
          const qty = _num(r.qty, 0);
          if (qty > 0) DB.Products.adjustStock(r.productId, qty);
          acc.updated++;
        }
      } catch (e) {
        acc.errors.push(`الباركود ${r.code}: ${e.message}`);
      }
    });

    if (errBox) {
      if (acc.errors.length) {
        errBox.style.display = 'block';
        errBox.textContent = acc.errors.join('\n');
      } else {
        errBox.style.display = 'none';
      }
    }

    if (resBox) {
      resBox.innerHTML = `
        <div class="sii-result-box">
          <div style="color:#10b981;font-size:15px;font-weight:700;margin-bottom:10px">
            <i class="fas fa-circle-check"></i> تم الحفظ
          </div>
          <div class="sii-result-row"><span>✅ منتجات جديدة أُضيفت</span><span class="sii-result-val" style="color:#10b981">${acc.added}</span></div>
          <div class="sii-result-row"><span>🔄 منتجات موجودة تحدَّثت</span><span class="sii-result-val" style="color:#3b82f6">${acc.updated}</span></div>
          ${acc.skipped ? `<div class="sii-result-row"><span>⚠️ صفوف تُخطِّيت (بدون اسم)</span><span class="sii-result-val" style="color:#f59e0b">${acc.skipped}</span></div>` : ''}
        </div>`;
    }

    if (typeof renderProducts === 'function') renderProducts();
    if (typeof checkAlerts === 'function') checkAlerts();
    if (typeof loadDashboard === 'function') loadDashboard();
    if (typeof toast === 'function') toast('تم تحديث المنتجات من فاتورة المورد ✓', 'success');

    // نُبقي الصفوف الناجحة فقط في حال أراد المستخدم إضافة المزيد بعدها
    _reviewData = _reviewData.filter(r => r.isNew && !(r.nameAr || '').trim());
    _codes = _reviewData.map(r => r.code);
    if (!_reviewData.length) {
      const wrap = document.getElementById('sii-review-wrap');
      if (wrap) {
        const table = wrap.querySelector('.sii-table-wrap');
        if (table) table.style.display = 'none';
        const footer = wrap.querySelector('.sii-footer');
        if (footer) footer.style.display = 'none';
      }
    } else {
      setTimeout(_renderReviewSection, 50);
    }
  }

  return { showPanel, _startScan, _addManual, _finishScanSession, _removeRow, _saveAll };

})();