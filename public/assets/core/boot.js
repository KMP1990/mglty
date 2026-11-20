/**
 * نقطة إقلاع التطبيق — تحمّل النواة وتُشغّلها.
 */
import { boot } from './core.js';

boot().catch((err) => {
  console.error('[boot]', err);
  const slot = document.getElementById('app-view');
  if (slot) {
    slot.innerHTML = `<div class="container stack" style="padding-block:64px;text-align:center">
      <h2>تعذّر تشغيل التطبيق</h2>
      <p>أعد تحميل الصفحة أو تحقق من المتصفح.</p>
      <button class="btn btn-primary" data-reload>إعادة التحميل</button>
    </div>`;
    document.querySelector('[data-reload]')?.addEventListener('click', () => location.reload());
  }
});
