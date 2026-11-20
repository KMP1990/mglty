/**
 * مجلتي وروتيني — نقطة تشغيل الخادم
 * ------------------------------------------------------------
 * كل منطق التطبيق في server/app.js (قابل للاختبار دون تشغيل منفذ).
 * هنا فقط: إنشاء الإعدادات، تشغيل السيرفر، والإغلاق اللطيف.
 */
import { createConfig } from './shared/config.js';
import { loadEnv } from './shared/env.js';
import { logger } from './shared/store.js';
import { createApp } from './app.js';

// اقرأ .env قبل أي إعداد (بيئة حقيقية تُغلب الملف)
loadEnv(process.cwd());

// سر الجلسات إلزامي في الإنتاج — لا نسمح بقيمة تطوير هناك
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
  console.error('✖ يجب تعيين SESSION_SECRET في بيئة الإنتاج.');
  process.exit(1);
}

const config = createConfig();
const { app } = await createApp(config);

const server = app.listen(config.port, () => {
  logger.info('server_started', { port: config.port, env: config.env });
  console.log(`\n  ✦ مجلتي وروتيني يعمل على: http://localhost:${config.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    logger.info('shutdown', { signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
