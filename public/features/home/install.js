/**
 * التثبيت كتطبيق (ميزة فرعية داخل home) — يتحدث أندرويد/كروم/إيدج مباشرة،
 * ويشرح خطوات iOS لأن سفاري لا يوفر حدث beforeinstallprompt.
 */
import { toast } from '../../assets/core/core.js';

let deferredPrompt = null;
let installedThisSession = false;

// يُلتقط مبكرًا من boot (core) ويُحفظ هنا عبر حدث مخصص
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  window.dispatchEvent(new CustomEvent('mr:install-available'));
});
window.addEventListener('appinstalled', () => {
  installedThisSession = true;
  deferredPrompt = null;
  toast.success('تم التثبيت! ستجده على شاشتك الرئيسية 🎉');
});

export const installState = () => ({
  canPrompt: Boolean(deferredPrompt),
  standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  installed: installedThisSession,
  ios: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
});

export async function promptInstall() {
  if (!deferredPrompt) {
    toast.info(
      installState().ios
        ? 'على آيفون/آيباد: اضغط زر المشاركة ثم «إضافة إلى الشاشة الرئيسية».'
        : 'استخدم قائمة المتصفح ⋮ ثم «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».'
    );
    return false;
  }
  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null;
  return choice?.outcome === 'accepted';
}

export function installCardHtml() {
  return `<div class="card install-card">
    <h3 style="margin:0">طريقة التثبيت حسب جهازك</h3>
    <div class="row" role="tablist" aria-label="نظام الجهاز" data-os-tabs>
      <button class="btn btn-sm btn-soft" data-os="android">أندرويد / كروم</button>
      <button class="btn btn-sm" data-os="ios">آيفون / آيباد</button>
      <button class="btn btn-sm" data-os="desktop">حاسوب</button>
    </div>
    <ol data-os-steps>
      <li>اضغط زر <strong>«ثبّت كتطبيق»</strong> هنا مباشرة، أو من قائمة المتصفح ⋮</li>
      <li>اختر <strong>«تثبيت التطبيق»</strong> ثم أكّد.</li>
      <li>ستجد الأيقونة على شاشتك الرئيسية.</li>
    </ol>
    <button class="btn btn-primary btn-block" data-install-cta>ثبّت كتطبيق الآن</button>
    <small style="color:var(--text-muted)">يعمل على أي متصفح حديث، وبدون متجر تطبيقات.</small>
  </div>`;
}

const STEPS = {
  android: [
    'افتح القائمة ⋮ في أعلى المتصفح.',
    'اختر «تثبيت التطبيق» أو «إضافة إلى الشاشة الرئيسية».',
    'أكّد — وستجد الأيقونة بين تطبيقاتك.',
  ],
  ios: [
    'افتح الموقع في <strong>سفاري</strong> (ليس متصفحًا آخر).',
    'اضغط زر المشاركة <kbd>⤴</kbd> أسفل الشاشة.',
    'اختر «إضافة إلى الشاشة الرئيسية» ثم «إضافة».',
  ],
  desktop: [
    'ابحث عن أيقونة التثبيت <kbd>⊕</kbd> داخل شريط العنوان.',
    'أو من القائمة ⋮ ← «تثبيت مجلتي وروتيني».',
    'سيُفتح في نافذة مستقلة كتطبيق سطح مكتب.',
  ],
};

export function bindInstall(root) {
  const applyState = () => {
    const s = installState();
    root.querySelectorAll('[data-install-cta]').forEach((b) => (b.hidden = s.standalone || s.installed));
    const stateEl = root.querySelector('[data-install-state]');
    if (stateEl) {
      stateEl.textContent = s.standalone
        ? 'مثبَّت — يعمل كتطبيق ✔'
        : s.canPrompt
          ? 'جاهز للتثبيت بضغطة'
          : s.ios
            ? 'آيفون: عبر زر المشاركة'
            : 'من قائمة المتصفح';
    }
  };
  applyState();
  window.addEventListener('mr:install-available', applyState);

  const os = installState().ios ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'desktop';
  const setOs = (key) => {
    root.querySelectorAll('[data-os]').forEach((b) => {
      b.classList.toggle('btn-soft', b.dataset.os === key);
    });
    const list = root.querySelector('[data-os-steps]');
    if (list) list.innerHTML = STEPS[key].map((s) => `<li>${s}</li>`).join('');
  };
  setOs(os);
  root.querySelectorAll('[data-os]').forEach((b) => b.addEventListener('click', () => setOs(b.dataset.os)));

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-install-cta]')) promptInstall();
  });
}
