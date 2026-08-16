/**
 * DAKANI CSV IMPORT v2.0
 * استيراد منتجات من ملف CSV
 * ─────────────────────────────────────────────────────────────
 * الأعمدة المدعومة (بأي ترتيب):
 *   nameAr / اسم_عربي / الاسم / اسم_المنتج / المنتج  ← مطلوب
 *   nameEn / اسم_انجليزي                              ← اختياري
 *   barcode / باركود                                   ← اختياري
 *   category / فئة / الفئة                             ← اختياري (يُنشأ تلقائياً إن لم توجد)
 *   buyPrice / سعر_شراء / شراء                          ← اختياري
 *   sellPrice / سعر_بيع / بيع                           ← اختياري
 *   stock / مخزون / الكمية / كمية / qty                ← اختياري
 *   minStock / حد_ادنى / حد_أدنى                        ← اختياري
 *   unit / وحدة                                         ← اختياري
 *   expiryDate / تاريخ_الصلاحية                         ← اختياري (YYYY-MM-DD أو DD/MM/YYYY أو رقم Excel)
 * ─────────────────────────────────────────────────────────────
 * التحسينات في v2.0 (دون تغيير أي واجهة برمجية خارجية):
 *  1. محلل CSV حقيقي يدعم الحقول متعددة الأسطر والفواصل والاقتباسات المزدوجة ("")
 *     بدل التقسيم الساذج على الأسطر، مما يمنع تلف البيانات لملفات مُصدَّرة من Excel.
 *  2. إصلاح خطأ حرج: DB.Categories.save غير موجود أصلاً في قاعدة البيانات
 *     (الدالة الصحيحة DB.Categories.add) — كان هذا يمنع إنشاء أي فئة جديدة أثناء
 *     الاستيراد ويُسجَّل كخطأ صامت لكل صف يحتاج فئة جديدة.
 *  3. حماية من XSS: كل قيمة تُعرض في جدول المعاينة تُنظَّف (HTML-escape) الآن،
 *     بدل حقنها مباشرة داخل innerHTML.
 *  4. قراءة أرقام أكثر ذكاءً: تدعم الفاصلة العشرية (12,50) والفواصل الألفية،
 *     وتمنع أي سعر أو كمية سالبة من الدخول لقاعدة البيانات.
 *  5. تطبيع تاريخ أقوى: يدعم أيضاً D.M.Y والسنة بصيغتين رقميتين، وأرقام Excel
 *     التسلسلية للتاريخ (مثال: يُصدِّر Excel أحياناً 45658 بدل 2024-12-01).
 *  6. إزالة BOM (\uFEFF) في بداية الملف حتى لا يفشل التعرف على أول عمود.
 *  7. استيراد على دفعات (chunked) مع شريط تقدّم حتى لا يتجمّد المتصفح مع
 *     ملفات ضخمة (آلاف الصفوف)، مع تحذير قبل معالجة ملف كبير جداً.
 *  8. رصد التكرار داخل نفس الملف (باركود/اسم مكرر في CSV نفسه) وعرضه في النتيجة
 *     النهائية كمعلومة إضافية دون كسر منطق التخطي/التحديث الحالي.
 *  9. تنظيف أفضل لأسماء الفئات والباركود (trim) قبل الحفظ.
 * ─────────────────────────────────────────────────────────────
 */

const CSVImport = (() => {

  // خريطة أسماء الأعمدة — عربي وإنجليزي (مُوسَّعة)
  const COL_MAP = {
    namear:      'nameAr',
    اسم_عربي:    'nameAr',
    الاسم:       'nameAr',
    اسم:         'nameAr',
    اسم_المنتج:  'nameAr',
    المنتج:      'nameAr',
    product_name:'nameAr',
    productname: 'nameAr',
    nameen:      'nameEn',
    اسم_انجليزي: 'nameEn',
    اسم_بالانجليزية: 'nameEn',
    barcode:     'barcode',
    باركود:      'barcode',
    category:    'category',
    فئة:         'category',
    الفئة:       'category',
    buyprice:    'buyPrice',
    سعر_شراء:    'buyPrice',
    شراء:        'buyPrice',
    sellprice:   'sellPrice',
    سعر_بيع:     'sellPrice',
    بيع:         'sellPrice',
    stock:       'stock',
    qty:         'stock',
    quantity:    'stock',
    مخزون:       'stock',
    الكمية:      'stock',
    كمية:        'stock',
    minstock:    'minStock',
    min_stock:   'minStock',
    حد_ادنى:     'minStock',
    حد_أدنى:     'minStock',
    الحد_الادنى: 'minStock',
    الحد_الأدنى: 'minStock',
    unit:        'unit',
    وحدة:        'unit',
    expirydate:  'expiryDate',
    expiry:      'expiryDate',
    exp_date:    'expiryDate',
    تاريخ_الصلاحية: 'expiryDate',
    تاريخ_انتهاء:   'expiryDate',
    تاريخ_انتهاء_الصلاحية: 'expiryDate',
    الصلاحية:    'expiryDate',
  };

  const MAX_SAFE_ROWS_WITHOUT_WARNING = 3000; // فوق هذا الرقم نُحذّر المستخدم قبل المتابعة
  const IMPORT_CHUNK_SIZE = 200; // حجم الدفعة أثناء الاستيراد لتفادي تجميد الواجهة

  // ─── تنظيف نص من رموز HTML قبل عرضه (حماية من XSS) ─────────────────────────
  function _esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ─── محلل CSV كامل: يدعم الاقتباسات، الفواصل داخل الحقول، والأسطر المتعددة ──
  // يُرجع مصفوفة صفوف، كل صف مصفوفة نصوص (خلايا)
  function _tokenizeCSV(text, sep) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    const len = text.length;

    for (let i = 0; i < len; i++) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else {
          field += c;
        }
        continue;
      }

      if (c === '"') { inQuotes = true; continue; }
      if (c === sep) { row.push(field); field = ''; continue; }
      if (c === '\r') { continue; }
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += c;
    }

    // آخر حقل/صف إن لم ينتهِ الملف بسطر جديد
    if (field.length || row.length) { row.push(field); rows.push(row); }

    return rows;
  }

  // ─── تخمين الفاصل الأنسب من أول سطر (بشكل تقريبي وسريع) ────────────────────
  function _detectSeparator(firstLine) {
    const candidates = [',', ';', '\t'];
    let best = ',', bestCount = -1;
    candidates.forEach(sep => {
      // نتجاهل الفواصل داخل الاقتباسات بشكل تقريبي (كافٍ لتحديد الفاصل الأنسب)
      const count = (firstLine.split('"').filter((_, i) => i % 2 === 0).join('').match(new RegExp('\\' + sep, 'g')) || []).length;
      if (count > bestCount) { bestCount = count; best = sep; }
    });
    return best;
  }

  // ─── تحليل رقم يدعم الفاصلة العشرية والفواصل الألفية ────────────────────────
  function _parseNumber(v) {
    if (v == null) return NaN;
    let s = String(v).trim();
    if (!s) return NaN;
    s = s.replace(/[^\d.,\-]/g, ''); // إزالة رموز العملة والمسافات وغيرها
    if (!s) return NaN;

    if (s.includes(',') && s.includes('.')) {
      // نفترض أن الفاصلة فاصل آلاف والنقطة عشرية: 1,200.50
      s = s.replace(/,/g, '');
    } else if (s.includes(',')) {
      const parts = s.split(',');
      if (parts[parts.length - 1].length <= 2) {
        // فاصلة عشرية: 12,50
        s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
      } else {
        // فاصلة آلاف: 1,200
        s = s.replace(/,/g, '');
      }
    }

    const n = parseFloat(s);
    return isNaN(n) ? NaN : n;
  }

  // رقم غير سالب آمن للحفظ في قاعدة البيانات، مع قيمة افتراضية
  function _safeNonNegative(v, fallback) {
    const n = _parseNumber(v);
    if (isNaN(n) || n < 0) return fallback;
    return n;
  }

  function _fmtDate(y, m, d) {
    const yi = parseInt(y, 10), mi = parseInt(m, 10), di = parseInt(d, 10);
    if (!yi || mi < 1 || mi > 12 || di < 1 || di > 31) return '';
    return `${yi}-${String(mi).padStart(2, '0')}-${String(di).padStart(2, '0')}`;
  }

  // ─── تطبيع تاريخ الصلاحية إلى صيغة YYYY-MM-DD ─────────────
  // يقبل: 2025-12-31، 31/12/2025، 31-12-2025، 31.12.2025، 31/12/25، أو رقم Excel التسلسلي
  function _normalizeDate(str) {
    if (!str) return '';
    const s = String(str).trim();

    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) return _fmtDate(m[1], m[2], m[3]);

    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
    if (m) return _fmtDate(m[3], m[2], m[1]);

    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})$/);
    if (m) return _fmtDate('20' + m[3], m[2], m[1]);

    // رقم Excel التسلسلي للتاريخ (أيام منذ 1899-12-30)
    if (/^\d{4,6}$/.test(s)) {
      const serial = parseInt(s, 10);
      const epoch = new Date(1899, 11, 30);
      const d = new Date(epoch.getTime() + serial * 86400000);
      if (!isNaN(d) && d.getFullYear() >= 2015 && d.getFullYear() <= 2100) {
        return _fmtDate(d.getFullYear(), d.getMonth() + 1, d.getDate());
      }
    }

    return '';
  }

  // ─── تحليل CSV ────────────────────────────────────────────
  function _parseCSV(text) {
    // إزالة BOM إن وُجد في بداية الملف (شائع في ملفات مُصدَّرة من Excel)
    text = String(text || '').replace(/^\uFEFF/, '').replace(/^\s+$/,'').trim();
    if (!text) return { error: 'الملف فارغ أو لا يحتوي على بيانات' };

    const firstLineEnd = text.search(/\r?\n/);
    const firstLine = firstLineEnd === -1 ? text : text.slice(0, firstLineEnd);
    const sep = _detectSeparator(firstLine);

    const table = _tokenizeCSV(text, sep).filter(r => !(r.length === 1 && r[0].trim() === ''));
    if (table.length < 2) return { error: 'الملف فارغ أو لا يحتوي على بيانات (صف العناوين فقط)' };

    const rawHeaders = table[0].map(h =>
      h.trim().replace(/^\uFEFF/, '').toLowerCase().replace(/\s+/g, '_')
    );
    const headers = rawHeaders.map(h => COL_MAP[h] || h);

    if (!headers.includes('nameAr')) {
      return { error: `لم يُعثر على عمود الاسم العربي.\nالأعمدة الموجودة: ${rawHeaders.join(', ')}\nيجب أن يكون أحد الأعمدة: nameAr أو اسم_عربي أو الاسم` };
    }

    const seenBarcodes = new Set();
    const seenNames = new Set();
    const rows = [];

    for (let i = 1; i < table.length; i++) {
      const vals = table[i];
      if (!vals || vals.every(v => v.trim() === '')) continue; // صف فارغ تماماً

      const obj = {};
      headers.forEach((h, idx) => { obj[h] = (vals[idx] || '').trim(); });
      if (!obj.nameAr) continue;

      // رصد التكرار داخل نفس الملف (معلوماتي فقط، لا يمنع الاستيراد)
      const bc = obj.barcode;
      const nm = obj.nameAr;
      obj._dupInFile = (bc && seenBarcodes.has(bc)) || seenNames.has(nm);
      if (bc) seenBarcodes.add(bc);
      seenNames.add(nm);

      obj._rowNum = i + 1; // رقم الصف الحقيقي في الملف (١-مبني، شامل صف العناوين)
      rows.push(obj);
    }

    return { headers, rows };
  }

  // ─── استيراد صف واحد إلى قاعدة البيانات ────────────────────
  function _importOneRow(row, mode, catCache, acc) {
    try {
      if (!row.nameAr) { acc.skipped++; return; }

      // إنشاء الفئة تلقائياً إن لم تكن موجودة
      let catId = '';
      const catName = (row.category || '').trim();
      if (catName) {
        if (!catCache[catName]) {
          const newCat = DB.Categories.add(catName); // ← تم إصلاح الاستدعاء (كان save غير موجود)
          catCache[catName] = newCat.id;
        }
        catId = catCache[catName];
      }

      const prod = {
        nameAr:    row.nameAr,
        nameEn:    row.nameEn  || '',
        barcode:   (row.barcode || '').trim(),
        categoryId: catId,
        buyPrice:  _safeNonNegative(row.buyPrice,  0),
        sellPrice: _safeNonNegative(row.sellPrice, 0),
        stock:     _safeNonNegative(row.stock,     0),
        minStock:  _safeNonNegative(row.minStock,  5),
        unit:      row.unit || 'قطعة',
        expiryDate: _normalizeDate(row.expiryDate),
      };

      // تحقق من التكرار بالباركود أو الاسم
      const existing = prod.barcode
        ? DB.Products.byBarcode(prod.barcode)
        : DB.Products.all().find(p => p.nameAr === prod.nameAr);

      if (existing) {
        if (mode === 'skip') { acc.skipped++; return; }
        if (mode === 'update') {
          DB.Products.save({ ...prod, id: existing.id });
          acc.updated++;
          return;
        }
        // mode === 'add' → يكمل ويضيف كمنتج جديد رغم التكرار
      }

      DB.Products.save(prod);
      acc.added++;
    } catch (e) {
      acc.errors.push(`صف ${row._rowNum || '?'}: ${e.message}`);
    }
    if (row._dupInFile) acc.dupInFile++;
  }

  // ─── معاينة ─────────────────────────────────────────────
  function _renderPreview(rows, container) {
    if (!rows.length) { container.innerHTML = '<p style="color:#6b7280;text-align:center">لا توجد بيانات للعرض</p>'; return; }

    const cols = ['nameAr', 'nameEn', 'barcode', 'category', 'buyPrice', 'sellPrice', 'stock', 'unit', 'expiryDate'];
    const labels = { nameAr:'الاسم العربي', nameEn:'الإنجليزي', barcode:'باركود', category:'فئة', buyPrice:'شراء', sellPrice:'بيع', stock:'مخزون', unit:'وحدة', expiryDate:'الصلاحية' };
    const available = cols.filter(c => rows.some(r => r[c]));

    const thead = available.map(c => `<th>${_esc(labels[c] || c)}</th>`).join('');
    const tbody = rows.slice(0, 10).map(r =>
      `<tr>${available.map(c => `<td>${_esc(r[c] || '—')}</td>`).join('')}</tr>`
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
        <div id="csv-error-box" style="display:none;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:12px 16px;color:#f87171;font-size:13px;margin-top:10px;white-space:pre-line"></div>

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
      .csv-progress-bar-outer { background:#1f2937;border-radius:8px;height:10px;overflow:hidden; }
      .csv-progress-bar-inner { background:linear-gradient(135deg,#6366f1,#4f46e5);height:100%;width:0%;transition:width .15s; }
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
    // تحذير بسيط للملفات الكبيرة جداً (تحليل نصي على الواجهة قد يبطئ قليلاً)
    if (file.size > 10 * 1024 * 1024) {
      const ok = window.confirm('حجم الملف كبير جداً (أكثر من 10 ميجابايت). قد تستغرق المعالجة بعض الوقت. هل تريد المتابعة؟');
      if (!ok) return;
    }

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
        errBox.textContent = result.error;
        previewWrap.style.display = 'none';
        importBtn.style.display = 'none';
        return;
      }

      if (!result.rows.length) {
        errBox.style.display = 'block';
        errBox.textContent = 'لم يتم العثور على أي صف صالح يحتوي على اسم منتج.';
        previewWrap.style.display = 'none';
        importBtn.style.display = 'none';
        return;
      }

      errBox.style.display = 'none';
      _parsedRows = result.rows;
      _renderPreview(result.rows, document.getElementById('csv-preview-table'));

      const dupCount = result.rows.filter(r => r._dupInFile).length;
      countInfo.textContent = `إجمالي الصفوف الجاهزة للاستيراد: ${result.rows.length} منتج` +
        (dupCount ? ` (منها ${dupCount} صف مكرر داخل الملف نفسه)` : '');

      if (result.rows.length > MAX_SAFE_ROWS_WITHOUT_WARNING) {
        countInfo.textContent += ' — ملف كبير، سيتم الاستيراد على دفعات لتفادي تجميد الواجهة.';
      }

      previewWrap.style.display = 'block';
      importBtn.style.display = 'flex';
    };
    reader.onerror = () => {
      const errBox = document.getElementById('csv-error-box');
      errBox.style.display = 'block';
      errBox.textContent = 'تعذّرت قراءة الملف. تأكد أنه ملف CSV صالح وحاول مجدداً.';
    };
    reader.readAsText(file, 'UTF-8');
  }

  // ─── تنفيذ الاستيراد (على دفعات لتفادي تجميد الواجهة) ─────
  function _doImport() {
    if (!_parsedRows.length) return;
    const mode = document.querySelector('input[name="csv-mode"]:checked')?.value || 'skip';

    const importBtn = document.getElementById('csv-do-import');
    const previewWrap = document.getElementById('csv-preview-wrap');
    const resBox = document.getElementById('csv-result-box');

    previewWrap.style.display = 'none';
    importBtn.style.display = 'none';

    resBox.style.display = 'block';
    resBox.innerHTML = `
      <div style="text-align:center;padding:16px 0">
        <div style="color:#9ca3af;font-size:13px;margin-bottom:10px" id="csv-progress-text">جارٍ الاستيراد... 0 / ${_parsedRows.length}</div>
        <div class="csv-progress-bar-outer"><div class="csv-progress-bar-inner" id="csv-progress-bar"></div></div>
      </div>`;

    const catCache = {};
    DB.Categories.all().forEach(c => { catCache[c.name] = c.id; });

    const acc = { added: 0, updated: 0, skipped: 0, dupInFile: 0, errors: [] };
    const total = _parsedRows.length;
    let idx = 0;

    function step() {
      const end = Math.min(idx + IMPORT_CHUNK_SIZE, total);
      for (; idx < end; idx++) {
        _importOneRow(_parsedRows[idx], mode, catCache, acc);
      }

      const bar = document.getElementById('csv-progress-bar');
      const txt = document.getElementById('csv-progress-text');
      if (bar) bar.style.width = Math.round((idx / total) * 100) + '%';
      if (txt) txt.textContent = `جارٍ الاستيراد... ${idx} / ${total}`;

      if (idx < total) {
        setTimeout(step, 0); // نترك الواجهة تتنفّس بين كل دفعة وأخرى
      } else {
        _finishImport(acc);
      }
    }
    step();
  }

  function _finishImport(result) {
    const resBox = document.getElementById('csv-result-box');
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
        ${result.dupInFile ? `
        <div class="csv-result-row">
          <span>⚠️ صفوف مكررة داخل الملف نفسه</span>
          <span class="csv-result-val" style="color:#f59e0b">${result.dupInFile}</span>
        </div>` : ''}
        ${result.errors.length ? `<div style="color:#f87171;font-size:12px;margin-top:10px">${result.errors.map(_esc).join('<br>')}</div>` : ''}
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