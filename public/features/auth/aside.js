/**
 * الجانب التعريفي المشترك لصفحتي الدخول وإنشاء الحساب (ميزة فرعية).
 */
import { icons } from './ui.js';

export function asideHtml({ title, lead }) {
  return `
    <span class="chip chip-brand" style="justify-self:start">✦ مجلتي وروتيني</span>
    <h2>${title}</h2>
    <p class="lead">${lead}</p>
    <ul class="auth-points">
      <li>
        <span class="pt-ico" style="color:var(--brand-600)">${icons.shield}</span>
        <span>حفظ قوي ومشفّر على جهازك<small>AES-GCM 256 + نسخة احتياطية ثانية + سلة محذوفات</small></span>
      </li>
      <li>
        <span class="pt-ico" style="color:var(--mint-600)">${icons.device}</span>
        <span>ثبّته كتطبيق من المتصفح<small>يعمل دون إنترنت، ويظهر كأيقونة على شاشتك</small></span>
      </li>
      <li>
        <span class="pt-ico" style="color:var(--honey-500)">${icons.book}</span>
        <span>مجلتك وروتينك في مكان واحد<small>كل ميزة في وحدتها — خفيفة وسريعة</small></span>
      </li>
    </ul>`;
}
