/**
 * اختبارات أنظمة الروتين الخمسة (node --test).
 * تتحقق من: سلامة المجلدات والملفات، التقييم، التوصية، التفعيل، ومنع التكرار.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-systems-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'systems-test-secret';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_SCHEDULER = 'true';

const { createConfig } = await import('../server/shared/config.js');
const { createApp } = await import('../server/app.js');
const { SYSTEM_IDS, evaluateAll, getSystem, listSystems, planSystemRoutines } = await import(
  '../server/features/routines/systems/index.js'
);

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
    return { status: res.status, json, text };
  }
  return {
    req,
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b) => req('POST', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    signup: (email) => req('POST', '/api/auth/signup', { name: 'سلمى', email, password: 'Str0ng-Passw0rd!', acceptTerms: true }),
  };
}

const EMAIL = `systems${Date.now().toString(36)}@example.com`;
let client;

test('مجلدات الأنظمة الخمسة مكتملة وصالحة', () => {
  assert.equal(SYSTEM_IDS.length, 5);
  const systems = listSystems();
  assert.equal(systems.length, 5, 'كل مجلد يجب أن يُحمَّل');
  assert.deepEqual(
    systems.map((s) => s.id).sort(),
    ['balance', 'builder', 'calm', 'deep-focus', 'energy']
  );

  for (const system of systems) {
    assert.ok(system.name.length >= 2);
    assert.ok(system.tagline.length >= 5);
    assert.ok(system.routineCount >= 7, `${system.id} يحتاج ٧ روتينات على الأقل`);
    assert.ok(system.coreCount >= 3, `${system.id} يحتاج ٣ أساسيات على الأقل`);
    assert.ok(system.estimatedMinutes > 0);
    assert.ok(system.preview.length === system.routineCount);
    const detail = getSystem(system.id);
    assert.ok(detail, `تفاصيل ${system.id}`);
    for (const routine of detail.routines) {
      assert.ok(routine.title.length >= 2);
      assert.equal(routine.systemId, system.id);
      assert.ok(['core', 'support', 'bonus'].includes(routine.priority));
      assert.ok(routine.steps.length >= 1, `«${routine.title}» بلا خطوات`);
      assert.ok(routine.why.length > 5);
    }
  }
});

test('عقل كل نظام يعطي تقييمًا وإشارات دون بيانات', async () => {
  const reviews = await evaluateAll({
    routines: [],
    logs: {},
    today: '2026-02-01',
    timeZone: 'UTC',
    now: Date.parse('2026-02-01T08:00:00Z'),
  });
  assert.equal(reviews.length, 5);
  for (const review of reviews) {
    assert.ok(review.score >= 18 && review.score <= 98);
    assert.ok(review.headline.length > 5);
    assert.ok(review.signals.length >= 2);
    assert.equal(review.applied.count, 0);
  }
});

test('قائمة الأنظمة تتطلب جلسة', async () => {
  const anon = createClient();
  const res = await anon.get('/api/routines/systems');
  assert.equal(res.status, 401);
});

test('المستخدم الجديد يرى الأنظمة الخمسة مع توصية', async () => {
  client = createClient();
  const signup = await client.signup(EMAIL);
  assert.equal(signup.status, 201);

  const res = await client.get('/api/routines/systems');
  assert.equal(res.status, 200);
  assert.equal(res.json.data.systems.length, 5);
  for (const system of res.json.data.systems) {
    assert.ok(system.review, 'كل نظام له تقييم');
    assert.ok(system.review.headline);
    assert.ok(Array.isArray(system.review.signals));
  }
  assert.equal(res.json.data.recommended.length, 2);
  assert.ok(res.json.data.recommended[0].reason.length > 5);
});

test('تفاصيل نظام تعرض الملفات كاملة', async () => {
  const res = await client.get('/api/routines/systems/deep-focus');
  assert.equal(res.status, 200);
  const { system, review } = res.json.data;
  assert.equal(system.id, 'deep-focus');
  assert.ok(system.routines.length >= 7);
  assert.ok(system.principles.length >= 2);
  assert.ok(system.stages.length >= 2);
  assert.ok(review.score >= 18);
  assert.ok(system.routines.every((r) => r.systemId === 'deep-focus'));
});

test('نظام غير موجود يعيد 404', async () => {
  const res = await client.get('/api/routines/systems/does-not-exist');
  assert.equal(res.status, 404);
});

test('تفعيل نظام كامل يضيف الروتينات ويكتبها في السجل', async () => {
  const apply = await client.post('/api/routines/systems/deep-focus/apply', { intensity: 'full' });
  assert.equal(apply.status, 201);
  assert.equal(apply.json.data.created.length, 7);
  assert.equal(apply.json.data.archived, 0);
  assert.equal(apply.json.data.skipped.length, 0);

  const board = await client.get('/api/routines/');
  assert.equal(board.status, 200);
  const created = board.json.data.routines.filter((r) => r.systemId === 'deep-focus');
  assert.equal(created.length, 7);
  assert.ok(created.every((r) => r.systemName === 'نظام التركيز العميق'));
  assert.ok(created.every((r) => r.source === 'system'));
  assert.ok(created.every((r) => Array.isArray(r.steps)));
});

test('إعادة التفعيل لا تكرّر أي روتين', async () => {
  const before = (await client.get('/api/routines/')).json.data.routines.length;
  const apply = await client.post('/api/routines/systems/deep-focus/apply', { intensity: 'full' });
  assert.equal(apply.status, 200);
  assert.equal(apply.json.data.created.length, 0);
  assert.equal(apply.json.data.skipped.length, 7);
  const after = (await client.get('/api/routines/')).json.data.routines.length;
  assert.equal(after, before);
});

test('شدة core تضيف الأساسيات فقط', async () => {
  const energy = getSystem('energy');
  const coreCount = energy.routines.filter((r) => r.priority === 'core').length;
  const apply = await client.post('/api/routines/systems/energy/apply', { intensity: 'core' });
  assert.equal(apply.status, 201);
  assert.equal(apply.json.data.created.length, coreCount);
  assert.ok(apply.json.data.created.every((r) => r.priority === 'core'));
});

test('وضع replace يؤرشف القديم ويضيف النظام الجديد', async () => {
  const before = await client.get('/api/routines/');
  const activeBefore = before.json.data.routines.length;
  assert.ok(activeBefore > 0);

  const apply = await client.post('/api/routines/systems/balance/apply', { mode: 'replace', intensity: 'full' });
  assert.equal(apply.status, 201);
  assert.equal(apply.json.data.archived, activeBefore);
  assert.equal(apply.json.data.created.length, 8);

  const after = await client.get('/api/routines/?archived=1');
  const activeNow = after.json.data.routines.filter((r) => !r.archivedAt);
  assert.equal(activeNow.length, 8);
  assert.ok(activeNow.every((r) => r.systemId === 'balance'));
  assert.ok(after.json.data.archivedCount >= activeBefore);
});

test('وضع أو شدة غير صالحة يعيد 400', async () => {
  const badMode = await client.post('/api/routines/systems/calm/apply', { mode: 'destroy' });
  assert.equal(badMode.status, 400);
  const badIntensity = await client.post('/api/routines/systems/calm/apply', { intensity: 'max' });
  assert.equal(badIntensity.status, 400);
});

test('المدرب الذكي يدمج توصية النظام في التحليل', async () => {
  const coach = await client.get('/api/routines/coach');
  assert.equal(coach.status, 200);
  const data = coach.json.data;
  assert.ok(data.systems);
  assert.ok(data.systems.recommendation);
  assert.equal(data.systems.matches.length, 5);
  assert.ok(data.advice.some((tip) => tip.kind === 'structure'));
});

test('منع التكرار داخل خطة النظام نفسه', () => {
  const system = getSystem('calm');
  const plan = planSystemRoutines(system, {
    intensity: 'full',
    existing: [{ title: 'تنفس ٤-٦', archivedAt: null }],
  });
  assert.equal(plan.routines.length, system.routineCount - 1);
  assert.ok(plan.skipped.some((s) => s.reason === 'already_exists'));
});
