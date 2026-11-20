/**
 * فحص النظام — يعرض صحة الأنظمة والمكتبة والإكمال والإشعارات
 * من GET /api/routines/diagnostics مع إمكانية إعادة الفحص.
 */
import { escapeHtml } from '../../assets/core/core.js';
import { routinesApi } from './api.js';
import { clientQuery, collectClientState } from '../notifications/inspect/checks.js';

const ICON = { ok: '✅', warn: '⚠️', fail: '❌' };
const ar = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

export function openDiagnosticsSheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet diagnostics-sheet" role="dialog" aria-modal="true" aria-labelledby="diag-title">
      <div class="sheet-head">
        <div><h2 id="diag-title">فحص النظام</h2><p class="sheet-sub">الأنظمة، المكتبة، الإكمال، والإشعارات — في تقرير واحد.</p></div>
        <button class="icon-btn" data-close aria-label="إغلاق">✕</button>
      </div>
      <div data-diag-body><div class="skeleton" style="height:220px"></div></div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const sheet = backdrop.querySelector('.sheet');
  const body = sheet.querySelector('[data-diag-body]');
  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.body.style.overflow = '';
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => e.target === backdrop && close());
  sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  async function load() {
    body.innerHTML = '<div class="skeleton" style="height:220px"></div>';
    try {
      const client = await collectClientState();
      const res = await routinesApi.diagnostics(clientQuery(client));
      render(res.data);
    } catch (err) {
      body.innerHTML = `<div class="starter"><span class="emoji">🩺</span><strong>تعذّر الفحص</strong><p>${escapeHtml(err.message)}</p><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>`;
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function render(report) {
    body.innerHTML = `
      <div class="diag-score" data-status="${report.status}">
        <strong>${ar(report.score)}٪</strong>
        <div><span>${report.status === 'ok' ? 'كل شيء سليم' : report.status === 'warn' ? 'يعمل مع تنبيهات' : 'يحتاج إصلاحًا'}</span>
        <small>${ar(report.counts.systems)} أنظمة • ${ar(report.counts.routines)} روتين نشط • ${ar(report.counts.logs)} يوم مسجّل</small></div>
        <button class="btn btn-sm btn-soft" data-refresh>فحص من جديد</button>
      </div>
      <ul class="diag-list">
        ${report.checks
          .map(
            (check) => `<li class="diag-item" data-status="${check.status}">
              <span class="diag-ico" aria-hidden="true">${ICON[check.status] || '•'}</span>
              <div><strong>${escapeHtml(check.label)}</strong><p>${escapeHtml(check.detail)}</p>${check.fix ? `<small>الإصلاح: ${escapeHtml(check.fix)}</small>` : ''}</div>
            </li>`
          )
          .join('')}
      </ul>
      <p class="hint-line">للفحص الكامل من الطرفية: <code>npm run inspect</code></p>`;
    body.querySelector('[data-refresh]')?.addEventListener('click', load);
  }

  load();
  return { close, reload: load };
}
