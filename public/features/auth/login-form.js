/**
 * نموذج تسجيل الدخول (ميزة فرعية داخل auth).
 * يحفظ آخر بريد استُخدم للتسهيل، ويكتمل مع مدير كلمات المرور عبر autocomplete.
 */
import { api, appStore, toast, $ } from '../../assets/core/core.js';
import { icons, safeNext, fieldError, clearFieldErrors, showAlert, bindPasswordToggles } from './ui.js';

const LAST_EMAIL_KEY = 'mr:last-email';

export function mountLoginForm(slot) {
  const next = safeNext();
  const lastEmail = localStorage.getItem(LAST_EMAIL_KEY) || '';
  slot.innerHTML = `
    <div class="card auth-card">
      <span class="chip chip-brand" style="justify-self:start">تسجيل الدخول</span>
      <h1>أهلًا بعودتك 👋</h1>
      <p class="sub">سجّل دخولك لتكمل من حيث توقفت. لا شيء فُقد.</p>
      <div class="form-alert" data-alert data-kind="error" role="alert"></div>
      <form novalidate data-login-form>
        <div class="field" data-field="email">
          <label for="login-email">البريد الإلكتروني</label>
          <div class="input-wrap">
            <span class="icon">${icons.mail}</span>
            <input class="input" id="login-email" name="email" type="email" inputmode="email" autocomplete="username"
              dir="ltr" placeholder="name@example.com" required value="${escapeAttr(lastEmail)}" style="text-align:left" />
          </div>
          <span class="error-text" role="alert"></span>
        </div>
        <div class="field" data-field="password">
          <label for="login-password">كلمة المرور</label>
          <div class="input-wrap">
            <span class="icon">${icons.lock}</span>
            <input class="input" id="login-password" name="password" type="password" autocomplete="current-password" required placeholder="••••••••" style="padding-inline-end:46px" />
            <button class="input-action pw-toggle" data-pw-toggle="#login-password" aria-label="إظهار كلمة المرور"></button>
          </div>
          <span class="error-text" role="alert"></span>
        </div>
        <div class="auth-meta">
          <label class="check"><input type="checkbox" name="remember" checked /> تذكّرني على هذا الجهاز</label>
          <a class="link-muted" href="/login#forgot" data-forgot>نسيت كلمة المرور؟</a>
        </div>
        <button class="btn btn-primary btn-block" type="submit">دخول إلى مساحتي</button>
      </form>
      <p class="auth-switch">ليس لديك حساب؟ <a href="/signup" data-link>أنشئ حسابًا مجانًا</a></p>
      <div class="auth-foot">${icons.shield}<span>جلستك محمية بكوكي httponly وتوقيع رقمي، ولا نخزّن كلمة مرورك نصًا أبدًا.</span></div>
    </div>`;

  const card = slot.firstElementChild;
  const form = $('[data-login-form]', card);
  const alert = $('[data-alert]', card);
  const btn = $('button[type="submit"]', form);
  bindPasswordToggles(card);

  const setBusy = (busy) => {
    btn.disabled = busy;
    btn.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span><span>جارٍ التحقق…</span>' : 'دخول إلى مساحتي';
    form.setAttribute('aria-busy', String(busy));
  };

  const emailField = () => card.querySelector('[data-field="email"]');
  const passField = () => card.querySelector('[data-field="password"]');

  form.addEventListener('input', (e) => {
    const field = e.target.closest('.field');
    if (field && e.target.classList.contains('input')) fieldError(field, '');
    showAlert(alert, '', '');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    clearFieldErrors(form);
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const remember = data.get('remember') === 'on';

    if (!email) {
      fieldError(emailField(), 'أدخل بريدك الإلكتروني');
      form.dataset.busy = '';
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      fieldError(emailField(), 'صيغة البريد غير صحيحة');
      form.dataset.busy = '';
      return;
    }
    if (!password) {
      fieldError(passField(), 'أدخل كلمة المرور');
      form.dataset.busy = '';
      return;
    }

    setBusy(true);
    try {
      const res = await api.post('/api/auth/login', { email, password, remember }, { silent: true });
      localStorage.setItem(LAST_EMAIL_KEY, email);
      appStore.set({ user: res.data.user, csrfToken: res.data.csrfToken, authenticated: true, sessionChecked: true });
      toast.success(`أهلًا ${res.data.user.name.split(' ')[0]} ✨`);
      // إعادة تحميل كاملة: تضمن تحميل وحدات المستخدم والقوالب الصحيحة
      location.assign(next);
      return;
    } catch (err) {
      const code = err.code;
      const fields = err.details?.fields || {};
      if (fields.email || code === 'validation_failed') fieldError(emailField(), fields.email || err.message);
      if (code === 'invalid_credentials') {
        fieldError(passField(), 'بيانات غير صحيحة');
        showAlert(alert, 'error', 'البريد الإلكتروني أو كلمة المرور غير صحيحة. تحقق من الإملاء وحاول مجددًا.');
      } else if (code === 'account_locked' || code === 'rate_limited') {
        showAlert(alert, 'error', err.message);
      } else if (code === 'network_error') {
        showAlert(alert, 'error', 'تعذّر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.');
      } else {
        showAlert(alert, 'error', err.message || 'تعذّر إتمام الدخول.');
      }
      $('input', form)?.focus();
    } finally {
      form.dataset.busy = '';
      setBusy(false);
    }
  });

  // "نسيت كلمة المرور" — التدفق غير مبني بعد، نوضح الخطوة التالية بأمانة
  $('[data-forgot]', card).addEventListener('click', (e) => {
    e.preventDefault();
    showAlert(alert, 'info', 'لا يوجد بريد لإعادة التعيين بعد. حاليًا يمكنك تغيير كلمة المرور من صفحة الحساب بعد الدخول.');
  });

  if (!lastEmail) setTimeout(() => $('#login-email', card)?.focus(), 60);
  else setTimeout(() => $('#login-password', card)?.focus(), 60);

  // إن كان مسجلًا بالفعل ننقله لوجهته
  if (appStore.state.authenticated) location.replace(next);
}

function escapeAttr(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
