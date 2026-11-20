/**
 * صفحة إنشاء الحساب — وكيل يجمع الجانب التعريفي + النموذج.
 */
import { loadStyles } from '../../assets/core/styles.js';
import { asideHtml } from './aside.js';
import { mountSignupForm } from './signup-form.js';

export async function mount(root) {
  await loadStyles(['/features/auth/auth.css']);
  const shell = document.createElement('div');
  shell.className = 'auth-shell';
  shell.innerHTML = `
    <aside class="auth-aside">${asideHtml({ title: 'مساحتك الشخصية تبدأ من هنا.', lead: 'أنشئ حسابًا في أقل من دقيقة: مقالك الأول، روتينك الأول، وكل شيء محفوظ بأمان على جهازك.' })}</aside>
    <div class="auth-main"><div data-form-slot></div></div>`;
  root.appendChild(shell);
  mountSignupForm(shell.querySelector('[data-form-slot]'));
}
