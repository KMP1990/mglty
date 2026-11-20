/**
 * Netlify Edge Function — تمرير الصفحات و/api إلى خادم Node.
 * ------------------------------------------------------------
 * Netlify لا يشغّل Express ولا يحفظ ملفات data/ بشكل دائم.
 * الأصول الثابتة (JS/CSS/الصور/vendor) تُخدَم من Netlify مباشرة،
 * بينما الصفحات وطلبات API تُمرَّر إلى BACKEND_ORIGIN.
 *
 * اضبط في Netlify: Site settings → Environment variables
 *   BACKEND_ORIGIN = https://your-app.onrender.com
 *
 * إن لم يُضبط، تُعاد صفحة عربية واضحة بدل خطأ 404 غامض.
 */
const STATIC_FILE = /\.[a-z0-9]{1,12}$/i;

function backendOrigin() {
  try {
    const value = globalThis.Netlify?.env?.get?.('BACKEND_ORIGIN') || globalThis.process?.env?.BACKEND_ORIGIN || '';
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url;
  } catch {
    return null;
  }
}

function missingBackend(request) {
  const wantsJson = new URL(request.url).pathname.startsWith('/api/');
  if (wantsJson) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: {
          code: 'backend_not_configured',
          message: 'لم يُضبط BACKEND_ORIGIN في Netlify. انشر خادم Node على Render ثم أضف رابطه.',
        },
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الخادم غير مرتبط — مجلتي وروتيني</title><style>body{font-family:system-ui,Tahoma,sans-serif;background:#faf7f5;color:#27201d;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:560px;background:#fff;border:1px solid #eadfd8;border-radius:20px;padding:28px;line-height:1.9}h1{margin:0 0 10px;font-size:1.4rem}code{background:#f3ece8;padding:2px 7px;border-radius:7px;direction:ltr;display:inline-block}a{color:#8a4b2f}</style></head><body><main><h1>الواجهة جاهزة، بس الخادم غير مرتبط</h1><p>هذا التطبيق يحتاج خادم Node للحسابات والجلسات والإشعارات. Netlify هنا يخدم الواجهة فقط.</p><p>انشر المشروع على Render أو Railway، وبعدها أضف متغيّر البيئة <code>BACKEND_ORIGIN</code> في Netlify برابط الخادم.</p><p>الخطوات كاملة موجودة في <a href="https://render.com/docs/docker">دليل Render</a> وملف <code>DEPLOY.md</code> داخل المشروع.</p></main></body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

export default async function proxy(request, context) {
  const url = new URL(request.url);
  // الأصول الثابتة تبقى على CDN الخاص بـ Netlify
  if (STATIC_FILE.test(url.pathname)) return context.next();

  const origin = backendOrigin();
  if (!origin) return missingBackend(request);

  const target = new URL(url.pathname + url.search, origin);
  try {
    const headers = new Headers(request.headers);
    headers.delete('host');
    return await fetch(target, {
      method: request.method,
      headers,
      // نقرأ الجسم كـArrayBuffer لأن بعض بيئات Edge لا تدعم بث الطلب مع duplex
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
    });
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: { code: 'backend_unreachable', message: 'تعذّر الوصول إلى الخادم. تحقق من BACKEND_ORIGIN.' } }),
      { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }
}
