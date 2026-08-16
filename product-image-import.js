/**
 * DAKANI PRODUCT IMAGE IMPORT
 * ─────────────────────────────────────────────────────────────
 * ربط صور المنتجات دفعة واحدة، بطريقتين معاً:
 *
 *  1) استيراد بالجملة مع مطابقة تلقائية:
 *     يختار المستخدم عدة صور دفعة واحدة (مثلاً كل صور منتجات المورد).
 *     كل صورة تُطابَق تلقائياً مع منتج موجود عبر اسم الملف:
 *       - إن كان اسم الملف (بدون الامتداد) مطابقاً تماماً لباركود منتج → مطابقة أكيدة.
 *       - وإلا، إن كان مطابقاً تماماً لاسم منتج (عربي أو إنجليزي) → مطابقة أكيدة.
 *       - وإلا، تخمين تقريبي (تضمُّن جزئي للاسم) يحتاج تأكيد المستخدم.
 *     يمكن تصحيح/تحديد المنتج يدوياً من قائمة منسدلة لكل صورة قبل الحفظ.
 *
 *  2) ربط سريع عبر مسح الباركود:
 *     يمسح المستخدم باركود منتج واحد بالكاميرا، ثم يختار له صورة واحدة مباشرة —
 *     مفيد عند تصوير المنتجات على الرف واحداً واحداً.
 *
 * الصور تُصغَّر تلقائياً (نفس منطق نافذة إضافة منتج) قبل حفظها في قاعدة
 * البيانات لتفادي تضخّم حجم التخزين مع عشرات/مئات الصور.
 *
 * هذا الملف مستقل تماماً (لا يعدّل أي ملف آخر) ويعتمد فقط على DB
 * (database.js) و DakaniScanner (camera-scanner.js) إن وُجد.
 *
 * الاستخدام:
 *   ProductImageImport.showPanel()
 */

const ProductImageImport = (() => {

  const MAX_DIM  = 640;
  const QUALITY  = 0.85;
  const MAX_SIZE = 8 * 1024 * 1024; // 8MB لكل صورة

  let _items = []; // { file, previewUrl, baseName, productId, matchType }

  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _norm(s) {
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function _baseName(filename) {
    return String(filename || '').replace(/\.[^./\\]+$/, '').trim();
  }

  // ─── تصغير الصورة إلى JPEG مضغوط (نفس مبدأ نافذة المنتج) ────────────────
  function _resizeToDataURL(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('read failed'));
      reader.onload = e => {
        const img = new Image();
        img.onerror = () => reject(new Error('decode failed'));
        img.onload = () => {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
            else { width = Math.round(width * (maxDim / height)); height = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }

  // ─── مطابقة اسم ملف بمنتج موجود ──────────────────────────
  function _findMatch(baseName) {
    const list = DB.Products.all();
    const nb = _norm(baseName);
    if (!nb) return null;

    // 1) مطابقة أكيدة عبر الباركود
    const byBarcode = DB.Products.byBarcode(baseName.trim()) || DB.Products.byBarcode(nb);
    if (byBarcode) return { product: byBarcode, type: 'barcode' };

    // 2) مطابقة أكيدة عبر الاسم الكامل (عربي أو إنجليزي)
    const exact = list.find(p => _norm(p.nameAr) === nb || _norm(p.nameEn) === nb);
    if (exact) return { product: exact, type: 'name' };

    // 3) تخمين تقريبي عبر تضمُّن جزئي — يحتاج تأكيد المستخدم
    const partial = list.find(p => {
      const na = _norm(p.nameAr), ne = _norm(p.nameEn);
      return (na && (na.includes(nb) || nb.includes(na))) ||
             (ne && (ne.includes(nb) || nb.includes(ne)));
    });
    if (partial) return { product: partial, type: 'fuzzy' };

    return null;
  }

  // ─── الأنماط ─────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('pii-styles')) return;
    const style = document.createElement('style');
    style.id = 'pii-styles';
    style.textContent = `
      #pii-overlay {
        position:fixed;inset:0;z-index:900;
        background:rgba(0,0,0,.75);backdrop-filter:blur(4px);
        display:flex;align-items:center;justify-content:center;
        font-family:'Cairo',sans-serif;padding:16px;
      }
      .pii-panel {
        background:#111827;border:1px solid #1f2937;border-radius:18px;
        padding:26px;width:100%;max-width:760px;color:#fff;
        box-shadow:0 25px 60px rgba(0,0,0,.5);max-height:92vh;overflow-y:auto;
      }
      .pii-header { display:flex;justify-content:space-between;align-items:center;font-size:17px;font-weight:700;color:#6366f1;margin-bottom:16px; }
      .pii-header button { background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer; }
      .pii-section-title { color:#9ca3af;font-size:13px;font-weight:600;margin:18px 0 8px;display:flex;align-items:center;gap:8px; }
      .pii-hint { color:#6b7280;font-size:12px;margin-bottom:12px;line-height:1.7; }
      .pii-drop-zone {
        border:2px dashed #374151;border-radius:14px;padding:26px;
        text-align:center;cursor:pointer;transition:border-color .2s;
      }
      .pii-drop-zone:hover, .pii-drop-zone.drag { border-color:#6366f1;background:rgba(99,102,241,.06); }
      .pii-table-wrap { max-height:42vh;overflow-y:auto;margin:12px 0; }
      table.pii-table { width:100%;border-collapse:collapse;font-size:12px; }
      table.pii-table th { background:#1f2937;color:#9ca3af;font-weight:600;padding:8px 6px;text-align:right;position:sticky;top:0; }
      table.pii-table td { padding:6px;border-bottom:1px solid #1f2937;color:#d1d5db;vertical-align:middle; }
      .pii-thumb { width:42px;height:42px;border-radius:8px;object-fit:cover;display:block;background:#1f2937; }
      table.pii-table select {
        width:100%;box-sizing:border-box;background:#1f2937;border:1px solid #374151;color:#fff;
        border-radius:6px;padding:6px 8px;font-size:12px;outline:none;
      }
      .pii-badge { padding:3px 9px;border-radius:20px;font-size:10px;font-weight:700;white-space:nowrap;display:inline-block; }
      .pii-badge-barcode { background:rgba(16,185,129,.15);color:#10b981; }
      .pii-badge-name    { background:rgba(59,130,246,.15);color:#3b82f6; }
      .pii-badge-fuzzy   { background:rgba(245,158,11,.15);color:#f59e0b; }
      .pii-badge-none    { background:rgba(239,68,68,.15);color:#f87171; }
      .pii-row-scan { background:#1f2937;border:1px solid #374151;color:#d1d5db;border-radius:6px;padding:5px 8px;cursor:pointer;font-size:11px; }
      .pii-row-scan:hover { border-color:#6366f1;color:#fff; }
      .pii-footer { display:flex;justify-content:flex-end;gap:10px;margin-top:16px;border-top:1px solid #1f2937;padding-top:16px; }
      .pii-btn-cancel { background:#1f2937;border:none;color:#9ca3af;padding:10px 20px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:14px;cursor:pointer; }
      .pii-btn-import { background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;color:#fff;padding:10px 22px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px; }
      .pii-btn-import:hover { opacity:.9; }
      .pii-result-box { background:rgba(16,185,129,.1);border:1px solid rgba(16,185,129,.3);border-radius:10px;padding:14px 18px;margin-top:10px; }
      .pii-result-row { display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:4px 0; }
      .pii-result-val { font-weight:700;font-size:16px; }
      .pii-quick-box {
        background:#0d1117;border:1px dashed #374151;border-radius:10px;
        padding:14px 16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;
      }
      .pii-quick-btn {
        background:linear-gradient(135deg,#10b981,#059669);border:none;color:#fff;
        padding:11px 18px;border-radius:10px;font-family:'Cairo',sans-serif;
        font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;
      }
      .pii-quick-btn:hover { opacity:.9; }
    `;
    document.head.appendChild(style);
  }

  // ─── اللوحة الرئيسية ─────────────────────────────────────
  function showPanel() {
    document.getElementById('pii-overlay')?.remove();
    _injectStyles();
    _items = [];

    const overlay = document.createElement('div');
    overlay.id = 'pii-overlay';
    overlay.innerHTML = `
      <div class="pii-panel">
        <div class="pii-header">
          <span><i class="fas fa-images"></i> استيراد صور المنتجات / Import Product Images</span>
          <button onclick="ProductImageImport._closePanel()"><i class="fas fa-xmark"></i></button>
        </div>

        <div class="pii-section-title"><i class="fas fa-barcode"></i> ربط سريع عبر مسح الباركود / Quick link by scanning</div>
        <div class="pii-quick-box">
          <span style="color:#9ca3af;font-size:13px">امسح باركود منتج واحد ثم اختر له صورة مباشرة</span>
          <button class="pii-quick-btn" onclick="ProductImageImport._quickScanAssign()">
            <i class="fas fa-camera"></i> مسح واختيار صورة / Scan &amp; Pick Image
          </button>
        </div>

        <div class="pii-section-title"><i class="fas fa-layer-group"></i> استيراد بالجملة (مطابقة تلقائية بالاسم/الباركود) / Bulk import</div>
        <div class="pii-hint">
          سمِّ كل صورة باسمها بباركود المنتج أو باسمه (مثال: 6191234567890.jpg أو سكر_أبيض.jpg) لتُطابَق تلقائياً.
          يمكنك دائماً تصحيح المطابقة أو اختيار المنتج يدوياً قبل الحفظ.
        </div>
        <div class="pii-drop-zone" id="pii-drop-zone" onclick="document.getElementById('pii-file-input').click()">
          <i class="fas fa-cloud-arrow-up" style="font-size:30px;color:#6366f1;margin-bottom:10px"></i>
          <p style="color:#fff;font-size:14px;margin:0">اضغط لاختيار عدة صور</p>
          <p style="color:#6b7280;font-size:12px;margin:4px 0 0">أو اسحب وأفلت الصور هنا</p>
          <input type="file" id="pii-file-input" accept="image/*" multiple style="display:none" onchange="ProductImageImport._onFiles(event)"/>
        </div>

        <div id="pii-bulk-wrap"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const zone = document.getElementById('pii-drop-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag');
      _loadFiles(e.dataTransfer.files);
    });
  }

  function _closePanel() {
    _items.forEach(it => { try { URL.revokeObjectURL(it.previewUrl); } catch (e) {} });
    document.getElementById('pii-overlay')?.remove();
  }

  // ─── الربط السريع عبر المسح ──────────────────────────────
  function _quickScanAssign() {
    if (typeof DakaniScanner === 'undefined') {
      if (typeof toast === 'function') toast('الماسح بالكاميرا غير متاح / Camera scanner unavailable', 'error');
      return;
    }
    DakaniScanner.open(code => {
      const product = DB.Products.byBarcode(code);
      if (!product) {
        if (typeof toast === 'function') toast(`لا يوجد منتج بهذا الباركود: ${code}`, 'error');
        return;
      }
      // مُدخَل ملف مؤقت لاختيار صورة واحدة لهذا المنتج تحديداً
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        document.body.removeChild(input);
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          if (typeof toast === 'function') toast('الرجاء اختيار صورة صالحة / Please select a valid image', 'error');
          return;
        }
        if (file.size > MAX_SIZE) {
          if (typeof toast === 'function') toast('حجم الصورة كبير جداً (الحد الأقصى 8MB) / Image too large', 'error');
          return;
        }
        _resizeToDataURL(file, MAX_DIM, QUALITY).then(dataUrl => {
          DB.Products.save({ id: product.id, image: dataUrl });
          if (typeof renderProducts === 'function') renderProducts();
          if (typeof toast === 'function') toast(`تم ربط الصورة بـ "${product.nameAr}" ✓`, 'success');
        }).catch(() => {
          if (typeof toast === 'function') toast('تعذّرت معالجة الصورة / Could not process image', 'error');
        });
      }, { once: true });
      input.click();
    }, { continuous: false, title: 'امسح باركود المنتج / Scan Product Barcode' });
  }

  // ─── قراءة الصور المختارة للاستيراد بالجملة ─────────────
  function _onFiles(e) {
    _loadFiles(e.target.files);
    e.target.value = '';
  }

  function _loadFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;

    files.forEach(file => {
      if (file.size > MAX_SIZE) {
        if (typeof toast === 'function') toast(`تم تجاوز "${file.name}" — حجم كبير جداً / Skipped: too large`, 'warning');
        return;
      }
      const baseName = _baseName(file.name);
      const match = _findMatch(baseName);
      _items.push({
        file,
        previewUrl: URL.createObjectURL(file),
        baseName,
        productId: match ? match.product.id : '',
        matchType: match ? match.type : 'none'
      });
    });

    _renderBulkTable();
  }

  function _matchBadge(type) {
    const map = {
      barcode: ['pii-badge-barcode', 'مطابقة بالباركود'],
      name:    ['pii-badge-name',    'مطابقة بالاسم'],
      fuzzy:   ['pii-badge-fuzzy',   'تخمين — تأكَّد منه'],
      none:    ['pii-badge-none',    'بدون مطابقة']
    };
    const [cls, label] = map[type] || map.none;
    return `<span class="pii-badge ${cls}">${label}</span>`;
  }

  function _renderBulkTable() {
    const wrap = document.getElementById('pii-bulk-wrap');
    if (!wrap) return;

    if (!_items.length) { wrap.innerHTML = ''; return; }

    const allProducts = DB.Products.all();
    const linkedCount = _items.filter(it => it.productId).length;

    const rows = _items.map((it, i) => `
      <tr>
        <td><img class="pii-thumb" src="${it.previewUrl}" alt=""/></td>
        <td>${_esc(it.file.name)}</td>
        <td>${_matchBadge(it.matchType)}</td>
        <td>
          <select onchange="ProductImageImport._setRowProduct(${i}, this.value)">
            <option value="">— لا تحفظ / Don't save —</option>
            ${allProducts.map(p => `<option value="${p.id}" ${it.productId === p.id ? 'selected' : ''}>${_esc(p.nameAr)}${p.barcode ? ' — ' + _esc(p.barcode) : ''}</option>`).join('')}
          </select>
        </td>
        <td><button class="pii-row-scan" onclick="ProductImageImport._scanForRow(${i})" title="مطابقة عبر مسح الباركود"><i class="fas fa-camera"></i></button></td>
      </tr>`).join('');

    wrap.innerHTML = `
      <div class="pii-table-wrap">
        <table class="pii-table">
          <thead><tr><th>الصورة</th><th>اسم الملف</th><th>المطابقة</th><th>المنتج المرتبط</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div id="pii-result-box"></div>
      <div class="pii-footer">
        <button class="pii-btn-cancel" onclick="ProductImageImport._closePanel()">إلغاء / Cancel</button>
        <button class="pii-btn-import" onclick="ProductImageImport._importAll()">
          <i class="fas fa-file-import"></i> حفظ (${linkedCount}) صورة مرتبطة / Save Linked Images
        </button>
      </div>`;
  }

  function _setRowProduct(i, productId) {
    if (!_items[i]) return;
    _items[i].productId = productId || '';
  }

  function _scanForRow(i) {
    if (typeof DakaniScanner === 'undefined') {
      if (typeof toast === 'function') toast('الماسح بالكاميرا غير متاح / Camera scanner unavailable', 'error');
      return;
    }
    DakaniScanner.open(code => {
      const product = DB.Products.byBarcode(code);
      if (!product) {
        if (typeof toast === 'function') toast(`لا يوجد منتج بهذا الباركود: ${code}`, 'error');
        return;
      }
      if (_items[i]) {
        _items[i].productId = product.id;
        _items[i].matchType = 'barcode';
        _renderBulkTable();
        if (typeof toast === 'function') toast(`تم الربط بـ "${product.nameAr}" ✓`, 'success');
      }
    }, { continuous: false, title: 'امسح باركود المنتج / Scan Product Barcode' });
  }

  // ─── تنفيذ الاستيراد بالجملة ─────────────────────────────
  function _importAll() {
    const toImport = _items.filter(it => it.productId);
    if (!toImport.length) {
      if (typeof toast === 'function') toast('لم تُربط أي صورة بمنتج / No images linked yet', 'warning');
      return;
    }

    const resBox = document.getElementById('pii-result-box');
    let done = 0, failed = 0;

    Promise.all(toImport.map(it =>
      _resizeToDataURL(it.file, MAX_DIM, QUALITY)
        .then(dataUrl => { DB.Products.save({ id: it.productId, image: dataUrl }); done++; })
        .catch(() => { failed++; })
    )).then(() => {
      if (resBox) {
        resBox.innerHTML = `
          <div class="pii-result-box">
            <div style="color:#10b981;font-size:15px;font-weight:700;margin-bottom:10px">
              <i class="fas fa-circle-check"></i> تم الاستيراد
            </div>
            <div class="pii-result-row"><span>✅ صور حُفظت بنجاح</span><span class="pii-result-val" style="color:#10b981">${done}</span></div>
            ${failed ? `<div class="pii-result-row"><span>⚠️ صور تعذّرت معالجتها</span><span class="pii-result-val" style="color:#f59e0b">${failed}</span></div>` : ''}
          </div>`;
      }
      if (typeof renderProducts === 'function') renderProducts();
      if (typeof toast === 'function') toast('تم حفظ صور المنتجات ✓', 'success');
    });
  }

  return { showPanel, _closePanel, _onFiles, _quickScanAssign, _setRowProduct, _scanForRow, _importAll };

})();