import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const ROOT_DIR = path.resolve(serverDir, '..');

/**
 * إعدادات الخادم. كل القيم القابلة للتغيير من متغيرات البيئة،
 * وكل مسارات البيانات قابلة للتحويل لمجلد مؤقت في الاختبارات.
 */
export function createConfig(overrides = {}) {
  const env = process.env.NODE_ENV || 'development';
  return {
    env,
    isProd: env === 'production',
    port: Number(process.env.PORT || 3000),
    trustProxy: Number(process.env.TRUST_PROXY || 0),
    publicDir: path.join(ROOT_DIR, 'public'),
    dataDir: process.env.DATA_DIR || path.join(ROOT_DIR, 'data'),
    // حد حجم الطلب: يسمح بصورة حساب بعد تصغيرها في العميل
    jsonLimit: process.env.JSON_LIMIT || '3mb',
    // الجلسات: مدتها وصفيحة التزوير
    sessionTtlMs: Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 24 * 30), // 30 يوم
    sessionIdleMs: Number(process.env.SESSION_IDLE_MS || 1000 * 60 * 60 * 24 * 7), // 7 أيام خمول
    cookieSecure: process.env.COOKIE_SECURE != null ? process.env.COOKIE_SECURE === 'true' : env === 'production',
    cookieName: 'mr_session',
    // سر توقيع الجلسات — يجب تعيينه في الإنتاج (SESSION_SECRET)
    sessionSecret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
    // حد الطلبات
    rateLimit: {
      // مرتفعة عمدًا في التطوير/الاختبار؛ في الإنتاج تُضبط بمتغيرات البيئة
      auth: { windowMs: 15 * 60 * 1000, max: Number(process.env.RL_AUTH || (env === 'production' ? 20 : 500)) },
      api: { windowMs: 60 * 1000, max: Number(process.env.RL_API || (env === 'production' ? 240 : 3000)) },
      signup: { windowMs: 60 * 60 * 1000, max: Number(process.env.RL_SIGNUP || (env === 'production' ? 10 : 500)) },
    },
    ...overrides,
  };
}
