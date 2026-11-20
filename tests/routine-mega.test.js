/**
 * اختبارات مركز القيادة: الكتالوج، التحليلات، الأهداف، المفكرة،
 * التصدير/الاستيراد، القوالب، الإجراءات الجماعية، والإجازة.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-mega-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'mega-test-secret';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_SCHEDULER = 'true';

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
    } catch {}
    return { status: res.status, json, text, headers: res.headers };
  }
  return {
    req,
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b) => req('POST', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    put: (u, b) => req('PUT', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    patch: (u, b) => req('PATCH', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    del: (u) => req('DELETE', u, undefined, { 'X-CSRF-Token': jar.get('mr_csrf') }),
  };
}

let client;
let firstRoutine;
let untimedRoutine;
let thirdRoutine;

test('إنشاء حساب وروتينات مركز القيادة', async () => {
  client = createClient();
  const signup = await client.post('/api/auth/signup', {
    name: 'ليان',
    email: `mega-${Date.now()}@example.com`,
    password: 'Str0ng-Passw0rd!',
    acceptTerms: true,
  });
  assert.equal(signup.status, 201);
  const one = await client.post('/api/routines', {
    title: 'روتين القيادة الأول',
    time: '09:00',
    duration: 15,
    tags: ['صباح', 'صحة'],
    favorite: true,
    ifThen: 'إذا شربت القهوة فسأكتب صفحة',
  });
  assert.equal(one.status, 201);
  firstRoutine = one.json.data.routine;
  assert.deepEqual(firstRoutine.tags, ['صباح', 'صحة']);
  assert.equal(firstRoutine.favorite, true);
  const two = await client.post('/api/routines', { title: 'روتين بلا وقت', duration: 10, priority: 'core' });
  assert.equal(two.status, 201);
  untimedRoutine = two.json.data.routine;
  const three = await client.post('/api/routines', { title: 'روتين للمراجعة', time: '20:00', duration: 10 });
  assert.equal(three.status, 201);
  thirdRoutine = three.json.data.routine;
});

test('لوحة مركز القيادة تعرض أكثر من ١٠٠ قدرة وتحليلات كاملة', async () => {
  const res = await client.get('/api/routines/mega');
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.ok(data.catalog.total > 100);
  assert.equal(data.catalog.groups, 12);
  assert.equal(data.heatmap.length, 90);
  assert.ok(data.health.length >= 3);
  assert.ok(data.summary.totalBadges >= 20);
  assert.equal(data.mission.id, untimedRoutine.id);
  assert.ok(data.weekday.length === 7);
  assert.ok(Array.isArray(data.smartPlan));
  assert.ok(data.settings);
  const catalog = await client.get('/api/routines/mega/catalog');
  assert.equal(catalog.status, 200);
  assert.ok(catalog.json.data.features.length > 100);
});

test('إنجاز اليوم والهدف والمطالبة بالمكافأة', async () => {
  const done = await client.put(`/api/routines/${firstRoutine.id}/status`, { status: 'done' });
  assert.equal(done.status, 200);
  for (const routine of [untimedRoutine, thirdRoutine]) {
    const res = await client.put(`/api/routines/${routine.id}/status`, { status: 'done' });
    assert.equal(res.status, 200);
  }
  const goal = await client.post('/api/routines/mega/goals', {
    title: 'إنجاز واحد',
    type: 'done',
    target: 1,
    reward: 'قهوة ممتازة',
  });
  assert.equal(goal.status, 201);
  const board = await client.get('/api/routines/mega');
  const loadedGoal = board.json.data.goals.find((item) => item.id === goal.json.data.goal.id);
  assert.equal(loadedGoal.complete, true);
  const claim = await client.post(`/api/routines/mega/goals/${goal.json.data.goal.id}/claim`, {});
  assert.equal(claim.status, 200);
  assert.equal(claim.json.data.claimed, true);
  const again = await client.post(`/api/routines/mega/goals/${goal.json.data.goal.id}/claim`, {});
  assert.equal(again.status, 200);
  assert.equal(again.json.data.alreadyClaimed, true);

  const daily = board.json.data.challenges.find((item) => item.claimable);
  assert.ok(daily, 'يوجد تحدٍّ قابل للاستلام بعد ثلاثة إنجازات');
  const claimed = await client.post(`/api/routines/mega/challenges/${daily.id}/claim`, {});
  assert.equal(claimed.status, 200);
  assert.equal(claimed.json.data.claimed, true);
  const repeated = await client.post(`/api/routines/mega/challenges/${daily.id}/claim`, {});
  assert.equal(repeated.status, 400);
  assert.equal(repeated.json.error.code, 'challenge_not_ready');
});

test('المفكرة والمزاج والتركيز والمراجعة تُحفظ', async () => {
  const journal = await client.post('/api/routines/mega/journal', {
    note: 'يوم هادئ',
    wins: 'أنجزت روتيني',
    lesson: 'البدء أهم من الكمال',
    mood: 4,
    energy: 3,
  });
  assert.equal(journal.status, 201);
  const mood = await client.post('/api/routines/mega/mood', { mood: 5, energy: 4 });
  assert.equal(mood.status, 200);
  const focus = await client.post('/api/routines/mega/focus', { routineId: firstRoutine.id, minutes: 25 });
  assert.equal(focus.status, 201);
  const review = await client.post('/api/routines/mega/reviews', {
    period: 'weekly',
    wins: 'ثبات',
    lessons: 'التقليل أفضل',
    next: 'روتين واحد',
  });
  assert.equal(review.status, 201);
  const board = await client.get('/api/routines/mega');
  assert.equal(board.json.data.journal.length, 1);
  assert.equal(board.json.data.focus.length, 1);
  assert.equal(board.json.data.reviews.length, 1);
});

test('الجدولة التلقائية تعطي الروتين بلا وقت موعدًا', async () => {
  const plan = await client.post('/api/routines/mega/auto-plan', { mode: 'schedule' });
  assert.equal(plan.status, 200);
  assert.ok(plan.json.data.changes.length >= 1);
  const list = await client.get('/api/routines/');
  const updated = list.json.data.routines.find((item) => item.id === untimedRoutine.id);
  assert.ok(updated.time);

  const struggling = await client.post('/api/routines', { title: 'روتين متعثر للاختبار', duration: 10 });
  assert.equal(struggling.status, 201);
  const rest = await client.post('/api/routines/mega/auto-plan', { mode: 'pause-low' });
  assert.equal(rest.status, 200);
  assert.equal(rest.json.data.changes[0].id, struggling.json.data.routine.id);
  const pausedState = await client.get('/api/routines/');
  assert.ok(pausedState.json.data.routines.find((item) => item.id === struggling.json.data.routine.id).pausedUntil);

  const invalid = await client.post('/api/routines/mega/auto-plan', { mode: 'nonsense' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error.code, 'invalid_plan_mode');
});

test('الإجراءات الجماعية: مفضلة ووسم وإيقاف', async () => {
  const tag = await client.post('/api/routines/mega/batch', { action: 'addTag', ids: [untimedRoutine.id], value: 'تركيز' });
  assert.equal(tag.status, 200);
  const fav = await client.post('/api/routines/mega/batch', { action: 'favorite', ids: [untimedRoutine.id] });
  assert.equal(fav.status, 200);
  const pause = await client.post('/api/routines/mega/batch', { action: 'pause', ids: [untimedRoutine.id], value: 7 });
  assert.equal(pause.status, 200);
  const list = await client.get('/api/routines/');
  const updated = list.json.data.routines.find((item) => item.id === untimedRoutine.id);
  assert.equal(updated.favorite, true);
  assert.ok(updated.tags.includes('تركيز'));
  assert.ok(updated.pausedUntil);
  const blocked = await client.put(`/api/routines/${untimedRoutine.id}/status`, { status: 'done' });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, 'routine_paused');
  const resume = await client.post('/api/routines/mega/batch', { action: 'resume', ids: [untimedRoutine.id] });
  assert.equal(resume.status, 200);
});

test('القوالب: حفظ وتطبيق وحذف', async () => {
  const saved = await client.post('/api/routines/mega/templates', { routineId: firstRoutine.id, name: 'قالب صباحي' });
  assert.equal(saved.status, 201);
  const id = saved.json.data.template.id;
  const applied = await client.post(`/api/routines/mega/templates/${id}/apply`, {});
  assert.equal(applied.status, 201);
  assert.match(applied.json.data.routine.title, /روتين القيادة الأول/);
  const removed = await client.del(`/api/routines/mega/templates/${id}`);
  assert.equal(removed.status, 200);
});

test('التصدير بأربع صيغ والاستيراد', async () => {
  for (const [format, type] of [['json', 'application/json'], ['ics', 'text/calendar'], ['csv', 'text/csv'], ['md', 'text/markdown']]) {
    const res = await client.get(`/api/routines/mega/export?format=${format}`);
    assert.equal(res.status, 200, format);
    assert.ok(res.headers.get('content-type').includes(type), format);
    assert.ok(res.text.length > 20, format);
  }
  const imported = await client.post('/api/routines/mega/import', {
    routines: [{ title: 'روتين مستورد', duration: 5 }, { title: 'روتين القيادة الأول' }, { title: '' }],
  });
  assert.equal(imported.status, 201);
  assert.equal(imported.json.data.created, 1);
  assert.ok(imported.json.data.skipped >= 2);
});

test('الإجازة توقف الروتينات وتعود عند إلغائها', async () => {
  const start = await client.put('/api/routines/mega/settings', { vacationUntil: '2099-01-01' });
  assert.equal(start.status, 200);
  const during = await client.get('/api/routines/');
  assert.ok(during.json.data.routines.filter((item) => !item.archivedAt).every((item) => item.pausedUntil === '2099-01-01'));
  const stop = await client.put('/api/routines/mega/settings', { vacationUntil: null });
  assert.equal(stop.status, 200);
  const afterVacation = await client.get('/api/routines/');
  assert.ok(afterVacation.json.data.routines.filter((item) => !item.archivedAt).every((item) => item.pausedUntil === null));
});
