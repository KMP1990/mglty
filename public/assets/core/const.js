/**
 * ثوابت وقت البناء — تُحقن من الخادم في وسم ثابت قبل تحميل النواة.
 * القيم الاحتياطية تجعل الملفات تعمل حتى لو فُتحت مباشرة في التطوير.
 */
(function () {
  if (!window.__MR_VERSION__) window.__MR_VERSION__ = 'dev';
  if (!window.__MR_BUILD__) window.__MR_BUILD__ = new Date().toISOString();
})();

export const __APP_VERSION__ = window.__MR_VERSION__ || 'dev';
export const __BUILD_TIME__ = window.__MR_BUILD__ || new Date().toISOString();
