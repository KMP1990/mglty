/**
 * اختبارات الخادم (node --test) — تشغّل التطبيق حقًا على منفذ عشوائي وتضرب الـ API.
 * تغطي: إنشاء حساب، الدخول، الجلسة، CSRF، الإشعارات، تغيير كلمة المرور، حذف الحساب.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-test-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
process.env.LOG_LEVEL = 'error';

const { createConfig } = await import('../server/shared/config.js');
const { createApp } = await import('../server/app.js');

const config = createConfig({ port: 0, cookieSecure: false, dataDir });
const { app } = await createApp(config);

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(dataDir, { recursive: true, force: true });
});

/* ---------- عميل HTTP مصغّر يحتفظ بالكوكيز ---------- */
function createClient() {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const store = (res) => {
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = raw.split(';');
      const [name, ...rest] = pair.split('=');
      const value = rest.join('=');
      const expired = attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim())) || value === '';
      if (expired) jar.delete(name.trim());
      else jar.set(name.trim(), value);
    }
  };
  async function req(method, url, body, headers = {}) {
    const res = await fetch(base + url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(jar.size ? { Cookie: cookieHeader() } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    });
    store(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { }
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    req,
    jar,
    csrf: () => jar.get('mr_csrf') || '',
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b, h) => req('POST', u, b ?? {}, h),
    put: (u, b, h) => req('PUT', u, b ?? {}, h),
    patch: (u, b, h) => req('PATCH', u, b ?? {}, h),
    del: (u, b, h) => req('DELETE', u, b, h),
    postCsrf: (u, b) => req('POST', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    putCsrf: (u, b) => req('PUT', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    patchCsrf: (u, b) => req('PATCH', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    delCsrf: (u, b) => req('DELETE', u, b, { 'X-CSRF-Token': jar.get('mr_csrf') }),
  };
}

const unique = (prefix) => `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}@example.com`;
const STRONG = 'Str0ng-Passw0rd!';

test('الصحة: /api/healthz يرد', async () => {
  const res = await fetch(base + '/api/healthz');
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.ok, true);
});

test('الصفحة الرئيسية تُخدم مع بيانات البناء', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /مجلتي وروتيني/);
  assert.match(html, /__MR_VERSION__/);
  assert.match(res.headers.get('content-security-policy') || '', /script-src 'self'/);
});

test('مسارات التطبيق تُخدم كصفحة HTML واحدة', async () => {
  for (const route of ['/login', '/signup', '/notifications', '/account', '/vault', '/index.html']) {
    const res = await fetch(base + route);
    assert.equal(res.status, 200, route);
  }
  const sw = await fetch(base + '/sw.js');
  assert.match(sw.headers.get('cache-control') || '', /no-store/);
});

test('إنشاء حساب ناجح يفتح جلسة ويعطي رمز CSRF', async () => {
  const c = createClient();
  const email = unique('sara');
  const res = await c.post('/api/auth/signup', { name: 'سارة أحمد', email, password: STRONG, acceptTerms: true });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.data.user.email, email);
  assert.ok(res.json.data.csrfToken);
  assert.ok(c.jar.get('mr_session'), 'كوكي الجلسة موجود');
  const setCookie = res.headers.getSetCookie().join(';');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.doesNotMatch(JSON.stringify(res.json), /password/i, 'لا تسريب لأي حقل كلمة مرور');
});

test('التحقق: بريد مكرر، كلمة مرور ضعيفة، شروط غير مقبولة', async () => {
  const c = createClient();
  const email = unique('dup');
  const first = await c.post('/api/auth/signup', { name: 'علي', email, password: STRONG, acceptTerms: true });
  assert.equal(first.status, 201);
  const c2 = createClient();
  const dup = await c2.post('/api/auth/signup', { name: 'علي', email, password: STRONG, acceptTerms: true });
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error.code, 'email_taken');

  const weak = await c2.post('/api/auth/signup', { name: 'ع', email: 'bad', password: '123', acceptTerms: false });
  assert.equal(weak.status, 400);
  const fields = weak.json.error.details.fields;
  assert.ok(fields.password && fields.email && fields.name && fields.acceptTerms);
});

test('تسجيل الدخول: نجاح، فشل، ومنع الوصول للبيانات دون جلسة', async () => {
  const c = createClient();
  const email = unique('login');
  await c.post('/api/auth/signup', { name: 'لمى', email, password: STRONG, acceptTerms: true });
  const anon = createClient();
  const noSession = await anon.get('/api/notifications/');
  assert.equal(noSession.status, 401);

  const bad = await anon.post('/api/auth/login', { email, password: 'WrongPass123!' });
  assert.equal(bad.status, 401);
  assert.equal(bad.json.error.code, 'invalid_credentials');

  const ok = await anon.post('/api/auth/login', { email, password: STRONG, remember: true });
  assert.equal(ok.status, 200);
  assert.ok(anon.jar.get('mr_session'));
  const session = await anon.get('/api/auth/session');
  assert.equal(session.json.data.authenticated, true);
  assert.equal(session.json.data.user.email, email);
});

test('حماية CSRF: تعديل بدون رمز مرفوض', async () => {
  const c = createClient();
  const email = unique('csrf');
  await c.post('/api/auth/signup', { name: 'نور', email, password: STRONG, acceptTerms: true });
  const noToken = await c.post('/api/notifications/', { title: 'بدون رمز' });
  assert.equal(noToken.status, 403);
  const badToken = await c.post('/api/notifications/', { title: 'رمز خاطئ' }, { 'X-CSRF-Token': 'x'.repeat(32) });
  assert.equal(badToken.status, 403);
  const good = await c.postCsrf('/api/notifications/', { title: 'برمز صحيح' });
  assert.equal(good.status, 201);
});

test('إشعارات: ترحيب تلقائي، قائمة، قراءة، حذف', async () => {
  const c = createClient();
  const email = unique('notif');
  const signup = await c.post('/api/auth/signup', { name: 'ريم', email, password: STRONG, acceptTerms: true });
  assert.equal(signup.status, 201);

  const list = await c.get('/api/notifications/');
  assert.equal(list.status, 200);
  assert.ok(list.json.data.items.length >= 1, 'إشعار الترحيب موجود');
  assert.equal(list.json.data.items[0].type, 'welcome');
  const unread = list.json.data.summary.unread;
  assert.ok(unread >= 1);

  const id = list.json.data.items[0].id;
  const read = await c.postCsrf(`/api/notifications/${id}/read`);
  assert.equal(read.status, 200);
  assert.equal(read.json.data.unread, unread - 1);

  const created = await c.postCsrf('/api/notifications/', { type: 'reminder', title: 'تذكير', body: 'اشرب ماء' });
  assert.equal(created.status, 201);
  const newId = created.json.data.notification.id;

  const del = await c.delCsrf(`/api/notifications/${newId}`);
  assert.equal(del.status, 200);
  const missing = await c.postCsrf(`/api/notifications/${newId}/read`);
  assert.equal(missing.status, 404);
});

test('تغيير كلمة المرور يُنهي الجلسة', async () => {
  const c = createClient();
  const email = unique('pw');
  await c.post('/api/auth/signup', { name: 'هند', email, password: STRONG, acceptTerms: true });
  const res = await c.putCsrf('/api/auth/password', { currentPassword: STRONG, newPassword: 'N3w-Strong-Pass!' });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.reauthRequired, true);
  const session = await c.get('/api/auth/session');
  assert.equal(session.json.data.authenticated, false);
  const relogin = await c.post('/api/auth/login', { email, password: 'N3w-Strong-Pass!' });
  assert.equal(relogin.status, 200);
});

test('حذف الحساب يتطلب تأكيدًا صريحًا', async () => {
  const c = createClient();
  const email = unique('del');
  await c.post('/api/auth/signup', { name: 'خالد', email, password: STRONG, acceptTerms: true });
  const wrong = await c.delCsrf('/api/me', { confirm: 'no' });
  assert.equal(wrong.status, 400);
  const ok = await c.delCsrf('/api/me', { confirm: 'DELETE' });
  assert.equal(ok.status, 200);
  const relogin = await c.post('/api/auth/login', { email, password: STRONG });
  assert.equal(relogin.status, 401);
});

test('الملفات محفوظة على القرص بشكل ذرّي مع نسخة احتياطية', async () => {
  const files = await fs.readdir(path.join(dataDir, 'users'));
  assert.ok(files.some((f) => f.endsWith('.json')), 'ملفات مستخدمين موجودة');
  // نكتب تحديثًا لضمان وجود نسخة سابقة ثم نفحصها
  const { writeJsonSafe, readJsonSafe } = await import('../server/shared/store.js');
  const target = path.join(dataDir, 'users', 'atomic-check.json');
  await writeJsonSafe(target, { v: 1 });
  await writeJsonSafe(target, { v: 2 });
  assert.deepEqual((await readJsonSafe(target, null)).v, 2);
  const bak = await readJsonSafe(path.join(dataDir, 'users', 'bak.atomic-check.json'), null);
  assert.equal(bak?.v, 1, 'النسخة الاحتياطية تحمل الحالة السابقة');
});
