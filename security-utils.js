/**
 * DAKANI SECURITY UTILS
 * ─────────────────────────────────────────────────────────────
 * ملف مستقل وصغير جداً (لا يعدّل أي ملف موجود ولا يلمس أي دالة قديمة).
 * الهدف الوحيد: توفير دالة تنظيف نصوص عامة (escHtml) تُستخدم قبل حقن أي
 * بيانات "أدخلها المستخدم" (اسم عميل، اسم مورد، اسم منتج، ملاحظات...)
 * داخل innerHTML، لمنع هجمات XSS (مثال: عميل اسمه
 *   <img src=x onerror=alert(1)>
 * كان سيُنفَّذ كـ HTML/JS فعلي بدل أن يُعرض كنص عادي).
 *
 * لماذا ملف مستقل؟
 *  - نفس مبدأ باقي الملفات المستقلة في المشروع (camera-scanner.js,
 *    keyboard-shortcuts.js...): صفر تعديل على الدوال القديمة، فقط
 *    إضافة دالة عامة جاهزة للاستخدام في أي مكان.
 *  - يجب تحميله *قبل* database.js/script.js/accounts.js في index.html
 *    (وهو مضاف بالفعل في أول <script> بعد i18n.js، وأيضاً في sw.js
 *    ضمن قائمة الملفات المخزَّنة للعمل بدون إنترنت).
 *
 * الاستخدام:
 *   escHtml(userValue)   → نص آمن للحقن داخل innerHTML كمحتوى نصي
 *   escAttr(userValue)   → نفس الشيء، آمن أيضاً داخل قيم attributes مثل
 *                          href="tel:${escAttr(phone)}"
 * (escAttr هي فعلياً نفس escHtml لأن الترميز الكامل لـ & < > " '
 *  يغطي سياق النص وسياق الـ attribute المقتبس بعلامات " أو ' معاً)
 */
(function (global) {
  const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, ch => MAP[ch]);
  }

  global.escHtml = escHtml;
  global.escAttr = escHtml; // نفس المنطق، اسم مختلف فقط لوضوح القراءة في مكان الاستخدام
})(window);