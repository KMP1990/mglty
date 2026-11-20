/**
 * اختبارات كتبي: مساعد القراءة المحلي + صورة الحساب.
 * الكتب نفسها تُخزَّن في المتصفح، لذلك نختبر الخادم الذي يخدم التحليل والتحقق.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-books-'));
process.env.DATA_DIR = dataDir;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'books-test-secret';
process.env.LOG_LEVEL = 'error';
process.env.DISABLE_SCHEDULER = 'true';
delete process.env.AI_PROVIDER;

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
  };
}

const PAGE = `القراءة اليومية عادة صغيرة تصنع فرقًا كبيرًا. عندما تقرأ عشر صفحات كل يوم فإنك تقرأ كتابًا كاملًا في شهر.
الفهم العميق يعني أن تربط المعلومة الجديدة بما تعرفه، وأن تشرحها بجملتك.
البيانات: ٨٠٪ من القراء يستفيدون من التلخيص.
الرسم البياني يوضح العلاقة بين وقت القراءة وعدد الكتب في السنة.`;

let client;

test('المساعد يحتاج تسجيل الدخول', async () => {
  const anon = createClient();
  const res = await anon.post('/api/books/ai/help', { task: 'summary', pageText: PAGE });
  assert.equal(res.status, 401);
});

test('إنشاء حساب لاختبارات كتبي', async () => {
  client = createClient();
  const res = await client.req('POST', '/api/auth/signup', {
    name: 'قارئة',
    email: `books${Date.now().toString(36)}@example.com`,
    password: 'Str0ng-Passw0rd!',
    acceptTerms: true,
  });
  assert.equal(res.status, 201);
});

test('حالة المساعد: محلي وبلا إنترنت افتراضيًا', async () => {
  const res = await client.get('/api/books/ai/status');
  assert.equal(res.status, 200);
  assert.equal(res.json.data.engine, 'local');
  assert.equal(res.json.data.vision, false);
});

test('تلخيص صفحة يعيد نقاطًا ومصطلحات', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pageText: PAGE,
    title: 'كتاب القراءة',
    chapterTitle: 'الفصل الأول',
    pageNumber: 3,
  });
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.equal(data.engine, 'local');
  assert.ok(data.summary.length > 20);
  assert.ok(Array.isArray(data.points) && data.points.length >= 2);
  assert.ok(data.terms.some((term) => /الفهم العميق/.test(term.term)));
  assert.ok(data.questions.length >= 1);
});

test('شرح رسمة يتعرف على النوع من التعليق', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'image',
    pageText: PAGE,
    images: [{ alt: 'رسم بياني', caption: 'شكل ١: العلاقة بين وقت القراءة وعدد الكتب' }],
  });
  assert.equal(res.status, 200);
  const image = res.json.data.images[0];
  assert.ok(image);
  assert.equal(image.kind, 'رسم بياني');
  assert.ok(image.what.includes('شكل ١'));
  assert.ok(image.how.length >= 2);
});

test('عنوان الفصل لا يتكرر داخل الملخص أو النقاط', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pageText: `الفصل الأول: عادة القراءة
${PAGE}`,
    chapterTitle: 'الفصل الأول: عادة القراءة',
  });
  assert.equal(res.status, 200);
  assert.ok(!res.json.data.headline.startsWith('الفصل الأول'));
  assert.ok(!res.json.data.points[0].startsWith('الفصل الأول'));
  assert.ok(!res.json.data.terms.some((term) => term.term.startsWith('الفصل الأول')));
});

test('سؤال عن الصفحة يُجاب من نصها', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'ask',
    pageText: PAGE,
    question: 'ما معنى الفهم العميق؟',
  });
  assert.equal(res.status, 200);
  assert.ok(res.json.data.answer.includes('الفهم العميق'));
});

test('تفضيلات الصوت وتذكير القراءة تُحفظ وتُقيَّد', async () => {
  const saved = await client.patch('/api/me', {
    preferences: {
      sound: { enabled: false, volume: 4 },
      readingReminder: { enabled: true, time: '21:15' },
    },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.user.preferences.sound.enabled, false);
  assert.equal(saved.json.data.user.preferences.sound.volume, 1);
  assert.equal(saved.json.data.user.preferences.readingReminder.enabled, true);
  assert.equal(saved.json.data.user.preferences.readingReminder.time, '21:15');

  const invalid = await client.patch('/api/me', {
    preferences: { readingReminder: { enabled: true, time: '99:99' } },
  });
  assert.equal(invalid.status, 200);
  assert.equal(invalid.json.data.user.preferences.readingReminder.time, '21:15');
});

test('صفحة فارغة تُرفض', async () => {
  const res = await client.post('/api/books/ai/help', { task: 'summary', pageText: '   ', images: [] });
  assert.equal(res.status, 400);
  assert.equal(res.json.error.code, 'empty_page');
});

test('إنشاء إشعار كتبي يحتفظ ببيانات المصدر', async () => {
  const created = await client.post('/api/notifications/', {
    type: 'achievement',
    title: 'أنهيت كتابًا 🎉',
    body: 'اختبار',
    link: '/books',
    data: { source: 'books', event: 'finished', bookId: 'x' },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.json.data.notification.data, { source: 'books', event: 'finished', bookId: 'x' });

  const listed = await client.get('/api/notifications/');
  assert.ok(listed.json.data.items.some((item) => item.data?.source === 'books'));
});

test('رفع صورة حساب صالحة ثم إزالتها', async () => {
  const bytes = await fs.readFile(path.join(root, 'public', 'icons', 'icon-192.png'));
  const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
  const saved = await client.put('/api/me/avatar', { avatar: dataUrl });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.data.user.avatar, dataUrl);

  const session = await client.get('/api/auth/session');
  assert.equal(session.json.data.user.avatar, dataUrl);

  const removed = await client.del('/api/me/avatar');
  assert.equal(removed.status, 200);
  assert.equal(removed.json.data.user.avatar, null);
});

test('رفض صورة SVG ورفض صورة ضخمة', async () => {
  const svg = await client.put('/api/me/avatar', { avatar: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
  assert.equal(svg.status, 400);
  assert.equal(svg.json.error.code, 'invalid_avatar');

  const big = await client.put('/api/me/avatar', { avatar: `data:image/png;base64,${'A'.repeat(2_000_000)}` });
  assert.equal(big.status, 400);
  assert.ok(['avatar_too_large', 'invalid_avatar'].includes(big.json.error.code));
});

test('الشرح المحلي باللهجة العراقية ومختصر', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pageText: PAGE,
    chapterTitle: 'الفصل الأول',
    pageNumber: 3,
  });
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.equal(data.engine, 'local');
  assert.ok(data.summary.startsWith('الزبدة:'));
  assert.ok(data.explanation[0].label.includes('فكرة الصفحة'));
  assert.ok(data.questions.every((question) => !question.startsWith('ماذا')));
});

test('صفحة صورة بلا نص تطلب مزوّد رؤية بدل شرح فارغ', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pageText: '',
    images: [{ alt: 'صفحة ٥ من الكتاب', caption: 'صفحة ٥ (صورة)' }],
    pageNumber: 5,
    visionImage: 'data:image/jpeg;base64,AAAA',
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.data.needsVision, true);
  assert.match(res.json.data.summary, /رؤية/);
  assert.match(res.json.data.headline, /٥|5/);
});

test('نص مستخرج من خطوط تالفة يُشرح مع تنبيه واضح', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pageText: PAGE,
    pageNumber: 7,
    textReliability: 'low',
  });
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.equal(data.engine, 'local');
  assert.ok(data.notice && /تالفة/.test(data.notice));
  assert.ok(data.summary.length > 20);
});

test('ترويسة PDF وأرقام الصفحات لا تدخل في الشرح', async () => {
  const noisy = `9 | P a g e
عوامل تؤثر في الإعجاب: • التشابه: نحن نميل إلى الإعجاب بمن يشبهنا في الاهتمامات والقيم.
• التعاون: العمل مع شخص آخر لتحقيق هدف مشترك يقوّي مشاعر الإعجاب بينكما.
KETABPEDIA.COM`;
  const res = await client.post('/api/books/ai/help', {
    task: 'ask',
    pageText: noisy,
    question: 'بسّطها أكثر',
    pageNumber: 9,
  });
  assert.equal(res.status, 200);
  const data = res.json.data;
  const bundle = [data.summary, data.answer, ...(data.terms || []).map((t) => t.term)].join(' ');
  assert.doesNotMatch(bundle, /P a g e|KETABPEDIA|\d+ \|/);
  assert.ok(/ببساطة|أسهل/.test(data.answer || ''));
});

test('صفحة تقريبية (كتاب بلا نطاقات صفحات) تُوضَّح', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pageText: PAGE,
    pageNumber: 3,
    approximatePage: true,
  });
  assert.equal(res.status, 200);
  assert.ok(/تقريبي/.test(res.json.data.notice || ''));
});

test('ملخص صفحات متعددة يغطيها ويرسم مخطط أفكار', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'summary',
    pages: [
      { number: 7, text: 'التشابه: نحن نميل إلى الإعجاب بمن يشبهنا. هذا التشابه يخلق ألفة وراحة.' },
      { number: 8, text: 'الثقة: عندما نحب شخصًا نثق به. الرغبة في إرضاء الآخر تدفعنا لتغيير سلوكنا.' },
    ],
    title: 'كتاب',
  });
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.equal(data.engine, 'local');
  assert.match(data.summary, /صفحة/);
  assert.ok(data.points.length >= 2);
  assert.ok(data.points.some((point) => /7|٧/.test(point)) && data.points.some((point) => /8|٨/.test(point)));
  assert.ok(data.diagram && data.diagram.branches.length >= 2);
});

test('سؤال شامل يعتمد على مقتطفات البحث بلا نص صفحة', async () => {
  const res = await client.post('/api/books/ai/help', {
    task: 'ask',
    pageText: '',
    bookContext: 'صفحة ١٢: المتلاعب يستخدم الإطراء الزائف ثم العزلة ثم التخويف.',
    question: 'شنو أسلوب المتلاعب؟',
  });
  assert.equal(res.status, 200);
  const data = res.json.data;
  assert.ok((data.answer || '').length > 10);
  assert.equal(data.needsVision, false);
});

test('كتالوج النماذج يضم عشرة نماذج وأكثر مع رؤية', async () => {
  const res = await client.get('/api/books/ai/models');
  assert.equal(res.status, 200);
  const models = res.json.data.models;
  assert.ok(models.length >= 10);
  assert.ok(models.filter((model) => model.vision).length >= 5);
  assert.ok(models.some((model) => model.provider === 'google' && model.vision));
  assert.ok(models.some((model) => model.provider === 'pollinations'));
});

test('إعدادات النموذج ترفض مزوّدًا يحتاج مفتاحًا بلا مفتاح', async () => {
  const res = await client.put('/api/books/ai/settings', { provider: 'openai', model: 'gpt-4o' });
  assert.equal(res.status, 400);
  assert.match(res.json.error.message, /مفتاح/);
  const active = await client.post('/api/books/ai/settings/active', { provider: 'pollinations', model: 'openai-fast' });
  assert.equal(active.status, 200);
});

test('تصحيح OCR متاح ويصلح النص حتى بلا مزوّد', async () => {
  const res = await client.post('/api/books/ai/ocr-fix', {
    text: 'المتلاعب يستخدم هذه المصطلحات لإبهارنا وإرياكناء وإخفاء افتقاره إلى المعرفةالحقيقية.',
    englishText: '',
  });
  assert.equal(res.status, 200);
  assert.match(res.json.data.text, /وإرباكنا/);
  assert.match(res.json.data.text, /المعرفة الحقيقية/);
  assert.equal(res.json.data.corrected, false);
});
