/**
 * لوحة الملف الشخصي (ميزة فرعية داخل account): الاسم + تصدير البيانات.
 */
import { api, appStore, toast, escapeHtml } from '../../assets/core/core.js';

export function bindProfilePanel(panel, { root }) {
  const user = appStore.state.user;
  panel.innerHTML = `
    <header>
      <span class="panel-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg></span>
      <div><h3>بيانات الحساب</h3><p>اسمك يظهر في الترحيب والإشعارات.</p></div>
    </header>
    <form class="inline-form" data-name-form novalidate>
      <div class="field" style="margin:0">
        <label for="ac-name">الاسم</label>
        <input class="input" id="ac-name" name="name" value="${escapeHtml(user?.name || '')}" maxlength="40" required autocomplete="name" />
      </div>
      <button class="btn btn-primary" type="submit">حفظ الاسم</button>
    </form>
    <div class="row-between" style="margin-top:12px">
      <div><div class="label">البريد الإلكتروني</div><p class="desc" dir="ltr" style="text-align:right">${escapeHtml(user?.email || '')}</p></div>
      <span class="chip">لتغييره نتواصل مع الدعم</span>
    </div>
    <div class="row-between">
      <div><div class="label">تصدير بياناتي</div><p class="desc">ملف JSON ببيانات حسابك الأساسية.</p></div>
      <a class="btn btn-sm btn-soft" href="/api/me/export" download="my-account.json">تصدير</a>
    </div>`;

  const form = panel.querySelector('[data-name-form]');
  const btn = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = form.name.value.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return form.name.focus();
    btn.disabled = true;
    btn.textContent = 'جارٍ الحفظ…';
    try {
      const res = await api.patch('/api/me', { name });
      appStore.set({ user: res.data.user });
      root.querySelector('[data-profile-name]').textContent = res.data.user.name;
      if (!res.data.user.avatar) {
        const freshInitials = res.data.user.name
          .split(/\s+/)
          .slice(0, 2)
          .map((p) => p[0])
          .join('');
        root.querySelectorAll('[data-avatar-target]').forEach((avatar) => {
          avatar.textContent = freshInitials;
        });
      }
      // تحديث الهيدر
      document.querySelector('[data-auth-area] a[href="/account"] .hide-sm')?.replaceChildren(res.data.user.name.split(' ')[0]);
      toast.success('تم تحديث الاسم');
    } catch {
      /* التوست يعرض الخطأ */
    } finally {
      btn.disabled = false;
      btn.textContent = 'حفظ الاسم';
    }
  });
}
