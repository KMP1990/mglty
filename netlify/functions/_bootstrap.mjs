/**
 * تهيئة التطبيق داخل Netlify Functions.
 * ------------------------------------------------------------
 * لا قرص دائم في Netlify، لذا نركّب Netlify Blobs كطبقة data/.
 * سر الجلسات يُنشأ مرة واحدة ويُحفظ في Blobs كي لا تتغير الجلسات
 * مع كل cold start. يمكن تجاوزه بـ SESSION_SECRET من لوحة Netlify.
 */
import { createConfig } from '../../server/shared/config.js';
import { createApp } from '../../server/app.js';
import { createNetlifyBackend, ensureBlobSecret, installBlobFs } from '../../server/shared/blob-vfs.js';

let appPromise = null;

async function init() {
  process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  process.env.COOKIE_SECURE = 'true';
  process.env.TRUST_PROXY = process.env.TRUST_PROXY || '1';
  process.env.DISABLE_SCHEDULER = 'true';
  process.env.MR_SERVERLESS = '1';
  process.env.DATA_DIR = process.env.DATA_DIR || '/tmp/majalati-data';

  const backend = await createNetlifyBackend();
  installBlobFs({ backend, dataRoot: process.env.DATA_DIR });

  if (!process.env.SESSION_SECRET) {
    process.env.SESSION_SECRET = await ensureBlobSecret();
  }

  const config = createConfig();
  const { app, ctx } = await createApp(config);
  return { app, ctx, config };
}

export function bootstrap() {
  if (!appPromise) appPromise = init();
  return appPromise;
}
