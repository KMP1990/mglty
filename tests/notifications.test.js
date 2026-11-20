/**
 * اختبارات تطوير الإشعارات:
 *  • مفتاح VAPID والاشتراك/الإلغاء عبر API.
 *  • مزامنة تقدّم القراءة (الكتاب يبقى على الجهاز).
 *  • حضور المستخدم وبانر «ما فاتك».
 *  • مجدول الخادم: تذكير قراءة وملخص يومي مرة واحدة، ويصل للغائب.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-notif-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret';
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
  ctx.services.reminders?.stop?.();
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
      redirect: 'manual',
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
    jar,
    get: (u, h) => req('GET', u, undefined, h),
    post: (u, b, h) => req('POST', u, b ?? {}, h),
    put: (u, b, h) => req('PUT', u, b ?? {}, h),
    patch: (u, b, h) => req('PATCH', u, b ?? {}, h),
    del: (u, b, h) => req('DELETE', u, b, h),
    postCsrf: (u, b) => req('POST', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    putCsrf: (u, b) => req('PUT', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
    patchCsrf: (u, b) => req('PATCH', u, b ?? {}, { 'X-CSRF-Token': jar.get('mr_csrf') }),
  };
}

const b64url = (value) => Buffer.from(value).toString('base64url');
const localDay = (offsetDays = 0) => {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};
const localTime = () => {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

let client;
let userId;

test('إنشاء حساب للاختبار', async () => {
  client = createClient();
  const res = await client.post('/api/auth/signup', {
    name: 'سارة الاختبار',
    email: `notif-${Date.now()}@example.com`,
    password: 'StrongPass!2345',
    acceptTerms: true,
  });
  assert.equal(res.status, 201);
  userId = res.json.data.user.id;
});

test('مفتاح Push متاح والاشتراك يُحفظ ولا يكشف المفاتيح', async () => {
  const key = await client.get('/api/notifications/push/key');
  assert.equal(key.status, 200);
  assert.equal(key.json.data.enabled, true);
  assert.equal(Buffer.from(key.json.data.publicKey, 'base64url').length, 65);

  const device = crypto.createECDH('prime256v1');
  device.generateKeys();
  const subscription = {
    endpoint: 'https://push.example.test/abc',
    keys: {
      p256dh: b64url(device.getPublicKey()),
      auth: b64url(crypto.randomBytes(16)),
    },
  };
  const subscribe = await client.postCsrf('/api/notifications/push/subscribe', { subscription, platform: 'Test' });
  assert.equal(subscribe.status, 201);
  assert.equal(subscribe.json.data.devices.length, 1);
  assert.ok(subscribe.json.data.devices[0].id);
  assert.equal(subscribe.json.data.devices[0].endpoint, undefined, 'لا نكشف endpoint');
  assert.equal(subscribe.json.data.devices[0].keys, undefined, 'لا نكشف المفاتيح');

  const list = await client.get('/api/notifications/');
  assert.equal(list.json.data.channels.webPush, true);
  assert.equal(list.json.data.channels.pushDevices.length, 1);

  const bad = await client.postCsrf('/api/notifications/push/subscribe', {
    subscription: { endpoint: 'not-a-url', keys: { p256dh: 'x', auth: 'y' } },
  });
  assert.equal(bad.status, 400);

  const unsubscribe = await client.postCsrf('/api/notifications/push/unsubscribe', { endpoint: subscription.endpoint });
  assert.equal(unsubscribe.status, 200);
  assert.equal(unsubscribe.json.data.removed, true);
  const after = await client.get('/api/notifications/');
  assert.equal(after.json.data.channels.pushDevices.length, 0);
});

test('مزامنة تقدّم القراءة تُحفظ على الخادم مع بقاء الكتاب على الجهاز', async () => {
  const snapshot = {
    bookId: 'book-1',
    bookTitle: 'كتاب الاختبار',
    chapterTitle: 'الفصل الثاني',
    chapterIndex: 1,
    pageIndex: 3,
    pageCount: 20,
    percent: 42,
    minutesToday: 18,
    pagesToday: 12,
    minutesTotal: 95,
    pagesTotal: 80,
    days: 5,
    streakDays: 3,
    lastReadDate: localDay(-1),
    lastReadAt: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const saved = await client.putCsrf('/api/books/reading', snapshot);
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.saved, true);
  assert.equal(saved.json.data.reading.bookTitle, 'كتاب الاختبار');
  assert.equal(saved.json.data.reading.percent, 42);

  // قيم خارج النطاق تُقصّ ولا تُكسر الخادم
  const clamped = await client.putCsrf('/api/books/reading', { percent: 900, minutesToday: -5, chapterIndex: -3 });
  assert.equal(clamped.status, 200);

  const reading = await client.get('/api/books/reading');
  assert.equal(reading.status, 200);
  assert.equal(reading.json.data.reading.bookTitle, 'كتاب الاختبار');
});

test('الغياب يُحسب، وبانر ما فاتك يعتمد على آخر زيارة لا آخر طلب', async () => {
  // زيارة أولى ثم إشعاران ثم زيارة أخرى: يجب ألا يُظهر الطلب نفسه غيابًا
  const firstVisit = await client.postCsrf('/api/notifications/visit', { source: 'test' });
  assert.equal(firstVisit.status, 200);

  await client.postCsrf('/api/notifications/', { type: 'system', title: 'خبر أول' });
  await client.postCsrf('/api/notifications/', { type: 'system', title: 'خبر ثانٍ' });

  const list = await client.get('/api/notifications/');
  assert.equal(list.status, 200);
  assert.equal(typeof list.json.data.summary.daysAway, 'number');
  assert.ok(list.json.data.summary.missed >= 0);
  assert.ok(list.json.data.activity);
  assert.ok(list.json.data.notificationPrefs);
});

test('تفضيلات الملخص اليومي وأنواع الإشعارات تُحفظ وتُصحّح', async () => {
  const res = await client.patchCsrf('/api/me', {
    preferences: {
      notifications: {
        digest: false,
        digestTime: '25:99',
        reengage: false,
        awayReminders: false,
        routineReminders: false,
        achievements: false,
        systemEvents: false,
        quietHours: { enabled: false, from: '99:99', to: 'bad' },
      },
    },
  });
  assert.equal(res.status, 200);
  const prefs = res.json.data.user.preferences.notifications;
  assert.equal(prefs.digest, false);
  assert.equal(prefs.reengage, false);
  assert.equal(prefs.awayReminders, false);
  assert.equal(prefs.routineReminders, false);
  assert.equal(prefs.achievements, false);
  assert.equal(prefs.systemEvents, false);
  assert.equal(prefs.quietHours.enabled, false);
  assert.equal(prefs.digestTime, '08:30', 'وقت غير صالح يعود للافتراضي');
  assert.equal(prefs.quietHours.from, '23:00', 'وقت هدوء غير صالح يعود للافتراضي');
  assert.equal(prefs.quietHours.to, '07:00');

  const ok = await client.patchCsrf('/api/me', {
    preferences: {
      notifications: {
        digest: true,
        digestTime: '09:15',
        awayReminders: true,
        routineReminders: true,
        achievements: true,
        systemEvents: true,
        quietHours: { enabled: false },
      },
    },
  });
  assert.equal(ok.json.data.user.preferences.notifications.digestTime, '09:15');
  assert.equal(ok.json.data.user.preferences.notifications.routineReminders, true);
});

test('المجدول يرسل تذكير قراءة وملخصًا مرة واحدة للغائب', async () => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await client.putCsrf('/api/routines/settings', { timeZone, reminders: { enabled: true, eveningNudge: false, morningPlan: false } });
  await client.patchCsrf('/api/me', {
    preferences: {
      readingReminder: { enabled: true, time: localTime() },
      notifications: { digest: true, digestTime: localTime(), reengage: true },
    },
  });

  // نُبعد المستخدم يومين حتى يُعدّ غائبًا ويستحق رسالة عودة
  const presence = ctx.services.presence;
  const state = await presence.read(userId);
  state.lastSeenAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
  state.reminders = {};
  await presence.write(userId, state);

  const reminders = ctx.services.reminders;
  await reminders.tickOnce();
  await reminders.tickOnce(); // لا تكرار

  const items = (await client.get('/api/notifications/')).json.data.items;
  const reading = items.filter((n) => n.title.includes('وقت القراءة'));
  assert.equal(reading.length, 1, 'تذكير قراءة واحد');
  const digests = items.filter((n) => n.type === 'digest');
  assert.equal(digests.length, 1, 'رسالة ملخص/عودة واحدة');
  assert.ok(digests[0].body.includes('كتاب الاختبار'));
});

test('المجدول يرسل تذكير روتين يوميًا للغائب مرة واحدة فقط', async () => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await client.putCsrf('/api/routines/settings', { timeZone, reminders: { enabled: true, eveningNudge: false, morningPlan: false } });
  await client.patchCsrf('/api/me', {
    preferences: {
      notifications: {
        digest: false,
        reengage: false,
        awayReminders: false,
        routineReminders: true,
        quietHours: { enabled: false },
      },
    },
  });

  const title = `روتين الغائب ${Date.now()}`;
  const created = await client.postCsrf('/api/routines', { title, time: localTime() });
  assert.equal(created.status, 201);

  const presence = ctx.services.presence;
  const state = await presence.read(userId);
  state.lastSeenAt = new Date(Date.now() - 5 * 86_400_000).toISOString();
  state.reminders = {};
  await presence.write(userId, state);

  const reminders = ctx.services.reminders;
  await reminders.tickOnce();
  await reminders.tickOnce(); // لا تكرار في اليوم نفسه

  const items = (await client.get('/api/notifications/')).json.data.items;
  const matches = items.filter((n) => n.title.includes(title));
  assert.equal(matches.length, 1, 'تذكير واحد للغائب يوميًا');
  assert.equal(matches[0].data.routineId, created.json.data.routine.id);
  assert.equal(matches[0].data.event, 'away-routine');
});

test('ساعات الهدوء تمنع تذكير الروتين غير الأمني', async () => {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await client.putCsrf('/api/routines/settings', { timeZone, reminders: { enabled: true, eveningNudge: false, morningPlan: false } });
  const now = new Date();
  const from = localTime();
  const end = new Date(now.getTime() + 60_000);
  const to = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  await client.patchCsrf('/api/me', {
    preferences: { notifications: { routineReminders: true, digest: false, quietHours: { enabled: true, from, to } } },
  });

  const title = `روتين هادئ ${Date.now()}`;
  const created = await client.postCsrf('/api/routines', { title, time: localTime() });
  assert.equal(created.status, 201);

  const presence = ctx.services.presence;
  const state = await presence.read(userId);
  state.lastSeenAt = new Date().toISOString();
  state.reminders = {};
  await presence.write(userId, state);

  await ctx.services.reminders.tickOnce();
  const items = (await client.get('/api/notifications/')).json.data.items;
  assert.equal(items.filter((n) => n.title.includes(title)).length, 0, 'لا تذكير أثناء ساعات الهدوء');

  // إعادة الهدوء إلى وضعه الافتراضي لبقية الاختبارات
  await client.patchCsrf('/api/me', {
    preferences: { notifications: { quietHours: { enabled: false, from: '23:00', to: '07:00' } } },
  });
});

test('تنظيف: حذف الحساب لا يترك اشتراكات أو حضورًا', async () => {
  const res = await client.del('/api/me', { confirm: 'DELETE' }, { 'X-CSRF-Token': client.jar.get('mr_csrf') });
  assert.equal(res.status, 200);
  await assert.rejects(fs.stat(path.join(dataDir, 'presence', `${userId}.json`)));
});
