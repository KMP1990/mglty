/**
 * Service Worker — أساس "الموقع كتطبيق":
 *  • تثبيت التطبيق (PWA): يعمل standalone بدون شريط المتصفح
 *  • عمل دون اتصال: قشرة التطبيق + الأصول + صفحة أوفلاين
 *  • استلام نقر الإشعارات وفتح المسار الصحيح
 * الاستراتيجيات:
 *  - التنقل (HTML): شبكة أولًا ثم الكاش (محتوى محدّث دائمًا مع بديل بلا شبكة)
 *  - الأصول الثابتة: stale-while-revalidate (سرعة + تحديث خلفي)
 *  - الـ API: شبكة فقط — لا نكاش لأي بيانات مستخدم أبدًا
 */
const VERSION = 'mwoydmdh-0.1.0';
const SHELL_CACHE = `mr-shell-${VERSION}`;
const ASSET_CACHE = `mr-assets-${VERSION}`;
const ORIGIN = self.location.origin;
const abs = (p) => new URL(p, ORIGIN).href;

const SHELL = [
  '/',
  '/offline.html',
  '/styles/fonts.css',
  '/styles/tokens.css',
  '/styles/base.css',
  '/assets/core/core.js',
  '/assets/core/boot.js',
  '/assets/core/const.js',
  '/assets/core/styles.js',
  '/assets/core/sound.js',
  '/assets/core/scene.js',
  '/features/assistant/assistant.js',
  '/features/assistant/assistant.css',
  '/features/assistant/text.js',
  '/features/books/ocr.js',
  '/features/books/ocr-text.js',
  '/assets/fonts/tajawal-regular.ttf',
  '/assets/fonts/noto-sans-arabic-arabic.woff2',
  '/assets/fonts/noto-sans-arabic-latin.woff2',
  '/assets/fonts/cairo-arabic.woff2',
  '/assets/fonts/cairo-latin.woff2',
  '/assets/fonts/noto-naskh-arabic.woff2',
  '/assets/fonts/noto-naskh-latin.woff2',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const results = await Promise.all(
        SHELL.map(async (p) => {
          const url = abs(p);
          try {
            const res = await fetch(url, { cache: 'reload', credentials: 'same-origin' });
            if (res.ok) {
              // نُسجّل كل المتحقق منه بمفتاح مطلق ومفتاح نسبي معًا
              await cache.put(url, res.clone());
              return true;
            }
            return `bad:${res.status}`;
          } catch (e) {
            return `err:${p}`;
          }
        })
      );
      // نحفظ بصمة المحتوى لندرك لاحقًا أن الكاش حُشي فعلًا
      await cache.put(
        abs('/__shell_manifest__'),
        new Response(JSON.stringify({ version: VERSION, cachedAt: Date.now(), results }), {
          headers: { 'Content-Type': 'application/json' },
        })
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // نحذف فقط مخازن هذا التطبيق القديمة — لا نمس مخازن أي شيء آخر على النطاق
      const stale = keys.filter((k) => (k.startsWith('mr-shell-') || k.startsWith('mr-assets-')) && k !== SHELL_CACHE && k !== ASSET_CACHE);
      await Promise.all(stale.map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

// اسمح للصفحة بإجبار التحديث
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_ASSETS') caches.delete(ASSET_CACHE);
  if (event.data?.type === 'UNREAD') void setBadge(Number(event.data.count) || 0);
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // لا كاش API أو البث
  if (url.pathname.startsWith('/api/')) return;
  // لا كاش لمحتوى المستخدم المولَّد
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // ملفات التطبيق (JS/CSS/وحدات الميزات) تعمل دائمًا من الشبكة أولًا.
  // السبب: أسماء الملفات ثابتة، فلو خدمنا الكاش أولًا لن يصل تحديث الكود أبدًا
  // حتى بعد إعادة التحميل. الشبكة أولًا تحافظ على “لا شيء قديم بعد تحديث”.
  if (/\.(?:js|mjs|css)$/.test(url.pathname)) {
    event.respondWith(networkFirstAsset(request));
    return;
  }

  // الصور والأيقونات والـ manifest نادرة التغيير → كاش أولًا مع تحديث خلفي
  if (/\.(?:svg|png|webp|woff2?|ttf|otf|bcmap|pfb|wasm|webmanifest)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

async function networkFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const url = abs(new URL(request.url).pathname);
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) cache.put(url, fresh.clone()).catch(() => {});
    return fresh;
  } catch {
    // نبحث عن الملف مطلقًا في كل المخازن (القشرة أو الأصول)
    const cached = (await cache.match(url)) || (await caches.match(url)) || (await caches.match(request));
    return cached || new Response('/* offline */', { status: 504, headers: { 'Content-Type': 'text/plain' } });
  }
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    if (fresh && fresh.ok) {
      const cache = await caches.open(SHELL_CACHE);
      // نخزن بمفتاح المطلوب وبمفتاح مساره فقط، حتى تعمل إعادات التحميل بأي مسار
      cache.put(request, fresh.clone()).catch(() => {});
      cache.put(abs(new URL(request.url).pathname), fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = (await caches.match(request)) || (await caches.match(abs(new URL(request.url).pathname)));
    if (cached) return cached;
    const shell = (await caches.match(abs('/'))) || (await caches.match('/'));
    if (shell) return shell;
    return (await caches.match(abs('/offline.html'))) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSET_CACHE);
  const url = abs(new URL(request.url).pathname);
  const cached = (await cache.match(url)) || (await caches.match(url));
  const network = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        cache.put(url, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => null);
  return cached || (await network) || new Response('', { status: 504 });
}

async function setBadge(count) {
  try {
    if (typeof self.registration.setAppBadge !== 'function') return;
    if (count > 0) await self.registration.setAppBadge(count);
    else await self.registration.clearAppBadge();
  } catch {}
}

// نقر الإشعار: افتح/ركّز النافذة على المسار المطلوب، وسجّل الإشعار كمقروء
function safeNotificationTarget(value) {
  try {
    const url = new URL(String(value || '/notifications'), ORIGIN);
    if (url.origin !== ORIGIN) return '/notifications';
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/notifications';
  }
}

function notificationActions(payload) {
  const routineId = payload?.data?.routineId;
  return [
    { action: 'open', title: payload?.type === 'reminder' && routineId ? 'افتح الروتين' : 'فتح' },
    { action: 'dismiss', title: 'لاحقًا' },
  ];
}

async function csrfToken() {
  try {
    if (typeof cookieStore !== 'undefined') {
      const cookie = await cookieStore.get('mr_csrf');
      if (cookie?.value) return cookie.value;
    }
  } catch {}
  try {
    const session = await fetch('/api/auth/session', { credentials: 'same-origin' });
    if (session.ok) return (await session.json())?.data?.csrfToken || '';
  } catch {}
  return '';
}

async function markNotificationRead(id) {
  if (!id || String(id).startsWith('test-')) return;
  try {
    const csrf = await csrfToken();
    const res = await fetch(`/api/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ read: true }),
    });
    // لا نصفّر شارة كل الإشعارات عند فتح واحد فقط؛ نأخذ العدد الحقيقي من الخادم.
    if (res.ok) {
      const payload = await res.json().catch(() => null);
      if (typeof payload?.data?.unread === 'number') await setBadge(payload.data.unread);
    }
  } catch {}
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  void setBadge(0);
  if (event.action === 'dismiss') return;
  const target = safeNotificationTarget(event.notification.data?.url);
  const notificationId = event.notification.data?.id || null;
  event.waitUntil(
    (async () => {
      // لا نُعطّل فتح التطبيق بانتظار الشبكة: تعليم القراءة خلفي، والفتح فوري.
      void markNotificationRead(notificationId);
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          client.postMessage({ type: 'NAVIGATE', url: target, notificationId });
          return;
        }
      }
      await self.clients.openWindow(target);
    })()
  );
});

self.addEventListener('push', (event) => {
  let payload = { title: 'مجلتي وروتيني', body: 'لديك تحديث جديد', url: '/notifications' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch { }
  const high = payload.priority === 'high';
  const VIBRATE = {
    security: [60, 90, 60, 90, 60],
    reminder: [40, 60, 40],
    achievement: [25, 45, 25, 45, 25],
    digest: [30, 50, 30],
    insight: [35, 55, 35],
  };
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(String(payload.title || 'مجلتي وروتيني'), {
        body: String(payload.body || ''),
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        dir: 'rtl',
        lang: 'ar',
        tag: payload.tag || payload.id || 'mr-notification',
        renotify: Boolean(payload.tag || payload.id),
        silent: payload.silent === true,
        requireInteraction: high,
        vibrate: payload.vibrate || VIBRATE[payload.type] || (high ? [40, 60, 40] : [25, 45, 25]),
        timestamp: payload.createdAt ? Date.parse(payload.createdAt) : Date.now(),
        actions: notificationActions(payload),
        data: {
          url: safeNotificationTarget(payload.url),
          id: payload.id || null,
          type: payload.type || 'general',
          priority: payload.priority || 'normal',
          data: payload.data || null,
        },
      });
      if (payload.badge !== undefined) await setBadge(Number(payload.badge) || 0);
    })()
  );
});

// عند تجديد المتصفح للاشتراك تلقائيًا: اشترك من جديد وأرسل للمفتاح الحالي
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/api/notifications/push/key', { credentials: 'same-origin' });
        if (!res.ok) return;
        const key = (await res.json())?.data?.publicKey;
        if (!key) return;
        const clean = String(key).replace(/-/g, '+').replace(/_/g, '/');
        const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
        const raw = atob(padded);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: bytes,
        });
        // بعض المتصفحات لا تدعم cookieStore داخل SW؛ نقرأ رمز الحماية من الجلسة
        let csrf = '';
        try {
          const session = await fetch('/api/auth/session', { credentials: 'same-origin' });
          if (session.ok) csrf = (await session.json())?.data?.csrfToken || '';
        } catch {}
        if (!csrf && typeof cookieStore !== 'undefined') {
          csrf = (await cookieStore.get('mr_csrf'))?.value || '';
        }
        await fetch('/api/notifications/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
          body: JSON.stringify({ subscription: subscription.toJSON(), platform: 'renewed' }),
        });
      } catch {}
    })()
  );
});
