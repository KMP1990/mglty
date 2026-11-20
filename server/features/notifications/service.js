/**
 * خدمات الإشعارات: إنشاء إشعار + بثه لحظيًا (SSE) للمتصفحات المفتوحة.
 * الإشعارات تُحفظ أولًا (مصدر الحقيقة) ثم تُبثّ — لا يُفقد شيء لو كان العميل مغلقًا.
 */
import { publicNotification } from './store.js';

const TEMPLATES = {
  welcome: (name) => ({
    type: 'welcome',
    title: `أهلًا ${name} ✨`,
    body: 'حسابك جاهز. ابدأ بإضافة أول روتين ليومك من الشاشة الرئيسية، وكل شيء سيكون محفوظًا بأمان.',
    link: '/routines',
    icon: 'sparkles',
    priority: 'high',
  }),
  security: (body) => ({ type: 'security', title: 'تنبيه أمان', body, icon: 'shield', priority: 'high' }),
  system: (body, link = null) => ({ type: 'system', title: 'إشعار من مجلتي وروتيني', body, link, icon: 'bell' }),
  reminder: (body) => ({ type: 'reminder', title: 'تذكير', body, icon: 'calendar' }),
};

export function createNotificationService({ logger, store, push = null, users = null }) {
  /** userId -> Set<res> */
  const clients = new Map();

  /**
   * تفضيلات الإشعارات تتحكم في دفع الجهاز فقط، لا في صندوق الإشعارات.
   * هكذا لا يضيع أي حدث داخل التطبيق، ولا يُزعج المستخدم خارج التطبيق بما أوقفه.
   */
  function pushAllowed(user, item) {
    const type = item?.type || 'general';
    if (type === 'security' || type === 'welcome') return true; // تنبيهات أمنية/ترحيب لا تُكتم أبدًا
    const prefs = user?.preferences?.notifications || {};
    if (type === 'reminder' && prefs.routineReminders === false) return false;
    if (type === 'achievement' && prefs.achievements === false) return false;
    if (['system', 'general'].includes(type) && prefs.systemEvents === false) return false;
    if (['digest', 'insight'].includes(type) && prefs.digest === false) return false;
    return true;
  }

  async function pushableItems(userId, items) {
    if (!users?.findById) return items;
    const user = await users.findById(userId).catch(() => null);
    if (!user) return [];
    return items.filter((item) => pushAllowed(user, item));
  }

  function send(userId, notification) {
    const set = clients.get(userId);
    if (!set || set.size === 0) return 0;
    const frame = `event: notification\ndata: ${JSON.stringify(publicNotification(notification))}\n\n`;
    let sent = 0;
    for (const res of set) {
      try {
        res.write(frame);
        sent += 1;
      } catch {
        set.delete(res);
      }
    }
    return sent;
  }

  function broadcastCount(userId, unread) {
    const set = clients.get(userId);
    if (!set) return;
    const frame = `event: unread\ndata: ${JSON.stringify({ unread })}\n\n`;
    for (const res of set) {
      try {
        res.write(frame);
      } catch {
        set.delete(res);
      }
    }
  }

  return {
    templates: TEMPLATES,

    /** إنشاء إشعارات (مصفوفة) ثم بثها لحظيًا ودفعها للأجهزة المشتركة */
    async notify(userId, payloads) {
      const list = Array.isArray(payloads) ? payloads : [payloads];
      const created = await store.addMany(userId, list);
      const unread = (await store.read(userId)).unread;
      for (const n of created) send(userId, n);
      broadcastCount(userId, unread);
      logger.info('notification_created', { userId, count: created.length, types: created.map((n) => n.type) });
      // Web Push غير معطّل لمسار الاستجابة: الإشعار محفوظ بالفعل، والإرسال للشبكة لا يجب أن يؤخر الطلب
      if (push?.enabled) {
        pushableItems(userId, created)
          .then((pushItems) => {
            if (!pushItems.length) {
              logger.debug('push_skipped_by_prefs', { userId, types: created.map((n) => n.type) });
              return null;
            }
            return push.deliver(userId, pushItems, store);
          })
          .then((result) => {
            if (result?.sent) logger.debug('push_delivered', { userId, ...result });
          })
          .catch((err) => logger.warn('push_deliver_failed', { userId, message: err?.message }));
      }
      return created;
    },

    async notifyTemplate(userId, templateName, ...args) {
      const tpl = TEMPLATES[templateName];
      if (!tpl) throw new Error(`unknown template: ${templateName}`);
      return this.notify(userId, tpl(...args));
    },

    async onUserSignedUp(user) {
      return this.notifyTemplate(user.id, 'welcome', user.name.split(' ')[0]);
    },

    /** تسجيل عميل SSE */
    subscribe(userId, res) {
      res.write(`retry: 3000\n\n`);
      res.write(`event: ready\ndata: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
      if (!clients.has(userId)) clients.set(userId, new Set());
      clients.get(userId).add(res);
      const heartbeat = setInterval(() => {
        try {
          res.write(`: ping ${Date.now()}\n\n`);
        } catch {
          clearInterval(heartbeat);
        }
      }, 25_000);
      heartbeat.unref?.();
      return () => {
        clearInterval(heartbeat);
        const set = clients.get(userId);
        if (set) {
          set.delete(res);
          if (set.size === 0) clients.delete(userId);
        }
      };
    },

    connectedCount(userId) {
      return clients.get(userId)?.size || 0;
    },

    /** إرسال دفعة اختبار إلى الأجهزة المشتركة فقط (بلا تخزين إشعار) */
    async pushTest(userId) {
      if (!push?.enabled) return { sent: 0, failed: 0, removed: 0, reason: 'disabled' };
      await push.ready();
      const item = {
        id: `test-${Date.now()}`,
        type: 'system',
        title: 'إشعار تجريبي من مجلتي وروتيني 🔔',
        body: 'لو وصلتك هذه الرسالة والتطبيق مغلق، فالإشعارات السحابية تعمل بنجاح.',
        link: '/notifications',
        priority: 'high',
        createdAt: new Date().toISOString(),
      };
      const result = await push.deliver(userId, [item], store);
      return { ...result, reason: result.sent ? 'sent' : 'not_delivered' };
    },
  };
}
