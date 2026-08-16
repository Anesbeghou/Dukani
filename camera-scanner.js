/**
 * DAKANI CAMERA SCANNER
 * ─────────────────────────────────────────────────────────────
 * مسح الباركود مباشرة عبر كاميرا الحاسوب / الهاتف / التابلت.
 *
 * - يعمل تلقائياً على كل حقول الباركود الموجودة في التطبيق:
 *   نقطة البيع، الفواتير، المرتجعات (القائمة + نافذة مرتجع جديد)،
 *   نموذج إضافة/تعديل منتج، بحث المنتجات — بالإضافة إلى زر مسح
 *   عام متاح من أي صفحة داخل الشريط العلوي.
 * - يستخدم أولاً واجهة المتصفح الأصلية BarcodeDetector (أسرع وتعمل
 *   بدون إنترنت بالكامل)، وإن لم تكن مدعومة (Safari/Firefox) يتحول
 *   تلقائياً لمكتبة ZXing (تُحمَّل مرة واحدة فقط ثم تُخزَّن للعمل Offline
 *   عبر Service Worker مثل بقية مكتبات التطبيق).
 * - عند فشل الكاميرا أو عدم توفرها: يبقى إدخال يدوي متاح دائماً — لا يتعطل
 *   أي شيء ولا تُفقد أي وظيفة موجودة سابقاً.
 * - هذا الملف مستقل تماماً (يحقن CSS الخاص به ولا يعدّل أي ملف آخر) لتقليل
 *   احتمال أي تعارض مع style.css أو script.js الحاليين.
 *
 * الاستخدام:
 *   DakaniScanner.open(code => { ... })     → يفتح الماسح ويعيد الرمز المكتشف
 *   DakaniScanner.attachButton('input-id')  → يضيف زر كاميرا صغير بجانب الحقل
 */

const DakaniScanner = (() => {

  const ZXING_CDN = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';

  const FORMATS = [
    'code_39', 'code_128', 'code_93', 'ean_13', 'ean_8',
    'upc_a', 'upc_e', 'codabar', 'itf', 'qr_code'
  ];

  // بعض المتصفحات (خصوصاً كروم على ويندوز/لينكس) تُعلن أن BarcodeDetector
  // مدعوم وتُرجع getSupportedFormats() نتيجة صالحة، لكن لا يوجد خلفها أي
  // محرك اكتشاف حقيقي على مستوى نظام التشغيل → detect() يعمل بدون أي خطأ
  // لكنه لا يكتشف أي رمز أبداً مهما طال الانتظار. لذا نضع مهلة زمنية: إن لم
  // يُكتشف أي رمز خلال هذه المدة أثناء عمل المحرك الأصلي، نتحول تلقائياً
  // إلى ZXing (يعمل عبر JS بحت وبالتالي لا يعتمد على دعم النظام) دون قطع
  // بث الكاميرا ودون إظهار أي رسالة خطأ للمستخدم.
  const NATIVE_TIMEOUT_MS = 5000;

  // ─── حالة داخلية عامة للجلسة الحالية ───────────────────────────────────
  const state = {
    active: false,
    engine: null,        // 'native' | 'zxing'
    detector: null,
    zxingReader: null,
    stream: null,
    devices: [],
    deviceIndex: 0,
    deviceLocked: false, // يصبح true فقط بعد أن يضغط المستخدم زر تبديل الكاميرا يدوياً
    torchOn: false,
    detectTimer: null,
    lastCode: '',
    lastCodeAt: 0,
    onResult: null,
    els: null,           // مراجع عناصر الواجهة (تُبنى مرة واحدة)

    // ─── ميزات إضافية ─────────────────────────────────────────────────
    zoomSupported: false,
    continuousMode: false, // وضع المسح المتتالي: لا يُغلق الماسح بعد كل كود
    scanCount: 0,           // عدد الأكواد الممسوحة في الجلسة الحالية (وضع المسح المتتالي)
    boxClearTimer: null,    // مؤقّت لمسح إطار الكشف الديناميكي عند غياب نتيجة جديدة
    resizeObs: null
  };

  const HISTORY_KEY = 'dks_scan_history';
  const HISTORY_MAX = 30;
  const CONTINUOUS_PREF_KEY = 'dks_continuous_pref';

  function _loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch (e) { return []; }
  }
  function _saveHistory(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX))); } catch (e) {}
  }
  function _pushHistory(code) {
    const list = _loadHistory();
    if (list.length && list[0].code === code) { list[0].at = Date.now(); }
    else { list.unshift({ code, at: Date.now() }); }
    _saveHistory(list);
    return list;
  }
  function _loadContinuousPref() {
    try { return localStorage.getItem(CONTINUOUS_PREF_KEY) === '1'; } catch (e) { return false; }
  }
  function _saveContinuousPref(v) {
    try { localStorage.setItem(CONTINUOUS_PREF_KEY, v ? '1' : '0'); } catch (e) {}
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  CSS — يُحقن مرة واحدة فقط
  // ═══════════════════════════════════════════════════════════════════════
  function _injectStyles() {
    if (document.getElementById('dks-styles')) return;
    const style = document.createElement('style');
    style.id = 'dks-styles';
    style.textContent = `
      .dks-scan-btn {
        width: 34px; height: 34px; flex-shrink: 0;
        display: flex; align-items: center; justify-content: center;
        background: var(--surface2, #1a2332); color: var(--text3, #64748b);
        border: 1px solid var(--border2, #253347); border-radius: var(--radius-sm, 8px);
        cursor: pointer; font-size: 14px; transition: all .2s; padding: 0;
      }
      .dks-scan-btn:hover { color: #fff; background: var(--accent, #10b981); border-color: transparent; }
      .pos-search-bar .dks-scan-btn,
      .inv-barcode-search-wrap .dks-scan-btn {
        width: 30px; height: 30px; background: transparent; border: none; font-size: 15px;
      }
      .pos-search-bar .dks-scan-btn:hover,
      .inv-barcode-search-wrap .dks-scan-btn:hover { color: var(--accent, #10b981); background: var(--surface3, #1e2d3d); border-radius: 6px; }

      .dks-inline-row { display: flex; align-items: center; gap: 8px; }
      .dks-inline-row input { flex: 1; min-width: 0; }

      .dks-global-btn {
        position: relative; cursor: pointer;
        width: 38px; height: 38px;
        background: var(--surface2, #1a2332); border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        color: var(--text2, #94a3b8); transition: all .2s; border: none; flex-shrink: 0;
      }
      .dks-global-btn:hover { color: #fff; background: var(--accent, #10b981); }

      .dks-overlay {
        display: none; position: fixed; inset: 0; z-index: 10000;
        background: rgba(0,0,0,.8); backdrop-filter: blur(4px);
        align-items: center; justify-content: center; padding: 16px;
        font-family: 'Cairo', 'Inter', sans-serif; direction: rtl;
      }
      .dks-overlay.active { display: flex; }
      .dks-modal {
        background: var(--surface, #111827); border: 1px solid var(--border2, #253347);
        border-radius: var(--radius, 12px); width: min(440px, 100%);
        box-shadow: 0 8px 40px rgba(0,0,0,.6); overflow: hidden;
      }
      .dks-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 16px 18px; border-bottom: 1px solid var(--border, #1e293b);
      }
      .dks-header h2 { font-size: 15px; font-weight: 800; color: var(--text, #e2e8f0); display: flex; align-items: center; gap: 8px; }
      .dks-header button {
        background: var(--surface2, #1a2332); border: none; color: var(--text2, #94a3b8);
        width: 30px; height: 30px; border-radius: 8px; cursor: pointer;
        font-size: 14px; display: flex; align-items: center; justify-content: center;
        transition: all .2s;
      }
      .dks-header button:hover { background: var(--red, #ef4444); color: #fff; }

      .dks-video-wrap {
        position: relative; width: 100%; aspect-ratio: 4/3; background: #000; overflow: hidden;
      }
      .dks-video-wrap video { width: 100%; height: 100%; object-fit: cover; display: block; }
      .dks-frame {
        position: absolute; inset: 14% 10%; pointer-events: none;
        border: 2px solid rgba(16,185,129,.85); border-radius: 12px;
        box-shadow: 0 0 0 2000px rgba(0,0,0,.28);
        transition: border-color .15s, box-shadow .15s;
      }
      .dks-frame.dks-success { border-color: #10b981; box-shadow: 0 0 0 2000px rgba(16,185,129,.22); }
      .dks-laser {
        position: absolute; left: 10%; right: 10%; top: 14%; height: 2px;
        background: linear-gradient(90deg, transparent, #10b981, transparent);
        animation: dks-laser-move 1.6s ease-in-out infinite; pointer-events: none;
      }
      @keyframes dks-laser-move { 0%,100% { top: 14%; } 50% { top: 84%; } }

      .dks-overlay-msg {
        position: absolute; inset: 0; display: none; flex-direction: column; gap: 10px;
        align-items: center; justify-content: center; text-align: center; padding: 20px;
        background: rgba(10,15,30,.92); color: var(--text2, #94a3b8); font-size: 13px;
      }
      .dks-overlay-msg.active { display: flex; }
      .dks-overlay-msg i { font-size: 30px; color: var(--text3, #64748b); }
      .dks-overlay-msg strong { color: var(--text, #e2e8f0); font-size: 14px; }
      .dks-overlay-msg button { margin-top: 4px; }

      .dks-controls {
        display: flex; align-items: center; justify-content: center; gap: 10px;
        padding: 10px 16px;
      }
      .dks-icon-btn {
        width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--border2, #253347);
        background: var(--surface2, #1a2332); color: var(--text2, #94a3b8);
        display: flex; align-items: center; justify-content: center; cursor: pointer;
        font-size: 14px; transition: all .2s;
      }
      .dks-icon-btn:hover { color: #fff; background: var(--accent, #10b981); border-color: transparent; }
      .dks-icon-btn.active { color: var(--gold, #f59e0b); border-color: var(--gold, #f59e0b); }
      .dks-icon-btn[hidden] { display: none; }

      .dks-status {
        text-align: center; font-size: 12px; color: var(--text3, #64748b);
        padding: 0 16px 10px;
      }
      .dks-manual-row {
        display: flex; gap: 8px; padding: 14px 16px; border-top: 1px solid var(--border, #1e293b);
      }
      .dks-manual-row input {
        flex: 1; min-width: 0; background: var(--surface2, #1a2332); border: 1px solid var(--border2, #253347);
        color: var(--text, #e2e8f0); padding: 10px 14px; border-radius: var(--radius-sm, 8px);
        font-family: 'Cairo', sans-serif; font-size: 13px; outline: none; direction: ltr; text-align: center;
      }
      .dks-manual-row input:focus { border-color: var(--accent, #10b981); }
      .dks-manual-row button {
        background: var(--accent-g, linear-gradient(135deg,#10b981,#0ea5e9)); color: #fff; border: none;
        border-radius: var(--radius-sm, 8px); padding: 0 16px; cursor: pointer; font-size: 14px;
      }

      /* ── قماشة رسم إطار الكشف الديناميكي فوق الفيديو ───────────────── */
      .dks-detect-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }

      /* ── تركيز باللمس: تموّج بصري عند النقر على الفيديو ──────────────── */
      .dks-video-wrap { cursor: pointer; }
      .dks-focus-ripple {
        position: absolute; width: 56px; height: 56px; margin: -28px 0 0 -28px;
        border: 2px solid #fff; border-radius: 50%; pointer-events: none;
        opacity: 0; transform: scale(1.4);
      }
      .dks-focus-ripple.dks-anim {
        animation: dks-focus-pop .55s ease-out;
      }
      @keyframes dks-focus-pop {
        0%   { opacity: 1; transform: scale(1.4); border-color: #fff; }
        100% { opacity: 0; transform: scale(0.9); border-color: #10b981; }
      }

      /* ── شريط التكبير (Zoom) ─────────────────────────────────────────── */
      .dks-zoom-row {
        position: absolute; left: 12px; right: 12px; bottom: 10px;
        display: none; align-items: center; gap: 8px;
        background: rgba(10,15,30,.55); border-radius: 20px; padding: 6px 12px;
        backdrop-filter: blur(3px);
      }
      .dks-zoom-row.active { display: flex; }
      .dks-zoom-row i { color: #fff; font-size: 12px; }
      .dks-zoom-row input[type="range"] { flex: 1; accent-color: #10b981; height: 4px; }

      /* ── وضع المسح المتتالي: شارة عدّاد ──────────────────────────────── */
      .dks-counter-badge {
        position: absolute; top: 10px; inset-inline-start: 10px;
        background: rgba(16,185,129,.92); color: #fff; font-size: 11px; font-weight: 800;
        padding: 4px 10px; border-radius: 20px; display: none; align-items: center; gap: 6px;
      }
      .dks-counter-badge.active { display: flex; }

      /* ── زر رفع صورة (input مخفي) ────────────────────────────────────── */
      .dks-upload-wrap { position: relative; display: inline-flex; }
      .dks-upload-wrap input[type="file"] {
        position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%;
      }

      /* ── سجل آخر المسحات ──────────────────────────────────────────────── */
      .dks-history-panel {
        display: none; max-height: 150px; overflow-y: auto;
        border-top: 1px solid var(--border, #1e293b); padding: 8px 16px;
      }
      .dks-history-panel.active { display: block; }
      .dks-history-empty { color: var(--text3, #64748b); font-size: 12px; text-align: center; padding: 6px 0; }
      .dks-history-item {
        display: flex; align-items: center; justify-content: space-between; gap: 8px;
        padding: 7px 4px; font-size: 12.5px; color: var(--text2, #94a3b8); cursor: pointer;
        border-bottom: 1px solid var(--border, #1e293b);
      }
      .dks-history-item:last-child { border-bottom: none; }
      .dks-history-item:hover { color: var(--accent, #10b981); }
      .dks-history-item .dks-hist-code { font-family: monospace; direction: ltr; color: var(--text, #e2e8f0); font-weight: 700; }
      .dks-history-item .dks-hist-time { font-size: 11px; color: var(--text3, #64748b); flex-shrink: 0; }
      .dks-history-clear { color: var(--red, #ef4444); cursor: pointer; font-size: 11px; }
      .dks-history-head {
        display: none; align-items: center; justify-content: space-between;
        padding: 8px 16px 0; font-size: 11.5px; color: var(--text3, #64748b);
      }
      .dks-history-head.active-head { display: flex; }
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  بناء الواجهة (مرة واحدة فقط ثم تُعاد استعمالها)
  // ═══════════════════════════════════════════════════════════════════════
  function _buildModal() {
    if (state.els) return state.els;

    const overlay = document.createElement('div');
    overlay.className = 'dks-overlay';
    overlay.innerHTML = `
      <div class="dks-modal">
        <div class="dks-header">
          <h2><i class="fas fa-camera"></i> مسح الباركود بالكاميرا / Scan Barcode</h2>
          <button type="button" data-dks="close"><i class="fas fa-xmark"></i></button>
        </div>
        <div class="dks-video-wrap">
          <video playsinline autoplay muted></video>
          <canvas class="dks-detect-canvas"></canvas>
          <div class="dks-frame"></div>
          <div class="dks-laser"></div>
          <div class="dks-counter-badge" data-dks="counter"><i class="fas fa-layer-group"></i> <span data-dks="counter-num">0</span></div>
          <div class="dks-focus-ripple" data-dks="ripple"></div>
          <div class="dks-zoom-row" data-dks="zoom-row">
            <i class="fas fa-magnifying-glass-minus"></i>
            <input type="range" data-dks="zoom" min="1" max="1" step="0.1" value="1"/>
            <i class="fas fa-magnifying-glass-plus"></i>
          </div>
          <div class="dks-overlay-msg">
            <i class="fas fa-camera-rotate"></i>
            <strong data-dks="msg-title">جارٍ تشغيل الكاميرا...</strong>
            <span data-dks="msg-body"></span>
            <button type="button" class="btn-secondary" data-dks="retry" style="display:none">
              <i class="fas fa-rotate"></i> إعادة المحاولة / Retry
            </button>
          </div>
        </div>
        <div class="dks-controls">
          <button type="button" class="dks-icon-btn" data-dks="switch" title="تبديل الكاميرا" hidden>
            <i class="fas fa-camera-rotate"></i>
          </button>
          <button type="button" class="dks-icon-btn" data-dks="torch" title="فلاش" hidden>
            <i class="fas fa-bolt"></i>
          </button>
          <button type="button" class="dks-icon-btn" data-dks="continuous" title="وضع المسح المتتالي / Continuous scan">
            <i class="fas fa-list-ol"></i>
          </button>
          <div class="dks-upload-wrap">
            <button type="button" class="dks-icon-btn" data-dks="upload-btn" title="مسح من صورة / Scan from image">
              <i class="fas fa-image"></i>
            </button>
            <input type="file" accept="image/*" data-dks="upload-input"/>
          </div>
          <button type="button" class="dks-icon-btn" data-dks="history-toggle" title="آخر المسحات / Recent scans">
            <i class="fas fa-clock-rotate-left"></i>
          </button>
        </div>
        <div class="dks-status" data-dks="status">وجّه الكاميرا نحو الباركود — سيتم اكتشافه تلقائياً</div>
        <div class="dks-history-head" data-dks="history-head">
          <span>آخر المسحات / Recent scans</span>
          <span class="dks-history-clear" data-dks="history-clear">مسح السجل / Clear</span>
        </div>
        <div class="dks-history-panel" data-dks="history-panel"></div>
        <div class="dks-manual-row">
          <input type="text" data-dks="manual" placeholder="أو أدخل الرقم يدوياً... / or type it manually" autocomplete="off" spellcheck="false"/>
          <button type="button" data-dks="manual-go"><i class="fas fa-check"></i></button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const els = {
      overlay,
      video: overlay.querySelector('video'),
      canvas: overlay.querySelector('.dks-detect-canvas'),
      frame: overlay.querySelector('.dks-frame'),
      videoWrap: overlay.querySelector('.dks-video-wrap'),
      ripple: overlay.querySelector('[data-dks="ripple"]'),
      msgBox: overlay.querySelector('.dks-overlay-msg'),
      msgTitle: overlay.querySelector('[data-dks="msg-title"]'),
      msgBody: overlay.querySelector('[data-dks="msg-body"]'),
      retryBtn: overlay.querySelector('[data-dks="retry"]'),
      switchBtn: overlay.querySelector('[data-dks="switch"]'),
      torchBtn: overlay.querySelector('[data-dks="torch"]'),
      continuousBtn: overlay.querySelector('[data-dks="continuous"]'),
      uploadBtn: overlay.querySelector('[data-dks="upload-btn"]'),
      uploadInput: overlay.querySelector('[data-dks="upload-input"]'),
      historyToggle: overlay.querySelector('[data-dks="history-toggle"]'),
      historyHead: overlay.querySelector('[data-dks="history-head"]'),
      historyClear: overlay.querySelector('[data-dks="history-clear"]'),
      historyPanel: overlay.querySelector('[data-dks="history-panel"]'),
      zoomRow: overlay.querySelector('[data-dks="zoom-row"]'),
      zoomInput: overlay.querySelector('[data-dks="zoom"]'),
      counterBadge: overlay.querySelector('[data-dks="counter"]'),
      counterNum: overlay.querySelector('[data-dks="counter-num"]'),
      status: overlay.querySelector('[data-dks="status"]'),
      manualInput: overlay.querySelector('[data-dks="manual"]'),
      manualGo: overlay.querySelector('[data-dks="manual-go"]')
    };

    overlay.querySelector('[data-dks="close"]').addEventListener('click', _close);
    overlay.addEventListener('click', e => { if (e.target === overlay) _close(); });
    els.retryBtn.addEventListener('click', () => _startCamera());
    els.switchBtn.addEventListener('click', _switchCamera);
    els.torchBtn.addEventListener('click', _toggleTorch);
    els.continuousBtn.addEventListener('click', _toggleContinuousMode);
    els.uploadBtn.addEventListener('click', () => els.uploadInput.click());
    els.uploadInput.addEventListener('change', _onImageFileSelected);
    els.historyToggle.addEventListener('click', _toggleHistoryPanel);
    els.historyClear.addEventListener('click', () => { _saveHistory([]); _renderHistory(); });
    els.zoomInput.addEventListener('input', _onZoomInput);
    els.videoWrap.addEventListener('click', _onVideoTapFocus);

    function submitManual() {
      const val = els.manualInput.value.trim();
      if (!val) return;
      els.manualInput.value = '';
      _onDetected(val);
    }
    els.manualGo.addEventListener('click', submitManual);
    els.manualInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitManual(); });

    state.els = els;
    return els;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  قماشة رسم إطار الكشف الديناميكي حول الباركود
  // ═══════════════════════════════════════════════════════════════════════
  function _resizeCanvas() {
    const els = state.els;
    if (!els) return;
    const rect = els.videoWrap.getBoundingClientRect();
    els.canvas.width = Math.round(rect.width);
    els.canvas.height = Math.round(rect.height);
  }

  function _clearCanvas() {
    const els = state.els;
    if (!els || !els.canvas) return;
    const ctx = els.canvas.getContext('2d');
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  }

  // يحوّل إحداثيات نقطة من مساحة بكسلات الفيديو الحقيقية إلى مساحة القماشة
  // المعروضة، مع مراعاة أن الفيديو يُعرض بخاصية object-fit: cover
  function _mapVideoPoint(px, py) {
    const els = state.els;
    const video = els.video;
    const vw = video.videoWidth || 1, vh = video.videoHeight || 1;
    const cw = els.canvas.width || 1, ch = els.canvas.height || 1;
    const scale = Math.max(cw / vw, ch / vh);
    const dw = vw * scale, dh = vh * scale;
    const offsetX = (cw - dw) / 2, offsetY = (ch - dh) / 2;
    return { x: offsetX + px * scale, y: offsetY + py * scale };
  }

  function _drawDetectionPoints(points) {
    const els = state.els;
    if (!els || !points || !points.length) return;
    _clearCanvas();
    const mapped = points.map(p => _mapVideoPoint(p.x, p.y));
    const ctx = els.canvas.getContext('2d');
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (mapped.length >= 3) {
      ctx.moveTo(mapped[0].x, mapped[0].y);
      for (let i = 1; i < mapped.length; i++) ctx.lineTo(mapped[i].x, mapped[i].y);
      ctx.closePath();
    } else if (mapped.length === 2) {
      // نتيجة أحادية البعد (Code128/EAN...): نرسم شريطاً عريضاً حول خط المسح
      const pad = 14;
      ctx.moveTo(mapped[0].x, mapped[0].y - pad);
      ctx.lineTo(mapped[1].x, mapped[1].y - pad);
      ctx.lineTo(mapped[1].x, mapped[1].y + pad);
      ctx.lineTo(mapped[0].x, mapped[0].y + pad);
      ctx.closePath();
    }
    ctx.stroke();
    mapped.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
    });

    // مسح الإطار تلقائياً إن لم تصل نتيجة جديدة خلال فترة قصيرة (خصوصاً مع ZXing)
    if (state.boxClearTimer) clearTimeout(state.boxClearTimer);
    state.boxClearTimer = setTimeout(_clearCanvas, 700);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  التكبير (Zoom)
  // ═══════════════════════════════════════════════════════════════════════
  function _setupZoom(track) {
    const els = state.els;
    const caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
    if (caps && caps.zoom && caps.zoom.max > caps.zoom.min) {
      state.zoomSupported = true;
      els.zoomInput.min = caps.zoom.min;
      els.zoomInput.max = caps.zoom.max;
      els.zoomInput.step = caps.zoom.step || 0.1;
      const settings = track.getSettings ? track.getSettings() : {};
      els.zoomInput.value = settings.zoom || caps.zoom.min;
      els.zoomRow.classList.add('active');
    } else {
      state.zoomSupported = false;
      els.zoomRow.classList.remove('active');
    }
  }

  function _onZoomInput(e) {
    if (!state.stream) return;
    const track = state.stream.getVideoTracks()[0];
    if (!track) return;
    const val = parseFloat(e.target.value);
    try { track.applyConstraints({ advanced: [{ zoom: val }] }); } catch (err) { /* غير مدعوم على هذا الجهاز */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  تركيز باللمس (Tap-to-focus)
  // ═══════════════════════════════════════════════════════════════════════
  async function _onVideoTapFocus(e) {
    // تجاهل النقر إن كان على أحد أزرار التحكم فوق الفيديو
    if (e.target.closest('.dks-zoom-row, .dks-icon-btn, .dks-overlay-msg')) return;

    const els = state.els;
    const rect = els.videoWrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    els.ripple.style.left = x + 'px';
    els.ripple.style.top = y + 'px';
    els.ripple.classList.remove('dks-anim');
    void els.ripple.offsetWidth; // إعادة تشغيل الحركة
    els.ripple.classList.add('dks-anim');

    if (!state.stream) return;
    const track = state.stream.getVideoTracks()[0];
    if (!track || !track.getCapabilities) return;
    const caps = track.getCapabilities();
    const nx = Math.min(1, Math.max(0, x / rect.width));
    const ny = Math.min(1, Math.max(0, y / rect.height));
    try {
      const advanced = {};
      if (caps.pointsOfInterest) advanced.pointsOfInterest = [{ x: nx, y: ny }];
      if (caps.focusMode && caps.focusMode.includes('single-shot')) advanced.focusMode = 'single-shot';
      if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
    } catch (err) { /* بعض الأجهزة لا تدعم التركيز اليدوي — تجاهل بصمت */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  وضع المسح المتتالي (Continuous / Batch scan)
  // ═══════════════════════════════════════════════════════════════════════
  function _toggleContinuousMode() {
    state.continuousMode = !state.continuousMode;
    _saveContinuousPref(state.continuousMode);
    const els = state.els;
    els.continuousBtn.classList.toggle('active', state.continuousMode);
    state.scanCount = 0;
    els.counterNum.textContent = '0';
    els.counterBadge.classList.toggle('active', state.continuousMode);
    els.status.textContent = state.continuousMode
      ? 'وضع المسح المتتالي مفعّل — امسح عدة أكواد دون إغلاق النافذة'
      : 'وجّه الكاميرا نحو الباركود — سيتم اكتشافه تلقائياً';
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  سجل آخر المسحات
  // ═══════════════════════════════════════════════════════════════════════
  function _fmtTime(ts) {
    try { return new Date(ts).toLocaleTimeString('ar-DZ', { hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  function _renderHistory() {
    const els = state.els;
    const list = _loadHistory();
    if (!list.length) {
      els.historyPanel.innerHTML = '<div class="dks-history-empty">لا يوجد مسحات سابقة / No recent scans</div>';
      return;
    }
    els.historyPanel.innerHTML = list.slice(0, 12).map(item => `
      <div class="dks-history-item" data-code="${(item.code + '').replace(/"/g, '&quot;')}">
        <span class="dks-hist-code">${item.code}</span>
        <span class="dks-hist-time">${_fmtTime(item.at)}</span>
      </div>`).join('');
    els.historyPanel.querySelectorAll('.dks-history-item').forEach(row => {
      row.addEventListener('click', () => {
        const code = row.getAttribute('data-code');
        if (code) _onDetected(code);
      });
    });
  }

  function _toggleHistoryPanel() {
    const els = state.els;
    const willOpen = !els.historyPanel.classList.contains('active');
    els.historyPanel.classList.toggle('active', willOpen);
    els.historyHead.classList.toggle('active-head', willOpen);
    els.historyToggle.classList.toggle('active', willOpen);
    if (willOpen) _renderHistory();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  مسح باركود من صورة مرفوعة (بديل عند تعذّر استخدام الكاميرا)
  // ═══════════════════════════════════════════════════════════════════════
  async function _decodeImageNative(imgEl) {
    if (!('BarcodeDetector' in window)) return null;
    try {
      const supported = await window.BarcodeDetector.getSupportedFormats();
      const usable = FORMATS.filter(f => supported.includes(f));
      if (!usable.length) return null;
      const detector = new window.BarcodeDetector({ formats: usable });
      const results = await detector.detect(imgEl);
      return (results && results.length) ? results[0].rawValue : null;
    } catch (e) { return null; }
  }

  function _decodeImageZXing(imgEl) {
    return _loadZXing().then(ZXing => {
      const reader = new ZXing.BrowserMultiFormatReader();
      return reader.decodeFromImageElement(imgEl).then(res => res.getText()).finally(() => {
        try { reader.reset(); } catch (e) {}
      });
    });
  }

  function _onImageFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // يسمح باختيار نفس الملف مرة أخرى لاحقاً
    if (!file) return;

    const els = state.els;
    els.status.textContent = 'جارٍ تحليل الصورة...';

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      let code = await _decodeImageNative(img);
      if (!code) {
        try { code = await _decodeImageZXing(img); } catch (err) { code = null; }
      }
      URL.revokeObjectURL(url);
      if (code) {
        _onDetected(code);
      } else {
        els.status.textContent = 'لم يتم العثور على باركود في هذه الصورة — جرّب صورة أوضح';
        if (typeof window.toast === 'function') window.toast('لم يتم العثور على باركود في الصورة', 'error');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      els.status.textContent = 'تعذّر فتح الصورة';
    };
    img.src = url;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  تحميل مكتبة ZXing عند الحاجة فقط (متصفحات لا تدعم BarcodeDetector)
  // ═══════════════════════════════════════════════════════════════════════
  let _zxingPromise = null;
  function _loadZXing() {
    if (window.ZXing) return Promise.resolve(window.ZXing);
    if (_zxingPromise) return _zxingPromise;
    _zxingPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = ZXING_CDN;
      script.onload = () => window.ZXing ? resolve(window.ZXing) : reject(new Error('ZXing failed to load'));
      script.onerror = () => reject(new Error('ZXing failed to load'));
      document.head.appendChild(script);
    });
    return _zxingPromise;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  الكاميرا: تشغيل / إيقاف / تبديل / فلاش
  // ═══════════════════════════════════════════════════════════════════════
  function _showMessage(title, body, showRetry) {
    const els = state.els;
    els.msgTitle.textContent = title;
    els.msgBody.textContent = body || '';
    els.retryBtn.style.display = showRetry ? 'inline-flex' : 'none';
    els.msgBox.classList.add('active');
  }
  function _hideMessage() { state.els.msgBox.classList.remove('active'); }

  async function _listCameras() {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      state.devices = all.filter(d => d.kind === 'videoinput');
    } catch (e) { state.devices = []; }
    state.els.switchBtn.hidden = state.devices.length < 2;
  }

  function _stopStream() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
      state.stream = null;
    }
  }

  async function _startCamera() {
    const els = state.els;
    _hideMessage();
    _stopStream();

    if (!window.isSecureContext) {
      _showMessage('يتطلب اتصال آمن', 'مسح الكاميرا يعمل فقط عبر HTTPS أو على هذا الجهاز محلياً. استخدم الإدخال اليدوي بالأسفل.', false);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      _showMessage('الكاميرا غير مدعومة', 'هذا المتصفح لا يدعم الوصول للكاميرا. استخدم الإدخال اليدوي بالأسفل.', false);
      return;
    }

    const chosen = (state.deviceLocked && state.devices[state.deviceIndex]) || null;
    const videoConstraints = chosen
      ? { deviceId: { exact: chosen.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } };

    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    } catch (err) {
      // إن فشل قيد الكاميرا الخلفية على بعض الحواسيب، جرّب أي كاميرا متاحة
      try {
        state.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        _handleCameraError(err2);
        return;
      }
    }

    els.video.srcObject = state.stream;
    els.video.playsInline = true;
    try { await els.video.play(); } catch (e) {}

    _resizeCanvas();
    if (!state.resizeObs && window.ResizeObserver) {
      state.resizeObs = new ResizeObserver(_resizeCanvas);
      state.resizeObs.observe(els.videoWrap);
    }

    if (!state.devices.length) await _listCameras();

    const track = state.stream.getVideoTracks()[0];

    if (!state.deviceLocked) {
      const settings = track && track.getSettings ? track.getSettings() : {};
      if (settings.deviceId) {
        const idx = state.devices.findIndex(d => d.deviceId === settings.deviceId);
        if (idx !== -1) state.deviceIndex = idx;
      }
    }

    const caps = (track && track.getCapabilities) ? track.getCapabilities() : {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) {
      try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {}
    }
    els.torchBtn.hidden = !(caps && caps.torch);
    state.torchOn = false;
    els.torchBtn.classList.remove('active');

    _setupZoom(track);

    els.status.textContent = state.continuousMode
      ? 'وضع المسح المتتالي مفعّل — امسح عدة أكواد دون إغلاق النافذة'
      : 'وجّه الكاميرا نحو الباركود — سيتم اكتشافه تلقائياً';
    _startDetectionLoop();
  }

  function _handleCameraError(err) {
    const name = (err && err.name) || '';
    let title = 'تعذّر تشغيل الكاميرا';
    let body = 'تحقق من إعدادات الكاميرا وحاول مجدداً، أو استخدم الإدخال اليدوي بالأسفل.';
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
      title = 'تم رفض إذن الكاميرا';
      body = 'يرجى السماح بالوصول للكاميرا من إعدادات المتصفح ثم إعادة المحاولة.';
    } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      title = 'لا توجد كاميرا';
      body = 'لم يتم العثور على كاميرا متاحة على هذا الجهاز.';
    } else if (name === 'NotReadableError' || name === 'TrackStartError') {
      title = 'الكاميرا مستخدمة حالياً';
      body = 'الكاميرا قيد الاستخدام من تطبيق آخر. أغلقه وحاول مجدداً.';
    }
    _showMessage(title, body, true);
  }

  async function _switchCamera() {
    if (state.devices.length < 2) return;
    state.deviceLocked = true;
    state.deviceIndex = (state.deviceIndex + 1) % state.devices.length;
    await _startCamera();
  }

  async function _toggleTorch() {
    if (!state.stream) return;
    const track = state.stream.getVideoTracks()[0];
    if (!track) return;
    try {
      state.torchOn = !state.torchOn;
      await track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
      state.els.torchBtn.classList.toggle('active', state.torchOn);
    } catch (e) { /* بعض الأجهزة لا تدعم applyConstraints للفلاش رغم إعلانها القدرة */ }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  محرّك الاكتشاف: BarcodeDetector الأصلي، وإلا ZXing كخيار بديل
  // ═══════════════════════════════════════════════════════════════════════
  function _stopDetectionLoop() {
    if (state.detectTimer) { clearTimeout(state.detectTimer); state.detectTimer = null; }
    if (state.zxingReader) { try { state.zxingReader.reset(); } catch (e) {} state.zxingReader = null; }
    state.detector = null;
    state.engine = null;
    state.nativeDeadline = 0;
  }

  function _loadZXingEngine() {
    state.els.status.textContent = 'جارٍ تحميل محرك المسح...';
    _loadZXing().then(ZXing => {
      if (!state.active) return; // أُغلقت النافذة أثناء التحميل
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        ZXing.BarcodeFormat.CODE_39, ZXing.BarcodeFormat.CODE_128, ZXing.BarcodeFormat.CODE_93,
        ZXing.BarcodeFormat.EAN_13, ZXing.BarcodeFormat.EAN_8, ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E, ZXing.BarcodeFormat.CODABAR, ZXing.BarcodeFormat.ITF,
        ZXing.BarcodeFormat.QR_CODE
      ]);
      const reader = new ZXing.BrowserMultiFormatReader(hints);
      state.engine = 'zxing';
      state.zxingReader = reader;
      state.els.status.textContent = 'وجّه الكاميرا نحو الباركود — سيتم اكتشافه تلقائياً';
      reader.decodeFromStream(state.stream, state.els.video, (result, err) => {
        if (result && state.active) {
          const pts = (result.getResultPoints ? result.getResultPoints() : []) || [];
          if (pts.length) _drawDetectionPoints(pts.map(p => ({ x: p.getX(), y: p.getY() })));
          _onDetected(result.getText());
        }
      }).catch(() => {});
    }).catch(() => {
      _showMessage('تعذّر تحميل محرك المسح', 'يتطلب هذا اتصالاً بالإنترنت في أول استخدام على هذا المتصفح. استخدم الإدخال اليدوي بالأسفل.', true);
    });
  }

  async function _startDetectionLoop() {
    _stopDetectionLoop();

    // ملاحظة مهمة: بعض المتصفحات (خصوصاً Chrome على ويندوز/لينكس) تُظهر واجهة
    // BarcodeDetector كموجودة رغم أن نظام التشغيل لا يوفّر محرك اكتشاف فعلي
    // خلفها (الدعم الحقيقي مقتصر على macOS وأندرويد). لذا نتحقق فعلياً عبر
    // getSupportedFormats() بدل الاكتفاء بفحص وجود الواجهة فقط، وإلا سيبدو
    // المسح "يعمل" بينما هو لا يكتشف شيئاً أبداً في الخلفية.
    if ('BarcodeDetector' in window && typeof window.BarcodeDetector.getSupportedFormats === 'function') {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        const usable = FORMATS.filter(f => supported.includes(f));
        if (usable.length) {
          state.detector = new window.BarcodeDetector({ formats: usable });
          state.engine = 'native';
          state.nativeDeadline = Date.now() + NATIVE_TIMEOUT_MS;
          if (!state.active) return;
          _tickNative();
          return;
        }
      } catch (e) { /* تجاهل وانتقل للبديل */ }
    }

    _loadZXingEngine();
  }

  async function _tickNative() {
    if (!state.active || state.engine !== 'native') return;
    try {
      const video = state.els.video;
      if (video.readyState >= 2) {
        const results = await state.detector.detect(video);
        if (results && results.length && state.active) {
          if (results[0].cornerPoints && results[0].cornerPoints.length) {
            _drawDetectionPoints(results[0].cornerPoints);
          }
          _onDetected(results[0].rawValue);
          if (!state.active) return;
        }
      }
    } catch (e) { /* تجاهل أخطاء عابرة أثناء التهيئة */ }

    // ─── حماية من الكاميرات/المتصفحات (غالباً حواسيب ويندوز أو لينكس) التي
    // تعلن دعم BarcodeDetector دون أن يكون خلفها محرك اكتشاف فعلي: تحويل
    // صامت إلى ZXing دون إظهار أي خطأ ودون قطع بث الكاميرا ──────────────────
    if (state.active && state.engine === 'native' && Date.now() > state.nativeDeadline) {
      _loadZXingEngine();
      return;
    }

    state.detectTimer = setTimeout(_tickNative, 180);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  عند اكتشاف رمز صالح
  // ═══════════════════════════════════════════════════════════════════════
  function _feedback() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start();
        osc.stop(ctx.currentTime + 0.13);
        osc.onended = () => ctx.close();
      }
    } catch (e) {}
    if (navigator.vibrate) { try { navigator.vibrate(80); } catch (e) {} }
  }

  function _onDetected(code) {
    const val = String(code || '').trim();
    if (!val) return;
    const now = Date.now();
    if (val === state.lastCode && (now - state.lastCodeAt) < 1500) return; // منع التكرار السريع
    state.lastCode = val;
    state.lastCodeAt = now;

    _pushHistory(val);
    if (state.els.historyPanel.classList.contains('active')) _renderHistory();

    const els = state.els;
    els.frame.classList.add('dks-success');
    _feedback();

    const cb = state.onResult;

    if (state.continuousMode && state.active) {
      // وضع المسح المتتالي: لا نُغلق النافذة، نستمر بالمسح ونعرض عدّاداً
      state.scanCount += 1;
      els.counterNum.textContent = String(state.scanCount);
      els.status.textContent = `تم الاكتشاف: ${val}`;
      if (typeof cb === 'function') cb(val);
      setTimeout(() => { if (state.active) els.frame.classList.remove('dks-success'); }, 350);
      setTimeout(() => {
        if (state.active) els.status.textContent = 'وضع المسح المتتالي مفعّل — امسح عدة أكواد دون إغلاق النافذة';
      }, 1400);
      return;
    }

    els.status.textContent = `تم الاكتشاف: ${val}`;
    setTimeout(() => {
      _close();
      if (typeof cb === 'function') cb(val);
    }, 260);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  فتح / إغلاق نافذة المسح
  // ═══════════════════════════════════════════════════════════════════════
  function open(onResult, opts) {
    opts = opts || {};
    _injectStyles();
    const els = _buildModal();

    if (state.active) _close();

    state.active = true;
    state.onResult = onResult;
    state.deviceIndex = 0;
    state.deviceLocked = false;
    state.lastCode = '';
    state.lastCodeAt = 0;
    state.scanCount = 0;
    state.continuousMode = opts.continuous != null ? !!opts.continuous : _loadContinuousPref();
    els.frame.classList.remove('dks-success');
    els.manualInput.value = '';
    els.continuousBtn.classList.toggle('active', state.continuousMode);
    els.counterBadge.classList.toggle('active', state.continuousMode);
    els.counterNum.textContent = '0';
    els.historyPanel.classList.remove('active');
    els.historyHead.classList.remove('active-head');
    els.historyToggle.classList.remove('active');
    els.zoomRow.classList.remove('active');
    _clearCanvas();
    if (opts.title) els.overlay.querySelector('.dks-header h2').innerHTML =
      `<i class="fas fa-camera"></i> ${opts.title}`;

    els.overlay.classList.add('active');
    document.body.style.overflow = 'hidden';

    _listCameras().then(_startCamera);
    setTimeout(() => els.manualInput && els.manualInput.blur(), 0);
  }

  function _close() {
    state.active = false;
    _stopDetectionLoop();
    _stopStream();
    if (state.boxClearTimer) { clearTimeout(state.boxClearTimer); state.boxClearTimer = null; }
    if (state.resizeObs) { try { state.resizeObs.disconnect(); } catch (e) {} state.resizeObs = null; }
    if (state.els) {
      _clearCanvas();
      state.els.overlay.classList.remove('active');
      state.els.video.srcObject = null;
      _hideMessage();
    }
    document.body.style.overflow = '';
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ربط زر مسح بحقل إدخال موجود في الصفحة
  //  mode: 'enter' → يملأ الحقل ثم يحاكي ضغط Enter (يشغّل منطق الحقل الحالي
  //                   بالضبط كما لو كتبه قارئ باركود فيزيائي حقيقي)
  //        'fill'  → يملأ الحقل فقط ويطلق حدث input (بدون محاكاة Enter)
  // ═══════════════════════════════════════════════════════════════════════
  function _applyToField(input, code, opts) {
    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    if (opts.mode === 'enter') {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }));
    } else if (typeof window.toast === 'function') {
      window.toast('تم تعبئة الباركود بالمسح ✓ / Barcode filled by scan', 'success');
    }
  }

  function _makeButton(onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dks-scan-btn';
    btn.title = 'مسح بالكاميرا / Scan with camera';
    btn.setAttribute('aria-label', 'مسح الباركود بالكاميرا');
    btn.innerHTML = '<i class="fas fa-camera"></i>';
    btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return btn;
  }

  function attachButton(inputId, opts) {
    opts = opts || { mode: 'enter' };
    const input = document.getElementById(inputId);
    if (!input || input.dataset.dksAttached) return;
    input.dataset.dksAttached = '1';

    const btn = _makeButton(() => {
      open(code => _applyToField(input, code, opts), opts);
    });

    const inlineWrap = input.closest('.inv-barcode-search-wrap, .pos-search-bar');
    if (inlineWrap) { inlineWrap.appendChild(btn); return; }

    const parent = input.parentElement;
    if (!parent) return;

    if (parent.classList.contains('filter-bar')) {
      parent.insertBefore(btn, input.nextSibling);
      return;
    }
    if (parent.classList.contains('form-group')) {
      const row = document.createElement('div');
      row.className = 'dks-inline-row';
      parent.insertBefore(row, input);
      row.appendChild(input);
      row.appendChild(btn);
      return;
    }
    // حاوية مرنة عامة (مثل صف بحث الفاتورة داخل نافذة المرتجع)
    parent.appendChild(btn);
  }

  // ─── زر عام في الشريط العلوي: متاح من أي صفحة، يوجّه النتيجة تلقائياً
  //     بنفس منطق قارئ الباركود الفيزيائي عبر window.handleGlobalScan ──────
  function attachGlobalButton() {
    const topbarRight = document.querySelector('.topbar-right');
    if (!topbarRight || document.getElementById('dks-global-btn')) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'dks-global-btn';
    btn.className = 'dks-global-btn';
    btn.title = 'مسح باركود بالكاميرا / Scan barcode with camera';
    btn.innerHTML = '<i class="fas fa-camera"></i>';
    btn.addEventListener('click', () => {
      open(code => {
        if (typeof window.handleGlobalScan === 'function') {
          window.handleGlobalScan(code);
        } else if (typeof window.toast === 'function') {
          window.toast(`تم مسح: ${code}`, 'info');
        }
      }, { title: 'مسح سريع من أي مكان / Quick Scan' });
    });

    const bell = topbarRight.querySelector('.notif-bell');
    if (bell) topbarRight.insertBefore(btn, bell);
    else topbarRight.appendChild(btn);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  التهيئة التلقائية عند تحميل الصفحة — تُضيف أزرار المسح لكل الحقول
  //  المعروفة دون الحاجة لأي تعديل يدوي إضافي في index.html
  // ═══════════════════════════════════════════════════════════════════════
  function _autoInit() {
    attachButton('pos-search',          { mode: 'enter' });
    attachButton('inv-barcode-search',  { mode: 'enter' });
    attachButton('ret-search',          { mode: 'enter' });
    attachButton('ret-inv-input',       { mode: 'enter' });
    attachButton('prod-barcode',        { mode: 'fill'  });
    attachButton('prod-search',         { mode: 'fill'  });
    attachGlobalButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _autoInit);
  } else {
    _autoInit();
  }

  return { open, attachButton, attachGlobalButton };

})();