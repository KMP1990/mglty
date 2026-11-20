/**
 * سجل الإنجاز — آخر ٣٠ يومًا من السجل الحقيقي.
 * يُظهر ما أنجزته وما تخطّيته، مع تطورك الكلي.
 */
import { escapeHtml } from '../../assets/core/core.js';
import { routinesApi } from './api.js';
import { colorOf, iconSvg } from './components.js';
import { STAGES, ar } from './evolution.js';

const WEEK_AR = { الأحد: 'الأحد', الاثنين: 'الاثنين', الثلاثاء: 'الثلاثاء', الأربعاء: 'الأربعاء', الخميس: 'الخميس', الجمعة: 'الجمعة', السبت: 'السبت' };

const dateLabel = (date) => {
  try {
    return new Date(`${date}T12:00:00Z`).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return date;
  }
};

export function openHistorySheet() {
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet history-sheet" role="dialog" aria-modal="true" aria-labelledby="history-title">
      <div class="sheet-head">
        <div><h2 id="history-title">سجلي</h2><p class="sheet-sub">كل إنجاز محفوظ — حتى لو اختفى الروتين من قائمة اليوم.</p></div>
        <button class="icon-btn" data-close aria-label="إغلاق">✕</button>
      </div>
      <div data-history-body><div class="skeleton" style="height:200px"></div></div>
    </div>`;
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const sheet = backdrop.querySelector('.sheet');
  const body = sheet.querySelector('[data-history-body]');
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
    try {
      const res = await routinesApi.history(30);
      render(res.data);
    } catch (err) {
      body.innerHTML = `<div class="starter"><span class="emoji">📡</span><strong>تعذّر تحميل السجل</strong><p>${escapeHtml(err.message)}</p><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>`;
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function render(data) {
    const evo = data.evolution;
    const stage = evo ? STAGES.find((s) => s.id === evo.stage) || STAGES[0] : null;
    body.innerHTML = `
      <div class="history-summary">
        <div class="history-stat"><strong>${ar(data.totals.done)}</strong><span>إنجاز في ${ar(data.days)} يومًا</span></div>
        <div class="history-stat"><strong>${ar(data.totals.activeDays)}</strong><span>يوم نشط</span></div>
        <div class="history-stat"><strong>${ar(data.totals.skipped)}</strong><span>تخطّي</span></div>
        ${evo ? `<div class="history-stat history-evo"><span class="evo-emoji-big">${stage?.emoji || '🌱'}</span><div><strong>المستوى ${ar(evo.level)}</strong><span>${evo.stageName} • ${ar(evo.totalXp)} XP</span></div></div>` : ''}
      </div>
      ${
        data.entries.length
          ? `<ul class="history-list">${data.entries
              .map(
                (entry) => `<li class="history-day">
                  <div class="history-date"><strong>${escapeHtml(WEEK_AR[entry.weekday] || entry.weekday || '')}</strong><small>${escapeHtml(dateLabel(entry.date))}</small></div>
                  <div class="history-items">
                    ${entry.done
                      .map(
                        (item) => `<span class="history-chip done" style="--accent:${colorOf(item.color).hex};--accent-soft:${colorOf(item.color).soft}">${iconSvg(item.icon || 'sparkles', 13)} ${escapeHtml(item.title)}</span>`
                      )
                      .join('')}
                    ${entry.skipped
                      .map(
                        (item) => `<span class="history-chip skipped" title="تخطّي">↷ ${escapeHtml(item.title)}</span>`
                      )
                      .join('')}
                  </div>
                </li>`
              )
              .join('')}</ul>`
          : `<div class="starter"><span class="emoji">🌱</span><strong>لا سجل بعد</strong><p>أنجز روتينك الأول وسيظهر هنا إلى الأبد.</p></div>`
      }`;
  }

  load();
  return { close, reload: load };
}
