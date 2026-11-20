/**
 * فحص دقيق لحالة الإشعارات — يجمع حالة الخادم (Push/VAPID/SSE/الصندوق)
 * مع حالة الجهاز التي يبلّغ عنها المتصفح، ويحوّلها إلى قائمة فحوص قابلة للتنفيذ.
 * لا يكشف أي مفتاح سري أو endpoint كامل — فقط حقائق الحالة.
 */
import fs from 'node:fs';

export const NOTIFICATION_EVENTS = {
  'routine-time': 'تذكير روتين في وقته',
  'away-routine': 'تذكير يومي للغائب عن التطبيق',
  'evening-nudge': 'دفعة مسائية لما بقي',
  'morning-plan': 'خطة الصباح',
  'routine-level-up': 'تطور روتين إلى مستوى جديد',
  'all-done': 'إتمام كل روتينات اليوم',
  'streak-milestone': 'محطة سلسلة (٧/١٤/٣٠…)',
  'system-applied': 'تفعيل نظام روتين جاهز',
  'system-milestone': 'إتمام مرحلة من نظام',
  'reading-reminder': 'تذكير القراءة',
  'weekly-harvest': 'الحصاد الأسبوعي',
  'reengage': 'رسالة عودة بعد الغياب',
  'daily-digest': 'الملخص اليومي',
  'away-digest': 'ملخص يومي أثناء الغياب',
  'new-device': 'دخول من جهاز جديد',
  'password-changed': 'تغيير كلمة المرور',
};

const CLIENT_KEYS = ['permission', 'secure', 'serviceWorker', 'subscribed', 'standalone', 'online', 'visibility', 'timezone', 'platform'];

function normalizeClient(query = {}) {
  return {
    permission: ['granted', 'denied', 'default', 'unsupported'].includes(query.permission) ? query.permission : 'unknown',
    secure: query.secure === '1' || query.secure === 'true',
    serviceWorker: query.serviceWorker === '1' || query.serviceWorker === 'true',
    subscribed: query.subscribed === '1' || query.subscribed === 'true',
    standalone: query.standalone === '1' || query.standalone === 'true',
    online: query.online === '1' || query.online === 'true',
    visibility: ['visible', 'hidden'].includes(query.visibility) ? query.visibility : 'unknown',
    timezone: String(query.timezone || '').slice(0, 60) || null,
    platform: String(query.platform || '').slice(0, 80) || null,
  };
}

function check(id, label, status, detail, fix = null) {
  return { id, label, status, detail, fix };
}

function scoreOf(checks) {
  if (!checks.length) return 0;
  const points = checks.reduce((sum, item) => sum + (item.status === 'ok' ? 1 : item.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((points / checks.length) * 100);
}

export function createNotificationDiagnostics({ config, push, service, store, presence = null }) {
  /**
   * @param {object} user المستخدم الحالي
   * @param {{client?: object, bucket?: object}} opts
   */
  async function run(user, { client = {}, bucket = null } = {}) {
    await push?.ready?.().catch(() => {});
    const box = bucket || (await store.read(user.id));
    const subscriptions = box.pushSubscriptions || [];
    const devices = store.publicPushDevices(user.id, box);
    const live = service.connectedCount(user.id) || 0;
    const pres = presence ? await presence.read(user.id).catch(() => null) : null;
    const clientState = normalizeClient(client);
    const vapidFile = `${config.dataDir}/push-vapid.json`;
    const vapidFileExists = fs.existsSync(vapidFile);
    const lastNotification = box.items?.[0] || null;
    const lastError = devices.find((device) => device.lastError) || null;
    const secure = clientState.secure || config.env !== 'production';
    const notifPrefs = user?.preferences?.notifications || {};
    const muted = [
      notifPrefs.routineReminders === false ? 'تذكيرات الروتين' : null,
      notifPrefs.achievements === false ? 'الإنجازات' : null,
      notifPrefs.systemEvents === false ? 'أحداث النظام' : null,
      notifPrefs.digest === false ? 'الملخص اليومي' : null,
    ].filter(Boolean);
    const quiet = notifPrefs.quietHours?.enabled !== false
      ? `ساعات هدوء ${notifPrefs.quietHours?.from || '23:00'}–${notifPrefs.quietHours?.to || '07:00'}`
      : null;

    const checks = [
      check(
        'server-push',
        'دفع الإشعارات على الخادم',
        push?.enabled ? 'ok' : 'fail',
        push?.enabled ? 'مفاتيح VAPID جاهزة وWeb Push مفعّل.' : 'مفاتيح VAPID غير جاهزة — الإشعارات داخل التطبيق فقط.',
        push?.enabled ? null : 'أعد تشغيل الخادم أو تحقق من صلاحية كتابة data/push-vapid.json'
      ),
      check(
        'vapid-source',
        'مصدر مفاتيح VAPID',
        push?.enabled ? (vapidFileExists ? 'ok' : 'warn') : 'warn',
        vapidFileExists ? 'المفاتيح محفوظة على القرص وتبقى بعد إعادة التشغيل.' : 'المفاتيح مولّدة في الذاكرة وقد تتغير بعد إعادة التشغيل.',
        vapidFileExists ? null : 'شغّل الخادم مع DATA_DIR قابل للكتابة'
      ),
      check(
        'sse',
        'القناة اللحظية SSE',
        live > 0 ? 'ok' : 'warn',
        live > 0 ? `${live} اتصال لحظي مفتوح الآن.` : 'لا يوجد اتصال مباشر الآن؛ سيصل كل شيء عند فتح التطبيق أو عبر Push.',
        live > 0 ? null : 'افتح التطبيق في تبويب نشط أو فعّل Web Push'
      ),
      check(
        'subscriptions',
        'أجهزة مشتركة في Push',
        subscriptions.length ? 'ok' : 'warn',
        subscriptions.length ? `${subscriptions.length} جهاز مشترك.` : 'لا يوجد جهاز مشترك — الإشعارات لن تصل والتطبيق مغلق.',
        subscriptions.length ? null : 'فعّل الإشعارات من هذه الصفحة'
      ),
      check(
        'delivery-error',
        'آخر محاولة دفع',
        lastError ? 'warn' : 'ok',
        lastError ? `فشل آخر إرسال لجهاز ${lastError.platform || 'غير معروف'}: ${lastError.lastError}` : 'لا أخطاء تسليم مسجّلة.',
        lastError ? 'استخدم زر الإصلاح لإعادة إنشاء الاشتراك' : null
      ),
      check(
        'inbox',
        'صندوق الإشعارات',
        Array.isArray(box.items) ? 'ok' : 'fail',
        Array.isArray(box.items) ? `${box.items.length} إشعارًا محفوظًا، ${box.unread} غير مقروء.` : 'تعذّر قراءة صندوق الإشعارات.',
        Array.isArray(box.items) ? null : 'تحقق من data/notifications'
      ),
      check(
        'preferences',
        'تفضيلات الوصول',
        muted.length ? 'warn' : 'ok',
        muted.length
          ? `أوقفت خارج التطبيق: ${muted.join('، ')}${quiet ? ` · ${quiet}` : ''}. تبقى محفوظة في صندوقك.`
          : `كل أنواع الإشعارات مسموحة${quiet ? ` · ${quiet}` : ''}.`,
        muted.length ? 'أعد تفعيل ما تحتاجه من صفحة الإشعارات' : null
      ),
      check(
        'client-permission',
        'إذن الجهاز',
        clientState.permission === 'granted' ? 'ok' : clientState.permission === 'denied' ? 'fail' : 'warn',
        clientState.permission === 'granted'
          ? 'المتصفح يسمح بالإشعارات.'
          : clientState.permission === 'denied'
            ? 'الإذن محجوب من إعدادات الموقع.'
            : 'لم يُطلب الإذن بعد أو لم يُمنح.',
        clientState.permission === 'granted' ? null : 'اضغط «السماح بالإشعارات»'
      ),
      check(
        'client-secure',
        'سياق آمن (HTTPS)',
        secure ? 'ok' : 'fail',
        secure ? 'الصفحة تعمل في سياق يسمح بالإشعارات.' : 'الإشعارات تحتاج HTTPS أو localhost.',
        secure ? null : 'افتح التطبيق عبر HTTPS'
      ),
      check(
        'client-sw',
        'Service Worker',
        clientState.serviceWorker ? 'ok' : 'warn',
        clientState.serviceWorker ? 'عامل الخدمة متاح.' : 'لم يُسجّل عامل الخدمة بعد.',
        clientState.serviceWorker ? null : 'أعد تحميل الصفحة أو استخدم زر الإصلاح'
      ),
      check(
        'client-subscription',
        'اشتراك هذا الجهاز',
        clientState.subscribed ? 'ok' : subscriptions.length ? 'warn' : 'warn',
        clientState.subscribed ? 'هذا الجهاز مشترك في Web Push.' : 'هذا الجهاز غير مشترك (قد تكون أجهزة أخرى مشتركة).',
        clientState.subscribed ? null : 'فعّل الإشعارات على هذا الجهاز'
      ),
    ];

    const score = scoreOf(checks);
    const status = checks.some((item) => item.status === 'fail') ? 'fail' : checks.some((item) => item.status === 'warn') ? 'warn' : 'ok';
    const recent = (box.items || []).slice(0, 5).map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      createdAt: item.createdAt,
      read: item.read,
    }));

    return {
      status,
      score,
      checkedAt: new Date().toISOString(),
      client: clientState,
      channels: {
        inApp: true,
        sse: live > 0,
        liveConnections: live,
        webPush: Boolean(push?.enabled && subscriptions.length),
        webPushServer: Boolean(push?.enabled),
        webPushDevices: subscriptions.length,
        localNotifications: clientState.permission === 'granted' && clientState.serviceWorker,
      },
      inbox: {
        total: box.items?.length || 0,
        unread: box.unread || 0,
        lastNotification,
        recent,
      },
      presence: pres
        ? {
            lastSeenAt: pres.lastSeenAt || null,
            lastOpenAt: pres.lastOpenAt || null,
            lastNotificationsAt: pres.lastNotificationsAt || null,
            daysAway: pres.lastOpenAt ? Math.max(0, Math.round(((Date.now() - Date.parse(pres.lastOpenAt)) / 86400000) * 10) / 10) : 0,
          }
        : null,
      events: NOTIFICATION_EVENTS,
      checks,
      lastError,
    };
  }

  return { run, events: NOTIFICATION_EVENTS };
}
