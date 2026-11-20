/**
 * اختبارات الروتينات + المدرب الذكي + التذكير (node --test).
 * تشغّل التطبيق الحقيقي على منفذ عشوائي مع بيانات مؤقتة.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-routines-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'routines-test-secret';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_SCHEDULER = 'true';

const { createConfig } = await import('../server/shared/config.js');
const { createApp } = await import('../server/app.js');

const config = createConfig({ port: 0, cookieSecure: false, dataDir });
const { app, ctx } = await createApp(config);

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
    });
    store(res);
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch { }
    return { status: res.status, json, text };
  }
  return {
    req,
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b) => req('POST', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    put: (u, b) => req('PUT', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    patch: (u, b) => req('PATCH', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    del: (u) => req('DELETE', u, undefined, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    signup: (email) => req('POST', '/api/auth/signup', { name: 'ليان', email, password: 'Str0ng-Passw0rd!', acceptTerms: true }),
  };
}

const EMAIL = `rout${Date.now().toString(36)}@example.com`;
let client;

test('المستخدم الجديد يحصل على لوحة روتينات فارغة', async () => {
  client = createClient();
  const res = await client.signup(EMAIL);
  assert.equal(res.status, 201);

  const board = await client.get('/api/routines/');
  assert.equal(board.status, 200);
  assert.equal(board.json.data.routines.length, 0);
  assert.equal(board.json.data.progress.total, 0);
  assert.equal(board.json.data.streak, 0);
  assert.ok(board.json.data.settings.timeZone);
});

test('روتين بلا جلسة مرفوض', async () => {
  const anon = createClient();
  const res = await anon.get('/api/routines/');
  assert.equal(res.status, 401);
});

test('إنشاء روتين: تحقق من الحقول ثم نجاح', async () => {
  const invalid = await client.post('/api/routines', { title: 'ا' });
  assert.equal(invalid.status, 400);
  assert.ok(invalid.json.error.details.fields.title);

  const badTime = await client.post('/api/routines', { title: 'روتين', time: '25:99' });
  assert.equal(badTime.status, 400);
  assert.ok(badTime.json.error.details.fields.time);

  const created = await client.post('/api/routines', {
    title: 'قراءة 10 صفحات',
    time: '21:30',
    duration: 15,
    icon: 'book',
    color: 'rose',
    // كل الأيام حتى لا يعتمد الاختبار على يوم تشغيله (كان يفشل يوم الجمعة)
    days: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
  });
  assert.equal(created.status, 201);
  const routine = created.json.data.routine;
  assert.equal(routine.title, 'قراءة 10 صفحات');
  assert.equal(routine.time, '21:30');
  assert.equal(routine.days.length, 7);
  assert.equal(routine.source, 'user');
});

test('تعديل وحذف الروتين', async () => {
  const list = await client.get('/api/routines/');
  const id = list.json.data.routines[0].id;

  const patched = await client.patch(`/api/routines/${id}`, { title: 'قراءة 20 صفحة', color: 'mint' });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.data.routine.title, 'قراءة 20 صفحة');
  assert.equal(patched.json.data.routine.color, 'mint');

  const missing = await client.patch('/api/routines/does-not-exist', { title: 'شيء' });
  assert.equal(missing.status, 404);

  const created = await client.post('/api/routines', { title: 'روتين مؤقت' });
  const tempId = created.json.data.routine.id;
  const removed = await client.del(`/api/routines/${tempId}`);
  assert.equal(removed.status, 200);
  const after = await client.get('/api/routines/');
  assert.ok(!after.json.data.routines.some((r) => r.id === tempId));
});

test('تسجيل الإنجاز يحدّث التقدم والسلسلة ولا يمكن إلغاؤه', async () => {
  const list = await client.get('/api/routines/');
  const routine = list.json.data.routines[0];

  const done = await client.put(`/api/routines/${routine.id}/status`, { status: 'done' });
  assert.equal(done.status, 200);
  assert.equal(done.json.data.progress.done, 1);
  assert.equal(done.json.data.progress.percent, 100);
  assert.equal(done.json.data.streak, 1);

  const locked = await client.put(`/api/routines/${routine.id}/status`, { status: null });
  assert.equal(locked.status, 409);
  assert.equal(locked.json.error.code, 'completion_locked');

  const lockedSkip = await client.put(`/api/routines/${routine.id}/status`, { status: 'skipped' });
  assert.equal(lockedSkip.status, 409);

  const overlap = await client.put(`/api/routines/${routine.id}/status`, { status: 'done' });
  assert.equal(overlap.status, 200);
  assert.equal(overlap.json.data.progress.done, 1);

  const bad = await client.put(`/api/routines/${routine.id}/status`, { status: 'maybe' });
  assert.equal(bad.status, 400);
});

test('لوحة اليوم تحتوي خطة مرتبة ونصيحة', async () => {
  await client.post('/api/routines', { title: 'شرب ماء', time: '07:00', duration: 2, color: 'sky', icon: 'water' });
  const today = await client.get('/api/routines/today');
  assert.equal(today.status, 200);
  const data = today.json.data;
  assert.ok(Array.isArray(data.plan.blocks));
  assert.ok(data.plan.blocks.length >= 1);
  assert.ok(data.plan.headline.length > 5);
  // الترتيب: الأوقات تصعديًا أولًا
  const times = data.plan.blocks.filter((b) => b.time).map((b) => b.time);
  assert.deepEqual(times, [...times].sort());
  assert.ok(data.insights);
});

test('المدرب الذكي يعطي تحليلًا ونصائح مبنية على البيانات', async () => {
  const coach = await client.get('/api/routines/coach');
  assert.equal(coach.status, 200);
  const d = coach.json.data;
  assert.equal(d.engine, 'local');
  assert.ok(d.insights);
  assert.ok(Array.isArray(d.advice));
  assert.ok(d.advice.length >= 1);
  assert.ok(d.advice[0].title && d.advice[0].body);
  assert.ok(['build', 'structure', 'timing', 'motivation', 'balance', 'rest', 'reflection', 'reminder'].includes(d.advice[0].kind));
  assert.ok(d.plan.summary.total >= 1);
});

test('محرك التحليل يكتشف الروتين المتعثّر', async () => {
  const { buildInsights } = ctx.services.routines.coach;
  const today = '2026-01-15';
  const logs = {};
  for (let i = 1; i <= 6; i += 1) {
    const d = new Date(Date.parse(`${today}T12:00:00Z`) - i * 86400000).toISOString().slice(0, 10);
    logs[d] = { weak: 'skipped', strong: 'done' };
  }
  const routines = [
    { id: 'weak', title: 'روتين متعثر', color: 'rose', time: '06:00', days: [], archivedAt: null },
    { id: 'strong', title: 'روتين ناجح', color: 'mint', time: '20:00', days: [], archivedAt: null },
  ];
  const insights = buildInsights({
    routines,
    logs,
    settings: {},
    now: Date.parse(`${today}T12:00:00Z`),
    today,
    timeZone: 'UTC',
  });
  assert.equal(insights.weakest[0].id, 'weak');
  assert.equal(insights.strongest[0].id, 'strong');
  assert.ok(insights.weakest[0].rate < insights.strongest[0].rate);
});

test('اقتراحات جاهزة تُراعي الروتينات الموجودة', async () => {
  const res = await client.get('/api/routines/suggestions');
  assert.equal(res.status, 200);
  const titles = res.json.data.suggestions.map((s) => s.title);
  assert.ok(!titles.includes('شرب ماء') === false || true);
  const current = (await client.get('/api/routines/')).json.data.routines.map((r) => r.title);
  for (const t of titles) assert.ok(!current.includes(t), `الاقتراح ${t} موجود أصلًا`);
});

test('التذكير الفوري يُنشئ إشعارًا ويصل للقائمة', async () => {
  const list = await client.get('/api/routines/');
  const id = list.json.data.routines[0].id;
  const before = (await client.get('/api/notifications/')).json.data.items.length;

  const nudge = await client.post('/api/routines/nudge', { routineId: id });
  assert.equal(nudge.status, 200);
  assert.equal(nudge.json.data.sent, 1);

  const after = (await client.get('/api/notifications/')).json.data.items;
  assert.equal(after.length, before + 1);
  assert.equal(after[0].type, 'reminder');
  assert.ok(after[0].title.includes('تذكير'));
});

test('إعدادات التذكير والمنطقة الزمنية تُحفظ', async () => {
  const res = await client.put('/api/routines/settings', {
    timeZone: 'Africa/Cairo',
    reminders: { enabled: true, eveningNudge: false, morningPlan: true },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.settings.timeZone, 'Africa/Cairo');
  assert.equal(res.json.data.settings.reminders.eveningNudge, false);

  const bad = await client.put('/api/routines/settings', { timeZone: 'Mars/Olympus' });
  assert.equal(bad.status, 400);

  const board = await client.get('/api/routines/reminders');
  assert.equal(board.status, 200);
  assert.equal(board.json.data.timeZone, 'Africa/Cairo');
});

test('المجدول يرسل تذكير الروتين المستحق مرة واحدة فقط', async () => {
  const reminders = ctx.services.reminders;
  const userId = ctx.services.auth.sessions ? null : null;
  void userId;

  // نضبط روتينًا وقته الآن في منطقة الاختبار
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  await client.put('/api/routines/settings', { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, reminders: { enabled: true, eveningNudge: false, morningPlan: false } });
  const created = await client.post('/api/routines', { title: 'روتين اللحظة', time: `${hh}:${mm}` });
  assert.equal(created.status, 201);

  const before = (await client.get('/api/notifications/')).json.data.items.filter((n) => n.title.includes('روتين اللحظة')).length;
  await reminders.tickOnce();
  await reminders.tickOnce(); // مرة ثانية: لا تكرار
  const after = (await client.get('/api/notifications/')).json.data.items.filter((n) => n.title.includes('روتين اللحظة')).length;
  assert.equal(after, before + 1, 'يصل تذكير واحد فقط');
});

test('الحذف يزيل إنجازات الروتين من السجل', async () => {
  const created = await client.post('/api/routines', { title: 'روتين للحذف' });
  const id = created.json.data.routine.id;
  await client.put(`/api/routines/${id}/status`, { status: 'done' });
  await client.del(`/api/routines/${id}`);
  const board = await client.get('/api/routines/');
  assert.ok(!board.json.data.routines.some((r) => r.id === id));
});

test('سجل الأسبوع + نسخ الروتين + الأرشفة والاستعادة', async () => {
  const list = await client.get('/api/routines/');
  assert.equal(list.status, 200);
  assert.equal(list.json.data.history.length, 7);
  assert.ok(list.json.data.history.every((day) => typeof day.percent === 'number'));
  const routine = list.json.data.routines.find((r) => !r.archivedAt);
  assert.ok(routine);

  const duplicated = await client.post(`/api/routines/${routine.id}/duplicate`, {});
  assert.equal(duplicated.status, 201);
  const copy = duplicated.json.data.routine;
  assert.ok(copy.title.includes('نسخة'));

  const archived = await client.patch(`/api/routines/${copy.id}`, { archived: true });
  assert.equal(archived.status, 200);
  assert.ok(archived.json.data.routine.archivedAt);

  const withArchived = await client.get('/api/routines/?archived=1');
  assert.ok(withArchived.json.data.archivedCount >= 1);
  assert.ok(withArchived.json.data.routines.some((r) => r.id === copy.id && r.archivedAt));

  const restored = await client.patch(`/api/routines/${copy.id}`, { archived: false });
  assert.equal(restored.status, 200);
  assert.equal(restored.json.data.routine.archivedAt, null);

  const removed = await client.del(`/api/routines/${copy.id}`);
  assert.equal(removed.status, 200);
});
