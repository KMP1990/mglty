/**
 * مجلتي وروتيني — نواة العميل
 * ------------------------------------------------------------
 * هذا الملف هو "نواة التطبيق" маленькая: حالة + مزامنة + توجيه + ثيم.
 * كل ميزة تُحمَّل ديناميكيًا عند فتح صفحتها (public/features/<name>/<name>.js)
 * ولا تُنزّل أي ميزة لا تحتاجها الصفحة — أول تحميل سريع، وعمل أفضل دون شبكة.
 */
import { __APP_VERSION__ } from './const.js';
import { sound } from './sound.js';
import { initScene } from './scene.js';

export { __APP_VERSION__, sound };

export const appStore = (() => {
  let state = {
    user: null,
    csrfToken: null,
    authenticated: false,
    sessionChecked: false,
    online: navigator.onLine,
    unread: 0,
  };
  const listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn(state));
  return {
    get state() {
      return state;
    },
    set(patch) {
      state = { ...state, ...patch };
      emit();
      return state;
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
})();

/* ---------- أدوات DOM ---------- */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const escapeHtml = (str = '') =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function setButtonLoading(btn, loading, label) {
  if (!btn) return;
  if (loading) {
    btn.dataset.prevHtml = btn.innerHTML;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.innerHTML = `<span class="spinner" aria-hidden="true"></span><span>${escapeHtml(label || 'جارٍ...')}</span>`;
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    if (btn.dataset.prevHtml) btn.innerHTML = btn.dataset.prevHtml;
    delete btn.dataset.prevHtml;
  }
}

/* ---------- التنبيهات العائمة ---------- */
export const toast = (() => {
  let stack;
  let timer = null;
  let current = null;
  function ensure() {
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      stack.setAttribute('aria-live', 'polite');
      document.body.appendChild(stack);
    }
    return stack;
  }
  /**
   * تنبيه واحد في كل وقت: التنبيه الجديد يستبدل السابق.
   * سبب التصميم: تراكم ثلاثة توستات كان يغطي قائمة الروتينات على الجوال.
   */
  function show(message, { variant = 'info', duration = 3800, sound: soundCue } = {}) {
    ensure();
    clearTimeout(timer);
    if (current) {
      const old = current;
      old.classList.add('leaving');
      setTimeout(() => old.remove(), 200);
    }
    const el = document.createElement('div');
    el.className = 'toast';
    el.dataset.variant = variant;
    el.innerHTML = `<span aria-hidden="true">${variantIcon(variant)}</span><span>${escapeHtml(String(message).replace(/\n/g, ' '))}</span>`;
    stack.appendChild(el);
    current = el;
    const close = () => {
      if (!el.isConnected) return;
      clearTimeout(timer);
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 200);
      if (current === el) current = null;
    };
    el.addEventListener('click', close);
    if (duration) timer = setTimeout(close, duration);
    const cue = soundCue === false
      ? null
      : soundCue || ({ success: 'success', error: 'error', warning: 'warning', info: 'tap' }[variant] || null);
    if (cue) sound.play(cue);
    return close;
  }
  const variantIcon = (v) =>
    ({ success: '✓', error: '✕', warning: '!', info: '•' }[v] || '•');
  return {
    show,
    success: (m, o) => show(m, { variant: 'success', ...o }),
    error: (m, o) => show(m, { variant: 'error', ...o }),
    info: (m, o) => show(m, { variant: 'info', ...o }),
    warning: (m, o) => show(m, { variant: 'warning', ...o }),
  };
})();

/* ---------- الثيم ---------- */
const THEME_KEY = 'mr:theme';
export const theme = {
  get stored() {
    return localStorage.getItem(THEME_KEY) || 'system';
  },
  apply(value = this.stored) {
    const resolved =
      value === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : value;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.dataset.themeMode = value;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolved === 'dark' ? '#15101a' : '#fdfbfb';
    syncThemeButtons();
  },
  set(value) {
    localStorage.setItem(THEME_KEY, value);
    this.apply(value);
    window.dispatchEvent(new CustomEvent('mr:theme-changed', { detail: { value } }));
  },
  toggle() {
    const current = document.documentElement.dataset.theme;
    this.set(current === 'dark' ? 'light' : 'dark');
  },
  syncToUser(pref) {
    if (!pref) return;
    if (this.stored !== pref) localStorage.setItem(THEME_KEY, pref);
    this.apply(pref);
  },
};
function syncThemeButtons() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  $$('[data-theme-toggle]').forEach((b) => {
    b.setAttribute('aria-label', isDark ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الداكن');
    b.setAttribute('title', b.getAttribute('aria-label'));
    const sun = b.querySelector('[data-icon="sun"]');
    const moon = b.querySelector('[data-icon="moon"]');
    if (sun) sun.style.display = isDark ? 'none' : 'block';
    if (moon) moon.style.display = isDark ? 'block' : 'none';
  });
}
theme.apply();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (theme.stored === 'system') theme.apply('system');
});

/* ---------- حالة السكون/الاتصال ---------- */
window.addEventListener('online', () => {
  appStore.set({ online: true });
  toast.success('عاد الاتصال بالإنترنت');
});
window.addEventListener('offline', () => {
  appStore.set({ online: false });
  toast.warning('أنت دون اتصال — بياناتك المحفوظة تبقى متاحة');
});

/* ---------- توجيه خفيف (client-side) ---------- */
const TITLES = {
  home: 'مجلتك وروتينك في مكان واحد',
  routines: 'روتيناتي',
  coach: 'المدرب الذكي',
  login: 'تسجيل الدخول',
  signup: 'إنشاء حساب',
  notifications: 'الإشعارات',
  account: 'حسابي',
  vault: 'الخزنة',
  books: 'كتبي',
};

export const router = {
  /** خريطة الصفحات → مسار وحدة الميزة */
  modules: {
    home: '/features/home/home.js',
    login: '/features/auth/login.js',
    signup: '/features/auth/signup.js',
    notifications: '/features/notifications/notifications.js',
    account: '/features/account/account.js',
    vault: '/features/vault/vault.js',
    routines: '/features/routines/routines.js',
    coach: '/features/routines/coach.js',
    books: '/features/books/books.js',
  },
  parse() {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const map = {
      '/': 'home',
      '': 'home',
      '/login': 'login',
      '/signup': 'signup',
      '/notifications': 'notifications',
      '/account': 'account',
      '/vault': 'vault',
      '/routines': 'routines',
      '/coach': 'coach',
      '/books': 'books',
    };
    return { route: map[path] || 'notfound', path };
  },

  /** يفتح مسارًا داخل التطبيق دون إعادة تحميل */
  async go(url, { replace = false } = {}) {
    if (!url.startsWith('/') || url.startsWith('//')) return location.assign(url);
    // ملاحظة مهمة: تعبير مثل `replace ? history.replaceState(...) : ...` يُفسَّر كتسمية (label)
    // ولا يُنفَّذ عند بدئه بمعرّف — لذلك نستخدم if صريحة.
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
    await this.mountCurrent({ scroll: true });
  },
  async mountCurrent({ scroll = false } = {}) {
    const gen = ++mountGeneration;
    const { route } = this.parse();
    document.body.dataset.route = route;
    document.body.classList.remove('is-reading');
    if (TITLES[route]) document.title = `${TITLES[route]} — مجلتي وروتيني`;
    const slot = document.getElementById('app-view');
    if (!slot) return;
    const modPath = this.modules[route];
    if (!modPath) {
      slot.innerHTML = notFoundHtml();
      return;
    }
    slot.setAttribute('aria-busy', 'true');
    try {
      const mod = await import(`${modPath}?v=${__APP_VERSION__}`);
      // انتقال آخر حدث أثناء انتظار التحميل؟ لا نرسم شيئًا.
      if (gen !== mountGeneration) return;
      slot.innerHTML = '';
      const section = document.createElement('section');
      section.className = 'view';
      slot.appendChild(section);
      await mod.mount(section);
      if (gen !== mountGeneration) return;
      if (scroll) window.scrollTo({ top: 0 });
    } catch (err) {
      if (gen !== mountGeneration) return;
      console.error('[router]', err);
      slot.innerHTML = `<div class="container stack" style="padding-block:64px"><h2>تعذّر تحميل الصفحة</h2><p>${escapeHtml(err?.message || 'خطأ غير متوقع')}</p><pre style="text-align:left;direction:ltr;font-size:.7rem;overflow:auto;max-height:200px;background:var(--bg-soft);padding:12px;border-radius:12px">${escapeHtml(String(err?.stack || '').slice(0, 600))}</pre><a class="btn" href="${escapeHtml(location.pathname)}" data-nav="off">إعادة المحاولة</a></div>`;
    } finally {
      if (gen === mountGeneration) slot.removeAttribute('aria-busy');
    }
    document.dispatchEvent(new CustomEvent('mr:route-changed', { detail: { route } }));
  },
};

/** يمنع سباق التنقل: آخر انتقال فقط هو من يُرسم */
let mountGeneration = 0;

function notFoundHtml() {
  return `<div class="container stack" style="padding-block:72px;text-align:center;place-items:center">
    <span style="font-size:56px">🧭</span><h1>الصفحة غير موجودة</h1>
    <p>ربما تغيّر الرابط. لنعد إلى البداية.</p>
    <a class="btn btn-primary" href="/" data-link>الرئيسية</a></div>`;
}

export function bindLinkInterception() {
  const known = ['/', '/login', '/signup', '/notifications', '/account', '/vault', '/routines', '/coach', '/books'];
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.target && a.target !== '_self') return;
    if (a.hasAttribute('download') || a.dataset.nav === 'off') return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (!known.includes(path)) return; // صفحات غير معروفة → انتقال عادي للمتصفح
    e.preventDefault();
    // نحافظ على ?query و#hash (مثل /routines?focus=<id> من الإشعارات)
    router.go(path + url.search + url.hash);
  });
  window.addEventListener('popstate', () => router.mountCurrent());

  // رسائل من Service Worker (نقر الإشعار أو روابط التطبيق) تنتقل داخليًا
  navigator.serviceWorker?.addEventListener?.('message', (event) => {
    const data = event.data;
    if (data?.type === 'NAVIGATE' && typeof data.url === 'string' && data.url.startsWith('/')) {
      router.go(data.url, { replace: true });
    }
  });
}

/* ---------- مصادقة العميل ---------- */
const csrfFromCookie = () =>
  document.cookie
    .split('; ')
    .find((c) => c.startsWith('mr_csrf='))
    ?.slice('mr_csrf='.length) || null;

export const auth = {
  get csrf() {
    return appStore.state.csrfToken || csrfFromCookie();
  },
  async refresh() {
    const data = await sessionRequest();
    if (data?.authenticated) {
      appStore.set({
        user: data.user,
        csrfToken: data.csrfToken,
        authenticated: true,
        sessionChecked: true,
      });
      theme.syncToUser(data.user?.preferences?.theme);
      sound.setUser(data.user.id, data.user?.preferences?.sound);
    } else {
      appStore.set({ user: null, csrfToken: null, authenticated: false, sessionChecked: true });
      sound.setUser(null, null);
    }
    return appStore.state;
  },
  async logout() {
    // فصل إشعارات Push عن هذا الحساب قبل إنهاء الجلسة (يبقى اشتراك المتصفح)
    try {
      const { detachPush } = await import('../features/device/device.js');
      await detachPush?.();
    } catch {}
    const res = await api.post('/api/auth/logout', {});
    appStore.set({ user: null, csrfToken: null, authenticated: false, unread: 0, sessionChecked: true });
    sound.setUser(null, null);
    return res;
  },
  /** يوجه لصفحة الدخول إن لم يكن مسجلًا. يرجع true إذا كان جاهزًا */
  async require({ redirectTo } = {}) {
    if (!appStore.state.sessionChecked) await this.refresh();
    if (appStore.state.authenticated) return true;
    // الهدف الافتراضي: هذه الصفحة نفسها (بلا المسار الحالي لو كان صفحة مصادقة)
    const here = location.pathname + location.search;
    const fallback = here.startsWith('/login') || here.startsWith('/signup') ? '/' : here;
    let target = redirectTo || fallback;
    // إذا كان هدف الدخول نفس الصفحة، نحفظ الاستعلام (مثل ?focus= من إشعار)
    try {
      const next = new URL(target, location.origin);
      if (next.pathname === location.pathname && !next.search) target = next.pathname + location.search;
    } catch {}
    location.replace(`/login?next=${encodeURIComponent(target)}`);
    return false;
  },
};

/* ---------- طلبات API ---------- */
class ApiError extends Error {
  constructor({ code, message, status, details }) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let refreshPromise = null;

async function request(method, url, body, { silent = false, retry = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD' && !url.startsWith('/api/auth/login') && !url.startsWith('/api/auth/signup')) {
    const token = auth.csrf;
    if (token) headers['X-CSRF-Token'] = token;
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (netErr) {
    const err = new ApiError({ code: 'network_error', message: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.', status: 0 });
    if (!silent) toast.error(err.message);
    throw err;
  }

  if (res.status === 403 && retry) {
    // رمز CSRF فسد (مثلاً انتهت الجلسة في تبويب آخر) → حدّث الجلسة وأعد المحاولة مرة
    if (!refreshPromise) refreshPromise = auth.refresh().finally(() => (refreshPromise = null));
    await refreshPromise;
    if (auth.csrf) return request(method, url, body, { silent, retry: false });
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (!res.ok || payload?.ok === false) {
    const e = payload?.error || {};
    const err = new ApiError({
      code: e.code || `http_${res.status}`,
      message: e.message || 'حدث خطأ غير متوقع',
      status: res.status,
      details: e.details,
    });
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      appStore.set({ user: null, authenticated: false, csrfToken: null });
    }
    if (!silent && res.status !== 401) toast.error(err.message);
    throw err;
  }
  return payload;
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body, opts) => request('POST', url, body ?? {}, opts),
  put: (url, body, opts) => request('PUT', url, body ?? {}, opts),
  patch: (url, body, opts) => request('PATCH', url, body ?? {}, opts),
  del: (url, body, opts) => request('DELETE', url, body, opts),
  ApiError,
};

let inflightSession = null;
/**
 * طلب واحد مشترك لحالة الجلسة: النواة وتحقق الصفحات يستدعيانها معًا،
 * فلا نكرر الطلب ولا يحدث سباق بينهما.
 */
function sessionRequest() {
  if (!inflightSession) {
    inflightSession = request('GET', '/api/auth/session', undefined, { silent: true })
      .then((res) => res?.data || null)
      .catch(() => null)
      .finally(() => {
        // نبقي النتيجة فترة قصيرة جدًا كي تستفيد الميزات من نفس الطلب
        setTimeout(() => (inflightSession = null), 50);
      });
  }
  return inflightSession;
}

/* ---------- حالة غير المقروء (تُحدَّث من الإشعارات) ---------- */
export function setUnread(count) {
  const n = Math.max(0, Number(count) || 0);
  if (n === appStore.state.unread) return;
  appStore.set({ unread: n });
  // شارة التطبيق على نظام التشغيل (أندرويد/سطح المكتب) — تُظهر العدّ حتى والتطبيق مغلق
  try {
    if (n > 0 && navigator.setAppBadge) navigator.setAppBadge(n);
    else if (navigator.clearAppBadge) navigator.clearAppBadge();
  } catch {}
  document.querySelectorAll('[data-unread-badge]').forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = n === 0;
  });
  document.title = (n > 0 ? `(${n}) ` : '') + document.title.replace(/^\(\d+\+?\)\s*/, '');
}

/* ---------- حماية الحقول (منع الإرسال المزدوج) ---------- */
export function guardForm(form, handler) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    const submitBtn = form.querySelector('[type="submit"]');
    setButtonLoading(submitBtn, true);
    try {
      await handler(new FormData(form), form);
    } catch (err) {
      if (!(err instanceof ApiError)) console.error(err);
    } finally {
      if (document.contains(form)) {
        form.dataset.busy = '';
        setButtonLoading(submitBtn, false);
      }
    }
  });
}

/* ---------- تهيئة الهيدر ---------- */
export function initHeader() {
  $$('[data-theme-toggle]').forEach((btn) => btn.addEventListener('click', () => theme.toggle()));
  $$('[data-sound-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const enabled = sound.toggle();
    toast.info(enabled ? 'أصوات التطبيق مفعّلة' : 'أصوات التطبيق متوقفة', { sound: false, duration: 1600 });
    if (appStore.state.authenticated) {
      api.patch('/api/me', { preferences: { sound: { enabled, volume: sound.volume } } }, { silent: true })
        .then((res) => appStore.set({ user: res.data.user }))
        .catch(() => { });
    }
  }));
  document.addEventListener('mr:sound-changed', () => {
    // الزر يُحدّث نفسه داخل وحدة الصوت؛ هذا يضمن حالته بعد أي إعادة رسم للهيدر
    $$('[data-sound-toggle]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(sound.enabled));
      btn.dataset.sound = sound.enabled ? 'on' : 'off';
      btn.querySelector('[data-sound-on]')?.toggleAttribute('hidden', !sound.enabled);
      btn.querySelector('[data-sound-off]')?.toggleAttribute('hidden', sound.enabled);
    });
  });

  const renderAuthArea = () => {
    const { authenticated, user } = appStore.state;
    const area = $('[data-auth-area]');
    if (!area) return;
    if (authenticated && user) {
      const initials = (user.name || '؟')
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join('');
      const avatar = user.avatar
        ? `<img class="avatar-chip" src="${escapeHtml(user.avatar)}" alt="" />`
        : `<span class="avatar-chip" aria-hidden="true">${escapeHtml(initials)}</span>`;
      area.innerHTML = `
        ${
          location.pathname === '/'
            ? ''
            : `<a class="btn btn-ghost btn-sm header-home" href="/" data-link title="العودة للرئيسية" aria-label="العودة للرئيسية">
                 <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/></svg>
                 <span class="hide-sm">الرئيسية</span>
               </a>`
        }
        <a class="btn btn-ghost btn-sm" href="/notifications" aria-label="الإشعارات" style="position:relative">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
          <span data-unread-badge hidden style="position:absolute;top:-2px;inset-inline-end:-2px;background:var(--brand-500);color:#fff;font-size:.68rem;min-width:18px;height:18px;border-radius:99px;display:grid;place-items:center;padding:0 5px"></span>
        </a>
        <a href="/account" class="btn btn-soft btn-sm" data-link>
          ${avatar}
          <span class="hide-sm">${escapeHtml(user.name.split(' ')[0])}</span>
        </a>`;
      setUnread(appStore.state.unread);
    } else if (authenticated === false && appStore.state.sessionChecked) {
      area.innerHTML = `
        <a class="btn btn-ghost btn-sm" href="/login" data-link>تسجيل الدخول</a>
        <a class="btn btn-primary btn-sm" href="/signup" data-link>إنشاء حساب</a>`;
    }
  };
  const renderMobileTabs = () => {
    const tabs = $('[data-mobile-tabs]');
    if (!tabs) return;
    if (!appStore.state.authenticated) {
      tabs.hidden = true;
      return;
    }
    tabs.hidden = false;
    const items = [
      { href: '/', label: 'الرئيسية', icon: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/>' },
      { href: '/books', label: 'كتبي', icon: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>' },
      { href: '/routines', label: 'روتيناتي', icon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' },
      { href: '/coach', label: 'المدرب', icon: '<path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/>' },
      { href: '/account', label: 'حسابي', icon: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>' },
    ];
    const here = location.pathname.replace(/\/+$/, '') || '/';
    tabs.innerHTML = items
      .map(
        (item) => `<a href="${item.href}" data-link class="${here === item.href ? 'is-active' : ''}" aria-current="${here === item.href ? 'page' : 'false'}">
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${item.icon}</svg>
          <span>${item.label}</span></a>`
      )
      .join('');
  };

  appStore.subscribe(renderAuthArea);
  appStore.subscribe(renderMobileTabs);
  // الهيدر يعتمد على المسار (زر «العودة للرئيسية») فيجب تحديثه مع كل تنقّل
  document.addEventListener('mr:route-changed', () => {
    renderAuthArea();
    renderMobileTabs();
    const here = location.pathname.replace(/\/+$/, '') || '/';
    $$('.main-nav a').forEach((link) => {
      const path = new URL(link.href, location.href).pathname.replace(/\/+$/, '') || '/';
      link.setAttribute('aria-current', path === here ? 'page' : 'false');
    });
  });
  renderAuthArea();
  renderMobileTabs();
  return renderAuthArea;
}

/* ---------- تسجيل Service Worker (للتثبيت والحفظ دون اتصال) ---------- */
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) worker.postMessage('SKIP_WAITING');
      });
    });
    // عند أول تحميل للـ SW، انتظر اكتمال التفعيل كي لا يشير AppInstallPrompt لـ SW غير جاهز
    const worker = reg.installing || reg.waiting || reg.active;
    if (worker && worker.state !== 'activated') {
      await new Promise((resolve) => {
        const done = () => worker.state === 'activated' && resolve();
        worker.addEventListener('statechange', done);
        setTimeout(resolve, 8000);
      });
    }
    return reg;
  } catch (err) {
    console.warn('[sw] register failed', err);
    return null;
  }
}

/* ---------- بدء التطبيق ---------- */
export async function boot() {
  bindLinkInterception();
  initHeader();
  initScene();
  registerServiceWorker();
  await auth.refresh();
  if (appStore.state.authenticated) {
    // تحميل ميزة الإشعارات في الخلفية لتشغيل البث اللحظي وشارة الجرس
    import('/features/notifications/notifications.js')
      .then((m) => m.startLive?.())
      .catch(() => { });
    // مزامنة لقطة القراءة: يعرف الخادم آخر كتاب/نسبة حتى يرسل تذكير القراءة
    // والملخص اليومي عبر Push والتطبيق مغلق (الكتاب نفسه يبقى على الجهاز).
    import('/features/books/sync.js')
      .then((m) => m.syncReadingSnapshot({ force: true }))
      .catch(() => { });
  }
  await router.mountCurrent();
}
