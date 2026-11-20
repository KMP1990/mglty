/**
 * صفحة المدرب الذكي — نظام تحليل واقتراحات الروتين.
 * تعتمد كليًا على GET /api/routines/coach وتُترجم النتائج إلى واجهة مفهومة.
 */
import { auth, escapeHtml } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { routinesApi } from './api.js';
import { colorOf, iconSvg } from './components.js';

/** تحويل الأرقام إلى عربية-هندية */
const ar = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

export async function mount(root) {
  if (!(await auth.require({ redirectTo: '/coach' }))) return;
  await loadStyles(['/features/routines/routines.css']);

  root.innerHTML = `
  <div class="container coach-page">
    <a class="back-link" href="/" data-link>${iconSvg('sunrise', 15)} <span>الرئيسية</span></a>
    <div class="card coach-hero">
      <div>
        <span class="chip chip-brand">✦ المدرب الذكي</span>
        <h1 style="margin-top:10px">تحليل يومك وعاداتك</h1>
        <p style="margin:0" data-hero-sub>يقرأ سجل التزامك الحقيقي، يكتشف الأنماط، ويقترح ما يزيد إنجازك.</p>
      </div>
      <div class="row" style="gap:8px">
        <a class="btn btn-soft" href="/routines" data-link>روتيناتي</a>
        <button class="btn btn-primary" data-refresh>${iconSvg('sparkles', 16)} حلّل من جديد</button>
      </div>
    </div>

    <div data-body>
      <div class="card ai-loading"><div class="orb"></div><span>أحلّل عاداتك…</span></div>
    </div>
  </div>`;

  const body = root.querySelector('[data-body]');
  const refreshBtn = root.querySelector('[data-refresh]');

  async function load() {
    refreshBtn.disabled = true;
    try {
      const res = await routinesApi.coach();
      render(res.data);
    } catch (err) {
      body.innerHTML = `<div class="card ai-loading"><span>تعذّر التحليل: ${escapeHtml(err.message)}</span><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>`;
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    } finally {
      refreshBtn.disabled = false;
    }
  }

  function render(data) {
    const { insights, plan, advice, narrative, engine, systems } = data;
    const i = insights;
    const systemPick = systems?.recommendation || null;
    const systemColor = systemPick ? colorOf(systemPick.color) : null;

    const stats = [
      { label: 'سلسلة حالية', value: i.streak, unit: 'يوم', hot: i.streak > 0 },
      { label: 'أفضل سلسلة', value: i.bestStreak, unit: 'يوم' },
      { label: 'التزام الأسبوع', value: `${ar(i.weekCompletion)}٪`, unit: 'من ١٠٠' },
      { label: 'إنجاز اليوم', value: `${ar(i.today.done)}/${ar(i.today.total)}`, unit: 'روتين' },
    ];

    const perRoutine = i.perRoutine.filter((r) => r.scheduled >= 2).sort((a, b) => b.rate - a.rate);

    body.innerHTML = `
      <div class="dash-grid" style="margin-top:var(--space-5)">
        <section class="stack">
          <div class="card panel-card">
            <div class="panel-head">
              <h2>ملخص التزامك</h2>
              <span class="mini-chip" title="يعمل محليًا بلا إنترنت؛ ويمكن تنشيط تحليل لغوي إضافي بمفتاح مزوّد">
                ${engine === 'hybrid' ? 'تحليل موسّع' : 'تحليل محلي'}
              </span>
            </div>
            <div class="row" style="gap:10px;flex-wrap:wrap">
              ${stats
        .map(
          (s) =>
            `<div class="stat-pill coach-stat" data-hot="${Boolean(s.hot)}">
              <strong>${s.value}</strong>
              <span>${s.label}</span>
              <small>${s.unit}</small>
            </div>`
        )
        .join('')}
            </div>
            ${narrative ? `<div class="narrative">${escapeHtml(narrative)}</div>` : ''}
          </div>

          <div class="card panel-card">
            <div class="panel-head">
              <h2>خطة اليوم المقترحة</h2>
              <span class="mini-chip"><bdi>${ar(plan.summary.done)}/${ar(plan.summary.total)}</bdi> منجز</span>
            </div>
            <p style="margin:0;font-size:.9rem;color:var(--text-soft)">${escapeHtml(plan.headline)}</p>
            ${plan.blocks.length
        ? `<ol class="plan-timeline">${plan.blocks
          .map((b) => {
            const c = colorOf(b.color);
            return `<li style="--accent:${c.hex};--accent-soft:${c.soft}">
                        <span class="t">${b.timeLabel || b.suggestedTime?.label || 'مرن'}</span>
                        <span class="dot"></span>
                        <div class="plan-body"><strong data-done="${b.flag === 'done'}">${escapeHtml(b.title)}</strong>
                        <span class="reason">${escapeHtml(b.reason)}</span></div>
                      </li>`;
          })
          .join('')}</ol>`
        : `<div class="starter"><span class="emoji" aria-hidden="true">🌤️</span><p>لا روتينات مجدولة اليوم — استمتع بيوم راحة.</p></div>`
      }
            <div class="row plan-footer">
              <span>المتبقي: ${ar(plan.summary.remaining)} • الوقت المقدر: ${ar(plan.summary.minutesLeft)} دقيقة</span>
              ${plan.focus ? `<button class="btn btn-sm btn-soft" data-focus="${plan.focus.id}">ذكّرني بـ «${escapeHtml(plan.focus.title)}»</button>` : ''}
            </div>
          </div>
        </section>

        <section class="stack">
          <div class="card panel-card">
            <div class="panel-head"><h2>نصائح مخصصة</h2></div>
            ${advice
        .map(
          (tip) => `<div class="tip-card" data-severity="${tip.severity}">
                  <span class="tag">${tip.kind === 'motivation' ? '🔥' : tip.kind === 'timing' ? '⏰' : tip.kind === 'structure' ? '🧩' : tip.kind === 'rest' ? '🌙' : tip.kind === 'balance' ? '⚖️' : '✦'}</span>
                  <div><strong>${escapeHtml(tip.title)}</strong><p>${escapeHtml(tip.body)}</p></div>
                </div>`
        )
        .join('') || '<p class="hint-line">لا نصائح جديدة الآن — واصل إنجازك.</p>'}
          </div>

          <div class="card panel-card">
            <div class="panel-head"><h2>أداء الروتينات</h2></div>
            ${perRoutine.length
        ? perRoutine
          .map(
            (r) => `<div class="insight-row">
                        <div class="insight-main">
                          <strong>${escapeHtml(r.title)}</strong>
                          <div class="bar"><i style="width:${Math.max(2, r.rate)}%"></i></div>
                          <small><bdi>${ar(r.done)}/${ar(r.scheduled)}</bdi> مرة</small>
                        </div>
                        <div class="insight-score" data-level="${r.rate >= 70 ? 'good' : r.rate >= 40 ? 'mid' : 'low'}">
                          <strong>${ar(r.rate)}٪</strong>
                          <small>🔥 ${ar(r.streak)}</small>
                        </div>
                      </div>`
          )
          .join('')
        : '<p class="hint-line">تحتاج يومين على الأقل من السجل لكل روتين لتظهر المقارنة.</p>'
      }
          </div>

          <div class="card panel-card">
            <div class="panel-head"><h2>أفضل نافذة وقت</h2></div>
            ${i.bestWindow
        ? `<p style="margin:0">أنت تنجح أكثر في <strong>${escapeHtml(i.bestWindow.key)}</strong> بنسبة <strong>${ar(i.bestWindow.rate)}٪</strong>. ضع أهم روتيناتك هناك.</p>
                   ${i.weakestDay ? `<p class="hint-line">أضعف يوم: ${escapeHtml(i.weakestDay.name || '')} (${ar(i.weakestDay.rate)}٪) — اجعله أخف أو يوم راحة مقصود.</p>` : ''}`
        : '<p class="hint-line">أضف أوقاتًا لروتيناتك ليحدّد المدرب أفضل نافذة لك.</p>'
      }
          </div>

          ${systemPick
        ? `<div class="card panel-card system-pick" style="--accent:${systemColor.hex};--accent-soft:${systemColor.soft}">
              <div class="panel-head">
                <h2>نظام مقترح لك</h2>
                <span class="mini-chip accent">${ar(systemPick.score)}٪ توافق</span>
              </div>
              <div class="system-pick-head">
                <span class="system-ico">${iconSvg(systemPick.icon, 20)}</span>
                <div><strong>${escapeHtml(systemPick.name)}</strong>
                <small>${ar(systemPick.applied?.count || 0)} من ${ar(systemPick.routineCount)} روتين مفعّل</small></div>
              </div>
              <p class="system-headline" style="margin:0">${escapeHtml(systemPick.headline)}</p>
              <a class="btn btn-sm btn-soft btn-block" href="/routines" data-link>${iconSvg('leaf', 15)} استعرض الأنظمة الخمسة</a>
            </div>`
        : ''
      }
        </section>
      </div>`;

    body.querySelector('[data-focus]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'جارٍ…';
      try {
        const { routinesApi } = await import('./api.js');
        const res = await routinesApi.nudge(btn.dataset.focus);
        btn.textContent = res.data.sent ? 'أُرسل التذكير ✓' : 'لا شيء لتذكيرك به';
      } catch {
        btn.disabled = false;
        btn.textContent = 'ذكّرني';
      }
    });
  }

  await load();
  refreshBtn.addEventListener('click', load);
}
