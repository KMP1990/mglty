/**
 * الشاشة الرئيسية (ميزة داخلية داخل home).
 * تعرض: تحية + حلقة تقدّم اليوم + إحصاءات (سلسلة/أسبوع) + قائمة روتينات اليوم
 * مع تبويب سريع للإنجاز، وتحليل قصير من المدرب الذكي، وإعدادات التذكير.
 */
import { appStore, api, toast, escapeHtml, auth, sound } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { routinesApi, deviceTimeZone } from '../routines/api.js';
import { iconSvg, colorOf, progressRing, greeting, formatTimeLabel } from '../routines/components.js';
import { openRoutineSheet } from '../routines/routine-sheet.js';
import { levelBadge } from '../routines/evolution.js';
import { sparkle, levelUp, celebrateDay, pulseIcon } from '../routines/motion.js';
import { bindReminderSettings } from '../routines/reminders-ui.js';

/** تحويل الأرقام إلى عربية-هندية (توحيد الشكل في كل الواجهة) */
const arNum = (n) => String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

export async function mountDashboard(root) {
  if (!(await auth.require({ redirectTo: '/' }))) return;
  // الأنماط تُحمَّل مسبقًا من home.js — نضمن وجودها هنا أيضًا عند الاستيراد المباشر
  await loadStyles(['/features/routines/routines.css']);

  root.innerHTML = `<div class="container dash">
    <div class="card dash-hero" data-hero>
      <div class="hero-copy">
        <span class="hero-greet">${greeting()}، ${escapeHtml(appStore.state.user?.name?.split(' ')[0] || '')}</span>
        <p class="headline" data-today-label>جارٍ التحميل…</p>
      </div>
      <div class="hero-ring" data-ring><div class="ring-value"><strong>—</strong><span>إنجاز اليوم</span></div></div>
      <div class="hero-stats" data-stats></div>
    </div>
    <p class="hero-note" data-headline-note></p>

    <div class="dash-grid">
      <!-- في RTL يُعرض العنصر الأول يمينًا: روتينات اليوم أولًا بصريًا -->
      <section class="card panel-card dash-main">
        <div class="panel-head">
          <h2>${iconSvg('sunrise', 18)} روتينات اليوم <span class="count" data-today-count>٠</span></h2>
          <div class="row" style="gap:6px">
            <button class="btn btn-sm btn-ghost" data-nudge title="تذكير بما لم تنجزه اليوم">${iconSvg('sparkles', 15)} ذكّرني</button>
            <button class="btn btn-sm btn-primary" data-add>+ روتين</button>
          </div>
        </div>
        <div data-today-list><div class="skeleton" style="height:72px"></div><div class="skeleton" style="height:72px;margin-top:10px"></div></div>
      </section>

      <div class="stack dash-side">
        <section class="card panel-card">
          <div class="panel-head">
            <h2>${iconSvg('book', 18)} كتبي</h2>
            <a class="btn btn-sm btn-ghost" href="/books" data-link>المكتبة</a>
          </div>
          <div data-books-widget></div>
        </section>

        <section class="card panel-card">
          <div class="coach-callout">
            <span class="ai-dot" aria-hidden="true">✦</span>
            <div>
              <strong>المدرب الذكي</strong>
              <p data-tip>يحلّل التزامك ويقترح أصغر خطوة تنجح بها اليوم.</p>
            </div>
            <a class="btn btn-sm btn-soft" href="/coach" data-link>افتح</a>
          </div>
          <div class="suggest-list" data-suggestions></div>
        </section>

        <section class="card panel-card" data-reminders>
          <div class="panel-head"><h2>${iconSvg('moon', 18)} التذكير</h2></div>
          <div data-reminder-body></div>
        </section>

        <section class="card panel-card">
          <div class="panel-head">
            <h2>روتيناتي <span class="count" data-all-count>٠</span></h2>
            <a class="btn btn-sm btn-ghost" href="/routines" data-link>إدارة الكل</a>
          </div>
          <div data-all-routines></div>
        </section>
      </div>
    </div>
  </div>`;

  const els = {
    ring: root.querySelector('[data-ring]'),
    todayLabel: root.querySelector('[data-today-label]'),
    headlineNote: root.querySelector('[data-headline-note]'),
    stats: root.querySelector('[data-stats]'),
    todayCount: root.querySelector('[data-today-count]'),
    todayList: root.querySelector('[data-today-list]'),
    tip: root.querySelector('[data-tip]'),
    suggestions: root.querySelector('[data-suggestions]'),
    allRoutines: root.querySelector('[data-all-routines]'),
    reminderBody: root.querySelector('[data-reminder-body]'),
    booksWidget: root.querySelector('[data-books-widget]'),
  };

  let board = null;
  let remindersBound = false;

  async function load({ silent = false } = {}) {
    void silent;
    try {
      board = (await routinesApi.today()).data;
      render();
      // الاقتراحات تُحدَّث دائمًا: كانت تُتخطّى في التحديث الصامت فتُعرض
      // اقتراحات لروتينات أضافها المستخدم للتو.
      loadSuggestions();
      loadAllRoutines();
      if (!remindersBound) {
        remindersBound = true;
        bindReminderSettings(els.reminderBody, { compact: true });
      }
      renderBooksWidget();
      if (board.totalRoutines === 0 && !localStorage.getItem('mr:onboarded')) {
        markOnboarded();
      }
    } catch (err) {
      els.todayList.innerHTML = `<div class="starter"><span class="emoji">📡</span><p>تعذّر تحميل روتيناتك: ${escapeHtml(err.message)}</p><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>`;
      els.todayList.querySelector('[data-retry]')?.addEventListener('click', () => load());
    }
  }

  function markOnboarded() {
    try {
      localStorage.setItem('mr:onboarded', '1');
    } catch { }
  }

  /** آخر كتاب مقروء — يُقرأ من localStorage فقط كي تبقى لوحة اليوم سريعة */
  function renderBooksWidget() {
    if (!els.booksWidget) return;
    let last = null;
    try {
      last = JSON.parse(localStorage.getItem('mr:books:last') || 'null');
    } catch {
      last = null;
    }
    if (!last?.id) {
      els.booksWidget.innerHTML = `<div class="dash-books-empty">
        <span aria-hidden="true">📖</span>
        <div><strong>افتح مكتبتك</strong><p>أضف كتابًا واقرأه بصفحات ومساعد يشرح لك.</p></div>
        <a class="btn btn-sm btn-soft" href="/books" data-link>كتبي</a>
      </div>`;
      return;
    }
    const percent = Math.max(0, Math.min(100, Number(last.percent) || 0));
    els.booksWidget.innerHTML = `<div class="dash-book">
      <span class="dash-book-cover" aria-hidden="true">${iconSvg('book', 18)}</span>
      <div class="dash-book-body">
        <strong>${escapeHtml(last.title || 'كتاب')}</strong>
        <p>${escapeHtml(last.chapterTitle || 'متابعة من حيث توقفت')} • ${arNum(percent)}٪</p>
        <div class="dash-book-progress"><i style="width:${percent}%"></i></div>
      </div>
      <a class="btn btn-sm btn-primary" href="/books" data-link>تابع</a>
    </div>`;
  }

  function render() {
    const { progress, streak, bestStreak, weekCompletion, items, plan, tip, weekday, date } = board;

    // حلقة التقدّم — الأرقام عربية-هندية لتطابق بقية الواجهة
    els.ring.innerHTML = `${progressRing(progress.percent)}<div class="ring-value"><strong>${arNum(progress.percent)}٪</strong><span>${progress.total ? `${arNum(progress.done)} من ${arNum(progress.total)}` : 'لا روتينات'}</span></div>`;
    els.ring.setAttribute('aria-label', `أنجزت ${arNum(progress.done)} من ${arNum(progress.total)} روتينًا اليوم`);

    // التاريخ: يُحسب من تاريخ الخادم المحلي (لا من ساعة الجهاز) مع صيغة عربية موحّدة
    const dayLabel = date
      ? new Date(`${date}T12:00:00Z`).toLocaleDateString('ar', {
          day: 'numeric',
          month: 'long',
          timeZone: 'UTC',
        })
      : '';
    els.todayLabel.textContent = `${weekday || ''}${dayLabel ? `، ${dayLabel}` : ''}`.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]).trim();

    // العنوان التحفيزي تحت شريط الهيرو
    els.headlineNote.textContent = plan?.headline || 'خطوة صغيرة اليوم أفضل من خطة كبيرة غدًا.';

    // الإحصاءات
    els.stats.innerHTML = `
      <div class="stat-pill" data-hot="${streak > 0}" title="الأيام المتتالية التي أنجزت فيها روتينًا واحدًا على الأقل">
        <strong>${arNum(streak)}</strong><span>سلسلة الأيام</span>
      </div>
      <div class="stat-pill" title="أطول سلسلة وصلت إليها">
        <strong>${arNum(bestStreak)}</strong><span>أفضل سلسلة</span>
      </div>
      <div class="stat-pill" title="نسبة ما أنجزته من روتينات آخر ٧ أيام (بدون محاسبة اليوم الحالي قبل بدايته)">
        <strong>${arNum(weekCompletion)}٪</strong><span>التزام الأسبوع</span>
      </div>`;

    els.todayCount.textContent = `${arNum(progress.done)}/${arNum(progress.total)}`;

    // القائمة: المنجز يختفي من الانتظار ويُحفظ في «أنجزت اليوم» بلا إلغاء
    if (!items.length) {
      els.todayList.innerHTML = `<div class="starter">
        <span class="starter-ico">${iconSvg('leaf', 30, 1.6)}</span>
        <strong>لا روتينات مجدولة اليوم</strong>
        <p>ابدأ بروتين واحد صغير — صفحة قراءة، كوب ماء، أو خمس دقائق تمدد.</p>
        <button class="btn btn-primary btn-sm" data-add-empty>أضف أول روتين</button>
      </div>`;
      els.todayList.querySelector('[data-add-empty]')?.addEventListener('click', () => openSheet(null));
    } else {
      const pending = items.filter((item) => item.status !== 'done');
      const done = items.filter((item) => item.status === 'done');
      els.todayList.innerHTML = `
        ${pending.length
          ? `<ul class="todo-list">${pending.map(todoHtml).join('')}</ul>`
          : `<div class="starter all-done-starter"><span class="starter-ico">🎉</span><strong>أتممت كل روتينات اليوم</strong><p>كل شيء محفوظ في سجلك، والإنجاز نهائي لهذا اليوم.</p></div>`}
        ${done.length
          ? `<details class="done-today" ${pending.length ? '' : 'open'}>
              <summary><span>✓ أنجزت اليوم</span><b>${arNum(done.length)}</b><small>عرض / تراجع</small></summary>
              <ul class="todo-list todo-list-done">${done.map(todoHtml).join('')}</ul>
            </details>`
          : ''}`;
    }

    // نصيحة الذكاء
    if (tip) {
      els.tip.innerHTML = `<strong style="color:var(--brand-600)">${escapeHtml(tip.title)}</strong><br>${escapeHtml(tip.body)}`;
    }
  }

  function todoHtml(r) {
    const c = colorOf(r.color);
    const late = r.status !== 'done' && r.time && board.nowMinutes > Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3));
    return `<li class="todo" data-id="${escapeHtml(r.id)}" data-status="${r.status || ''}" data-late="${Boolean(late)}"
              style="--accent:${c.hex};--accent-soft:${c.soft}">
      <button class="todo-check" data-toggle aria-label="${r.status === 'done' ? 'تم الإنجاز — نهائي' : 'تم إنجازه'}" aria-pressed="${r.status === 'done'}" ${r.status === 'done' ? 'disabled' : ''}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7"/></svg>
      </button>
      <span class="todo-ico">${iconSvg(r.icon, 20)}</span>
      <div class="todo-body">
        <span class="todo-title">${escapeHtml(r.title)}</span>
        <span class="todo-meta">
          <span>${r.time ? formatTimeLabel(r.time) : '٢٤ ساعة'}</span>
          ${r.duration ? `<span><bdi>${arNum(r.duration)}</bdi> د</span>` : ''}
          ${late ? '<span class="warn">فات وقته</span>' : ''}
          ${r.streak > 1 ? `<span class="streak">🔥 ${arNum(r.streak)}</span>` : ''}
          ${r.progress ? `<span class="todo-evo">${levelBadge(r.progress)}</span>` : ''}
        </span>
      </div>
      <div class="todo-actions">
        <button class="icon-btn" data-remind title="تذكير فوري" aria-label="تذكير فوري">${iconSvg('sparkles', 15)}</button>
        <button class="icon-btn" data-edit title="تعديل الروتين" aria-label="تعديل">${iconSvg('pen', 14)}</button>
        <button class="icon-btn" data-skip title="تخطّي اليوم" aria-label="تخطّي اليوم" style="color:var(--warning)">${iconSvg('moon', 14)}</button>
      </div>
    </li>`;
  }

  // أحداث القائمة
  els.todayList.addEventListener('click', async (e) => {
    const li = e.target.closest('.todo');
    if (!li) return;
    const id = li.dataset.id;
    const routine = board.items.find((r) => r.id === id);

    if (e.target.closest('[data-toggle]')) {
      if (routine.status === 'done') {
        toast.info('الإنجاز نهائي اليوم — محفوظ في سجلك');
        return;
      }
      const next = 'done';
      li.classList.add('is-busy');
      try {
        const res = await routinesApi.setStatus(id, next, board.date);
        const evolution = res.data.evolution || null;
        routine.status = next;
        if (res.data.routine?.progress) routine.progress = res.data.routine.progress;
        // نحدّث كل الإحصاءات من رد الخادم مباشرة
        board.progress = res.data.progress;
        board.streak = res.data.streak ?? board.streak;
        board.bestStreak = res.data.bestStreak ?? board.bestStreak;
        board.weekCompletion = res.data.weekCompletion ?? board.weekCompletion;
        board.evolution = res.data.evolutionSummary || board.evolution;
        board.items = board.items.map((r) => (r.id === id ? { ...r, ...routine } : r));
        if (next === 'done') {
          sparkle(li);
          pulseIcon(li.querySelector('.todo-ico'));
        }
        const allDone = board.progress.total > 0 && board.progress.done === board.progress.total;
        const leveledUp = Boolean(next === 'done' && evolution?.leveledUp);
        setTimeout(() => {
          render();
          if (leveledUp) {
            sound.play('fanfare');
            levelUp({ title: routine.title, level: routine.progress?.level, stage: routine.progress?.stage, stageName: routine.progress?.stageName });
            toast.success(`تطور «${routine.title}» إلى المستوى ${arNum(routine.progress?.level)} ${routine.progress?.stageEmoji || ''}`, { sound: false, duration: 5000 });
          } else if (next === 'done' && allDone) {
            sound.play('fanfare');
            celebrateDay();
            toast.success('أتممت روتينات اليوم 🎉', { sound: false, duration: 5000 });
          } else if (next === 'done') {
            toast.success('خطوة أُنجزت ✨', { duration: 1800 });
          }
          loadSuggestions();
        }, next === 'done' ? 220 : 0);
      } catch {
        li.classList.remove('is-busy');
      }
      return;
    }
    if (e.target.closest('[data-skip]')) {
      li.classList.add('is-busy');
      try {
        const next = routine.status === 'skipped' ? null : 'skipped';
        routine.status = next;
        await routinesApi.setStatus(id, next, board.date);
        await load();
        toast.info(next ? 'تم تخطّيه اليوم — بلا ذنب' : 'أُعيد للجدول');
      } catch {
        li.classList.remove('is-busy');
      }
      return;
    }
    if (e.target.closest('[data-remind]')) {
      try {
        const res = await routinesApi.nudge(id);
        toast.success(res.data.sent ? 'أرسلنا لك تذكيرًا 🔔' : 'لا شيء ليُذكّر به');
      } catch { }
      return;
    }
    if (e.target.closest('[data-edit]')) {
      openSheet(routine);
    }
  });

  // إضافة/تعديل روتين — إعادة تحميل كاملة كي تُصفّى الاقتراحات وتُحدَّث الإحصاءات
  const openSheet = (routine) =>
    openRoutineSheet({
      routine,
      onSaved: () => load(),
    });

  root.querySelector('[data-add]')?.addEventListener('click', () => openSheet(null));
  root.querySelector('[data-nudge]')?.addEventListener('click', async () => {
    try {
      const res = await routinesApi.nudge();
      toast[res.data.sent ? 'success' : 'info'](res.data.sent ? 'أرسلنا تذكيرًا بروتيناتك المتبقية 🔔' : 'لا شيء متبقٍ اليوم 🎉');
    } catch { }
  });

  async function loadSuggestions() {
    try {
      const res = await routinesApi.suggestions();
      const list = res.data.suggestions;
      els.suggestions.innerHTML = list.length
        ? list
            .map((s) => {
              const c = colorOf(s.color);
              return `<div class="suggest" style="--accent:${c.hex};--accent-soft:${c.soft}">
                <span class="suggest-ico">${iconSvg(s.icon, 16)}</span>
                <div class="suggest-body">
                  <strong>${escapeHtml(s.title)}</strong>
                  <p class="why">${escapeHtml(s.why)}</p>
                </div>
                <button class="btn btn-sm btn-soft suggest-add" data-quick="${escapeHtml(encodeURIComponent(JSON.stringify(s)))}" aria-label="أضف ${escapeHtml(s.title)}">
                  <span aria-hidden="true">+</span>
                </button>
              </div>`;
            })
            .join('')
        : '<p class="suggest-empty">لا اقتراحات إضافية الآن — قائمتك جيدة كما هي.</p>';
    } catch {
      els.suggestions.innerHTML = '';
    }
  }

  els.suggestions.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-quick]');
    if (!btn) return;
    const s = JSON.parse(decodeURIComponent(btn.dataset.quick));
    btn.disabled = true;
    try {
      await routinesApi.create({ title: s.title, icon: s.icon, color: s.color, time: s.time, duration: s.duration, days: s.days });
      toast.success('أُضيف الروتين المقترح');
      load();
    } catch {
      btn.disabled = false;
    }
  });

  async function loadAllRoutines() {
    try {
      const res = await routinesApi.list();
      const routines = res.data.routines;
      const countEl = root.querySelector('[data-all-count]');
      if (countEl) countEl.textContent = arNum(routines.length);

      if (!routines.length) {
        els.allRoutines.innerHTML = '<p style="margin:0;font-size:.85rem;color:var(--text-muted)">لا روتينات بعد — أضف أول واحد.</p>';
        return;
      }

      // نعرض كل الروتينات في سطر واحد لكل روتين، مع الوقت أو التكرار
      els.allRoutines.innerHTML = `<ul class="list-flat">${routines
        .map((r) => {
          const c = colorOf(r.color);
          return `<li style="--accent:${c.hex};--accent-soft:${c.soft}">
            <span class="routine-line">
              <span class="routine-ico">${iconSvg(r.icon, 14)}</span>
              <span class="routine-name">${escapeHtml(r.title)}</span>
            </span>
            <small>${r.time ? formatTimeLabel(r.time) : '٢٤ ساعة'}</small>
          </li>`;
        })
        .join('')}</ul>`;
    } catch {}
  }

  await load();

  // تحديث تلقائي كل دقيقة (تغيّر "فات وقته") وحين يعود التبويب للنشاط
  const timer = setInterval(() => {
    if (document.body.dataset.route !== 'home') return;
    load({ silent: true });
  }, 60_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.body.dataset.route === 'home') load({ silent: true });
  });
  document.addEventListener('mr:notification', (e) => {
    if (document.body.dataset.route === 'home' && e.detail?.type === 'reminder') load({ silent: true });
  });

  // تنظيف عند مغادرة الصفحة
  const observer = new MutationObserver(() => {
    if (!document.contains(root)) {
      clearInterval(timer);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
  void api;
  void deviceTimeZone;
}
