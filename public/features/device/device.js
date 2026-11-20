/**
 * إشعارات النظام + Web Push (ميزة فرعية داخل notifications).
 * ------------------------------------------------------------
 * ثلاث طبقات:
 *  1) إشعارات محلية عبر Service Worker (تعمل والتطبيق مفتوح).
 *  2) Web Push حقيقي بمفاتيح VAPID — يصل والتطبيق مغلق لأيام.
 *  3) حالة صادقة للواجهة: مدعوم / ممنوح / مشترك / محجوب.
 */
const LAST_KEY = 'mr:notif-pref';
const PUSH_WANTED_KEY = 'mr:push-enabled';

export function permission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

export function prefEnabled() {
  return localStorage.getItem(LAST_KEY) !== 'off';
}

export function setPref(on) {
  localStorage.setItem(LAST_KEY, on ? 'on' : 'off');
}

/** هل طلب المستخدم صراحةً تفعيل Push على هذا الجهاز؟ */
export function pushWanted() {
  return localStorage.getItem(PUSH_WANTED_KEY) === '1';
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    typeof Notification !== 'undefined'
  );
}

/** آيفون/آيباد: Web Push لا يعمل إلا بعد «إضافة إلى الشاشة الرئيسية» */
export function iosNeedsInstall() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isIos =
    /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
  if (!isIos) return false;
  const standalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
    navigator.standalone === true;
  return !standalone;
}

function keyBytes(value) {
  if (!value) return null;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

function sameBytes(a, b) {
  const left = keyBytes(a);
  const right = keyBytes(b);
  if (!left || !right || left.length !== right.length) return false;
  for (let i = 0; i < left.length; i += 1) if (left[i] !== right[i]) return false;
  return true;
}

function csrfToken() {
  return document.cookie.split('; ').find((c) => c.startsWith('mr_csrf='))?.slice(8) || '';
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
    body: JSON.stringify(body || {}),
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch {}
  if (!res.ok || payload?.ok === false) {
    const message = payload?.error?.message || `تعذّر الاتصال (${res.status})`;
    throw new Error(message);
  }
  return payload?.data;
}

function urlBase64ToUint8Array(value) {
  const clean = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = clean.length % 4 === 0 ? '' : '='.repeat(4 - (clean.length % 4));
  const raw = atob(clean + pad);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

let configPromise = null;
export async function pushConfig() {
  if (!configPromise) {
    configPromise = fetch('/api/notifications/push/key', {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((payload) => payload?.data || { enabled: false })
      .catch(() => ({ enabled: false }))
      .then((data) => {
        // لا نُخزّن فشلًا مؤقتًا؛ ربما كان الخادم ما يزال يجهّز المفاتيح
        if (!data?.enabled) configPromise = null;
        return data;
      });
  }
  return configPromise;
}

async function ensureRegistration() {
  let reg = await navigator.serviceWorker.getRegistration('/').catch(() => null);
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  if (!reg.active) {
    // لا نشترك قبل أن يصبح الـSW نشطًا: PushManager يفشل بـInvalidStateError
    await Promise.race([
      navigator.serviceWorker.ready.catch(() => null),
      new Promise((resolve) => setTimeout(resolve, 9000)),
    ]);
    reg = (await navigator.serviceWorker.getRegistration('/').catch(() => null)) || reg;
  }
  if (!reg?.active) throw new Error('sw-not-active');
  return reg;
}

async function ensurePermission() {
  if (typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  if (document.visibilityState !== 'visible') return Notification.permission;
  return Notification.requestPermission();
}

/**
 * يشترك الجهاز في Web Push. يجب استدعاؤه من نقرة مستخدم
 * (المتصفحات تشترط إيماءة لطلب الإذن).
 */
export async function subscribePush({ skipPermission = false } = {}) {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return { ok: false, reason: 'insecure' };
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const perm = skipPermission ? permission() : await ensurePermission();
  if (perm !== 'granted') return { ok: false, reason: perm === 'denied' ? 'denied' : 'not-granted' };

  const config = await pushConfig();
  if (!config?.enabled || !config.publicKey) return { ok: false, reason: 'disabled' };

  try {
    const reg = await ensureRegistration();
    const serverKey = urlBase64ToUint8Array(config.publicKey);
    let subscription = await reg.pushManager.getSubscription();
    // إن تغيّر مفتاح VAPID على الخادم (بيانات جديدة/مفتاح جديد) فالاشتراك القديم
    // لن يصل: نلغيه ونشترك من جديد بدل إرسال صامت يفشل بـ 403.
    if (subscription && subscription.options?.applicationServerKey && !sameBytes(subscription.options.applicationServerKey, serverKey)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: serverKey,
      });
    }
    const data = await postJson('/api/notifications/push/subscribe', {
      subscription: subscription.toJSON(),
      platform: navigator.platform || '',
    });
    setPref(true);
    localStorage.setItem(PUSH_WANTED_KEY, '1');
    document.dispatchEvent(new CustomEvent('mr:push-state', { detail: { subscribed: true, devices: data?.devices || [] } }));
    return { ok: true, subscription, devices: data?.devices || [] };
  } catch (err) {
    const message = String(err?.message || '');
    let reason = 'subscribe-failed';
    if (/sw-not-active/i.test(message)) reason = 'sw-not-active';
    else if (/permission|denied|not allowed|NotAllowedError/i.test(message)) reason = 'denied';
    else if (/push service|not available|registration failed|AbortError/i.test(message)) reason = 'push-unavailable';
    else if (/applicationServerKey|InvalidAccess|InvalidState/i.test(message)) reason = 'key-invalid';
    else if (/csrf|رمز الحماية|الجلسة/i.test(message)) reason = 'session';
    return { ok: false, reason, message: message || undefined, diagnostics: await pushDiagnostics().catch(() => null) };
  }
}

/** إلغاء اشتراك هذا الجهاز فقط (لا يمس الأجهزة الأخرى) */
export async function unsubscribePush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager?.getSubscription();
    if (subscription) {
      await postJson('/api/notifications/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
      await subscription.unsubscribe();
    }
    localStorage.setItem(PUSH_WANTED_KEY, '0');
    document.dispatchEvent(new CustomEvent('mr:push-state', { detail: { subscribed: false } }));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'unsubscribe-failed' };
  }
}

export async function pushStatus() {
  const supported = pushSupported();
  const perm = permission();
  let subscribed = false;
  if (supported) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      subscribed = Boolean(await reg?.pushManager?.getSubscription());
    } catch {}
  }
  return { supported, permission: perm, subscribed, pref: prefEnabled(), iosNeedsInstall: iosNeedsInstall() };
}

/** فصل الجهاز عن الحساب الحالي دون إلغاء اشتراك المتصفح (يُستخدم عند الخروج) */
export async function detachPush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager?.getSubscription();
    if (subscription) await postJson('/api/notifications/push/unsubscribe', { endpoint: subscription.endpoint }).catch(() => {});
  } catch {
    /* الخروج لا يفشل بسبب الإشعارات */
  }
}

/** إعادة ربط اشتراك قائم بعد تسجيل الدخول — لا تُنشئ اشتراكًا جديدًا */
export async function reattachPush() {
  if (!pushSupported() || !pushWanted() || permission() !== 'granted') return { ok: false, reason: 'not-wanted' };
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const subscription = await reg?.pushManager?.getSubscription();
    if (!subscription) return { ok: false, reason: 'no-subscription' };
    await postJson('/api/notifications/push/subscribe', {
      subscription: subscription.toJSON(),
      platform: navigator.platform || '',
    });
    document.dispatchEvent(new CustomEvent('mr:push-state', { detail: { subscribed: true } }));
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err?.message || 'reattach-failed' };
  }
}

/** طلب إذن الإشعارات ثم الاشتراك السحابي تلقائيًا */
export async function requestPermission() {
  const result = await ensurePermission();
  if (result === 'granted') {
    await subscribePush({ skipPermission: true }).catch(() => {});
  }
  return result;
}

/** توافق قديم: كان يسجّل «جهازًا» وهميًا؛ الآن يشترك فعليًا إن أمكن */
export async function registerDevice() {
  return subscribePush({ skipPermission: true });
}

export async function showSystemNotification(title, body, { tag, url = '/notifications', silent = false } = {}) {
  if (permission() !== 'granted' || !prefEnabled() || document.visibilityState === 'visible') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    const options = {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag,
      renotify: Boolean(tag),
      silent,
      dir: 'rtl',
      lang: 'ar',
      data: { url },
      vibrate: silent ? undefined : [30, 40, 30],
    };
    if (reg?.showNotification) await reg.showNotification(title, options);
    else new Notification(title, options);
    return true;
  } catch (err) {
    console.warn('[device] notify failed', err);
    return false;
  }
}

/** تحقق من دعم كل ما تحتاجه الميزة لتُعرض حالة صادقة للمستخدم */
/** تقرير تشخيصي كامل يُعرض للمستخدم لمعرفة سبب فشل التفعيل */
export async function pushDiagnostics() {
  const info = {
    secureContext: typeof window !== 'undefined' ? window.isSecureContext === true : false,
    origin: typeof location !== 'undefined' ? location.origin : '',
    supported: pushSupported(),
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    notification: typeof Notification !== 'undefined',
    permission: permission(),
    iosNeedsInstall: iosNeedsInstall(),
    registration: false,
    active: false,
    scope: null,
    subscribed: false,
    endpointHost: null,
    keyConfigured: false,
    error: null,
  };
  try {
    const config = await pushConfig();
    info.keyConfigured = Boolean(config?.enabled && config?.publicKey);
  } catch (err) {
    info.error = err?.message || 'config';
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    info.registration = Boolean(reg);
    info.active = Boolean(reg?.active);
    info.scope = reg?.scope || null;
    const sub = await reg?.pushManager?.getSubscription();
    info.subscribed = Boolean(sub);
    info.endpointHost = sub ? new URL(sub.endpoint).host : null;
  } catch (err) {
    info.error = info.error || err?.message || 'registration';
  }
  return info;
}

/** إعادة ضبط كاملة: إلغاء الاشتراك ثم إعادة إنشائه — تُصلح معظم حالات 403/تغيّر المفتاح */
export async function resetPush() {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const existing = await reg?.pushManager?.getSubscription();
    if (existing) await existing.unsubscribe().catch(() => {});
  } catch {
    /* نكمل */
  }
  const result = await subscribePush();
  return { ...result, diagnostics: await pushDiagnostics().catch(() => null) };
}

export function capabilities() {
  return {
    secureContext: typeof window !== 'undefined' ? window.isSecureContext === true : false,
    api: typeof Notification !== 'undefined',
    serviceWorker: 'serviceWorker' in navigator,
    push: pushSupported(),
    permission: permission(),
    pref: prefEnabled(),
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
  };
}
