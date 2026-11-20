/**
 * لوحة الأمان (ميزة فرعية داخل account): تغيير كلمة المرور.
 * بعد التغيير تُنهى كل الجلسات — أنت تعلم الأمان يتطلب إعادة الدخول.
 */
import { api, auth, toast } from '../../assets/core/core.js';
import { passwordScore, LABELS } from '../auth/ui.js';

export function bindSecurityPanel(panel) {
  panel.innerHTML = `
    <header>
      <span class="panel-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10" width="15" height="10.5" rx="3"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/><path d="M12 14.5v2"/></svg></span>
      <div><h3>الأمان</h3><p>كلمة مرورك تُخزَّن مجزَّأة (scrypt) ولا يمكن استرجاعها نصًا.</p></div>
    </header>
    <form class="form-grid" data-pw-form novalidate>
      <div class="field full">
        <label for="ac-current">كلمة المرور الحالية</label>
        <input class="input" id="ac-current" name="currentPassword" type="password" autocomplete="current-password" required />
      </div>
      <div class="field">
        <label for="ac-new">كلمة المرور الجديدة</label>
        <input class="input" id="ac-new" name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
        <span class="hint" data-pw-hint>8 أحرف على الأقل</span>
      </div>
      <div class="field">
        <label for="ac-confirm">تأكيد الجديدة</label>
        <input class="input" id="ac-confirm" name="confirm" type="password" autocomplete="new-password" required />
        <span class="hint" data-pw-match></span>
      </div>
      <div class="full row" style="justify-content:flex-end">
        <button class="btn btn-primary" type="submit">تحديث كلمة المرور</button>
      </div>
    </form>
    <p style="margin:0;font-size:.82rem;color:var(--text-muted)">ملاحظة: بعد التحديث ستُنهى كل الجلسات (بما فيها هذه) وتحتاج تسجيل الدخول من جديد.</p>`;

  const form = panel.querySelector('[data-pw-form]');
  const hint = panel.querySelector('[data-pw-hint]');
  const match = panel.querySelector('[data-pw-match]');
  const btn = form.querySelector('button');

  form.newPassword.addEventListener('input', () => {
    const { score } = passwordScore(form.newPassword.value);
    hint.textContent = form.newPassword.value ? `القوة: ${LABELS[score]}` : '8 أحرف على الأقل';
    hint.style.color = score >= 3 ? 'var(--success)' : score >= 2 ? 'var(--warning)' : 'var(--text-muted)';
  });
  form.confirm.addEventListener('input', () => {
    match.textContent = form.confirm.value && form.confirm.value !== form.newPassword.value ? 'غير متطابقتين' : '';
    match.style.color = 'var(--danger)';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.confirm.value !== form.newPassword.value) return match.focus(), (match.textContent = 'غير متطابقتين');
    btn.disabled = true;
    btn.textContent = 'جارٍ التحديث…';
    try {
      await api.put('/api/auth/password', {
        currentPassword: form.currentPassword.value,
        newPassword: form.newPassword.value,
      });
      toast.success('تم تحديث كلمة المرور — سجّل الدخول من جديد');
      await auth.refresh().catch(() => { });
      setTimeout(() => location.assign('/login'), 900);
    } catch (err) {
      toast.error(err.details?.fields?.currentPassword ? 'كلمة المرور الحالية غير صحيحة' : err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'تحديث كلمة المرور';
    }
  });
}
