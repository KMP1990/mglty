/**
 * اختبار وضع Netlify المجاني: Express داخل Function + تخزين Blobs.
 * يستخدم backend ذاكرة محلية بدل Netlify الحقيقي، لكنه يمرّ بنفس
 * مسار الحدث والدالة والكوكيز وCSRF والبيانات.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.BLOB_BACKEND = 'memory';
process.env.DATA_DIR = '/tmp/mr-blob-function-test';
process.env.NODE_ENV = 'production';
process.env.SESSION_SECRET = 'blob-function-test-secret';

const { handler } = await import('../netlify/functions/server.mjs');

const jar = new Map();
const cookieHeader = () => [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');

function makeEvent(path, { method = 'GET', body, headers = {} } = {}) {
  return {
    httpMethod: method,
    path: '/.netlify/functions/server',
    headers: {
      host: 'mgla.netlify.app',
      'x-mr-path': path,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(jar.size ? { cookie: cookieHeader() } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : null,
    isBase64Encoded: false,
    queryStringParameters: null,
  };
}

function saveCookies(response) {
  const values = Object.values(response.multiValueHeaders || {}).flat();
  for (const raw of values) {
    if (!String(raw).startsWith('mr_')) continue;
    const [pair] = String(raw).split(';');
    const [name, ...rest] = pair.split('=');
    const value = rest.join('=');
    if (value) jar.set(name, value);
    else jar.delete(name);
  }
}

async function call(path, options) {
  const response = await handler(makeEvent(path, options), {});
  saveCookies(response);
  let json = null;
  try {
    json = JSON.parse(response.body);
  } catch { }
  return { status: response.statusCode, json, body: response.body, headers: response.headers || {} };
}

test('دالة Netlify تشغّل الصفحات والجلسات والروتينات ومركز القيادة', async () => {
  const health = await call('/api/healthz');
  assert.equal(health.status, 200);
  assert.equal(health.json.ok, true);

  const page = await call('/routines');
  assert.equal(page.status, 200);
  assert.match(page.body, /__MR_SERVERLESS__=true/);
  assert.match(page.body, /روتيناتي/);

  const signup = await call('/api/auth/signup', {
    method: 'POST',
    body: { name: 'سحابة', email: `cloud-${Date.now()}@example.com`, password: 'StrongPass!2345', acceptTerms: true },
  });
  assert.equal(signup.status, 201);
  assert.ok(jar.get('mr_session'));
  assert.ok(jar.get('mr_csrf'));

  const create = await call('/api/routines', {
    method: 'POST',
    body: { title: 'روتين سحابي', duration: 10, tags: ['سحابة'] },
    headers: { 'x-csrf-token': jar.get('mr_csrf') },
  });
  assert.equal(create.status, 201);
  assert.equal(create.json.data.routine.title, 'روتين سحابي');

  const done = await call(`/api/routines/${create.json.data.routine.id}/status`, {
    method: 'PUT',
    body: { status: 'done' },
    headers: { 'x-csrf-token': jar.get('mr_csrf') },
  });
  assert.equal(done.status, 200);

  const mega = await call('/api/routines/mega');
  assert.equal(mega.status, 200);
  assert.equal(mega.json.data.catalog.total, 120);
  assert.equal(mega.json.data.summary.totalDone, 1);

  const keys = [...(globalThis.__mrMemoryBlobs?.keys() || [])];
  assert.ok(keys.some((key) => key.startsWith('users/')));
  assert.ok(keys.some((key) => key.startsWith('sessions/')));
  assert.ok(keys.some((key) => key.startsWith('routines/')));
  assert.ok(keys.some((key) => key.startsWith('notifications/')));
});
