/**
 * تجميع التطبيق (Express app) بلا تشغيل سيرفر.
 * الفائدة: الاختبارات تستدعيه مباشرة ببيانات مؤقتة، والسيرفر يستدعي نفسه.
 */
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { appShell, documentPage } from './views/shell.js';
import { initDataDirs, logger } from './shared/store.js';
import { requestContext } from './shared/middleware.js';
import { handleError } from './shared/http.js';
import { BUILD } from './shared/build.js';
import presenceFeature from './features/presence/index.js';
import authFeature from './features/auth/index.js';
import notificationsFeature from './features/notifications/index.js';
import meFeature from './features/me/index.js';
import legalFeature from './features/legal/index.js';
import routinesFeature from './features/routines/index.js';
import booksFeature from './features/books/index.js';
import remindersFeature from './features/reminders/index.js';

/** ترتيب التركيب مهم: المصادقة أولًا لأنها تقدم الخدمات المشتركة */
export async function createApp(config) {
  await initDataDirs(config);
  const isDev = config.env === 'development';
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'"], // سكربت البناء الصغير + محرك PDF
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          // Tesseract يقرأ ملف wasm من data: URL، وبعض المتصفحات تستخدم blob: لعامله.
          'connect-src': ["'self'", 'data:', 'blob:'],
          'worker-src': ["'self'", 'blob:', 'data:'],
          'child-src': ["'self'", 'blob:'],
          'manifest-src': ["'self'"],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: isDev ? false : { maxAge: 15552000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: config.jsonLimit || '3mb' }));
  app.use(requestContext);

  const ctx = { config, logger };
  // الحضور يُسجَّل قبل المصادقة حتى يستطيع حارس الجلسة تحديث آخر نشاط
  presenceFeature.register(app, ctx);
  authFeature.register(app, ctx);
  notificationsFeature.register(app, ctx);
  meFeature.register(app, ctx);
  legalFeature.register(app, ctx);
  // الروتينات (تعتمد على المصادقة والإشعارات)، وكتبي، ثم مجدول التذكير
  routinesFeature.register(app, ctx);
  booksFeature.register(app, ctx);
  remindersFeature.register(app, ctx);

  // Service Worker يجب أن يُخدَم قبل express.static ليأخذ رؤوس no-cache
  app.get('/sw.js', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    res.type('application/javascript; charset=utf-8');
    res.sendFile('sw.js', { root: config.publicDir });
  });

  app.use(
    express.static(config.publicDir, {
      etag: true,
      lastModified: true,
      index: false, // الصفحات تُخدَم من قالب الخادم فقط
      setHeaders(res, filePath) {
        const rel = filePath.replace(config.publicDir, '').replace(/\\/g, '/');
        if (rel.endsWith('.html') || rel.startsWith('/manifest')) res.setHeader('Cache-Control', 'no-cache');
        else res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
      },
    })
  );

  app.get('/api/healthz', (req, res) => res.json({ ok: true, uptime: process.uptime(), build: BUILD.id }));

  // الصفحات تأتي من قالب الخادم حصريًا (server/views/shell.js) — لا index.html ثابت.
  // لذلك نحذف أي ملف بحمل نفس الاسم لو وُجد من نسخة سابقة من البناء.
  const staleIndex = path.join(config.publicDir, 'index.html');
  if (await fs.stat(staleIndex).then(() => true).catch(() => false)) {
    await fs.rm(staleIndex, { force: true });
    logger.warn('stale_index_removed', { path: staleIndex });
  }
  app.get('/index.html', (req, res) => res.redirect(308, '/'));

  // الصفحات كلها من قالب الخادم — لا index.html يعتمد عليه، ولا تعارض مع express.static
  const buildMarker = `<script>window.__MR_VERSION__=${JSON.stringify(BUILD.id)};window.__MR_BUILD__=${JSON.stringify(
    BUILD.builtAt
  )};window.__MR_SERVERLESS__=${process.env.MR_SERVERLESS === '1' ? 'true' : 'false'};</script>`;

  const ROUTE_NAMES = {
    '/': 'home',
    '/routines': 'routines',
    '/coach': 'routines',
    '/login': 'login',
    '/signup': 'signup',
    '/notifications': 'notifications',
    '/account': 'account',
    '/vault': 'vault',
    '/books': 'books',
  };
  const TITLES = {
    home: 'مجلتي وروتيني — مجلتك وروتينك في مكان واحد',
    routines: 'روتيناتي — مجلتي وروتيني',
    login: 'تسجيل الدخول — مجلتي وروتيني',
    signup: 'إنشاء حساب — مجلتي وروتيني',
    notifications: 'الإشعارات — مجلتي وروتيني',
    account: 'حسابي — مجلتي وروتيني',
    vault: 'الخزنة — مجلتي وروتيني',
    books: 'كتبي — مجلتي وروتيني',
  };

  const renderApp = (route) =>
    documentPage({
      title: TITLES[route] || TITLES.home,
      route,
      body: appShell(),
      // أنماط الصفحة الرئيسية مبكرة لتجنب وميض أول رسم
      extraHead: route === 'home' ? '<link rel="stylesheet" href="/features/home/home.css" />\n' : '',
      buildMarker,
    });

  // التحقق بالقيمة الحسابية المحسوبة عند الإقلاع — إرسال واحد لكل مسار
  const renderedPages = new Map(Object.entries(ROUTE_NAMES).map(([path, route]) => [path, renderApp(route)]));

  for (const [routePath, html] of renderedPages) {
    app.get(routePath, (req, res) => {
      void req;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.send(html);
    });
  }

  const notFoundPage = () => `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>غير موجود — مجلتي وروتيني</title><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"></head><body><main class="container" style="display:grid;place-items:center;gap:12px;min-height:80dvh;text-align:center"><span style="font-size:56px">🧭</span><h1>هذه الصفحة غير موجودة</h1><p>ربما الرابط قديم. لنعد للبداية.</p><a class="btn btn-primary" href="/">الرئيسية</a></main></body></html>`;

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'المسار غير موجود' } });
    }
    res.status(404).send(notFoundPage());
  });

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: { code: 'payload_too_large', message: 'الطلب كبير جدًا' } });
    }
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ ok: false, error: { code: 'bad_json', message: 'صيغة الطلب غير صحيحة' } });
    }
    handleError(err, req, res, next);
  });

  return { app, ctx };
}
