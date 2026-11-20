/**
 * نموذج إنشاء الحساب (ميزة فرعية داخل auth).
 * تحقق فوري + مقياس قوة + موافقة على الشروط + منع الإرسال المزدوج.
 */
import { api, appStore, toast } from '../../assets/core/core.js';
import { icons, safeNext, fieldError, clearFieldErrors, showAlert, bindPasswordToggles, passwordScore, LABELS } from './ui.js';

export function mountSignupForm(slot) {
  const next = safeNext();
  slot.innerHTML = `
    <div class="card auth-card">
      <span class="chip chip-mint" style="justify-self:start">إنشاء حساب جديد</span>
      <h1>ابدأ مساحتك ✨</h1>
      <p class="sub">دقيقة واحدة، وبعدها كل شيء جاهز ومحفوظ.</p>

      <div class="form-alert" data-alert data-kind="error" role="alert"></div>

      <form novalidate data-signup-form>
        <div class="field" data-field="name">
          <label for="su-name">الاسم</label>
          <div class="input-wrap">
            <span class="icon">${icons.user}</span>
            <input class="input" id="su-name" name="name" type="text" autocomplete="name" placeholder="مثال: سارة أحمد" required maxlength="40" />
          </div>
          <span class="error-text" role="alert"></span>
        </div>

        <div class="field" data-field="email">
          <label for="su-email">البريد الإلكتروني</label>
          <div class="input-wrap">
            <span class="icon">${icons.mail}</span>
            <input class="input" id="su-email" name="email" type="email" inputmode="email" autocomplete="email" dir="ltr" placeholder="name@example.com" required style="text-align:left" />
          </div>
          <span class="hint">نستخدمه للدخول فقط — بدون رسائل إزعاج.</span>
          <span class="error-text" role="alert"></span>
        </div>

        <div class="field" data-field="password">
          <label for="su-password">كلمة المرور</label>
          <div class="input-wrap">
            <span class="icon">${icons.lock}</span>
            <input class="input" id="su-password" name="password" type="password" autocomplete="new-password" required minlength="8" maxlength="128" placeholder="8 أحرف على الأقل" style="padding-inline-end:46px" />
            <button class="input-action pw-toggle" data-pw-toggle="#su-password" aria-label="إظهار كلمة المرور"></button>
          </div>
          <div class="strength" data-strength data-score="0">
            <div class="strength-bars"><span></span><span></span><span></span><span></span></div>
            <div class="strength-row"><strong data-strength-label>—</strong><span data-strength-hint>استخدم 12 حرفًا أو أكثر مع أرقام ورموز</span></div>
          </div>
          <ul class="pw-rules" data-rules>
            <li data-rule="length">8 أحرف على الأقل</li>
            <li data-rule="mixed">حروف وأرقام</li>
            <li data-rule="symbol">رمز مثل !@#</li>
          </ul>
          <span class="error-text" role="alert"></span>
        </div>

        <div class="field" data-field="confirm">
          <label for="su-confirm">تكرار كلمة المرور</label>
          <div class="input-wrap">
            <span class="icon">${icons.lock}</span>
            <input class="input" id="su-confirm" name="confirm" type="password" autocomplete="new-password" required placeholder="أعد كتابة كلمة المرور" style="padding-inline-end:46px" />
            <button class="input-action pw-toggle" data-pw-toggle="#su-confirm" aria-label="إظهار كلمة المرور"></button>
          </div>
          <span class="error-text" role="alert"></span>
        </div>

        <div class="field" data-field="terms" style="margin-bottom:var(--space-4)">
          <label class="check" style="align-items:flex-start">
            <input type="checkbox" name="acceptTerms" required style="margin-top:3px" />
            <span>أوافق على <a href="/terms" target="_blank" rel="noopener">شروط الاستخدام</a> و<a href="/privacy" target="_blank" rel="noopener">سياسة الخصوصية</a>.</span>
          </label>
          <span class="error-text" role="alert"></span>
        </div>

        <button class="btn btn-primary btn-block" type="submit">إنشاء حسابي</button>
      </form>

      <p class="auth-switch">لديك حساب بالفعل؟ <a href="/login" data-link>تسجيل الدخول</a></p>
      <div class="auth-foot">${icons.shield}<span>كلمة مرورك تُخزَّن مجزَّأة (scrypt) — لا يمكن لأحد قراءتها، حتى نحن.</span></div>
    </div>`;

  const card = slot.firstElementChild;
  const form = card.querySelector('[data-signup-form]');
  const alert = card.querySelector('[data-alert]');
  const btn = form.querySelector('button[type="submit"]');
  const pw = form.querySelector('#su-password');
  const confirm = form.querySelector('#su-confirm');
  const email = form.querySelector('#su-email');
  const name = form.querySelector('#su-name');
  const strength = card.querySelector('[data-strength]');
  const strengthLabel = card.querySelector('[data-strength-label]');
  const strengthHint = card.querySelector('[data-strength-hint]');
  const rules = card.querySelector('[data-rules]');

  bindPasswordToggles(card);

  const field = (key) => card.querySelector(`[data-field="${key}"]`);
  const HINTS = ['8 أحرف على الأقل', 'أضف رقمًا أو رمزًا', 'جيدة — أضف رمزًا لتقويتها', 'ممتازة!', 'ممتازة! احتفظ بها في مكان آمن'];

  pw.addEventListener('input', () => {
    const { checks, score } = passwordScore(pw.value);
    strength.dataset.score = String(score);
    strengthLabel.textContent = pw.value ? LABELS[score] : '—';
    strengthHint.textContent = pw.value ? HINTS[score] : 'استخدم 12 حرفًا أو أكثر مع أرقام ورموز';
    rules.querySelector('[data-rule="length"]').dataset.ok = String(checks.length);
    rules.querySelector('[data-rule="mixed"]').dataset.ok = String(checks.digit && (checks.upper || checks.lower));
    rules.querySelector('[data-rule="symbol"]').dataset.ok = String(checks.symbol);
    fieldError(field('password'), '');
    if (confirm.value) validateConfirm();
  });
  confirm.addEventListener('input', () => {
    validateConfirm();
  });
  function validateConfirm() {
    if (confirm.value && confirm.value !== pw.value) fieldError(field('confirm'), 'كلمتا المرور غير متطابقتين');
    else fieldError(field('confirm'), '');
  }
  [name, email].forEach((el) =>
    el.addEventListener('input', () => {
      fieldError(field(el.id === 'su-name' ? 'name' : 'email'), '');
      showAlert(alert, '', '');
    })
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.busy === '1') return;
    clearFieldErrors(form);
    showAlert(alert, '', '');

    const values = {
      name: name.value.trim().replace(/\s+/g, ' '),
      email: email.value.trim(),
      password: pw.value,
      acceptTerms: form.querySelector('[name="acceptTerms"]').checked,
    };
    let bad = false;
    if (values.name.length < 2) {
      fieldError(field('name'), 'اكتب اسمك (حرفان على الأقل)');
      bad = true;
    }
    if (!/^\S+@\S+\.\S+$/.test(values.email)) {
      fieldError(field('email'), 'صيغة البريد غير صحيحة');
      bad = true;
    }
    if (values.password.length < 8) {
      fieldError(field('password'), 'كلمة المرور قصيرة — 8 أحرف على الأقل');
      bad = true;
    }
    if (confirm.value !== values.password) {
      fieldError(field('confirm'), 'كلمتا المرور غير متطابقتين');
      bad = true;
    }
    if (!values.acceptTerms) {
      fieldError(field('terms'), 'يجب الموافقة على الشروط للمتابعة');
      bad = true;
    }
    if (bad) {
      form.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    form.dataset.busy = '1';
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>جارٍ إنشاء حسابك…</span>';

    try {
      const res = await api.post('/api/auth/signup', values, { silent: true });
      appStore.set({ user: res.data.user, csrfToken: res.data.csrfToken, authenticated: true, sessionChecked: true });
      toast.success(`تم إنشاء حسابك، أهلًا ${res.data.user.name.split(' ')[0]} 🎉`);
      location.assign(next);
      return;
    } catch (err) {
      const fields = err.details?.fields || {};
      if (fields.name) fieldError(field('name'), fields.name);
      if (fields.email) fieldError(field('email'), fields.email);
      if (fields.password) fieldError(field('password'), fields.password);
      if (err.code === 'email_taken') {
        fieldError(field('email'), 'هذا البريد مسجّل مسبقًا');
        showAlert(alert, 'error', 'يبدو أن لديك حسابًا بهذا البريد. جرّب تسجيل الدخول.');
      } else if (err.code === 'rate_limited') {
        showAlert(alert, 'error', 'محاولات كثيرة من هذا الجهاز. انتظر قليلًا ثم حاول.');
      } else if (err.code === 'network_error') {
        showAlert(alert, 'error', 'تعذّر الاتصال. تحقق من الإنترنت ثم أعد المحاولة.');
      } else {
        showAlert(alert, 'error', err.message || 'تعذّر إنشاء الحساب.');
      }
    } finally {
      form.dataset.busy = '';
      btn.disabled = false;
      btn.textContent = 'إنشاء حسابي';
    }
  });

  setTimeout(() => name.focus(), 60);
  if (appStore.state.authenticated) location.replace(next);
}
