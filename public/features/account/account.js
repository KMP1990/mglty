/**
 * ميزة الحساب — عرض البيانات، تعديل الاسم، تغيير كلمة المرور، الثيم، حذف الحساب.
 * منطق كل لوحة مفصول في ملفات فرعية صغيرة.
 */
import { auth, appStore, escapeHtml } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { bindProfilePanel } from './profile.js';
import { bindSecurityPanel } from './security.js';
import { bindPrefsPanel } from './prefs.js';
import { bindDangerPanel } from './danger.js';
import { bindAvatar } from './avatar.js';

export async function mount(root) {
  if (!(await auth.require({ redirectTo: '/account' }))) return;
  await loadStyles(['/features/auth-forms.css', '/features/account/account.css']);

  const user = appStore.state.user;
  const initials = (user?.name || '؟')
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('');

  root.innerHTML = `
  <div class="container account-layout">
    <aside class="card profile-card">
      <span class="avatar-lg avatar-target" data-avatar-target aria-hidden="true">${user?.avatar ? `<img src="${escapeHtml(user.avatar)}" alt="صورة ${escapeHtml(user.name || '')}" />` : escapeHtml(initials)}</span>
      <h2 data-profile-name>${escapeHtml(user?.name || '')}</h2>
      <p class="email" data-profile-email>${escapeHtml(user?.email || '')}</p>
      <span class="chip chip-mint">عضو منذ ${new Date(user?.createdAt || Date.now()).toLocaleDateString('ar', { month: 'long', year: 'numeric' })}</span>
      <div class="row" style="justify-content:center;margin-top:8px">
        <a class="btn btn-sm btn-soft" href="/books" data-link>كتبي</a>
        <a class="btn btn-sm btn-soft" href="/notifications" data-link>الإشعارات</a>
        <a class="btn btn-sm btn-soft" href="/vault" data-link>الخزنة</a>
      </div>
    </aside>

    <div class="account-panels">
      <section class="card panel" data-avatar-panel></section>
      <section class="card panel" data-profile></section>
      <section class="card panel" data-security></section>
      <section class="card panel" data-prefs></section>
      <section class="card panel danger-zone" data-danger></section>
    </div>
  </div>`;

  bindAvatar(root.querySelector('[data-avatar-panel]'), { root });
  bindProfilePanel(root.querySelector('[data-profile]'), { root });
  bindSecurityPanel(root.querySelector('[data-security]'));
  bindPrefsPanel(root.querySelector('[data-prefs]'), { root });
  bindDangerPanel(root.querySelector('[data-danger]'), { root });
}
