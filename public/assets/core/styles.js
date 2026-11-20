/**
 * تحميل أوراق الأنماط عند الحاجة (ميزة → ملف CSS خاص بها فقط).
 * يمنع التحميل المزدوج ويكافح التخزين المؤقت القديم بإصدار البناء.
 */
import { __APP_VERSION__ } from './const.js';

const loaded = new Set();

export function loadStyles(hrefs) {
  return Promise.all(
    [].concat(hrefs).map(
      (href) =>
        new Promise((resolve) => {
          // مفتاح بدون باراميتر الإصدار — يمنع إضافة وسم مكرر لنفس الملف
          const key = href.split('?')[0];
          if (loaded.has(key)) return resolve(true);
          const abs = `${key}${key.includes('?') ? '&' : '?'}v=${__APP_VERSION__}`;
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = abs;
          link.onload = () => {
            loaded.add(key);
            resolve(true);
          };
          link.onerror = () => resolve(false);
          document.head.appendChild(link);
        })
    )
  );
}
