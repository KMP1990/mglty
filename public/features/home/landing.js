/**
 * الصفحة التعريفية (ميزة داخلية داخل home) — للزوار غير المسجّلين.
 * المحتوى نفسه السابق، مفصولًا حتى تبقى لوحة اليوم ملفًا مستقلًا.
 */
import { loadStyles } from '../../assets/core/styles.js';
import { appStore } from '../../assets/core/core.js';
import { installCardHtml, bindInstall } from './install.js';

const FEATURES = [
  {
    title: 'روتين يومي بذكاء',
    body: 'خطة يوم جاهزة، ترتيب تلقائي حسب وقتك وطاقتك، وسلسلة أيام تحفّزك على الاستمرار.',
    icon: '<path d="M3.5 5h17v16h-17z"/><path d="M8 3v4M16 3v4M3.5 10h17M8 14l2 2 4-4"/>',
  },
  {
    title: 'مدرب ذكاء اصطناعي',
    body: 'يحلّل التزامك ويكتشف الروتين المتعثّر وأفضل نافذة وقت، ثم يقترح أصغر خطوة تُنجحك.',
    icon: '<path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  },
  {
    title: 'تذكير في وقته',
    body: 'تنبيه لحظة موعد الروتين ودفعة مسائية للأشياء المتبقية — داخل التطبيق وخارجه.',
    icon: '<path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  },
  {
    title: 'حفظ قوي فعلًا',
    body: 'تشفير AES-GCM بمفتاح غير قابل للاستخراج، كتابة على مرحلتين، ونسخ احتياطية متعددة.',
    icon: '<path d="M12 3l7 3v5.5c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6z"/><path d="m9 12 2 2 4-4"/>',
  },
  {
    title: 'إشعارات لحظية',
    body: 'تصل فورًا دون تحديث الصفحة، مع شارة عدّاد وتصفية ذكية للمقروء وغير المقروء.',
    icon: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>',
  },
  {
    title: 'يعمل دون إنترنت',
    body: 'ثبّته كتطبيق وافتحه في الطائرة — روتيناتك وبياناتك حاضرة دائمًا.',
    icon: '<path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5.5 5.5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  },
];

export async function mountLanding(root) {
  await loadStyles(['/features/home/home.css']);
  const authed = appStore.state.authenticated;
  const user = appStore.state.user;

  root.innerHTML = `
    <section class="hero">
      <div class="container hero-grid">
        <div>
          <span class="chip chip-brand">✦ روتين ذكي + مدرب شخصي</span>
          <h1 style="margin-top:12px">روتينك اليومي،<br /><span class="grad">مرتّبًا بذكاء.</span></h1>
          <p class="lead">خطة يوم تُبنى من عاداتك الحقيقية، مدرب يقرأ التزامك ويقترح ما ينجح فعلًا، وتذكير لا يتركك تنسى — مع حفظ مشفّر على جهازك.</p>
          <div class="hero-cta">
            ${authed
      ? `<a class="btn btn-primary" href="/" data-link>مرحبًا ${escapeHtml(user?.name?.split(' ')[0] || '')} — روتيناتي</a>`
      : `<a class="btn btn-primary" href="/signup" data-link>أنشئ حسابك مجانًا</a>
                   <a class="btn" href="/login" data-link>لدي حساب — دخول</a>`
    }
            <button class="btn btn-ghost" data-install-cta hidden>ثبّت كتطبيق</button>
          </div>
          <p class="hero-note">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>
            بدون متجر تطبيقات، وبلا إعلانات.
          </p>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="hero-3d">
            <span class="h3d h3d-ring"><i></i></span>
            <span class="h3d h3d-cube"><span class="cube-spin"><i></i><i></i><i></i><i></i><i></i><i></i></span></span>
            <span class="h3d h3d-orb"></span>
            <span class="h3d h3d-pyramid"><i></i></span>
          </div>
          <div class="phone">
            <div class="phone-screen">
              <div class="phone-top"><span>${new Date().toLocaleDateString('ar', { weekday: 'long' })}</span><span>☾</span></div>
              <div style="display:grid;gap:10px">
                <div class="phone-card phone-card-accent">
                  <strong style="font-size:.78rem">إنجاز اليوم 67%</strong>
                  <span class="line"></span><span class="line short"></span>
                </div>
                <div class="phone-list">
                  <div class="phone-row" data-done="true"><span class="bullet"></span><span>قراءة 10 صفحات</span></div>
                  <div class="phone-row" data-done="true"><span class="bullet"></span><span>مشي 15 دقيقة</span></div>
                  <div class="phone-row"><span class="bullet"></span><span>تمدد 5 دقائق</span></div>
                </div>
                <div class="phone-card">
                  <strong style="font-size:.72rem">✦ نصيحة المدرب</strong>
                  <span class="line"></span><span class="line short"></span>
                </div>
              </div>
            </div>
          </div>
          <span class="float-badge b1">🔥 سلسلة 7 أيام</span>
          <span class="float-badge b2">✦ مدرب ذكي</span>
        </div>
      </div>
    </section>

    <section class="section container">
      <div class="section-head-center">
        <span class="chip">ماذا يصنع الفرق؟</span>
        <h2 style="margin-top:12px">ستة أساسات، كل واحدة بملفها الخاص</h2>
      </div>
      <div class="features">
        ${FEATURES.map(
      (f) => `<article class="card feature">
            <span class="feature-ico"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${f.icon}</svg></span>
            <h3>${f.title}</h3><p>${f.body}</p>
          </article>`
    ).join('')}
      </div>
    </section>

    <section class="section container" id="install">
      <div class="section-head-center">
        <span class="chip chip-mint">التثبيت في 5 ثوانٍ</span>
        <h2 style="margin-top:12px">خُذه معك كتطبيق</h2>
      </div>
      <div class="install-grid">${installCardHtml()}</div>
    </section>

    <div class="container">
      <div class="cta-band">
        <div><h2>جاهز تبدأ؟</h2><p style="margin:0">روتينك الأول على بُعد دقيقة.</p></div>
        <a class="btn btn-primary" href="${authed ? '/' : '/signup'}" data-link>${authed ? 'روتيناتي' : 'ابدأ الآن'}</a>
      </div>
    </div>`;

  bindInstall(root);
  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
