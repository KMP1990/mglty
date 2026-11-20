/**
 * صفحة "روتيناتي" — إدارة كل الروتينات.
 * إنشاء، إنجاز مباشر، تخطّي، تعديل، نسخ، أرشفة، حذف، تصفية، وترتيب،
 * مع ملخص أسبوعي ونقاط حالة لآخر سبعة أيام لكل روتين.
 */
import { auth, toast, escapeHtml, sound } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { routinesApi } from './api.js';
import { iconSvg, colorOf, weekdayBadge, formatTimeLabel, progressRing } from './components.js';
import { levelBadge, evolutionBar } from './evolution.js';
import { sparkle, levelUp, celebrateDay, stagger, pulseIcon } from './motion.js';
import { openRoutineSheet } from './routine-sheet.js';
import { openSystemsSheet } from './systems-sheet.js';
import { openHistorySheet } from './history-sheet.js';
import { openDiagnosticsSheet } from './diagnostics-sheet.js';
import { openMegaSheet } from './mega-sheet.js';
import { bindReminderSettings } from './reminders-ui.js';

const DAY_LABELS = { sun: 'الأحد', mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت' };

const FILTERS = ['all', 'today', 'timed', 'systems', 'done', 'archived'];
const initialFilter = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('filter') : null;

const state = {
  filter: FILTERS.includes(initialFilter) ? initialFilter : 'all',
  sort: 'default',
  search: '',
  focus: null,
  routines: [],
  stats: null,
  loading: true,
};

// نمرّر المستخدم من الإشعار إلى روتينه مرة واحدة فقط بعد التحميل، دون فتح نافذة أو إنجاز تلقائي.
let focusScrollPending = false;

const ar = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const WEEK_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_SHORT = { sun: 'أحد', mon: 'اثن', tue: 'ثلا', wed: 'أرب', thu: 'خمي', fri: 'جمع', sat: 'سبت' };
const dayName = (date) => {
  try {
    const index = new Date(`${date}T12:00:00Z`).getUTCDay();
    return DAY_SHORT[WEEK_KEYS[index]] || '';
  } catch {
    return '';
  }
};

export async function mount(root) {
  if (!(await auth.require({ redirectTo: '/routines' }))) return;
  await loadStyles(['/features/routines/routines.css']);

  // كل تنقل يحمل ?filter= أو ?focus= يُحدّث الحالة (الوحدات تبقى محمّلة بين التنقلات).
  const params = new URLSearchParams(window.location.search);
  const focus = params.get('focus');
  state.focus = focus && /^[a-z0-9-]{8,64}$/i.test(focus) ? focus : null;
  state.filter = FILTERS.includes(params.get('filter')) ? params.get('filter') : 'all';
  state.search = '';
  focusScrollPending = Boolean(state.focus);

  root.innerHTML = `
  <div class="container routines-page">
    <a class="back-link" href="/" data-link>${iconSvg('sunrise', 15)} <span>الرئيسية</span></a>

    <div class="routines-toolbar">
      <div>
        <h1>روتيناتي</h1>
        <p style="margin:0" data-summary>…</p>
      </div>
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button class="btn btn-soft" data-systems>${iconSvg('leaf', 16)} أنظمة جاهزة</button>
        <button class="btn btn-ghost" data-history>${iconSvg('book', 15)} سجلي</button>
        <button class="btn btn-soft" data-mega>${iconSvg('sparkles', 16)} مركز القيادة</button>
        <button class="btn btn-ghost" data-diagnostics title="فحص النظام والإشعارات">🩺</button>
        <a class="btn btn-soft" href="/coach" data-link>${iconSvg('sparkles', 16)} المدرب</a>
        <button class="btn btn-primary" data-add>+ روتين جديد</button>
      </div>
    </div>

    <div class="routines-stats" data-stats aria-label="ملخص الروتينات"></div>

    <div class="dash-grid">
      <section class="card panel-card routines-main">
        <div class="panel-head">
          <h2>كل الروتينات <span class="count" data-count>٠</span></h2>
        </div>

        <div class="routines-controls">
          <label class="routines-search">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="input" data-search placeholder="ابحث في روتيناتك…" maxlength="80" />
          </label>
          <div class="filters" role="tablist" aria-label="تصفية الروتينات">
            <button role="tab" data-filter="all" aria-selected="true">الكل</button>
            <button role="tab" data-filter="today" aria-selected="false">اليوم</button>
            <button role="tab" data-filter="timed" aria-selected="false">بمواعيد</button>
            <button role="tab" data-filter="systems" aria-selected="false">أنظمة</button>
            <button role="tab" data-filter="done" aria-selected="false">منجز اليوم</button>
            <button role="tab" data-filter="archived" aria-selected="false">المؤرشفة</button>
          </div>
          <select class="input routines-sort" data-sort aria-label="ترتيب الروتينات">
            <option value="default">الترتيب الافتراضي</option>
            <option value="time">حسب الوقت</option>
            <option value="streak">الأقوى سلسلة</option>
            <option value="name">أبجديًا</option>
          </select>
        </div>

        <div class="done-banner" data-done-banner hidden></div>
        <ul class="routine-cards" data-cards><li class="skeleton" style="height:170px"></li><li class="skeleton" style="height:170px"></li></ul>
      </section>

      <div class="stack">
        <section class="card panel-card" data-week>
          <div class="panel-head"><h2>هذا الأسبوع</h2></div>
          <div data-week-body><div class="skeleton" style="height:150px"></div></div>
        </section>

        <section class="card panel-card evolution-panel" data-evolution>
          <div class="panel-head"><h2>تطورك</h2><span class="mini-chip" data-evo-level>…</span></div>
          <div data-evo-body><div class="skeleton" style="height:90px"></div></div>
        </section>

        <section class="card panel-card systems-teaser">
          <div class="panel-head"><h2>أنظمة روتين جاهزة</h2><span class="mini-chip">٥</span></div>
          <p class="hint-line">خمسة أنظمة متكاملة: تركيز، طاقة، هدوء، بناء، وتوازن. أضف ما يناسب مرحلتك بدفعة واحدة.</p>
          <button class="btn btn-sm btn-soft btn-block" data-open-systems>${iconSvg('leaf', 15)} استعرض الأنظمة</button>
        </section>

        <section class="card panel-card" data-suggestions>
          <div class="panel-head"><h2>اقتراحات سريعة</h2><span class="mini-chip">✦</span></div>
          <div class="suggest-list" data-suggestions-list><div class="skeleton" style="height:64px"></div></div>
        </section>

        <section class="card panel-card">
          <div class="panel-head"><h2>التذكير</h2></div>
          <div data-reminders><div class="skeleton" style="height:200px"></div></div>
        </section>
      </div>
    </div>
  </div>`;

  const el = {
    cards: root.querySelector('[data-cards]'),
    count: root.querySelector('[data-count]'),
    summary: root.querySelector('[data-summary]'),
    stats: root.querySelector('[data-stats]'),
    weekBody: root.querySelector('[data-week-body]'),
    suggestions: root.querySelector('[data-suggestions-list]'),
    search: root.querySelector('[data-search]'),
    sort: root.querySelector('[data-sort]'),
    doneBanner: root.querySelector('[data-done-banner]'),
    evoBody: root.querySelector('[data-evo-body]'),
    evoLevel: root.querySelector('[data-evo-level]'),
  };

  let todayKey = '';

  async function load() {
    try {
      const res = await routinesApi.list({ archived: true });
      state.routines = res.data.routines;
      for (const routine of state.routines) {
        if (routine.status === undefined) routine.status = routine.week?.find((d) => d.isToday)?.status || null;
      }
      state.stats = res.data;
      todayKey = res.data.today;
      state.loading = false;
      render();
      loadSuggestions();
    } catch (err) {
      state.loading = false;
      el.cards.innerHTML = `<li class="starter"><span class="emoji">📡</span><strong>تعذّر تحميل روتيناتك</strong><p>${escapeHtml(err.message)}</p><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></li>`;
      el.cards.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  function activeRoutines() {
    return state.routines.filter((r) => !r.archivedAt);
  }

  /** حالة اليوم: من الحقل المباشر أو من نقطة الأسبوع */
  const statusOf = (routine) => routine.status || routine.week?.find((d) => d.isToday)?.status || null;
  const todayIds = () => new Set((state.stats?.todayItems || []).map((r) => r.id));
  const isDoneToday = (routine) => !routine.archivedAt && statusOf(routine) === 'done' && todayIds().has(routine.id);
  const isDoneAnyDay = (routine) => !routine.archivedAt && statusOf(routine) === 'done';

  function filtered() {
    const term = state.search.trim().toLowerCase();
    let list = state.routines;
    if (state.focus) list = list.filter((r) => !r.archivedAt);
    else if (state.filter === 'archived') list = list.filter((r) => r.archivedAt);
    else if (state.filter === 'today') list = list.filter((r) => !r.archivedAt && r.week?.find((d) => d.isToday)?.scheduled);
    else if (state.filter === 'timed') list = list.filter((r) => !r.archivedAt && r.time);
    else if (state.filter === 'systems') list = list.filter((r) => !r.archivedAt && r.systemId);
    else if (state.filter === 'done') list = list.filter(isDoneToday);
    // الافتراضي: الروتين المنجز يختفي من قائمة الانتظار ويُحفظ في سجلك
    else list = list.filter((r) => !isDoneAnyDay(r));

    if (term) list = list.filter((r) => `${r.title} ${r.note || ''}`.toLowerCase().includes(term));
    const sorted = [...list];
    if (state.sort === 'time') sorted.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
    else if (state.sort === 'streak') sorted.sort((a, b) => (b.streak || 0) - (a.streak || 0));
    else if (state.sort === 'name') sorted.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    return sorted;
  }

  function render() {
    const s = state.stats;
    if (!s) return;
    const active = activeRoutines();
    el.count.textContent = ar(filtered().length);
    el.summary.textContent = active.length
      ? `${ar(active.length)} روتين • اليوم ${ar(s.progress.done)} من ${ar(s.progress.total)} • سلسلة ${ar(s.streak)} ${s.streak === 1 ? 'يوم' : 'أيام'}`
      : 'لم تُضف روتينات بعد — ابدأ بروتين واحد صغير.';

    el.stats.innerHTML = [
      { label: 'سلسلة حالية', value: ar(s.streak), suffix: s.streak === 1 ? 'يوم' : 'أيام', hot: s.streak > 0, icon: '🔥' },
      { label: 'أفضل سلسلة', value: ar(s.bestStreak), suffix: 'يوم', icon: '🏆' },
      { label: 'التزام الأسبوع', value: `${ar(s.weekCompletion)}٪`, suffix: 'من ١٠٠', icon: '📈' },
      { label: 'إنجاز اليوم', value: `${ar(s.progress.done)}/${ar(s.progress.total)}`, suffix: 'روتين', icon: '✅' },
    ]
      .map(
        (item) => `<div class="routine-stat" data-hot="${Boolean(item.hot)}">
          <span class="routine-stat-ico" aria-hidden="true">${item.icon}</span>
          <div><strong>${item.value}</strong><span>${item.label}</span></div>
          <small>${item.suffix}</small>
        </div>`
      )
      .join('');

    renderDoneBanner();
    renderEvolution();
    renderCards();
    renderWeek();
  }

  /** شريط يذكّر بما أُنجز اليوم ويسمح بالعودة إليه في سجلك */
  function renderDoneBanner() {
    if (!el.doneBanner) return;
    const done = activeRoutines().filter(isDoneToday);
    if (!done.length) {
      el.doneBanner.hidden = true;
      el.doneBanner.innerHTML = '';
      return;
    }
    el.doneBanner.hidden = false;
    el.doneBanner.innerHTML = `<span class="done-banner-ico" aria-hidden="true">✓</span>
      <span>أنجزت ${ar(done.length)} اليوم${state.stats.progress.total ? ` من ${ar(state.stats.progress.total)}` : ''} — محفوظة في سجلك.</span>
      <button class="btn btn-sm btn-soft" data-view-done>عرض المنجز</button>`;
  }

  function renderEvolution() {
    const evo = state.stats?.evolution;
    if (!el.evoBody) return;
    if (!evo) {
      el.evoBody.innerHTML = '<p class="hint-line">أنجز روتينك الأول لتبدأ رحلة التطور.</p>';
      return;
    }
    if (el.evoLevel) el.evoLevel.textContent = `${evo.stageEmoji || '🌱'} ${evo.stageName || 'بذرة'}`;
    el.evoBody.innerHTML = `
      <div class="evo-head">
        <span class="evo-emoji-big" aria-hidden="true">${evo.stageEmoji || '🌱'}</span>
        <div><strong>المستوى ${ar(evo.level)}</strong><span>${ar(evo.totalXp)} XP • ${ar(evo.totalDone)} إنجاز</span></div>
      </div>
      <div class="evolution-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${evo.percent}"><i style="width:${evo.percent}%"></i></div>
      <p class="hint-line" style="margin:8px 0 0">${evo.top?.length ? `الأقوى: «${escapeHtml(evo.top[0].title)}» — المستوى ${ar(evo.top[0].level)}` : 'أضف روتينًا لتظهر تفاصيل تطورك.'}</p>`;
  }

  function renderCards() {
    const list = filtered();
    if (!list.length) {
      const archived = state.filter === 'archived';
      el.cards.innerHTML = `<li class="starter">
        <span class="emoji" aria-hidden="true">${archived ? '🗄️' : state.routines.length ? '🔎' : '🌱'}</span>
        <strong>${archived ? 'لا روتينات مؤرشفة' : state.routines.length ? 'لا نتائج لهذا التصنيف' : 'لا روتينات بعد'}</strong>
        <p>${archived ? 'الروتينات التي تؤرشفها تظهر هنا ويمكن استعادتها.' : state.routines.length ? 'جرّب تصنيفًا أو كلمة بحث أخرى.' : 'أضف روتينًا واحدًا بوقت ثابت — هذا أنجح بداية.'}</p>
        ${archived ? '' : '<button class="btn btn-primary btn-sm" data-add-inline>أضف روتينًا</button>'}
      </li>`;
      el.cards.querySelector('[data-add-inline]')?.addEventListener('click', () => open(null));
      return;
    }

    el.cards.innerHTML = list.map(cardHtml).join('');
    stagger(el.cards);
    if (state.focus && focusScrollPending) {
      focusScrollPending = false;
      const target = el.cards.querySelector(`[data-id="${CSS.escape(state.focus)}"]`);
      if (!target) state.focus = null;
      else requestAnimationFrame(() => {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.focus?.({ preventScroll: true });
      });
    }
  }

  function cardHtml(routine) {
    const c = colorOf(routine.color);
    const archived = Boolean(routine.archivedAt);
    const status = statusOf(routine);
    const week = routine.week || [];
    const doneToday = status === 'done';
    const skippedToday = status === 'skipped';
    return `<li class="routine-card-item${state.focus === routine.id ? ' is-focused' : ''}" data-id="${escapeHtml(routine.id)}" data-status="${status || ''}" data-archived="${archived}" ${state.focus === routine.id ? 'tabindex="0"' : ''}
        style="--accent:${c.hex};--accent-soft:${c.soft}">
      <header>
        <span class="todo-ico">${iconSvg(routine.icon, 20)}</span>
        <div style="min-width:0;flex:1">
          <h3>${escapeHtml(routine.title)}</h3>
          ${routine.note ? `<p class="note">${escapeHtml(routine.note)}</p>` : '<p class="note muted">بدون ملاحظة</p>'}
        </div>
        ${archived ? '<span class="mini-chip">مؤرشف</span>' : routine.streak > 1 ? `<span class="mini-chip accent" title="أيام متتالية">🔥 ${ar(routine.streak)}</span>` : ''}
      </header>

      <div class="routine-meta">
        ${routine.systemName ? `<span class="mini-chip system" title="من نظام جاهز">${escapeHtml(routine.systemName)}</span>` : ''}
        <span class="mini-chip accent">${routine.time ? formatTimeLabel(routine.time) : '٢٤ ساعة'}</span>
        <span class="mini-chip">${routine.duration ? `<bdi>${ar(routine.duration)}</bdi> دقيقة` : 'بلا مدة'}</span>
        <span class="mini-chip">${escapeHtml(weekdayBadge(routine.days, DAY_LABELS))}</span>
        ${routine.anchor ? `<span class="mini-chip" title="محفّز البدء">⚓ ${escapeHtml(routine.anchor)}</span>` : ''}
      </div>

      ${!archived && routine.progress ? `<div class="routine-evolution">${levelBadge(routine.progress)}${evolutionBar(routine.progress, { compact: true })}</div>` : ''}

      ${!archived && routine.steps?.length ? `<details class="routine-steps">
        <summary>خطوات صغيرة <b>${ar(routine.steps.length)}</b></summary>
        <ol>${routine.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
      </details>` : ''}

      ${archived ? '' : `<div class="routine-week" aria-label="حالة الأيام السبعة الأخيرة">
        ${week
          .map(
            (day) => `<span class="week-dot" data-state="${day.status || (day.scheduled ? 'pending' : 'off')}" title="${escapeHtml(day.date)}${day.status === 'done' ? ' — منجز' : day.status === 'skipped' ? ' — متخطّى' : day.scheduled ? ' — لم يُسجّل' : ' — غير مجدول'}">
              <i>${dayName(day.date)}</i><b>${day.status === 'done' ? '✓' : day.status === 'skipped' ? '↷' : day.scheduled ? '·' : ''}</b>
            </span>`
          )
          .join('')}
      </div>`}

      <footer class="routine-card-actions">
        ${
          archived
            ? `<button class="btn btn-sm btn-soft" data-restore>استعادة</button>
               <button class="icon-btn" data-delete title="حذف نهائي" aria-label="حذف">🗑</button>`
            : `${doneToday
                ? `<span class="done-lock" title="الإنجاز نهائي ويُحفظ في سجلك">✓ منجز اليوم</span>`
                : `<button class="btn btn-sm btn-primary" data-toggle aria-pressed="false" title="تسجيل إنجاز اليوم">أنجزته</button>
                   <button class="icon-btn" data-skip title="${skippedToday ? 'إلغاء التخطّي' : 'تخطّي اليوم'}" aria-label="تخطّي اليوم">↷</button>`}
               <button class="icon-btn" data-edit title="تعديل" aria-label="تعديل">✎</button>
               <details class="routine-menu">
                 <summary class="icon-btn" title="خيارات أكثر" aria-label="خيارات أكثر">⋯</summary>
                 <div class="routine-menu-panel">
                   <button type="button" data-remind>${iconSvg('sparkles', 14)} تذكير فوري</button>
                   <button type="button" data-duplicate>⧉ نسخ الروتين</button>
                   <button type="button" data-archive>🗄 أرشفة</button>
                   <button type="button" data-delete class="danger">🗑 حذف</button>
                 </div>
               </details>`
        }
      </footer>
    </li>`;
  }

  function currentWeek(history) {
    if (!history.length) return [];
    const today = history.find((day) => day.isToday) || history[history.length - 1];
    const base = new Date(`${today.date}T12:00:00Z`);
    if (Number.isNaN(base.getTime())) return history;
    const start = new Date(base);
    start.setUTCDate(base.getUTCDate() - base.getUTCDay());
    const byDate = new Map(history.map((day) => [day.date, day]));
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + index);
      const key = date.toISOString().slice(0, 10);
      return byDate.get(key) || { date: key, done: 0, total: 0, percent: 0, scheduled: false, isToday: false };
    });
  }

  function renderWeek() {
    const s = state.stats;
    if (!s) return;
    const history = currentWeek(s.history || []);
    el.weekBody.innerHTML = `
      <div class="week-summary">
        <div class="week-ring">
          ${progressRing(s.weekCompletion, 104, 9)}
          <div class="week-ring-value"><strong>${ar(s.weekCompletion)}٪</strong><span>هذا الأسبوع</span></div>
        </div>
        <div class="week-facts">
          <div class="week-fact"><span>سلسلة حالية</span><strong>${ar(s.streak)} ${s.streak === 1 ? 'يوم' : 'أيام'}</strong></div>
          <div class="week-fact"><span>أفضل سلسلة</span><strong>${ar(s.bestStreak)} ${s.bestStreak === 1 ? 'يوم' : 'أيام'}</strong></div>
          <div class="week-fact"><span>إنجاز اليوم</span><strong><bdi>${ar(s.progress.done)}/${ar(s.progress.total)}</bdi></strong></div>
        </div>
      </div>
      <div class="week-heat" aria-label="نسبة الإنجاز في أيام هذا الأسبوع">
        ${history
          .map(
            (day) => `<div class="heat-col" data-today="${Boolean(day.isToday)}" title="${escapeHtml(day.date)} — ${ar(day.done)}/${ar(day.total)}">
              <div class="heat-track"><i style="height:${Math.max(day.total ? 6 : 2, day.percent)}%"></i></div>
              <span>${dayName(day.date)}</span>
            </div>`
          )
          .join('')}
      </div>
      <a class="btn btn-sm btn-soft btn-block" href="/coach" data-link style="margin-top:12px">${iconSvg('sparkles', 15)} تحليل المدرب الذكي</a>`;
  }

  async function loadSuggestions() {
    try {
      const res = await routinesApi.suggestions();
      const list = res.data.suggestions.slice(0, 3);
      if (!list.length) {
        el.suggestions.innerHTML = '<p class="suggest-empty">لا اقتراحات إضافية الآن — قائمتك جيدة كما هي.</p>';
        return;
      }
      el.suggestions.innerHTML = list
        .map((s) => {
          const c = colorOf(s.color);
          return `<div class="suggest" style="--accent:${c.hex};--accent-soft:${c.soft}">
            <span class="suggest-ico">${iconSvg(s.icon, 16)}</span>
            <div class="suggest-body"><strong>${escapeHtml(s.title)}</strong><p class="why">${escapeHtml(s.why)}</p></div>
            <button class="btn btn-sm btn-soft suggest-add" data-quick="${escapeHtml(encodeURIComponent(JSON.stringify(s)))}" aria-label="أضف ${escapeHtml(s.title)}">+</button>
          </div>`;
        })
        .join('');
    } catch {
      el.suggestions.innerHTML = '<p class="suggest-empty">تعذّر تحميل الاقتراحات.</p>';
    }
  }

  /* ---------- الأحداث ---------- */
  elsCardClick(el.cards);

  function elsCardClick(container) {
    container.addEventListener('click', async (e) => {
      const card = e.target.closest('[data-id]');
      if (!card) return;
      const id = card.dataset.id;
      const routine = state.routines.find((r) => r.id === id);
      if (!routine) return;
      if (!e.target.closest('summary')) card.querySelector('details[open]')?.removeAttribute('open');

      if (e.target.closest('[data-toggle]')) {
        const currentStatus = statusOf(routine);
        if (currentStatus === 'done') {
          toast.info('الإنجاز نهائي اليوم — محفوظ في سجلك');
          return;
        }
        const next = 'done';
        card.classList.add('is-busy');
        try {
          const res = await routinesApi.setStatus(id, next, todayKey);
          const evolution = res.data.evolution || null;
          Object.assign(state.stats, {
            progress: res.data.progress,
            streak: res.data.streak ?? state.stats.streak,
            bestStreak: res.data.bestStreak ?? state.stats.bestStreak,
            weekCompletion: res.data.weekCompletion ?? state.stats.weekCompletion,
            evolution: res.data.evolutionSummary || state.stats.evolution,
          });
          routine.status = next;
          if (res.data.routine?.progress) routine.progress = res.data.routine.progress;
          const todayDot = routine.week?.find((d) => d.isToday);
          if (todayDot) todayDot.status = next;
          if (next === 'done') {
            sparkle(card);
            pulseIcon(card.querySelector('.todo-ico'));
          }
          const allDone = res.data.progress.total > 0 && res.data.progress.done === res.data.progress.total;
          const leveledUp = Boolean(next === 'done' && evolution?.leveledUp);
          // نُبقي البطاقة لحظة كي تكتمل حركة الإنجاز قبل أن تختفي إلى سجلك
          setTimeout(() => {
            render();
            stagger(el.cards);
            if (leveledUp) {
              sound.play('fanfare');
              levelUp({
                title: routine.title,
                level: routine.progress?.level,
                stage: routine.progress?.stage,
                stageName: routine.progress?.stageName,
              });
              toast.success(`تطور «${routine.title}» إلى المستوى ${ar(routine.progress?.level)} ${routine.progress?.stageEmoji || ''}`, {
                sound: false,
                duration: 5000,
              });
            } else if (next === 'done' && allDone) {
              sound.play('fanfare');
              celebrateDay();
              toast.success('أتممت روتينات اليوم 🎉', { sound: false, duration: 5000 });
            } else if (next === 'done') {
              toast.success('خطوة أُنجزت ✨', { duration: 1800 });
            } else {
              toast.info('أُلغي الإنجاز — عاد الروتين إلى قائمتك', { duration: 1800 });
            }
          }, next === 'done' ? 220 : 0);
        } catch {
          card.classList.remove('is-busy');
        }
        return;
      }

      if (e.target.closest('[data-skip]')) {
        const currentStatus = statusOf(routine);
        const next = currentStatus === 'skipped' ? null : 'skipped';
        try {
          await routinesApi.setStatus(id, next, todayKey);
          toast.info(next ? 'تم تخطّيه اليوم — بلا ذنب' : 'أُعيد للجدول');
          await load();
        } catch { }
        return;
      }
      if (e.target.closest('[data-remind]')) {
        try {
          const res = await routinesApi.nudge(id);
          toast.success(res.data.sent ? 'أرسلنا تذكيرًا لهذا الروتين 🔔' : 'لا شيء ليُذكّر به');
        } catch { }
        return;
      }
      if (e.target.closest('[data-edit]')) return open(routine);
      if (e.target.closest('[data-duplicate]')) {
        try {
          await routinesApi.duplicate(id);
          toast.success('أُضيفت نسخة من الروتين');
          await load();
        } catch { }
        return;
      }
      if (e.target.closest('[data-archive]')) {
        const ok = confirm(`أرشفة «${routine.title}»؟ سيتوقف عن الظهور في اليوم ويمكن استعادته.`);
        if (!ok) return;
        try {
          await routinesApi.setArchived(id, true);
          toast.info('أُرشف الروتين — تجده في تبويب المؤرشفة');
          await load();
        } catch { }
        return;
      }
      if (e.target.closest('[data-restore]')) {
        try {
          await routinesApi.setArchived(id, false);
          toast.success('أُعيد الروتين إلى قائمتك');
          await load();
        } catch { }
        return;
      }
      if (e.target.closest('[data-delete]')) {
        if (!confirm(`حذف «${routine.title}»؟ سيُمسح سجل إنجازه نهائيًا.`)) return;
        try {
          await routinesApi.remove(id);
          toast.info('حُذف الروتين');
          await load();
        } catch { }
      }
    });
  }

  const open = (routine) =>
    openRoutineSheet({
      routine,
      onSaved: () => load(),
    });

  const openSystems = () => openSystemsSheet({ onApplied: () => load() });

  root.querySelector('[data-add]').addEventListener('click', () => open(null));
  root.querySelector('[data-systems]')?.addEventListener('click', openSystems);
  root.querySelector('[data-open-systems]')?.addEventListener('click', openSystems);
  root.querySelector('[data-history]')?.addEventListener('click', () => openHistorySheet());
  root.addEventListener('click', (e) => {
    if (!e.target.closest('[data-view-done]')) return;
    state.filter = 'done';
    state.focus = null;
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === 'done')));
    render();
  });
  root.querySelector('[data-diagnostics]')?.addEventListener('click', () => openDiagnosticsSheet());
  root.querySelector('[data-mega]')?.addEventListener('click', () => openMegaSheet());
  root.querySelectorAll('[data-filter]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      state.focus = null;
      root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      render();
    })
  );
  el.search.addEventListener('input', () => {
    state.search = el.search.value;
    state.focus = null;
    renderCards();
    el.count.textContent = ar(filtered().length);
  });
  el.sort.addEventListener('change', () => {
    state.sort = el.sort.value;
    renderCards();
  });

  el.suggestions.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quick]');
    if (!btn) return;
    const suggestion = JSON.parse(decodeURIComponent(btn.dataset.quick));
    btn.disabled = true;
    try {
      await routinesApi.create({
        title: suggestion.title,
        icon: suggestion.icon,
        color: suggestion.color,
        time: suggestion.time,
        duration: suggestion.duration,
        days: suggestion.days,
      });
      toast.success('أُضيف الروتين المقترح');
      await load();
    } catch {
      btn.disabled = false;
    }
  });

  if (state.filter !== 'all') {
    root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === state.filter)));
  }
  bindReminderSettings(root.querySelector('[data-reminders]'));
  await load();

  return () => {
    /* لا مؤقتات في هذه الصفحة */
  };
}
