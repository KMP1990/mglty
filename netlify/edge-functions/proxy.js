/**
 * Netlify Edge Function — بوابة التطبيق.
 * ------------------------------------------------------------
 * الوضع الافتراضي (مجاني بالكامل): الصفحات و/api تُمرَّر إلى Netlify Function
 * `server` التي تشغّل Express كاملًا مع Netlify Blobs كتخزين دائم.
 * الأصول الثابتة تبقى على CDN الخاص بـNetlify.
 *
 * وإن ضبطت BACKEND_ORIGIN (Render/Railway) يُمرَّر الطلب إلى ذلك الخادم بدلًا
 * من الدالة — مفيد لمن يريد خادمًا دائمًا ومجدولًا يعمل بلا توقف.
 */
const STATIC_FILE = /\.[a-z0-9]{1,12}$/i;
const FUNCTION_PREFIX = '/.netlify/functions/';

function backendOrigin() {
  try {
    const value =
      globalThis.Netlify?.env?.get?.('BACKEND_ORIGIN') || globalThis.process?.env?.BACKEND_ORIGIN || '';
    if (!String(value).trim()) return null;
    const url = new URL(String(value).trim());
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
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
          message: 'لم يُضبط الخادم. أعد نشر الموقع على Netlify لتفعيل دالة server، أو أضف BACKEND_ORIGIN.',
        },
      }),
      { status: 503, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    );
  }
  return new Response(
    `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>الخادم غير مرتبط — مجلتي وروتيني</title><style>body{font-family:system-ui,Tahoma,sans-serif;background:#faf7f5;color:#27201d;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px}main{max-width:560px;background:#fff;border:1px solid #eadfd8;border-radius:20px;padding:28px;line-height:1.9}h1{margin:0 0 10px;font-size:1.4rem}code{background:#f3ece8;padding:2px 7px;border-radius:7px;direction:ltr;display:inline-block}a{color:#8a4b2f}</style></head><body><main><h1>الخادم غير مرتبط</h1><p>لم تُنشر دالة Netlify بعد. أعد نشر الموقع، أو اضبط <code>BACKEND_ORIGIN</code> لخادم Node دائم.</p></main></body></html>`,
    { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } }
  );
}

async function forward(request, target, extraHeaders = {}) {
  const headers = new Headers(request.headers);
  headers.delete('host');
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return fetch(target, {
    method: request.method,
    headers,
    // Edge لا يدعم duplex لبث الطلب في كل الحالات، لذا نقرأ الجسم كمصفوفة بايتات.
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
    redirect: 'manual',
  });
}

export default async function proxy(request, context) {
  const url = new URL(request.url);

  // لا نعيد توجيه نداءات الدوال نفسها إلى نفسها.
  if (url.pathname.startsWith(FUNCTION_PREFIX)) return context.next();
  // الأصول الثابتة تبقى على CDN.
  if (STATIC_FILE.test(url.pathname)) return context.next();

  const origin = backendOrigin();
  if (origin) {
    try {
      return await forward(request, new URL(url.pathname + url.search, origin));
    } catch {
      return new Response(
        JSON.stringify({ ok: false, error: { code: 'backend_unreachable', message: 'تعذّر الوصول إلى الخادم. تحقق من BACKEND_ORIGIN.' } }),
        { status: 502, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
      );
    }
  }

  // الوضع المجاني الافتراضي: Express داخل Netlify Function.
  try {
    return await forward(
      request,
      new URL(`${FUNCTION_PREFIX}server`, url.origin),
      { 'x-mr-path': `${url.pathname}${url.search}` }
    );
  } catch {
    return missingBackend(request);
  }
}
