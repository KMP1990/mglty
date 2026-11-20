/**
 * فحص حالة الإشعارات الدقيق من خارج الخادم:
 * ملفات القناة، مفاتيح VAPID، صندوق كل مستخدم، آخر أخطاء التسليم، وربط الأحداث.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTIFICATION_EVENTS } from '../../server/features/notifications/diagnostics.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'data');

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function inspectNotifications() {
  const checks = [];
  const files = [
    'server/features/notifications/index.js',
    'server/features/notifications/service.js',
    'server/features/notifications/push.js',
    'server/features/notifications/diagnostics.js',
    'public/features/notifications/inspect/diagnostics.js',
    'public/features/device/device.js',
  ];
  const missing = [];
  for (const file of files) if (!(await exists(path.join(ROOT, file)))) missing.push(file);
  checks.push({
    id: 'notifications-files',
    label: 'ملفات قناة الإشعارات',
    status: missing.length ? 'fail' : 'ok',
    detail: missing.length ? `مفقود: ${missing.join(', ')}` : 'الخادم والعميل وملفات الفحص موجودة.',
    fix: missing.length ? 'أعد الملف المفقود' : null,
  });

  const vapid = await readJson(path.join(DATA, 'push-vapid.json'));
  checks.push({
    id: 'notifications-vapid',
    label: 'مفاتيح VAPID',
    status: vapid?.publicKey && vapid?.privateKey ? 'ok' : 'warn',
    detail: vapid?.publicKey && vapid?.privateKey ? 'المفاتيح محفوظة وتبقى بعد إعادة التشغيل.' : 'لا ملف مفاتيح بعد — سيُولّد عند أول تشغيل.',
    fix: vapid?.publicKey ? null : 'شغّل الخادم مرة واحدة مع DATA_DIR قابل للكتابة',
  });

  let boxes = [];
  try {
    const list = (await fs.readdir(path.join(DATA, 'notifications'))).filter((f) => /^[a-f0-9]{24}\.json$/.test(f));
    for (const file of list) {
      const box = await readJson(path.join(DATA, 'notifications', file));
      if (box) boxes.push(box);
    }
  } catch {
    /* لا بيانات بعد */
  }
  const subscriptions = boxes.reduce((sum, box) => sum + (box.pushSubscriptions?.length || 0), 0);
  const unread = boxes.reduce((sum, box) => sum + (box.unread || 0), 0);
  const errors = boxes.flatMap((box) => (box.pushSubscriptions || []).filter((s) => s.lastError));
  checks.push({
    id: 'notifications-inbox',
    label: 'صناديق الإشعارات',
    status: errors.length ? 'warn' : 'ok',
    detail: boxes.length
      ? `${boxes.length} صندوقًا • ${subscriptions} جهازًا مشتركًا • ${unread} غير مقروء.`
      : 'لا صناديق محلية بعد (بيئة جديدة).',
    fix: errors.length ? 'افحص أخطاء التسليم من صفحة الإشعارات ثم أصلح الاشتراك' : null,
  });
  checks.push({
    id: 'notifications-events',
    label: 'الأحداث المرتبطة',
    status: Object.keys(NOTIFICATION_EVENTS).length >= 8 ? 'ok' : 'warn',
    detail: `${Object.keys(NOTIFICATION_EVENTS).length} حدثًا مرتبطًا بالروتين والأنظمة والقراءة والأمان.`,
    fix: null,
  });
  return checks;
}
