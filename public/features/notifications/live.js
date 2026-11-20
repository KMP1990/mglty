/**
 * البث اللحظي للإشعارات عبر SSE (ميزة فرعية داخل notifications).
 * - إعادة اتصال تلقائي عند الانقطاع مع تأخير متزايد (backoff)
 * - يحدّث المخزن المشترك (شارة الجرس) ويطلق حدثًا لكل صفحة تسمعه
 * - يظهر توست عند وصول إشعار جديد والتطبيق في المقدمة
 */
import { appStore, setUnread, toast, sound } from '../../assets/core/core.js';
import { showSystemNotification } from '../device/device.js';
import { notificationTone } from '../../assets/core/sound.js';

let source = null;
let retry = 0;
let stopRequested = false;
let reconnectTimer = null;
let pollTimer = null;

const RETRY_STEPS = [2000, 5000, 10000, 20000, 40000];

export function startLive() {
  if (stopRequested) stopRequested = false; // إعادة السماح بعد خروج/دخول جديد
  if (source || !appStore.state.authenticated) return source || null;
  // Netlify Functions لا تُبقي SSE مفتوحًا؛ نستخدم تحديثًا دوريًا أخف.
  if (globalThis.__MR_SERVERLESS__) {
    void visitApp();
    startPolling();
    setConnectionState('polling');
    return null;
  }
  if (typeof EventSource === 'undefined') return null;
  // نبض وصول: يخبر الخادم أن التطبيق فُتح (ويُعيد ما فات أثناء الغياب)
  void visitApp();
  // إن كان المستخدم فعّل Push سابقًا على هذا الجهاز، أعِد ربطه بالحساب الحالي
  import('../device/device.js')
    .then((m) => m.reattachPush?.())
    .catch(() => {});

  try {
    source = new EventSource('/api/notifications/stream', { withCredentials: true });
  } catch {
    return null;
  }

  source.addEventListener('ready', () => {
    retry = 0;
    stopPolling();
    setConnectionState('live');
    // مزامنة عدّاد غير المقروء بعد إعادة الاتصال
    refreshUnread();
  });

  source.addEventListener('notification', (e) => {
    try {
      const item = JSON.parse(e.data);
      handleIncoming(item);
    } catch { }
  });

  source.addEventListener('unread', (e) => {
    try {
      setUnread(JSON.parse(e.data).unread);
    } catch { }
  });

  source.onerror = () => {
    setConnectionState('connecting');
    source?.close();
    source = null;
    // خلف Proxy/Netlify قد يُحجب SSE؛ نحدّث العدّاد دوريًا كخطة بديلة
    if (retry >= 2) startPolling();
    const delay = RETRY_STEPS[Math.min(retry, RETRY_STEPS.length - 1)];
    retry += 1;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(startLive, delay);
  };

  return source;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    if (!appStore.state.authenticated) return;
    refreshUnread();
  }, 20_000);
}

function stopPolling() {
  clearInterval(pollTimer);
  pollTimer = null;
}

export function stopLive() {
  stopRequested = true;
  clearTimeout(reconnectTimer);
  stopPolling();
  source?.close();
  source = null;
  setConnectionState('offline');
}

function handleIncoming(item) {
  setUnread(appStore.state.unread + 1);
  document.dispatchEvent(new CustomEvent('mr:notification', { detail: item }));
  // أحداث كتبي التي أظهرت توستًا محليًا لا تحتاج صدى ثانيًا على صفحة المكتبة
  const localBookEcho =
    item.data?.source === 'books' &&
    ['first-book', 'finished'].includes(item.data?.event) &&
    location.pathname.startsWith('/books');
  if (localBookEcho) return;
  sound.playNotification?.(notificationTone(item.type)) || sound.play('notify');
  toast.info(item.title, { duration: 5000, sound: false });
  if (document.visibilityState === 'visible' || item.priority === 'high') {
    showSystemNotification(item.title, item.body || 'لديك إشعار جديد في مجلتي وروتيني', {
      tag: item.id,
      url: item.link || '/notifications',
      silent: item.priority !== 'high',
    });
  }
  if (navigator.vibrate && item.priority === 'high') navigator.vibrate(30);
}

export async function refreshUnread() {
  try {
    const res = await fetch('/api/notifications/', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
    if (!res.ok) return;
    const payload = await res.json();
    setUnread(payload?.data?.summary?.unread ?? 0);
  } catch { }
}

/** يسجّل فتح التطبيق ويعيد ملخص ما فات (بانر ترحيب العودة) */
export async function visitApp() {
  try {
    const csrf = document.cookie.split('; ').find((c) => c.startsWith('mr_csrf='))?.slice(8) || '';
    const res = await fetch('/api/notifications/visit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify({ source: 'boot' }),
    });
    if (!res.ok) return null;
    const payload = await res.json();
    const data = payload?.data;
    if (!data) return null;
    setUnread(data.unread ?? appStore.state.unread);
    if (data.missed > 0) {
      document.dispatchEvent(new CustomEvent('mr:welcome-back', { detail: data }));
    }
    return data;
  } catch {
    return null;
  }
}

function setConnectionState(state) {
  document.querySelectorAll('[data-live-state]').forEach((el) => {
    el.dataset.state = state;
    el.textContent =
      state === 'live' ? 'متصل مباشرة' : state === 'polling' ? 'تحديث دوري' : state === 'connecting' ? 'جارٍ إعادة الاتصال' : 'غير متصل';
  });
  document.dispatchEvent(new CustomEvent('mr:live-state', { detail: { state } }));
}
