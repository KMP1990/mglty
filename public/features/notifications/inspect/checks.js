/**
 * جمع حالة الإشعارات من المتصفح بدقة — تُرسل للخادم مع طلب الفحص.
 * لا تُرسل أي مفاتيح اشتراك أو endpoint كامل، فقط حقائق الحالة.
 */
export async function collectClientState() {
  const state = {
    permission: typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
    secure: typeof window !== 'undefined' ? window.isSecureContext === true : false,
    serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
    subscribed: false,
    standalone: false,
    online: typeof navigator !== 'undefined' ? navigator.onLine !== false : true,
    visibility: typeof document !== 'undefined' ? document.visibilityState : 'unknown',
    timezone: null,
    platform: typeof navigator !== 'undefined' ? navigator.platform || '' : '',
    registrationScope: null,
    endpointHost: null,
    error: null,
  };
  try {
    state.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    state.timezone = null;
  }
  try {
    state.standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  } catch {
    state.standalone = false;
  }
  try {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    state.registrationScope = reg?.scope || null;
    const sub = await reg?.pushManager?.getSubscription();
    state.subscribed = Boolean(sub);
    state.endpointHost = sub ? new URL(sub.endpoint).host : null;
  } catch (err) {
    state.error = err?.message || 'registration';
  }
  return state;
}

export function clientQuery(state = {}) {
  const params = new URLSearchParams();
  params.set('permission', String(state.permission || 'unknown'));
  params.set('secure', state.secure ? '1' : '0');
  params.set('serviceWorker', state.serviceWorker ? '1' : '0');
  params.set('subscribed', state.subscribed ? '1' : '0');
  params.set('standalone', state.standalone ? '1' : '0');
  params.set('online', state.online ? '1' : '0');
  params.set('visibility', String(state.visibility || 'unknown'));
  if (state.timezone) params.set('timezone', state.timezone);
  if (state.platform) params.set('platform', state.platform);
  return params;
}
