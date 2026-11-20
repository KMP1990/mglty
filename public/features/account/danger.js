/**
 * منطقة الخطر (ميزة فرعية داخل account): حذف الحساب نهائيًا.
 * تأكيد مزدوج: كتابة DELETE + حوار تأكيد.
 */
import { api, auth, appStore, toast } from '../../assets/core/core.js';
import { clearBooksForUser } from '../books/store.js';

export function bindDangerPanel(panel) {
  panel.innerHTML = `
    <header>
      <span class="panel-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4.5"/><circle cx="12" cy="17" r=".7" fill="currentColor"/></svg></span>
      <div><h3>حذف الحساب</h3><p>لا يمكن التراجع. تُمسح بيانات الحساب وإشعاراته ومكتبتك المحلية المرتبطة به.</p></div>
    </header>
    <div class="danger-row">
      <p>للتأكيد اكتب <strong>DELETE</strong> في الحقل ثم اضغط الحذف.</p>
      <div class="danger-controls">
        <input class="input" data-confirm-input placeholder="DELETE" aria-label="اكتب DELETE للتأكيد" autocomplete="off" spellcheck="false" />
        <button class="btn btn-danger btn-sm" data-delete-account disabled>حذف نهائي</button>
      </div>
    </div>`;

  const input = panel.querySelector('[data-confirm-input]');
  const btn = panel.querySelector('[data-delete-account]');
  input.addEventListener('input', () => (btn.disabled = input.value.trim() !== 'DELETE'));

  btn.addEventListener('click', async () => {
    if (!confirm('سيُحذف حسابك وإشعاراتك من الخادم نهائيًا. متأكد؟')) return;
    btn.disabled = true;
    btn.textContent = 'جارٍ الحذف…';
    const userId = appStore.state.user?.id;
    try {
      await api.del('/api/me', { confirm: 'DELETE' });
      if (userId) {
        await clearBooksForUser(userId).catch(() => { });
        try {
          localStorage.removeItem(`mr:sound:${userId}`);
        } catch { }
      }
      await auth.refresh().catch(() => { });
      toast.success('تم حذف الحساب. نتمنى رؤيتك مجددًا.');
      setTimeout(() => location.assign('/'), 700);
    } catch {
      btn.disabled = false;
      btn.textContent = 'حذف نهائي';
    }
  });
}
