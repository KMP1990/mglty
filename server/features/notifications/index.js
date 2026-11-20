import express from 'express';
import crypto from 'node:crypto';
import { wrap, badRequest, notFound } from '../../shared/http.js';
import { createRateLimiter } from '../../shared/rate-limit.js';
import { createNotificationStore, publicNotification } from './store.js';
import { createNotificationService } from './service.js';
import { createPushService } from './push.js';
import { createNotificationDiagnostics } from './diagnostics.js';

const PUSH_TYPES = new Set(['general', 'security', 'system', 'reminder', 'welcome', 'achievement', 'digest', 'insight']);

/** نمنع SSRF: لا نقبل عناوين محلية أو منافذ غير 443 */
function isPublicPushEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:') return false;
    if (url.port && url.port !== '443') return false;
    const host = url.hostname.toLowerCase();
    if (!host.includes('.')) return false;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(host)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '::1' || host.startsWith('[')) return false;
    return true;
  } catch {
    return false;
  }
}

/** يتحقق من اشتراك Web Push القادم من المتصفح */
function validPushSubscription(input) {
  const endpoint = String(input?.endpoint || '');
  if (!/^https:\/\/[^\s]{10,1200}$/i.test(endpoint) || !isPublicPushEndpoint(endpoint)) {
    return { ok: false, message: 'عنوان الاشتراك غير صالح' };
  }
  const p256dh = String(input?.keys?.p256dh || '');
  const auth = String(input?.keys?.auth || '');
  const isB64url = (v) => /^[A-Za-z0-9_-]+={0,2}$/.test(v);
  if (!isB64url(p256dh) || Buffer.from(p256dh, 'base64url').length !== 65) {
    return { ok: false, message: 'مفتاح الاشتراك (p256dh) غير صالح' };
  }
  if (!isB64url(auth) || Buffer.from(auth, 'base64url').length < 16) {
    return { ok: false, message: 'مفتاح الاشتراك (auth) غير صالح' };
  }
  return { ok: true, subscription: { endpoint, keys: { p256dh, auth } } };
}

/**
 * ميزة الإشعارات
 * GET    /api/notifications/            — قائمة الإشعارات + عدد غير المقروء + نوع الإرسال المتاح
 * POST   /api/notifications/            — إنشاء إشعار (خادم → مستخدم نفسه؛ نقطة ربط لأي ميزة)
 * POST   /api/notifications/:id/read    — تعليم إشعار كمقروء
 * POST   /api/notifications/read-all    — تعليم الكل كمقروء
 * DELETE /api/notifications/:id         — حذف إشعار
 * DELETE /api/notifications/            — حذف الكل
 * GET    /api/notifications/stream      — بث لحظي (SSE)
 * POST   /api/notifications/visit       — نبض فتح التطبيق + ما فاتك
 * GET    /api/notifications/push/key    — مفتاح VAPID العام
 * POST   /api/notifications/push/subscribe   — اشتراك جهاز في Web Push
 * DELETE /api/notifications/push/subscribe/:id
 * POST   /api/notifications/push/unsubscribe — إلغاء عبر endpoint
 * POST   /api/notifications/push/test   — إشعار تجريبي للأجهزة
 * POST   /api/notifications/devices     — تسجيل جهاز للإشعارات المحلية (توافق)
 * DELETE /api/notifications/devices/:id — إلغاء تسجيل جهاز
 */
export default {
  register(app, ctx) {
    const { config, logger } = ctx;
    const auth = ctx.services?.auth;
    if (!auth) throw new Error('notifications feature requires auth feature registered first');

    const store = createNotificationStore(config);
    const push = createPushService({ config, logger });
    const service = createNotificationService({ logger, store, push, users: auth.users });
    const presence = ctx.services?.presence;
    const diagnostics = createNotificationDiagnostics({ config, push, service, store, presence });
    void push.ready();
    ctx.services = { ...(ctx.services || {}), notifications: service, push, notificationDiagnostics: diagnostics };

    const router = express.Router();
    const { guards } = auth;
    const apiLimiter = createRateLimiter(config.rateLimit.api);

    // كل شيء هنا يتطلب تسجيل دخول
    router.use(guards.loadSession, guards.requireAuth);
    router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    // ---------- البث اللحظي ----------
    router.get('/stream', (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders?.();
      const unsubscribe = service.subscribe(req.auth.user.id, res);
      req.on('close', unsubscribe);
      req.on('error', unsubscribe);
    });

    // ---------- القائمة ----------
    router.get(
      '/',
      wrap(async (req, res) => {
        const userId = req.auth.user.id;
        if (!push.enabled) await push.ready();
        const bucket = await store.read(userId);
        // نسجّل آخر فتح للتطبيق قبل حساب الغياب، حتى لا يصفّر الطلب نفسه العدّاد
        const previous = presence ? await presence.read(userId) : null;
        const now = Date.now();
        const lastOpenAt = previous?.lastOpenAt || req.auth.user.lastLoginAt || req.auth.user.createdAt;
        const lastNotificationsAt = previous?.lastNotificationsAt || null;
        const daysAway = lastOpenAt ? Math.max(0, Math.round(((now - Date.parse(lastOpenAt)) / 86_400_000) * 10) / 10) : 0;
        const since = Date.parse(lastNotificationsAt || lastOpenAt || 0) || 0;
        const missed = bucket.items.filter((item) => !item.read && Date.parse(item.createdAt) > since).length;
        const summary = {
          total: bucket.items.length,
          unread: bucket.unread,
          missed,
          daysAway,
          lastSeq: bucket.items[0]?.seq || 0,
          lastOpenAt,
        };
        const reading = previous?.reading || null;
        res.json({
          ok: true,
          data: {
            items: bucket.items.map(publicNotification),
            summary,
            activity: {
              lastSeenAt: previous?.lastSeenAt || null,
              lastOpenAt: previous?.lastOpenAt || null,
              lastNotificationsAt,
              opens: previous?.opens || 0,
              reading: reading
                ? { bookTitle: reading.bookTitle, percent: reading.percent, lastReadDate: reading.lastReadDate, streakDays: reading.streakDays }
                : null,
            },
            channels: {
              inApp: true,
              // Web Push حقيقي عبر VAPID — يعمل والتطبيق مغلق
              webPush: push.enabled,
              webPushReady: push.enabled,
              email: false,
              pushDevices: store.publicPushDevices(userId, bucket),
            },
            notificationPrefs: req.auth.user.preferences?.notifications || {},
            liveConnections: service.connectedCount(userId),
          },
        });
        if (presence) {
          await presence.markNotificationsViewed(userId, { at: now }).catch(() => {});
        }
      })
    );

    // ---------- فتح التطبيق (نبض وصول) ----------
    router.post(
      '/visit',
      wrap(async (req, res) => {
        const userId = req.auth.user.id;
        const now = Date.now();
        const previous = presence ? await presence.read(userId) : null;
        const lastOpenAt = previous?.lastOpenAt || req.auth.user.lastLoginAt || null;
        const daysAway = lastOpenAt ? Math.max(0, Math.round(((now - Date.parse(lastOpenAt)) / 86_400_000) * 10) / 10) : 0;
        const since = Date.parse(lastOpenAt || 0) || 0;
        const bucket = await store.read(userId);
        const missedItems = bucket.items.filter((item) => !item.read && Date.parse(item.createdAt) > since).slice(0, 5);
        const result = presence ? await presence.markOpen(userId, { at: now, source: String(req.body?.source || 'boot').slice(0, 60) }) : null;
        res.json({
          ok: true,
          data: {
            daysAway,
            missed: bucket.items.filter((item) => !item.read && Date.parse(item.createdAt) > since).length,
            items: missedItems.map(publicNotification),
            unread: bucket.unread,
            countedAsOpen: Boolean(result?.missedOpen),
          },
        });
      })
    );

    // ---------- فحص دقيق لحالة الإشعارات ----------
    router.get(
      '/diagnostics',
      wrap(async (req, res) => {
        const bucket = await store.read(req.auth.user.id);
        const data = await diagnostics.run(req.auth.user, { client: req.query, bucket });
        res.json({ ok: true, data });
      })
    );

    // ---------- Web Push: المفتاح والاشتراك ----------
    router.get(
      '/push/key',
      wrap(async (req, res) => {
        await push.ready();
        res.json({
          ok: true,
          data: {
            enabled: push.enabled,
            publicKey: push.publicKey,
            subject: push.subject,
          },
        });
      })
    );

    router.post(
      '/push/subscribe',
      apiLimiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        await push.ready();
        if (!push.enabled) throw badRequest('push_disabled', 'الإشعارات السحابية غير مهيأة على الخادم بعد');
        const parsed = validPushSubscription(req.body?.subscription || req.body);
        if (!parsed.ok) throw badRequest('invalid_subscription', parsed.message);
        const saved = await store.savePushSubscription(req.auth.user.id, parsed.subscription, {
          platform: req.body?.platform || req.get('sec-ch-ua-platform') || '',
          userAgent: req.get('user-agent') || '',
        });
        const bucket = await store.read(req.auth.user.id);
        logger.info('push_subscribed', { userId: req.auth.user.id });
        res.status(201).json({
          ok: true,
          data: { id: saved?.id || null, devices: store.publicPushDevices(req.auth.user.id, bucket) },
        });
      })
    );

    router.delete(
      '/push/subscribe/:id',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const removed = await store.removePushSubscription(req.auth.user.id, req.params.id);
        if (!removed) throw notFound('الجهاز غير مشترك');
        res.json({ ok: true, data: { removed: true } });
      })
    );

    // إلغاء من العميل عبر endpoint (لا نكشف مفاتيح الجهاز في الواجهة)
    router.post(
      '/push/unsubscribe',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const endpoint = String(req.body?.endpoint || '');
        if (!/^https:\/\//i.test(endpoint)) throw badRequest('invalid_endpoint', 'عنوان الاشتراك غير صالح');
        const id = crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
        const removed = await store.removePushSubscription(req.auth.user.id, id);
        res.json({ ok: true, data: { removed } });
      })
    );

    router.post(
      '/push/test',
      apiLimiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const result = await service.pushTest(req.auth.user.id);
        if (result.reason === 'disabled') throw badRequest('push_disabled', 'الإشعارات السحابية غير مهيأة على الخادم');
        res.json({ ok: true, data: result });
      })
    );

    // ---------- إنشاء إشعار ----------
    router.post(
      '/',
      apiLimiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const body = req.body || {};
        const title = String(body.title ?? '').trim();
        if (!title || title.length > 120) return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: 'العنوان مطلوب (حتى 120 حرفًا)' } });
        const text = String(body.body ?? '').trim();
        if (text.length > 500) return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: 'النص طويل جدًا (500 حرف كحد أقصى)' } });
        const allowedTypes = PUSH_TYPES;
        const type = allowedTypes.has(body.type) ? body.type : 'general';
        let data = null;
        if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
          try {
            const serialized = JSON.stringify(body.data);
            if (serialized.length <= 2000) data = JSON.parse(serialized);
          } catch { }
        }
        const [created] = await service.notify(req.auth.user.id, {
          type,
          title,
          body: text,
          link: typeof body.link === 'string' && body.link.startsWith('/') ? body.link.slice(0, 200) : null,
          priority: body.priority === 'high' ? 'high' : 'normal',
          data,
        });
        res.status(201).json({ ok: true, data: { notification: publicNotification(created) } });
      })
    );

    // ---------- تعليم كمقروء ----------
    router.post(
      '/:id/read',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const read = req.body?.read !== false;
        const bucket = await store.setRead(req.auth.user.id, req.params.id, read);
        if (!bucket) return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'الإشعار غير موجود' } });
        res.json({ ok: true, data: { unread: bucket.unread } });
      })
    );

    router.post(
      '/read-all',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const bucket = await store.setRead(req.auth.user.id, 'all', true);
        res.json({ ok: true, data: { unread: bucket.unread } });
      })
    );

    // ---------- الحذف ----------
    router.delete(
      '/:id',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const bucket = await store.remove(req.auth.user.id, req.params.id);
        if (!bucket) return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'الإشعار غير موجود' } });
        res.json({ ok: true, data: { unread: bucket.unread } });
      })
    );

    router.delete(
      '/',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const bucket = await store.remove(req.auth.user.id, 'all');
        res.json({ ok: true, data: { unread: bucket.unread } });
      })
    );

    // ---------- أجهزة الإشعارات المحلية (توافق قديم) ----------
    router.post(
      '/devices',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const raw = String(req.body?.endpoint ?? '');
        if (!/^https?:\/\/\S{10,500}$/.test(raw)) return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: 'عنوان الجهاز غير صالح' } });
        const hash = (await import('node:crypto')).createHash('sha256').update(raw).digest('hex').slice(0, 24);
        const count = await store.saveDevice(req.auth.user.id, {
          endpoint: raw,
          endpointHash: hash,
          platform: String(req.body?.platform ?? '').slice(0, 40),
          userAgent: String(req.get('user-agent') || '').slice(0, 200),
        });
        res.status(201).json({ ok: true, data: { devices: count, id: hash } });
      })
    );

    router.delete(
      '/devices/:id',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const removed = await store.removeDevice(req.auth.user.id, req.params.id);
        if (!removed) throw notFound('الجهاز غير مسجل');
        res.json({ ok: true, data: { removed: true } });
      })
    );

    router.use((req, res, next) => next(notFound()));

    app.use('/api/notifications', router);
  },
};
