/**
 * Netlify Function — تشغيل تطبيق Express كاملًا (صفحات + API).
 * تستدعيها Edge Function بعد إضافة x-mr-path، أو مباشرة في الاختبار.
 */
import serverless from 'serverless-http';
import { connectLambda } from '@netlify/blobs';
import { bootstrap } from './_bootstrap.mjs';

let handlerPromise = null;

async function getHandler() {
  if (!handlerPromise) {
    handlerPromise = bootstrap().then(({ app }) => serverless(app, { binary: false }));
  }
  return handlerPromise;
}

export async function handler(event, context) {
  // توافق Lambda: يمرّر سياق Blobs حين يوفره Netlify.
  if (event.blobs) connectLambda(event);
  const original = event.headers?.['x-mr-path'] || event.path || '/';
  let url;
  try {
    url = new URL(original, 'https://netlify.local');
  } catch {
    url = new URL('/', 'https://netlify.local');
  }

  const headers = { ...(event.headers || {}) };
  delete headers['x-mr-path'];
  const query = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (query[key] === undefined) query[key] = value;
    else query[key] = [].concat(query[key], value);
  }

  event.headers = headers;
  event.path = url.pathname;
  event.rawUrl = `https://${headers.host || 'netlify.local'}${url.pathname}${url.search}`;
  event.rawQuery = url.search.replace(/^\?/, '');
  event.queryStringParameters = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
  );
  event.multiValueQueryStringParameters = Object.fromEntries(
    Object.entries(query).map(([key, value]) => [key, Array.isArray(value) ? value : [value]])
  );
  context.callbackWaitsForEmptyEventLoop = false;

  try {
    return await (await getHandler())(event, context);
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      body: JSON.stringify({
        ok: false,
        error: { code: 'serverless_boot_failed', message: err?.message || 'تعذّر تشغيل الخادم على Netlify' },
      }),
    };
  }
}

export default handler;
