/**
 * DAKANI BARCODE ENGINE
 * ─────────────────────────────────────────────────────────────
 * مولّد باركود Code 39 يعمل بالكامل دون اتصال بالإنترنت (Offline)
 * لا يعتمد على أي مكتبة خارجية — مبني من الصفر بصيغة SVG قابلة للطباعة والمسح الضوئي.
 *
 * لماذا Code 39؟
 *  - يدعم الحروف الكبيرة والأرقام والشرطة "-" بدون أي ترميز إضافي
 *  - أرقام الفواتير والمرتجعات في دكاني بصيغة INV-00001 / RET-00001 متوافقة معه تماماً
 *  - يمكن قراءته بأي قارئ باركود عادي (USB / بلوتوث) دون إعدادات خاصة
 *
 * الاستخدام:
 *   DakaniBarcode.toSVG('INV-00001')                 → نص SVG جاهز للحقن في HTML
 *   DakaniBarcode.render('elementId', 'INV-00001')   → يرسم الباركود مباشرة داخل عنصر
 */

const DakaniBarcode = (() => {

  // ─── جدول ترميز Code 39 القياسي (43 محرف + رمز البداية/النهاية *) ─────────
  const CHARS = [
    '0','1','2','3','4','5','6','7','8','9',
    'A','B','C','D','E','F','G','H','I','J','K','L','M',
    'N','O','P','Q','R','S','T','U','V','W','X','Y','Z',
    '-','.',' ','$','/','+','%','*'
  ];
  // كل رقم هنا يمثّل نمط الأشرطة/الفراغات (9 عناصر) لهذا المحرف بصيغة ثنائية
  const CODES = [
    20957,29783,23639,30485,20951,29813,23669,20855,29789,23645,
    29975,23831,30533,22295,30149,24005,21623,29981,23837,22301,
    30023,23879,30545,22343,30161,24017,21959,30065,23921,22385,
    29015,18263,29141,17879,29045,18293,17783,29021,18269,17477,
    17489,17681,20753,35770
  ];

  // ─── تنظيف النص: Code 39 يدعم فقط الحروف الكبيرة والأرقام وبعض الرموز ──────
  function sanitize(text) {
    return String(text || '').toUpperCase().replace(/[^0-9A-Z\-.\ $/+%]/g, '');
  }

  function _patternOf(ch) {
    const idx = CHARS.indexOf(ch);
    if (idx === -1) return '';
    return CODES[idx].toString(2);
  }

  // يبني سلسلة من "0" و"1" — كل خانة تمثل وحدة عرض واحدة (شريط أسود أو فراغ أبيض)
  function encode(text) {
    const clean = sanitize(text);
    if (!clean) return '';
    let data = _patternOf('*'); // بداية الباركود
    for (let i = 0; i < clean.length; i++) {
      const p = _patternOf(clean[i]);
      if (p) data += p + '0'; // فراغ فاصل بين كل محرف والآخر
    }
    data += _patternOf('*'); // نهاية الباركود
    return data;
  }

  // ─── توليد SVG قابل للطباعة والمسح الضوئي ──────────────────────────────────
  function toSVG(text, opts) {
    opts = opts || {};
    const clean = sanitize(text);
    if (!clean) return '';

    const unit       = opts.unit || 2;          // عرض الوحدة الواحدة (px)
    const barHeight  = opts.height || 46;        // ارتفاع الأشرطة
    const showText   = opts.showText !== false;  // إظهار الرقم أسفل الباركود
    const fontSize   = opts.fontSize || 12;
    const color      = opts.color || '#000000';
    const bg         = opts.background || 'transparent';

    const data   = encode(clean);
    const totalW = data.length * unit;
    const svgH   = barHeight + (showText ? fontSize + 8 : 4);

    let bars = '';
    let runStart = -1;
    // دمج الأعمدة المتتالية المتشابهة في مستطيل واحد لتقليل حجم الـ SVG
    for (let i = 0; i <= data.length; i++) {
      const isBar = data[i] === '1';
      if (isBar && runStart === -1) runStart = i;
      if (!isBar && runStart !== -1) {
        const w = (i - runStart) * unit;
        bars += `<rect x="${runStart * unit}" y="0" width="${w}" height="${barHeight}" fill="${color}"/>`;
        runStart = -1;
      }
    }

    const textEl = showText
      ? `<text x="${totalW / 2}" y="${barHeight + fontSize + 1}" text-anchor="middle" font-family="monospace" font-size="${fontSize}" letter-spacing="2" fill="${color}">${clean}</text>`
      : '';

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${svgH}" width="${totalW}" height="${svgH}" preserveAspectRatio="xMidYMid meet" style="max-width:100%;height:auto">` +
           (bg !== 'transparent' ? `<rect x="0" y="0" width="${totalW}" height="${svgH}" fill="${bg}"/>` : '') +
           bars + textEl + `</svg>`;
  }

  // ─── رسم الباركود مباشرة داخل عنصر HTML عبر id ─────────────────────────────
  function render(containerId, text, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = toSVG(text, opts);
  }

  return { toSVG, render, encode, sanitize };

})();