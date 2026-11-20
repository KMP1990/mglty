/**
 * مركز قيادة الروتين — واجهة واحدة لأكثر من ١٢٠ قدرة:
 * تحليلات، مهمة اليوم، تحديات وشارات، صحة العادات، أهداف، مفكرة،
 * تركيز، مراجعات، مخطط ذكي، قوالب، وتصدير/استيراد.
 */
import { escapeHtml, toast } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { routinesApi } from './api.js';
import { ar } from './evolution.js';

const TABS = [
  { id: 'command', label: 'القيادة', icon: '🧭' },
  { id: 'analytics', label: 'التحليلات', icon: '📊' },
  { id: 'challenges', label: 'التحديات', icon: '🏆' },
  { id: 'habits', label: 'العادات', icon: '🌱' },
  { id: 'goals', label: 'الأهداف', icon: '🎯' },
  { id: 'tools', label: 'الأدوات', icon: '🧰' },
];

const GOAL_TYPES = [
  ['done', 'عدد الإنجازات'],
  ['streak', 'السلسلة الحالية'],
  ['perfect', 'الأيام المثالية'],
  ['active', 'الأيام النشطة'],
  ['minutes', 'دقائق الالتزام'],
  ['level', 'المستوى'],
  ['journal', 'التدوينات'],
  ['focus', 'جلسات التركيز'],
  ['review', 'المراجعات'],
  ['manual', 'تقدّم يدوي'],
];

const riskLabels = { low: 'مستقر', medium: 'انتبه', high: 'متعثر' };
const loadLabels = { light: 'خفيف', balanced: 'متوازن', busy: 'مزدحم', overload: 'محمّل جدًا' };
const burnoutLabels = { low: 'صحي', medium: 'تحت المراقبة', high: 'مرتفع' };

const bar = (percent, tone = '') =>
  `<div class="mega-bar ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0, Math.min(100, Number(percent) || 0))}"><i style="width:${Math.max(0, Math.min(100, Number(percent) || 0))}%"></i></div>`;

const stat = (label, value, hint = '', tone = '') =>
  `<div class="mega-kpi ${tone}"><strong>${value}</strong><span>${label}</span>${hint ? `<small>${hint}</small>` : ''}</div>`;

const money = (value) => ar(Math.max(0, Math.round(Number(value) || 0)));

function shell() {
  return `
    <div class="sheet mega-sheet" role="dialog" aria-modal="true" aria-labelledby="mega-title">
      <div class="sheet-head mega-head">
        <div>
          <span class="mini-chip accent">${data?.catalog?.total ? `${ar(data.catalog.total)} قدرة` : 'مركز القيادة'}</span>
          <h2 id="mega-title">مركز قيادة الروتين</h2>
          <p class="sheet-sub">لوحة واحدة تقرأ سجلك، تختار خطوتك التالية، وتحمي استمرارك.</p>
        </div>
        <button class="icon-btn" data-close aria-label="إغلاق">✕</button>
      </div>
      <div class="mega-tabs" role="tablist" aria-label="أقسام مركز القيادة">
        ${TABS.map((tab) => `<button class="mega-tab" role="tab" data-tab="${tab.id}" aria-selected="${tab.id === currentTab}"><span aria-hidden="true">${tab.icon}</span>${tab.label}</button>`).join('')}
      </div>
      <div class="mega-body" data-body></div>
    </div>`;
}

function renderCommand() {
  const s = data.summary;
  const m = s.momentum;
  return `
    <section class="mega-hero">
      <div class="mega-hero-main">
        <span class="mega-stage">${escapeHtml(s.stageEmoji || '🌱')}</span>
        <div>
          <p class="mega-eyebrow">مستواك الكلي</p>
          <h3>المستوى ${ar(s.level)} · ${escapeHtml(s.stage || 'بذرة')}</h3>
          <p>${ar(s.xp)} XP · ${ar(s.points)} نقطة · ${ar(s.earnedBadges)} من ${ar(s.totalBadges)} شارة</p>
          ${bar(s.xpPercent)}
        </div>
      </div>
      <div class="mega-hero-side">
        <span class="mega-pill ${m.direction}">${m.direction === 'up' ? '↑' : m.direction === 'down' ? '↓' : '→'} ${escapeHtml(m.label)}</span>
        <strong class="mega-delta">${m.delta > 0 ? '+' : ''}${ar(m.delta)}٪</strong>
        <small>هذا الأسبوع مقابل السابق</small>
      </div>
    </section>

    <div class="mega-kpis">
      ${stat('سلسلة حالية', `${ar(s.streak)} يوم`, `أفضل: ${ar(s.bestStreak)}`)}
      ${stat('التزام الأسبوع', `${ar(s.weekRate)}٪`, `٣٠ يومًا: ${ar(s.rate30)}٪`, s.weekRate >= 70 ? 'good' : 'warn')}
      ${stat('إجمالي الإنجاز', ar(s.totalDone), `${ar(s.activeDays)} يوم نشط`)}
      ${stat('أيام مثالية', ar(s.perfectDays), 'كل الروتينات أُنجزت')}
      ${stat('دقائق العناية', ar(s.totalMinutes), 'وقت استثمرته في نفسك')}
      ${stat('الحمل اليوم', `${ar(data.load.count)} روتين`, `${ar(data.load.minutes)} دقيقة · ${loadLabels[data.load.status] || ''}`, data.load.status === 'overload' ? 'bad' : '')}
      ${stat('خطر الإرهاق', burnoutLabels[data.burnout.level] || '—', `${ar(data.burnout.score)} / ٧`, data.burnout.level === 'high' ? 'bad' : data.burnout.level === 'medium' ? 'warn' : 'good')}
      ${stat('توقع المستوى', data.forecast.daysToNextLevel == null ? 'غير متاح' : `${ar(data.forecast.daysToNextLevel)} يوم`, `بمعدل ${ar(data.forecast.dailyDone)} إنجاز/يوم`)}
    </div>

    <div class="mega-grid-2">
      <article class="mega-card mega-mission">
        <div class="mega-card-head"><h3>مهمة اليوم</h3><span class="mini-chip">${data.today}</span></div>
        ${data.mission?.complete
          ? `<div class="mega-empty"><span>🎉</span><strong>أنجزت كل شيء اليوم</strong><p>استرح أو راجع أسبوعك بهدوء.</p></div>`
          : `<div class="mega-mission-main">
              <span class="mega-mission-ico">${escapeHtml(data.mission?.icon || '✨')}</span>
              <div><strong>${escapeHtml(data.mission?.title || '')}</strong><p>${escapeHtml(data.mission?.reason || '')}</p>
              ${data.mission?.time ? `<small>${escapeHtml(data.mission.time)}</small>` : '<small>٢٤ ساعة</small>'}</div>
            </div>
            <button class="btn btn-primary btn-sm" data-mission="${escapeHtml(data.mission?.id || '')}">أنجز المهمة</button>`}
      </article>

      <article class="mega-card">
        <div class="mega-card-head"><h3>أفضل خطوة تالية</h3><span class="mini-chip">ذكي</span></div>
        ${data.nextBestAction
          ? `<p class="mega-strong">${escapeHtml(data.nextBestAction.title)}</p><p class="hint-line">${escapeHtml(data.nextBestAction.detail)}</p>
             <button class="btn btn-sm btn-soft" data-plan-action="${escapeHtml(data.nextBestAction.action || 'schedule')}">${data.nextBestAction.action === 'schedule' ? 'طبّق الجدولة' : 'جرّب الاقتراح'}</button>`
          : '<div class="mega-empty"><span>✅</span><strong>لا اقتراحات عاجلة</strong><p>إيقاعك مستقر — حافظ عليه.</p></div>'}
      </article>
    </div>

    <div class="mega-grid-2">
      <article class="mega-card">
        <div class="mega-card-head"><h3>خطة اليوم الذكية</h3><span class="mini-chip">${ar(data.smartPlan.length)} اقتراح</span></div>
        ${data.smartPlan.length
          ? `<ul class="mega-list">${data.smartPlan.slice(0, 4).map((item) => `<li><span class="mega-dot ${escapeHtml(item.tone || '')}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></li>`).join('')}</ul>`
          : '<p class="hint-line">لا تعديلات مطلوبة اليوم — خطتك متوازنة.</p>'}
      </article>
      <article class="mega-card">
        <div class="mega-card-head"><h3>المتأخر اليوم</h3><span class="mini-chip">${ar(data.load.overdue)}</span></div>
        ${data.load.overdueItems.length
          ? `<ul class="mega-list">${data.load.overdueItems.slice(0, 4).map((item) => `<li><span class="mega-dot rose"></span><div><strong>${escapeHtml(item.title)}</strong><small>كان ${escapeHtml(item.time || '')} — يمكنك إنجازه الآن.</small></div></li>`).join('')}</ul>`
          : '<p class="hint-line">لا شيء متأخر. ممتاز.</p>'}
      </article>
    </div>

    <article class="mega-card mega-advice ${escapeHtml(data.burnout.level)}">
      <div class="mega-card-head"><h3>${escapeHtml(data.burnout.label)}</h3><span class="mini-chip">${ar(data.burnout.score)} / ٧</span></div>
      <p>${escapeHtml(data.burnout.advice)}</p>
    </article>
  `;
}

function renderAnalytics() {
  const s = data.summary;
  return `
    <div class="mega-kpis">
      ${stat('الالتزام ٩٠ يومًا', `${ar(s.rate90)}٪`, 'كل الأيام')}
      ${stat('الاستمرارية', `${ar(s.consistency)}٪`, 'أيام نشطة / أيام مجدولة')}
      ${stat('التخطّي', ar(s.totalSkips), 'كلما قلّ كان أفضل', s.totalSkips > s.totalDone * 0.25 ? 'warn' : 'good')}
      ${stat('الزخم', `${s.momentum.delta > 0 ? '+' : ''}${ar(s.momentum.delta)}٪`, s.momentum.label, s.momentum.direction === 'down' ? 'warn' : 'good')}
    </div>

    <article class="mega-card">
      <div class="mega-card-head"><h3>خريطة ٩٠ يومًا</h3><span class="mini-chip">أغمق = إنجاز أعلى</span></div>
      <div class="mega-heat">${data.heatmap.map((day) => `<span class="mega-heat-cell l${day.level}" title="${escapeHtml(day.date)} — ${ar(day.done)}/${ar(day.total)}" aria-label="${escapeHtml(day.date)} ${ar(day.percent)}٪"></span>`).join('')}</div>
      <div class="mega-legend"><span>أقل</span><i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i><span>أكثر</span></div>
    </article>

    <article class="mega-card">
      <div class="mega-card-head"><h3>أداء أيام الأسبوع</h3><span class="mini-chip">آخر ٩٠ يومًا</span></div>
      <div class="mega-bars">${data.weekday.map((day) => `<div class="mega-bar-row"><span>${escapeHtml(day.label)}</span>${bar(day.rate)}<strong>${ar(day.rate)}٪</strong></div>`).join('')}</div>
    </article>

    <div class="mega-grid-2">
      ${breakdownCard('الأولوية', data.breakdowns.priority)}
      ${breakdownCard('الطاقة', data.breakdowns.energy)}
    </div>
    ${breakdownCard('الأنظمة', data.breakdowns.systems)}

    <article class="mega-card">
      <div class="mega-card-head"><h3>أوقات الإنجاز</h3><span class="mini-chip">آخر ٣٠ يومًا</span></div>
      <div class="mega-bars">${data.timeBuckets.map((bucket) => `<div class="mega-bar-row"><span>${escapeHtml(bucket.label)}</span>${bar(bucket.rate)}<strong>${ar(bucket.rate)}٪</strong></div>`).join('')}</div>
    </article>

    <div class="mega-grid-2">
      <article class="mega-card">
        <div class="mega-card-head"><h3>ملخص الشهر</h3><span class="mini-chip">${escapeHtml(data.monthlyRecap.month)}</span></div>
        <div class="mega-mini-stats">
          <span><strong>${ar(data.monthlyRecap.done)}</strong><small>إنجاز</small></span>
          <span><strong>${ar(data.monthlyRecap.activeDays)}</strong><small>يوم نشط</small></span>
          <span><strong>${ar(data.monthlyRecap.perfectDays)}</strong><small>يوم مثالي</small></span>
          <span><strong>${ar(data.monthlyRecap.rate)}٪</strong><small>التزام</small></span>
        </div>
      </article>
      <article class="mega-card">
        <div class="mega-card-head"><h3>روتينات تحتاج تدخلًا</h3><span class="mini-chip">${ar(data.atRisk.length)}</span></div>
        ${data.atRisk.length ? `<ul class="mega-list">${data.atRisk.slice(0, 4).map((item) => `<li><span class="mega-dot ${item.risk === 'high' ? 'rose' : 'honey'}"></span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.suggestion)}</small></div></li>`).join('')}</ul>` : '<p class="hint-line">كل روتيناتك مستقرة.</p>'}
      </article>
    </div>
  `;
}

function breakdownCard(title, rows) {
  return `<article class="mega-card"><div class="mega-card-head"><h3>${escapeHtml(title)}</h3><span class="mini-chip">${ar(rows.length)}</span></div>
    ${rows.length ? `<div class="mega-bars">${rows.map((row) => `<div class="mega-bar-row"><span>${escapeHtml(row.label)}</span>${bar(row.rate)}<strong>${ar(row.rate)}٪</strong></div>`).join('')}</div>` : '<p class="hint-line">لا بيانات كافية بعد.</p>'}
  </article>`;
}

function renderChallenges() {
  return `
    <div class="mega-card-head mega-page-head"><h3>تحدياتك</h3><span class="mini-chip">كل التقدم من سجلك</span></div>
    <div class="mega-challenges">${data.challenges.map((item) => `
      <article class="mega-challenge ${item.claimable ? 'claimable' : ''}">
        <span class="mega-challenge-ico">${item.icon}</span>
        <div class="mega-challenge-main"><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.description)}</p>${bar(item.percent)}</div>
        <div class="mega-challenge-side"><strong>${ar(item.value)}/${ar(item.target)}</strong><small>${escapeHtml(item.unit)}</small>
          ${item.claimable ? `<button class="btn btn-sm btn-primary" data-claim-challenge="${escapeHtml(item.id)}">استلم</button>` : item.claimedAt ? '<span class="mini-chip good">تم</span>' : ''}
        </div>
      </article>`).join('')}</div>
    <div class="mega-card-head mega-page-head"><h3>الشارات</h3><span class="mini-chip">${ar(data.summary.earnedBadges)} / ${ar(data.badges.length)}</span></div>
    <div class="mega-badges">${data.badges.map((badge) => `<article class="mega-badge ${badge.earned ? 'earned' : ''}" title="${escapeHtml(badge.description)}">
      <span class="mega-badge-emoji">${badge.earned ? badge.emoji : '🔒'}</span>
      <strong>${escapeHtml(badge.name)}</strong><small>${escapeHtml(badge.description)}</small>${bar(badge.progress)}
    </article>`).join('')}</div>
  `;
}

function renderHabits() {
  return `
    <div class="mega-card-head mega-page-head"><h3>صحة العادات</h3><span class="mini-chip">آخر ٣٠ يومًا</span></div>
    <div class="mega-habits">${data.health.map((item) => `
      <article class="mega-habit" data-health="${escapeHtml(item.id)}">
        <div class="mega-habit-head"><span class="mega-habit-ico">${escapeHtml(item.icon || '✦')}</span><div><strong>${escapeHtml(item.title)}</strong><small>${item.time ? escapeHtml(item.time) : '٢٤ ساعة'} · ${item.systemName ? escapeHtml(item.systemName) : 'شخصي'}</small></div><span class="mega-risk ${item.risk}">${riskLabels[item.risk] || item.risk}</span></div>
        <div class="mega-habit-stats"><span><b>${ar(item.rate)}٪</b> التزام</span><span><b>${ar(item.streak)}</b> سلسلة</span><span><b>${ar(item.strength)}٪</b> قوة</span></div>
        ${bar(item.strength, item.risk === 'high' ? 'bad' : '')}
        ${item.tags?.length ? `<div class="mega-tags">${item.tags.map((tag) => `<span class="mini-chip">${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
        <div class="mega-habit-actions">
          <button class="icon-btn" data-fav="${escapeHtml(item.id)}" data-fav-state="${item.favorite}" title="${item.favorite ? 'إزالة من المفضلة' : 'إضافة للمفضلة'}">${item.favorite ? '★' : '☆'}</button>
          <button class="btn btn-sm btn-ghost" data-tag="${escapeHtml(item.id)}">وسم</button>
          ${item.pausedUntil ? `<button class="btn btn-sm btn-soft" data-resume="${escapeHtml(item.id)}">استئناف</button>` : `<button class="btn btn-sm btn-ghost" data-pause="${escapeHtml(item.id)}">إيقاف ٧ أيام</button>`}
        </div>
        ${item.ifThen ? `<p class="hint-line">إذا/فسوف: ${escapeHtml(item.ifThen)}</p>` : ''}
        <p class="hint-line">${escapeHtml(item.suggestion)}</p>
      </article>`).join('')}</div>

    <div class="mega-grid-2">
      <article class="mega-card">
        <div class="mega-card-head"><h3>تدوينة اليوم</h3><span class="mini-chip">مفكرة</span></div>
        <form class="mega-form" data-form="journal">
          <textarea class="input" name="note" rows="3" maxlength="800" placeholder="ماذا حدث؟ ما الذي تريد تذكره؟"></textarea>
          <input class="input" name="wins" maxlength="300" placeholder="انتصار صغير اليوم…" />
          <input class="input" name="lesson" maxlength="300" placeholder="درس تعلمته…" />
          <div class="mega-inline"><select class="input" name="mood" aria-label="المزاج"><option value="">المزاج</option><option value="5">😄 ممتاز</option><option value="4">🙂 جيد</option><option value="3">😐 عادي</option><option value="2">😕 منخفض</option><option value="1">😣 صعب</option></select>
          <select class="input" name="energy" aria-label="الطاقة"><option value="">الطاقة</option><option value="5">⚡ عالية</option><option value="4">🔋 جيدة</option><option value="3">🌤️ متوسطة</option><option value="2">🪫 منخفضة</option><option value="1">💤 تعبان</option></select></div>
          <button class="btn btn-primary btn-sm" type="submit">احفظ التدوينة</button>
        </form>
      </article>
      <article class="mega-card">
        <div class="mega-card-head"><h3>جلسة تركيز</h3><span class="mini-chip">${ar(data.focus.reduce((sum, item) => sum + Number(item.minutes || 0), 0))} دقيقة</span></div>
        <form class="mega-form" data-form="focus">
          <select class="input" name="routineId" aria-label="الروتين"><option value="">اختر روتينًا (اختياري)</option>${data.health.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('')}</select>
          <div class="mega-inline"><input class="input" type="number" name="minutes" min="5" max="120" value="${ar(data.settings?.focusMinutes || 25)}" aria-label="دقائق التركيز" /><button class="btn btn-primary btn-sm" type="submit">سجّل الجلسة</button></div>
        </form>
        <p class="hint-line">جلسة واحدة صغيرة أفضل من انتظار المزاج المثالي.</p>
      </article>
    </div>

    <article class="mega-card">
      <div class="mega-card-head"><h3>آخر التدوينات</h3><span class="mini-chip">${ar(data.journal.length)}</span></div>
      ${data.journal.length ? `<ul class="mega-journal">${data.journal.slice(0, 6).map((entry) => `<li><div><time>${escapeHtml(entry.date)}</time><p>${escapeHtml(entry.note || entry.wins || entry.lesson)}</p>${entry.wins && entry.note ? `<small>🏆 ${escapeHtml(entry.wins)}</small>` : ''}</div><button class="icon-btn" data-journal-delete="${escapeHtml(entry.id)}" title="حذف">✕</button></li>`).join('')}</ul>` : '<p class="hint-line">لا تدوينات بعد — سطر واحد يكفي.</p>'}
    </article>
  `;
}

function renderGoals() {
  return `
    <div class="mega-grid-2">
      <article class="mega-card">
        <div class="mega-card-head"><h3>هدف جديد</h3><span class="mini-chip">قابل للقياس</span></div>
        <form class="mega-form" data-form="goal">
          <input class="input" name="title" maxlength="80" placeholder="مثال: ٣٠ إنجازًا هذا الشهر" required />
          <div class="mega-inline"><select class="input" name="type">${GOAL_TYPES.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
          <input class="input" type="number" name="target" min="1" max="100000" value="30" aria-label="الهدف" /></div>
          <div class="mega-inline"><input class="input" type="date" name="deadline" aria-label="الموعد النهائي" /><input class="input" name="reward" maxlength="120" placeholder="مكافأة عند الإتمام" /></div>
          <button class="btn btn-primary btn-sm" type="submit">أضف الهدف</button>
        </form>
      </article>
      <article class="mega-card">
        <div class="mega-card-head"><h3>مراجعة</h3><span class="mini-chip">نمو</span></div>
        <form class="mega-form" data-form="review">
          <select class="input" name="period"><option value="weekly">أسبوعية</option><option value="daily">يومية</option><option value="monthly">شهرية</option><option value="quarterly">ربع سنوية</option></select>
          <input class="input" name="wins" maxlength="500" placeholder="ما الذي نجح؟" />
          <input class="input" name="lessons" maxlength="500" placeholder="ما الذي تعلمته؟" />
          <input class="input" name="next" maxlength="500" placeholder="خطوتك التالية؟" />
          <button class="btn btn-primary btn-sm" type="submit">احفظ المراجعة</button>
        </form>
      </article>
    </div>

    <div class="mega-card-head mega-page-head"><h3>أهدافك</h3><span class="mini-chip">${ar(data.goals.length)}</span></div>
    ${data.goals.length ? `<div class="mega-goals">${data.goals.map((goal) => `<article class="mega-goal ${goal.complete ? 'complete' : ''}">
      <div class="mega-goal-head"><strong>${escapeHtml(goal.title)}</strong><span class="mini-chip">${goal.complete ? '✓ مكتمل' : `${ar(goal.percent)}٪`}</span></div>
      ${bar(goal.percent, goal.complete ? 'good' : '')}
      <p class="hint-line">${ar(goal.value)} من ${ar(goal.target)}${goal.deadline ? ` · حتى ${escapeHtml(goal.deadline)}${goal.daysLeft != null ? ` (${goal.daysLeft >= 0 ? `${ar(goal.daysLeft)} يوم` : 'انتهى'})` : ''}` : ''}</p>
      ${goal.reward ? `<p class="mega-reward">🎁 ${escapeHtml(goal.reward)}</p>` : ''}
      <div class="mega-goal-actions">${goal.complete && !goal.claimed ? `<button class="btn btn-sm btn-primary" data-goal-claim="${escapeHtml(goal.id)}">استلم المكافأة</button>` : goal.claimed ? '<span class="mini-chip good">استلمت المكافأة</span>' : ''}<button class="btn btn-sm btn-ghost" data-goal-delete="${escapeHtml(goal.id)}">حذف</button></div>
    </article>`).join('')}</div>` : '<p class="hint-line">لا أهداف بعد — ابدأ بهدف واحد صغير.</p>'}

    <article class="mega-card">
      <div class="mega-card-head"><h3>آخر المراجعات</h3><span class="mini-chip">${ar(data.reviews.length)}</span></div>
      ${data.reviews.length ? `<ul class="mega-journal">${data.reviews.slice(0, 5).map((review) => `<li><div><time>${escapeHtml(review.date)} · ${escapeHtml(review.period)}</time><p>${escapeHtml(review.wins || review.lessons || review.next)}</p>${review.next && (review.wins || review.lessons) ? `<small>→ ${escapeHtml(review.next)}</small>` : ''}</div></li>`).join('')}</ul>` : '<p class="hint-line">لا مراجعات بعد — أسبوع واحد يكفي لتبدأ.</p>'}
    </article>
  `;
}

function renderTools() {
  const groups = featuresByGroup();
  return `
    <div class="mega-grid-2">
      <article class="mega-card">
        <div class="mega-card-head"><h3>المخطط التلقائي</h3><span class="mini-chip">آمن</span></div>
        <p class="hint-line">يعيد ترتيب الروتينات بلا وقت أو يحل التعارضات. لن يحذف شيئًا.</p>
        <div class="mega-inline"><button class="btn btn-primary btn-sm" data-auto="schedule">جدولة الروتينات</button><button class="btn btn-soft btn-sm" data-auto="balance">حل التعارضات</button><button class="btn btn-ghost btn-sm" data-auto="focus">اختر تركيزًا</button></div>
      </article>
      <article class="mega-card">
        <div class="mega-card-head"><h3>التصدير</h3><span class="mini-chip">بياناتك</span></div>
        <div class="mega-inline"><a class="btn btn-sm btn-soft" href="${routinesApi.exportUrl('json')}" download>JSON</a><a class="btn btn-sm btn-soft" href="${routinesApi.exportUrl('ics')}" download>تقويم ICS</a><a class="btn btn-sm btn-soft" href="${routinesApi.exportUrl('csv')}" download>CSV</a><a class="btn btn-sm btn-soft" href="${routinesApi.exportUrl('md')}" download>Markdown</a></div>
      </article>
    </div>

    <article class="mega-card">
      <div class="mega-card-head"><h3>استيراد روتينات</h3><span class="mini-chip">JSON</span></div>
      <form class="mega-form" data-form="import"><textarea class="input" name="json" rows="4" placeholder='{"routines":[{"title":"قراءة ١٠ دقائق"}]}'></textarea><button class="btn btn-soft btn-sm" type="submit">استورد</button></form>
    </article>

    <article class="mega-card">
      <div class="mega-card-head"><h3>قوالبي</h3><span class="mini-chip">${ar(data.templates?.length || 0)}</span></div>
      <form class="mega-form mega-inline" data-form="template"><select class="input" name="routineId">${data.health.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join('')}</select><input class="input" name="name" maxlength="80" placeholder="اسم القالب" /><button class="btn btn-sm btn-primary" type="submit">احفظ القالب</button></form>
      ${data.templates?.length ? `<ul class="mega-templates">${data.templates.map((template) => `<li><span>${escapeHtml(template.name)}</span><button class="btn btn-sm btn-soft" data-template-apply="${escapeHtml(template.id)}">أضف</button><button class="icon-btn" data-template-delete="${escapeHtml(template.id)}" title="حذف">✕</button></li>`).join('')}</ul>` : '<p class="hint-line">احفظ روتينًا ناجحًا كقالب تعود إليه لاحقًا.</p>'}
    </article>

    <article class="mega-card">
      <div class="mega-card-head"><h3>إعدادات القيادة</h3><span class="mini-chip">شخصية</span></div>
      <form class="mega-form" data-form="settings">
        <input class="input" name="identity" maxlength="160" value="${escapeHtml(data.settings?.identity || '')}" placeholder="عبارة الهوية: أنا شخص يقرأ كل يوم…" />
        <input class="input" name="celebration" maxlength="160" value="${escapeHtml(data.settings?.celebration || '')}" placeholder="كيف تحتفل بإنجازك؟" />
        <input class="input" name="environment" maxlength="200" value="${escapeHtml(data.settings?.environment || '')}" placeholder="تهيئة البيئة: الكتاب على الوسادة…" />
        <div class="mega-inline"><label class="field"><span>ميزانية اليوم (دقيقة)</span><input class="input" type="number" name="dailyBudget" min="15" max="720" value="${ar(data.settings?.dailyBudget || 120)}" /></label><label class="field"><span>جلسة التركيز</span><input class="input" type="number" name="focusMinutes" min="5" max="120" value="${ar(data.settings?.focusMinutes || 25)}" /></label></div>
        <label class="check"><input type="checkbox" name="autoBalance" ${data.settings?.autoBalance !== false ? 'checked' : ''} /> اقترح موازنة تلقائية</label>
        <label class="check"><input type="checkbox" name="gentleMode" ${data.settings?.gentleMode !== false ? 'checked' : ''} /> وضع اللطف عند التعثر</label>
        <label class="field"><span>إجازة حتى (اختياري)</span><input class="input" type="date" name="vacationUntil" value="${escapeHtml(data.settings?.vacationUntil || '')}" /></label>
        <button class="btn btn-primary btn-sm" type="submit">احفظ الإعدادات</button>
      </form>
    </article>

    <article class="mega-card">
      <div class="mega-card-head"><h3>مكتبة القدرات</h3><span class="mini-chip">${ar(data.catalog?.total || 0)} قدرة</span></div>
      <div class="mega-catalog">${groups.map((group) => `<details class="mega-catalog-group"><summary><span>${escapeHtml(group.name)}</span><b>${ar(group.items.length)}</b></summary><div class="mega-catalog-items">${group.items.map((item) => `<span class="mini-chip">${escapeHtml(item.name)}</span>`).join('')}</div></details>`).join('')}</div>
    </article>
  `;
}

function featuresByGroup() {
  const features = catalog?.features || [];
  if (!features.length) return data.featureGroups || [];
  return (data.featureGroups || []).map((group) => ({
    ...group,
    items: features.length
      ? features.filter((feature) => feature.group === group.id)
      : (group.items || []).map((item) => (Array.isArray(item) ? { id: item[0], name: item[1] } : item)),
  }));
}

function render() {
  const body = backdrop.querySelector('[data-body]');
  if (!body) return;
  const badge = backdrop.querySelector('.mega-head .mini-chip');
  if (badge && data?.catalog?.total) badge.textContent = `${ar(data.catalog.total)} قدرة`;
  body.innerHTML =
    currentTab === 'analytics'
      ? renderAnalytics()
      : currentTab === 'challenges'
        ? renderChallenges()
        : currentTab === 'habits'
          ? renderHabits()
          : currentTab === 'goals'
            ? renderGoals()
            : currentTab === 'tools'
              ? renderTools()
              : renderCommand();
  backdrop.querySelectorAll('[data-tab]').forEach((button) => {
    button.setAttribute('aria-selected', String(button.dataset.tab === currentTab));
  });
}

let backdrop = null;
let data = null;
let catalog = null;
let currentTab = 'command';
let closeSheet = () => {};
let loading = false;

async function load() {
  if (loading) return;
  loading = true;
  try {
    const [mega, cat] = await Promise.all([routinesApi.mega(), routinesApi.megaCatalog().catch(() => null)]);
    data = mega.data;
    catalog = cat?.data || catalog;
    render();
  } catch (err) {
    const body = backdrop?.querySelector('[data-body]');
    if (body) {
      body.innerHTML = `<div class="starter"><span class="emoji">📡</span><strong>تعذّر تحميل مركز القيادة</strong><p>${escapeHtml(err.message || 'خطأ غير معروف')}</p><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>`;
      body.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  } finally {
    loading = false;
  }
}

async function run(task, success) {
  try {
    const result = await task();
    if (success) toast.success(success);
    await load();
    return result;
  } catch (err) {
    toast.error(err?.message || 'تعذّر تنفيذ الإجراء');
    return null;
  }
}

function bindActions() {
  backdrop.addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      currentTab = tab.dataset.tab;
      render();
      return;
    }
    if (event.target.closest('[data-close]')) return closeSheet();
    const mission = event.target.closest('[data-mission]');
    if (mission) {
      const id = mission.dataset.mission;
      if (!id) return;
      if (!confirm('تسجيل إنجاز مهمة اليوم نهائي. متابعة؟')) return;
      return run(() => routinesApi.setStatus(id, 'done'), 'أُنجزت المهمة وحُفظت في سجلك');
    }
    const auto = event.target.closest('[data-auto]');
    if (auto) {
      const mode = auto.dataset.auto;
      const result = await run(() => routinesApi.autoPlan(mode), null);
      if (result?.data?.message) toast.success(result.data.message);
      return;
    }
    const planAction = event.target.closest('[data-plan-action]');
    if (planAction) {
      const action = planAction.dataset.planAction || 'schedule';
      if (action === 'habit') {
        currentTab = 'habits';
        render();
        return;
      }
      return run(() => routinesApi.autoPlan(action), 'طُبّق الاقتراح');
    }
    const challenge = event.target.closest('[data-claim-challenge]');
    if (challenge) return run(() => routinesApi.claimChallenge(challenge.dataset.claimChallenge), 'استلمت التحدي — أحسنت');
    const favorite = event.target.closest('[data-fav]');
    if (favorite) {
      const enabled = favorite.dataset.favState === 'true';
      return run(() => routinesApi.batch(enabled ? 'unfavorite' : 'favorite', [favorite.dataset.fav]), enabled ? 'أُزيل من المفضلة' : 'أُضيف إلى المفضلة');
    }
    const pause = event.target.closest('[data-pause]');
    if (pause) return run(() => routinesApi.batch('pause', [pause.dataset.pause], 7), 'أُوقف الروتين ٧ أيام');
    const resume = event.target.closest('[data-resume]');
    if (resume) return run(() => routinesApi.batch('resume', [resume.dataset.resume]), 'استُؤنف الروتين');
    const tag = event.target.closest('[data-tag]');
    if (tag) {
      const value = window.prompt('وسم جديد (مثال: صباح، صحة، تركيز)');
      if (!value) return;
      return run(() => routinesApi.batch('addTag', [tag.dataset.tag], value), 'أُضيف الوسم');
    }
    const goalClaim = event.target.closest('[data-goal-claim]');
    if (goalClaim) return run(() => routinesApi.claimGoal(goalClaim.dataset.goalClaim), 'استلمت مكافأة الهدف 🎁');
    const goalDelete = event.target.closest('[data-goal-delete]');
    if (goalDelete) {
      if (!confirm('حذف هذا الهدف؟')) return;
      return run(() => routinesApi.deleteGoal(goalDelete.dataset.goalDelete), 'حُذف الهدف');
    }
    const journalDelete = event.target.closest('[data-journal-delete]');
    if (journalDelete) return run(() => routinesApi.deleteJournal(journalDelete.dataset.journalDelete), 'حُذفت التدوينة');
    const templateApply = event.target.closest('[data-template-apply]');
    if (templateApply) return run(() => routinesApi.applyTemplate(templateApply.dataset.templateApply), 'أُضيف الروتين من القالب');
    const templateDelete = event.target.closest('[data-template-delete]');
    if (templateDelete) return run(() => routinesApi.deleteTemplate(templateDelete.dataset.templateDelete), 'حُذف القالب');
    if (event.target === backdrop) closeSheet();
  });

  backdrop.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    const values = new FormData(form);
    const kind = form.dataset.form;
    if (kind === 'goal') {
      return run(
        () => routinesApi.createGoal({ title: values.get('title'), type: values.get('type'), target: values.get('target'), deadline: values.get('deadline') || null, reward: values.get('reward') }),
        'أُضيف الهدف'
      );
    }
    if (kind === 'journal') {
      return run(() => routinesApi.addJournal({ note: values.get('note'), wins: values.get('wins'), lesson: values.get('lesson'), mood: values.get('mood') || null, energy: values.get('energy') || null }), 'حُفظت التدوينة');
    }
    if (kind === 'focus') {
      return run(() => routinesApi.logFocus({ routineId: values.get('routineId') || null, minutes: values.get('minutes') }), 'سُجّلت جلسة التركيز');
    }
    if (kind === 'review') {
      return run(() => routinesApi.addReview({ period: values.get('period'), wins: values.get('wins'), lessons: values.get('lessons'), next: values.get('next') }), 'حُفظت المراجعة');
    }
    if (kind === 'settings') {
      return run(
        () =>
          routinesApi.saveMegaSettings({
            identity: values.get('identity'),
            celebration: values.get('celebration'),
            environment: values.get('environment'),
            dailyBudget: Number(values.get('dailyBudget')),
            focusMinutes: Number(values.get('focusMinutes')),
            autoBalance: values.get('autoBalance') === 'on',
            gentleMode: values.get('gentleMode') === 'on',
            vacationUntil: values.get('vacationUntil') || null,
          }),
        'حُفظت إعدادات القيادة'
      );
    }
    if (kind === 'template') {
      return run(() => routinesApi.saveTemplate({ routineId: values.get('routineId'), name: values.get('name') }), 'حُفظ القالب');
    }
    if (kind === 'import') {
      let parsed;
      try {
        parsed = JSON.parse(String(values.get('json') || ''));
      } catch {
        return toast.error('صيغة JSON غير صحيحة');
      }
      const routines = Array.isArray(parsed) ? parsed : parsed.routines;
      if (!Array.isArray(routines)) return toast.error('لم أجد قائمة routines في الملف');
      const result = await run(() => routinesApi.importData(routines), null);
      if (result?.data) toast.success(`أُضيف ${ar(result.data.created)} روتينًا · تُخطّي ${ar(result.data.skipped)}`);
      return;
    }
  });

  document.addEventListener('keydown', onKey);
}

function onKey(event) {
  if (event.key === 'Escape') closeSheet();
}

export function openMegaSheet() {
  void loadStyles(['/features/routines/mega.css']);
  if (backdrop) return { close: closeSheet, reload: load };
  currentTab = 'command';
  data = null;
  catalog = null;
  backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = shell();
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  closeSheet = () => {
    document.removeEventListener('keydown', onKey);
    backdrop?.remove();
    backdrop = null;
    data = null;
    document.body.style.overflow = '';
  };
  bindActions();
  load();
  return { close: closeSheet, reload: load };
}
