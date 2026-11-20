/**
 * عناصر واجهة مشتركة لميزة المصادقة.
 */
export const icons = {
  mail: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3.5 7 8.5 6 8.5-6"/></svg>',
  lock: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10" width="15" height="10.5" rx="3"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14.5v2"/></svg>',
  user: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>',
  eye: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l18 18"/><path d="M10.6 6.1A9.8 9.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.8"/><path d="M6.2 7.8A16.7 16.7 0 0 0 2.5 12S6 18 12 18a9 9 0 0 0 3.4-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
  shield: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6z"/><path d="m9 12 2 2 4-4"/></svg>',
  device: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="13" height="10" rx="2"/><path d="M7 18h5"/><rect x="17" y="9" width="4.5" height="10.5" rx="1.5"/></svg>',
  book: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
  check: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>',
};

/** الحصول على قيمة ?next= الآمنة (مسار داخلي فقط) */
export function safeNext() {
  const raw = new URLSearchParams(location.search).get('next');
  if (!raw) return '/';
  try {
    const url = new URL(raw, location.origin);
    if (url.origin !== location.origin) return '/';
    if (!url.pathname.startsWith('/') || url.pathname.startsWith('//')) return '/';
    if (url.pathname.startsWith('/login') || url.pathname.startsWith('/signup')) return '/';
    return url.pathname + url.search;
  } catch {
    return '/';
  }
}

/** شبكة/شريط ضعيف: وضع تحقق فوري بعد أول محاولة */
export function fieldError(fieldEl, message) {
  const err = fieldEl.querySelector('.error-text');
  const input = fieldEl.querySelector('.input');
  if (err) {
    err.textContent = message || '';
    err.dataset.show = message ? 'true' : 'false';
  }
  if (input) {
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
}

export function clearFieldErrors(form) {
  form.querySelectorAll('.field').forEach((f) => fieldError(f, ''));
}

export function showAlert(el, kind, message) {
  if (!message) {
    el.dataset.show = 'false';
    el.textContent = '';
    return;
  }
  el.dataset.kind = kind;
  el.dataset.show = 'true';
  el.innerHTML = `${kind === 'error' ? icons.shield : kind === 'success' ? icons.check : ''}<span></span>`;
  el.querySelector('span').textContent = message;
}

/** زر إظهار كلمة المرور — يُركَّب على كل حقل */
export function bindPasswordToggles(root) {
  root.querySelectorAll('[data-pw-toggle]').forEach((btn) => {
    btn.innerHTML = icons.eye;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'إظهار كلمة المرور');
    btn.addEventListener('click', () => {
      const input = root.querySelector(btn.dataset.pwToggle);
      if (!input) return;
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      btn.innerHTML = show ? icons.eyeOff : icons.eye;
      btn.setAttribute('aria-label', show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور');
      input.focus({ preventScroll: true });
    });
  });
}

/** مقياس قوة محلي (نفس منطق الخادم تقريبًا) */
export function passwordScore(pw) {
  const p = String(pw || '');
  const checks = {
    length: p.length >= 8,
    long: p.length >= 12,
    upper: /\p{Lu}/u.test(p),
    lower: /\p{Ll}/u.test(p),
    digit: /\d/.test(p),
    symbol: /[^\p{L}\p{N}\s]/u.test(p),
    noSpace: p.length > 0 && !/\s/.test(p),
  };
  let score = 0;
  if (checks.length) score++;
  if (checks.long) score++;
  if ([checks.upper, checks.lower, checks.digit, checks.symbol].filter(Boolean).length >= 3) score++;
  if ([checks.upper, checks.lower, checks.digit, checks.symbol].filter(Boolean).length === 4) score++;
  return { checks, score: Math.min(4, score) };
}

export const LABELS = ['ضعيفة جدًا', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جدًا'];
