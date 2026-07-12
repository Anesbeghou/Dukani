/**
 * DAKANI CSV IMPORT v1.0
 * استيراد منتجات من ملف CSV
 * ─────────────────────────────────────────────────────────────
 * الأعمدة المدعومة (بأي ترتيب):
 *   nameAr / اسم_عربي     ← مطلوب
 *   nameEn / اسم_انجليزي  ← اختياري
 *   barcode / باركود       ← اختياري
 *   category / فئة         ← اختياري (يُنشأ تلقائياً إن لم توجد)
 *   buyPrice / سعر_شراء    ← اختياري
 *   sellPrice / سعر_بيع    ← اختياري
 *   stock / مخزون          ← اختياري
 *   minStock / حد_ادنى     ← اختياري
 *   unit / وحدة            ← اختياري
 *   expiryDate / تاريخ_الصلاحية ← اختياري (بصيغة YYYY-MM-DD)
 * ─────────────────────────────────────────────────────────────
 */

const CSVImport = (() => {

  // خريطة أسماء الأعمدة — عربي وإنجليزي
  const COL_MAP = {
    namear:    'nameAr',
    اسم_عربي:  'nameAr',
    الاسم:     'nameAr',
    اسم:       'nameAr',
    nameen:    'nameEn',
    اسم_انجليزي: 'nameEn',
    barcode:   'barcode',
    باركود:    'barcode',
    category:  'category',
    فئة:       'category',
    الفئة:     'category',
    buyprice:  'buyPrice',
    سعر_شراء:  'buyPrice',
    شراء:      'buyPrice',
    sellprice: 'sellPrice',
    سعر_بيع:   'sellPrice',
    بيع:       'sellPrice',
    stock:     'stock',
    مخزون:     'stock',
    الكمية:    'stock',
    كمية:      'stock',
    minstock:  'minStock',
    حد_ادنى:   'minStock',
    حد_أدنى:   'minStock',
    unit:      'unit',
    وحدة:      'unit',
    expirydate: 'expiryDate',
    تاريخ_الصلاحية: 'expiryDate',
    تاريخ_انتهاء: 'expiryDate',
    الصلاحية: 'expiryDate',
  };

  // ─── تحليل CSV ────────────────────────────────────────────
  function _parseCSV(text) {
    // دعم فاصل , أو ;
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return { error: 'الملف فارغ أو لا يحتوي على بيانات' };

    const sep = lines[0].includes(';') ? ';' : ',';

    const rawHeaders = lines[0].split(sep).map(h =>
      h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_')
    );

    const headers = rawHeaders.map(h => COL_MAP[h] || h);

    if (!headers.includes('nameAr')) {
      return { error: `لم يُعثر على عمود الاسم العربي.\nالأعمدة الموجودة: ${rawHeaders.join(', ')}\nيجب أن يكون أحد الأعمدة: nameAr أو اسم_عربي أو الاسم` };
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const vals = _splitCSVLine(lines[i], sep);
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim().replace(/^"|"$/g, ''); });
      if (obj.nameAr) rows.push(obj);
    }

    return { headers, rows };
  }

  // ─── تطبيع تاريخ الصلاحية إلى صيغة YYYY-MM-DD ─────────────
  // يقبل: 2025-12-31 أو 31/12/2025 أو 31-12-2025
  function _normalizeDate(str) {
    if (!str) return '';
    const s = String(str).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    return '';
  }

  function _splitCSVLine(line, sep) {
    const result = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === sep && !inQ) { result.push(cur); cur = ''; }
      else { cur += c; }
    }
    result.push(cur);
    return result;
  }

  // ─── استيراد الصفوف إلى DB ────────────────────────────────
  function _importRows(rows, mode) {
    let added = 0, updated = 0, skipped = 0, errors = [];

    // تأكد أن الفئات موجودة
    const catCache = {};
    DB.Categories.all().forEach(c => { catCache[c.name] = c.id; });

    rows.forEach((row, idx) => {
      try {
        if (!row.nameAr) { skipped++; return; }

        // إنشاء الفئة تلقائياً إن لم تكن موجودة
        let catId = '';
        if (row.category) {
          if (!catCache[row.category]) {
            const newCat = DB.Categories.save({ name: row.category, color: '#6b7280' });
            catCache[row.category] = newCat.id;
          }
          catId = catCache[row.category];
        }

        const prod = {
          nameAr:    row.nameAr,
          nameEn:    row.nameEn   || '',
          barcode:   row.barcode  || '',
          categoryId: catId,
          buyPrice:  parseFloat(row.buyPrice)  || 0,
          sellPrice: parseFloat(row.sellPrice) || 0,
          stock:     parseFloat(row.stock)     || 0,
          minStock:  parseFloat(row.minStock)  || 5,
          unit:      row.unit || 'قطعة',
          expiryDate: _normalizeDate(row.expiryDate),
        };

        // تحقق من التكرار بالباركود أو الاسم
        const existing = prod.barcode
          ? DB.Products.byBarcode(prod.barcode)
          : DB.Products.all().find(p => p.nameAr === prod.nameAr);

        if (existing) {
          if (mode === 'skip') { skipped++; return; }
          if (mode === 'update') {
            DB.Products.save({ ...prod, id: existing.id });
            updated++;
            return;
          }
        }

        DB.Products.save(prod);
        added++;
      } catch(e) {
        errors.push(`صف ${idx + 2}: ${e.message}`);
      }
    });

    return { added, updated, skipped, errors };
  }

  // ─── معاينة ─────────────────────────────────────────────
  function _renderPreview(rows, container) {
    if (!rows.length) { container.innerHTML = '<p style="color:#6b7280;text-align:center">لا توجد بيانات للعرض</p>'; return; }

    const cols = ['nameAr', 'nameEn', 'barcode', 'category', 'buyPrice', 'sellPrice', 'stock', 'unit', 'expiryDate'];
    const labels = { nameAr:'الاسم العربي', nameEn:'الإنجليزي', barcode:'باركود', category:'فئة', buyPrice:'شراء', sellPrice:'بيع', stock:'مخزون', unit:'وحدة', expiryDate:'الصلاحية' };
    const available = cols.filter(c => rows.some(r => r[c]));

    const thead = available.map(c => `<th>${labels[c] || c}</th>`).join('');
    const tbody = rows.slice(0, 10).map(r =>
      `<tr>${available.map(c => `<td>${r[c] || '—'}</td>`).join('')}</tr>`
    ).join('');

    container.innerHTML = `
      <div style="overflow-x:auto;max-height:220px;overflow-y:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#1f2937;position:sticky;top:0">${thead}</tr></thead>
          <tbody>${tbody}</tbody>
        </table>
      </div>
      ${rows.length > 10 ? `<p style="color:#6b7280;font-size:12px;margin:8px 0 0;text-align:center">... و ${rows.length - 10} صف آخر</p>` : ''}
    `;
    // تنسيق الخلايا
    container.querySelectorAll('th').forEach(el => Object.assign(el.style, { padding:'7px 10px', color:'#9ca3af', fontWeight:'600', textAlign:'right' }));
    container.querySelectorAll('td').forEach(el => Object.assign(el.style, { padding:'6px 10px', borderBottom:'1px solid #1f2937', color:'#d1d5db' }));
  }

  // ─── لوحة الاستيراد الرئيسية ─────────────────────────────
  function showPanel() {
    document.getElementById('csv-import-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'csv-import-overlay';
    overlay.innerHTML = `
      <div class="csv-panel">
        <div class="csv-header">
          <span><i class="fas fa-file-csv"></i> استيراد منتجات من CSV</span>
          <button onclick="document.getElementById('csv-import-overlay').remove()"><i class="fas fa-xmark"></i></button>
        </div>

        <!-- تحميل الملف -->
        <div class="csv-drop-zone" id="csv-drop-zone" onclick="document.getElementById('csv-file-input').click()">
          <i class="fas fa-cloud-arrow-up" style="font-size:32px;color:#6366f1;margin-bottom:10px"></i>
          <p style="color:#fff;font-size:14px;margin:0">اضغط لاختيار ملف CSV</p>
          <p style="color:#6b7280;font-size:12px;margin:4px 0 0">أو اسحب وأفلت الملف هنا</p>
          <input type="file" id="csv-file-input" accept=".csv,.txt" style="display:none" onchange="CSVImport._onFile(event)"/>
        </div>

        <!-- نموذج تحميل -->
        <div style="text-align:center;margin:8px 0">
          <button class="csv-link-btn" onclick="CSVImport.downloadTemplate()">
            <i class="fas fa-download"></i> تحميل نموذج CSV فارغ
          </button>
        </div>

        <!-- معاينة -->
        <div id="csv-preview-wrap" style="display:none">
          <div class="csv-section-title"><i class="fas fa-eye"></i> معاينة البيانات (أول 10 صفوف)</div>
          <div id="csv-preview-table"></div>

          <div class="csv-section-title" style="margin-top:14px"><i class="fas fa-sliders"></i> خيارات الاستيراد</div>
          <div class="csv-options">
            <label class="csv-radio">
              <input type="radio" name="csv-mode" value="skip" checked/>
              <span>تخطي المنتجات المكررة</span>
            </label>
            <label class="csv-radio">
              <input type="radio" name="csv-mode" value="update"/>
              <span>تحديث المنتجات المكررة</span>
            </label>
            <label class="csv-radio">
              <input type="radio" name="csv-mode" value="add"/>
              <span>إضافة الكل (حتى المكرر)</span>
            </label>
          </div>

          <div id="csv-count-info" style="color:#9ca3af;font-size:13px;margin:8px 0"></div>
        </div>

        <!-- أخطاء -->
        <div id="csv-error-box" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;color:#f87171;font-size:13px;margin-top:10px"></div>

        <!-- نتيجة -->
        <div id="csv-result-box" style="display:none"></div>

        <div class="csv-footer">
          <button class="csv-btn-cancel" onclick="document.getElementById('csv-import-overlay').remove()">إلغاء</button>
          <button class="csv-btn-import" id="csv-do-import" style="display:none" onclick="CSVImport._doImport()">
            <i class="fas fa-file-import"></i> استيراد الآن
          </button>
        </div>
      </div>`;

    // الأنماط
    const style = document.createElement('style');
    style.id = 'csv-import-styles';
    style.textContent = `
      #csv-import-overlay {
        position:fixed;inset:0;z-index:99997;
        background:rgba(0,0,0,.75);backdrop-filter:blur(4px);
        display:flex;align-items:center;justify-content:center;
        font-family:'Cairo',sans-serif;
      }
      .csv-panel {
        background:#111827;border:1px solid #1f2937;border-radius:18px;
        padding:28px;width:100%;max-width:560px;color:#fff;
        box-shadow:0 25px 60px rgba(0,0,0,.5);max-height:90vh;overflow-y:auto;
      }
      .csv-header {
        display:flex;justify-content:space-between;align-items:center;
        font-size:17px;font-weight:700;color:#6366f1;margin-bottom:18px;
      }
      .csv-header button { background:none;border:none;color:#6b7280;font-size:18px;cursor:pointer; }
      .csv-drop-zone {
        border:2px dashed #374151;border-radius:14px;padding:28px;
        text-align:center;cursor:pointer;transition:border-color .2s;
      }
      .csv-drop-zone:hover,.csv-drop-zone.drag { border-color:#6366f1;background:rgba(99,102,241,0.06); }
      .csv-link-btn {
        background:none;border:none;color:#6366f1;font-size:13px;
        font-family:'Cairo',sans-serif;cursor:pointer;text-decoration:underline;
      }
      .csv-section-title { color:#9ca3af;font-size:13px;font-weight:600;margin-bottom:8px; }
      .csv-options { display:flex;flex-direction:column;gap:8px; }
      .csv-radio { display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#d1d5db; }
      .csv-radio input { accent-color:#6366f1;width:16px;height:16px; }
      .csv-footer { display:flex;justify-content:flex-end;gap:10px;margin-top:18px;border-top:1px solid #1f2937;padding-top:16px; }
      .csv-btn-cancel { background:#1f2937;border:none;color:#9ca3af;padding:10px 20px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:14px;cursor:pointer; }
      .csv-btn-import { background:linear-gradient(135deg,#6366f1,#4f46e5);border:none;color:#fff;padding:10px 22px;border-radius:10px;font-family:'Cairo',sans-serif;font-size:14px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:6px; }
      .csv-btn-import:hover { opacity:.9; }
      .csv-result-success { background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:10px;padding:14px 18px; }
      .csv-result-row { display:flex;justify-content:space-between;align-items:center;font-size:14px;padding:4px 0; }
      .csv-result-val { font-weight:700;font-size:16px; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Drag & Drop
    const zone = document.getElementById('csv-drop-zone');
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (file) _loadFile(file);
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  // ─── قراءة الملف ─────────────────────────────────────────
  let _parsedRows = [];

  function _onFile(e) {
    const file = e.target.files[0];
    if (file) _loadFile(file);
  }

  function _loadFile(file) {
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target.result;
      const result = _parseCSV(text);

      const errBox = document.getElementById('csv-error-box');
      const previewWrap = document.getElementById('csv-preview-wrap');
      const importBtn = document.getElementById('csv-do-import');
      const countInfo = document.getElementById('csv-count-info');

      if (result.error) {
        errBox.style.display = 'block';
        errBox.innerHTML = `<i class="fas fa-circle-xmark"></i> ${result.error}`;
        previewWrap.style.display = 'none';
        importBtn.style.display = 'none';
        return;
      }

      errBox.style.display = 'none';
      _parsedRows = result.rows;
      _renderPreview(result.rows, document.getElementById('csv-preview-table'));
      countInfo.textContent = `إجمالي الصفوف الجاهزة للاستيراد: ${result.rows.length} منتج`;
      previewWrap.style.display = 'block';
      importBtn.style.display = 'flex';
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ─── تنفيذ الاستيراد ──────────────────────────────────────
  function _doImport() {
    if (!_parsedRows.length) return;
    const mode = document.querySelector('input[name="csv-mode"]:checked')?.value || 'skip';
    const result = _importRows(_parsedRows, mode);

    const resBox = document.getElementById('csv-result-box');
    const importBtn = document.getElementById('csv-do-import');
    const previewWrap = document.getElementById('csv-preview-wrap');

    previewWrap.style.display = 'none';
    importBtn.style.display = 'none';

    resBox.style.display = 'block';
    resBox.innerHTML = `
      <div class="csv-result-success">
        <div style="color:#10b981;font-size:16px;font-weight:700;margin-bottom:12px">
          <i class="fas fa-circle-check"></i> تم الاستيراد بنجاح
        </div>
        <div class="csv-result-row">
          <span>✅ منتجات أُضيفت</span>
          <span class="csv-result-val" style="color:#10b981">${result.added}</span>
        </div>
        <div class="csv-result-row">
          <span>🔄 منتجات حُدِّثت</span>
          <span class="csv-result-val" style="color:#3b82f6">${result.updated}</span>
        </div>
        <div class="csv-result-row">
          <span>⏭️ منتجات تُخطِّيت</span>
          <span class="csv-result-val" style="color:#6b7280">${result.skipped}</span>
        </div>
        ${result.errors.length ? `<div style="color:#f87171;font-size:12px;margin-top:10px">${result.errors.join('<br>')}</div>` : ''}
      </div>`;

    // تحديث واجهة المنتجات
    if (typeof renderProducts === 'function') renderProducts();
    if (typeof loadDashboard  === 'function') loadDashboard();
    if (typeof checkAlerts    === 'function') checkAlerts();
  }

  // ─── تحميل نموذج CSV ──────────────────────────────────────
  function downloadTemplate() {
    const content =
      'nameAr,nameEn,barcode,category,buyPrice,sellPrice,stock,minStock,unit,expiryDate\n' +
      'سكر أبيض,White Sugar,6191234567890,مواد غذائية,80,100,50,10,كيس,2026-12-31\n' +
      'زيت ذهبي,Golden Oil,6197654321098,مواد غذائية,150,180,30,5,لتر,2026-09-15\n' +
      'صابون برادة,Soap Bar,,منظفات,40,60,100,20,قطعة,\n';
    const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'dakani-products-template.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }

  return { showPanel, downloadTemplate, _onFile, _doImport };

})();
