/**
 * صفحة تسجيل الدخول — وكيل خفيف يجمع الجانب التعريفي + النموذج.
 * منطق النموذج نفسه في login-form.js (ميزة فرعية).
 */
import { loadStyles } from '../../assets/core/styles.js';
import { asideHtml } from './aside.js';
import { mountLoginForm } from './login-form.js';

export async function mount(root) {
  await loadStyles(['/features/auth/auth.css']);
  const shell = document.createElement('div');
  shell.className = 'auth-shell';
  shell.innerHTML = `
    <aside class="auth-aside">${asideHtml({ title: 'مرحبًا بعودتك إلى مساحتك الخاصة.', lead: 'دفترك وروتينك ينتظرانك — كل شيء محفوظ، مشفّر، وجاهز حتى دون إنترنت.' })}</aside>
    <div class="auth-main"><div data-form-slot></div></div>`;
  root.appendChild(shell);
  mountLoginForm(shell.querySelector('[data-form-slot]'));
}
