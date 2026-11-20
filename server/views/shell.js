/**
 * قوالب HTML على الخادم — مصدر واحد لصفحات التطبيق.
 * لماذا على الخادم؟ لأن حقن بصمة البناء يجب أن يحدث قبل إرسال الصفحة،
 * وبذلك لا يوجد ملف index.html يمكن أن "يتيه" منه سكربت الإقلاع.
 */

/** هيكل الصفحة العام: رأس مشترك + مساحة العرض + تذييل */
export function appShell({ year = new Date().getFullYear() } = {}) {
  return `  <a class="skip-link" href="#app-view">تخطَّ إلى المحتوى</a>
  <header class="app-header">
    <div class="container">
      <a class="logo" href="/" data-link aria-label="مجلتي وروتيني — الرئيسية">
        <span class="logo-mark" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7"/></svg></span>
        <span class="logo-text">مجلتي وروتيني<small>دفتر وسِجلّك الشخصي</small></span>
      </a>
      <nav class="main-nav" aria-label="أقسام التطبيق">
        <a href="/" data-link>الرئيسية</a>
        <a href="/books" data-link>كتبي</a>
        <a href="/routines" data-link>روتيناتي</a>
        <a href="/coach" data-link>المدرب</a>
      </nav>
      <div class="header-actions">
        <button class="btn btn-ghost btn-icon hide-sm" data-sound-toggle type="button" data-sound="on" aria-pressed="true" aria-label="إيقاف أصوات التطبيق" title="إيقاف أصوات التطبيق">
          <svg data-sound-on width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L13 5v14l-5.5-4.5H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>
          <svg data-sound-off width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" hidden><path d="M4 9.5h3.5L13 5v14l-5.5-4.5H4z"/><path d="m17 9 4 4M21 9l-4 4"/></svg>
        </button>
        <button class="btn btn-ghost btn-icon" data-theme-toggle type="button" aria-label="تبديل الوضع الليلي">
          <svg data-icon="moon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>
          <svg data-icon="sun" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" style="display:none"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
        </button>
        <div class="row" style="gap:8px" data-auth-area></div>
      </div>
    </div>
  </header>
  <main id="app-view" tabindex="-1"></main>
  <nav class="mobile-tabs" data-mobile-tabs aria-label="تنقل سريع" hidden></nav>
  <footer class="site-footer">
    <div class="container row" style="justify-content:space-between">
      <small>© ${year} مجلتي وروتيني — صُنع بعناية للمساحة الشخصية.</small>
      <nav class="row" style="gap:16px">
        <a href="/books" data-link>كتبي</a>
        <a href="/routines" data-link>روتيناتي</a>
        <a href="/coach" data-link>المدرب الذكي</a>
        <a href="/vault" data-link>الخزنة</a>
        <a href="/notifications" data-link>الإشعارات</a>
        <a href="/terms">الشروط</a>
        <a href="/privacy">الخصوصية</a>
      </nav>
    </div>
  </footer>`;
}

/** صفحة كاملة جاهزة (head + shell + سكربتات) */
export function documentPage({ title, route = 'home', body, extraHead = '', buildMarker = '' }) {
  return `<!doctype html>
<html lang="ar" dir="rtl" data-theme="light">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<meta name="description" content="مجلتي وروتيني — مساحة أنيقة لمقالاتك وروتينك اليومي. موقع يعمل كتطبيق، يعمل دون اتصال، ويحفظ بياناتك مشفّرة على جهازك." />
<meta name="theme-color" content="#fdfbfb" />
<link rel="manifest" href="/manifest.webmanifest" />
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
<link rel="apple-touch-icon" href="/icons/icon-192.png" />
<link rel="preload" href="/assets/fonts/noto-sans-arabic-arabic.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/assets/fonts/cairo-arabic.woff2" as="font" type="font/woff2" crossorigin />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="مجلتي وروتيني" />
<link rel="stylesheet" href="/styles/fonts.css" />
<link rel="stylesheet" href="/styles/tokens.css" />
<link rel="stylesheet" href="/styles/base.css" />
${extraHead}${buildMarker ? `\n${buildMarker}` : ''}
</head>
<body data-route="${route}">
${body}
<script type="module" src="/assets/core/boot.js"></script>
</body>
</html>`;
}
