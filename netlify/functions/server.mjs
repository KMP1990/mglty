/**
 * Netlify Function — تشغيل تطبيق Express كاملًا (صفحات + API).
 * ------------------------------------------------------------
 * تُستدعى من Edge Function بعد إضافة `x-mr-path`، أو مباشرة في الاختبار.
 *
 * مهم: بيئة Netlify الحديثة تمرّر كائن `Request` من نوع Web API، وخصائصه
 * (`headers`, `url`) للقراءة فقط. لذلك لا نعدّل الكائن الأصلي أبدًا، بل نبني
 * كائن Lambda جديدًا لكل نداء، ثم نحوّل الناتج إلى `Response` عند الحاجة.
 */
import serverless from 'serverless-http';
import { connectLambda } from '@netlify/blobs';
import { bootstrap } from './_bootstrap.mjs';

const PATH_HEADER = 'x-mr-path';
const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

let handlerPromise = null;

function getHandler() {
  if (!handlerPromise) {
    // لا استجابات ثنائية في هذا التطبيق (JSON/HTML/ICS/CSV/MD كلها نصية)،
    // لذا نُبقي الناتج نصًا صريحًا ليعمل في وضع Lambda ووضع Request معًا.
    handlerPromise = bootstrap().then(({ app }) => serverless(app, { binary: false }));
  }
  return handlerPromise;
}

function isWebRequest(value) {
  return typeof Request !== 'undefined' && value instanceof Request;
}

function isWebResponse(value) {
  return typeof Response !== 'undefined' && value instanceof Response;
}

function safeUrl(value, base = 'https://netlify.local') {
  try {
    return new URL(value, base);
  } catch {
    return new URL('/', base);
  }
}

/** يحوّل Headers أو كائن عادي إلى كائن مفاتيحه بحروف صغيرة. */
function headersFrom(value) {
  const headers = {};
  if (!value) return headers;
  if (typeof value.forEach === 'function' && typeof value.entries === 'function' && !Array.isArray(value)) {
    for (const [key, item] of value.entries()) headers[String(key).toLowerCase()] = item;
    return headers;
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    headers[String(key).toLowerCase()] = Array.isArray(item) ? item.join(', ') : item;
  }
  return headers;
}

/** كائن Lambda مبسّط من طلب Web API (بلا تعديل على الأصل). */
async function eventFromRequest(request) {
  const url = new URL(request.url);
  const headers = headersFrom(request.headers);

  let body;
  let isBase64Encoded = false;
  if (!BODYLESS_METHODS.has(request.method)) {
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > 0) {
      body = bytes.toString('base64');
      isBase64Encoded = true;
    }
  }

  const event = {
    httpMethod: request.method,
    path: url.pathname,
    headers,
    body,
    isBase64Encoded,
  };
  // سياق Blobs يُمرَّر كنص في وضع Lambda فقط.
  if (typeof request.blobs === 'string') event.blobs = request.blobs;
  return event;
}

/**
 * يبني كائن Lambda قابلًا للتعديل (نسخة جديدة) ويحلّ المسار الحقيقي
 * من `x-mr-path` كما ترسله Edge Function.
 */
function normalizeEvent(event) {
  const source = event && typeof event === 'object' ? event : {};
  const headers = headersFrom(source.headers);
  const target = headers[PATH_HEADER] || source.rawUrl || source.path || '/';
  delete headers[PATH_HEADER];

  const url = safeUrl(target, `https://${headers.host || 'netlify.local'}`);
  const multiValueQueryStringParameters = {};
  for (const [key, value] of url.searchParams) {
    (multiValueQueryStringParameters[key] ||= []).push(value);
  }
  const queryStringParameters = Object.fromEntries(
    Object.entries(multiValueQueryStringParameters).map(([key, values]) => [key, values[0]])
  );

  return {
    ...source,
    httpMethod: source.httpMethod || source.method || 'GET',
    path: url.pathname,
    rawPath: url.pathname,
    rawQuery: url.search.replace(/^\?/, ''),
    rawUrl: `https://${headers.host || 'netlify.local'}${url.pathname}${url.search}`,
    headers,
    multiValueHeaders: Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key, [value]])
    ),
    queryStringParameters,
    multiValueQueryStringParameters,
    body: source.body,
    isBase64Encoded: source.isBase64Encoded === true,
  };
}

async function invoke(event, context) {
  if (typeof event.blobs === 'string') {
    try {
      connectLambda(event);
    } catch {
      // Blobs قد تكون مهيّأة عبر متغيّرات البيئة الحديثة.
    }
  }
  try {
    if (context) context.callbackWaitsForEmptyEventLoop = false;
  } catch {
    // بعض بيئات التشغيل تمرّر context للقراءة فقط.
  }
  const handler = await getHandler();
  return handler(event, context);
}

/** يحوّل نتيجة Lambda ({statusCode, headers, body}) إلى Response. */
function toResponse(result) {
  if (isWebResponse(result)) return result;

  const status = Number(result?.statusCode) || 200;
  const headers = new Headers();

  const addCookie = (value) => {
    for (const item of [].concat(value)) {
      if (item != null && item !== '') headers.append('set-cookie', String(item));
    }
  };
  const setHeader = (key, value) => {
    if (value === undefined || value === null) return;
    const name = String(key).toLowerCase();
    if (name === 'set-cookie') return addCookie(value);
    if (!headers.has(name)) headers.set(name, [].concat(value).join(', '));
  };

  for (const [key, value] of Object.entries(result?.multiValueHeaders || {})) {
    setHeader(key, value);
  }
  for (const [key, value] of Object.entries(result?.headers || {})) {
    setHeader(key, value);
  }
  for (const cookie of [].concat(result?.cookies || [])) {
    addCookie(cookie);
  }

  const nullableBody = status === 204 || status === 205 || status === 304;
  const rawBody = result?.body;
  let body = null;
  if (!nullableBody && rawBody !== undefined && rawBody !== null) {
    body = result?.isBase64Encoded
      ? Buffer.from(String(rawBody), 'base64')
      : Buffer.from(String(rawBody), 'utf8');
  }

  return new Response(body, { status, headers });
}

async function handle(event, context) {
  return toResponse(await invoke(normalizeEvent(event), context));
}

/** وضع Netlify Functions v2: (Request, context) → Response. */
export default async function netlifyHandler(request, context) {
  const event = isWebRequest(request) ? await eventFromRequest(request) : request;
  return handle(event, context);
}

/** توافق Lambda / وضع v1: (event, context) → نتيجة Lambda أو Response. */
export async function handler(event, context) {
  if (isWebRequest(event)) {
    return toResponse(await invoke(normalizeEvent(await eventFromRequest(event)), context));
  }
  return invoke(normalizeEvent(event), context);
}
