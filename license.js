/**
 * DAKANI LICENSE SYSTEM v2.0
 * - التحقق من المفتاح رياضياً (أوفلاين)
 * - ربط المفتاح ببصمة الجهاز
 * - كشف أدوات المطور (F12)
 */

const DakaniLicense = (() => {

  // ════════════════════════════════════════════════════════════
  //  ⚠️  غيّر هذه القيمة قبل النشر — يجب أن تطابق keygen.html
  // ════════════════════════════════════════════════════════════
  const SECRET = 'DAKANI-2025-SÉTIF-PRO-X9K2';

  const STORAGE_KEY  = 'dakani_lic';
  const DEVICE_KEY   = 'dakani_did';

  // ─── بصمة الجهاز ─────────────────────────────────────────────────────────
  function _fingerprint() {
    const raw = [
      navigator.language,
      navigator.platform,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      Intl.DateTimeFormat().resolvedOptions().timezone,
      navigator.hardwareConcurrency || 0
    ].join('|');
    return _hash(raw).slice(0, 8);
  }

  // ─── دالة الهاش ──────────────────────────────────────────────────────────
  function _hash(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).toUpperCase().padStart(8, '0');
  }

  function _computeChecksum(payload) {
    return _hash(SECRET + payload + SECRET).slice(0, 4);
  }

  // ─── تحليل المفتاح ────────────────────────────────────────────────────────
  function _parseKey(key) {
    const clean = key.toUpperCase().replace(/\s/g, '');
    const parts = clean.split('-');
    if (parts.length !== 3 || parts[0] !== 'DKN') return null;
    const payload  = parts[1];
    const checksum = parts[2];
    if (payload.length < 10 || checksum.length !== 4) return null;
    const dateStr    = payload.slice(0, 8);
    const merchantId = payload.slice(8);
    const year  = parseInt(dateStr.slice(0, 4));
    const month = parseInt(dateStr.slice(4, 6)) - 1;
    const day   = parseInt(dateStr.slice(6, 8));
    const expiry = new Date(year, month, day, 23, 59, 59);
    return { payload, checksum, expiry, merchantId, raw: clean };
  }

  // ─── التحقق من المفتاح ────────────────────────────────────────────────────
  function verify(key) {
    const parsed = _parseKey(key);
    if (!parsed) return { valid: false, reason: 'صيغة المفتاح غير صحيحة' };
    if (_computeChecksum(parsed.payload) !== parsed.checksum)
      return { valid: false, reason: 'مفتاح غير صالح' };
    if (new Date() > parsed.expiry)
      return { valid: false, reason: 'انتهت صلاحية الترخيص بتاريخ ' + parsed.expiry.toLocaleDateString('ar-DZ') };
    return { valid: true, expiry: parsed.expiry, merchantId: parsed.merchantId };
  }

  // ─── حفظ واسترجاع ────────────────────────────────────────────────────────
  function save(key) {
    try {
      localStorage.setItem(STORAGE_KEY, key);
      // احفظ بصمة الجهاز عند أول تفعيل
      if (!localStorage.getItem(DEVICE_KEY)) {
        localStorage.setItem(DEVICE_KEY, _fingerprint());
      }
    } catch(e) {}
  }

  function load() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; }
  }

  function _savedDevice() {
    try { return localStorage.getItem(DEVICE_KEY) || ''; } catch(e) { return ''; }
  }

  // ─── فحص بصمة الجهاز ─────────────────────────────────────────────────────
  function _deviceMatch() {
    const saved = _savedDevice();
    if (!saved) return true; // أول مرة
    return saved === _fingerprint();
  }

  // ─── كشف F12 / أدوات المطور ──────────────────────────────────────────────
  function _watchDevTools() {
    // الطريقة 1: فارق التوقيت مع debugger
    function _timerCheck() {
      const t = performance.now();
      // eslint-disable-next-line no-debugger
      debugger;
      if (performance.now() - t > 80) _lockdown();
    }

    // الطريقة 2: حجم النافذة (DevTools يُصغّر النافذة)
    function _sizeCheck() {
      const threshold = 160;
      if (
        window.outerWidth  - window.innerWidth  > threshold ||
        window.outerHeight - window.innerHeight > threshold
      ) _lockdown();
    }

    // الطريقة 3: خاصية toString على devtools
    let _devOpen = false;
    const _img = new Image();
    Object.defineProperty(_img, 'id', {
      get() { _devOpen = true; _lockdown(); return ''; }
    });

    setInterval(_timerCheck, 3000);
    setInterval(_sizeCheck,  1500);
    setInterval(() => { _devOpen = false; console.log(_img); }, 2000);
  }

  // ─── قفل التطبيق ─────────────────────────────────────────────────────────
  function _lockdown() {
    document.body.innerHTML = '';
    document.body.style.background = '#0a0f1e';
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(DEVICE_KEY);
    setTimeout(() => location.reload(), 2000);
  }

  // ─── شاشة الترخيص ────────────────────────────────────────────────────────
  function showLicenseScreen(reason) {
    document.body.style.overflow = 'hidden';
    const overlay = document.createElement('div');
    overlay.id = 'license-overlay';
    overlay.innerHTML = `
      <div class="lic-box">
        <div class="lic-logo">
          <i class="fas fa-store"></i>
          <div>
            <span class="lic-brand-ar">دكاني</span>
            <span class="lic-brand-en">Dakani POS</span>
          </div>
        </div>
        <div class="lic-icon-wrap">
          <i class="fas fa-shield-halved lic-icon"></i>
        </div>
        <h2 class="lic-title">مرخص ومحمي</h2>
        <p class="lic-subtitle">Licensed & Protected Software</p>
        ${reason ? `<div class="lic-error"><i class="fas fa-circle-xmark"></i> ${reason}</div>` : ''}
        <div class="lic-form">
          <label class="lic-label">
            <i class="fas fa-key"></i> أدخل مفتاح الترخيص / Enter License Key
          </label>
          <input type="text" id="lic-input" class="lic-input"
            placeholder="DKN-XXXXXXXXXX-XXXX"
            autocomplete="off" spellcheck="false" dir="ltr"/>
          <button class="lic-btn" onclick="DakaniLicense.activate()">
            <i class="fas fa-unlock"></i> تفعيل / Activate
          </button>
        </div>
        <p class="lic-contact">
          <i class="fas fa-envelope"></i>
          للحصول على مفتاح ترخيص، تواصل مع المورد
        </p>
        <p class="lic-ver">v2.0 © دكاني 2025</p>
      </div>`;

    const style = document.createElement('style');
    style.textContent = `
      #license-overlay {
        position: fixed; inset: 0; z-index: 99999;
        background: #0a0f1e;
        display: flex; align-items: center; justify-content: center;
        font-family: 'Cairo', sans-serif;
      }
      .lic-box {
        background: #111827; border: 1px solid #1f2937;
        border-radius: 20px; padding: 40px 36px;
        width: 100%; max-width: 420px; text-align: center;
        box-shadow: 0 25px 60px rgba(0,0,0,0.5);
      }
      .lic-logo { display:flex; align-items:center; justify-content:center; gap:12px; margin-bottom:24px; color:#10b981; }
      .lic-logo i { font-size:32px; }
      .lic-brand-ar { display:block; font-size:22px; font-weight:700; color:#fff; }
      .lic-brand-en { display:block; font-size:12px; color:#6b7280; }
      .lic-icon-wrap { width:72px; height:72px; border-radius:50%; background:rgba(16,185,129,0.1); border:2px solid rgba(16,185,129,0.3); display:flex; align-items:center; justify-content:center; margin:0 auto 16px; }
      .lic-icon { font-size:30px; color:#10b981; }
      .lic-title { color:#fff; font-size:20px; font-weight:700; margin:0 0 4px; }
      .lic-subtitle { color:#6b7280; font-size:13px; margin:0 0 20px; }
      .lic-error { background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); color:#f87171; border-radius:10px; padding:10px 14px; font-size:13px; margin-bottom:16px; text-align:right; }
      .lic-form { text-align:right; }
      .lic-label { display:block; color:#9ca3af; font-size:13px; margin-bottom:8px; }
      .lic-input { width:100%; box-sizing:border-box; background:#1f2937; border:1px solid #374151; color:#fff; border-radius:10px; padding:12px 16px; font-size:16px; letter-spacing:2px; text-transform:uppercase; outline:none; text-align:center; margin-bottom:12px; }
      .lic-input:focus { border-color:#10b981; }
      .lic-btn { width:100%; padding:13px; background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:10px; font-size:16px; font-weight:700; font-family:'Cairo',sans-serif; cursor:pointer; }
      .lic-btn:hover { opacity:0.9; }
      .lic-contact { color:#4b5563; font-size:12px; margin:20px 0 4px; }
      .lic-ver { color:#374151; font-size:11px; margin:0; }`;

    document.head.appendChild(style);
    document.body.appendChild(overlay);
    setTimeout(() => document.getElementById('lic-input')?.focus(), 100);
    document.getElementById('lic-input')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') DakaniLicense.activate();
    });
  }

  // ─── تفعيل المفتاح ────────────────────────────────────────────────────────
  function activate() {
    const key = (document.getElementById('lic-input')?.value || '').trim();
    if (!key) return;
    const result = verify(key);
    if (result.valid) {
      save(key);
      document.getElementById('license-overlay')?.remove();
      document.body.style.overflow = '';
      window.dispatchEvent(new Event('dakani-licensed'));
    } else {
      document.getElementById('license-overlay')?.remove();
      showLicenseScreen(result.reason);
    }
  }

  // ─── البوابة الرئيسية ─────────────────────────────────────────────────────
  function gate() {
    _watchDevTools(); // ابدأ المراقبة فوراً

    const savedKey = load();
    if (!savedKey) { showLicenseScreen(null); return false; }

    // فحص بصمة الجهاز
    if (!_deviceMatch()) {
      showLicenseScreen('هذا المفتاح مُفعَّل على جهاز مختلف');
      return false;
    }

    const result = verify(savedKey);
    if (result.valid) return true;
    showLicenseScreen(result.reason);
    return false;
  }

  function info() {
    const key = load();
    if (!key) return null;
    const r = verify(key);
    return r.valid ? { key, ...r } : null;
  }

  return { gate, activate, verify, info };

})();