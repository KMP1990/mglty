/**
 * محرك تحليلات «مركز القيادة» — حسابات نقية من سجل الروتين.
 * لا يكتب شيئًا ولا يعتمد على الشبكة؛ يعيد حزمة واحدة تخدم أكثر من ١٠٠
 * قدرة معروضة في الكتالوج (زخم، مخاطر، خريطة حرارية، تحدي، شارة…).
 */
import {
  addDays,
  formatMinutes,
  isScheduledOn,
  parseTimeToMinutes,
  weekdayKey,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
} from '../schedule.js';
import { currentStreak, bestStreak, weekCompletion } from '../stats.js';
import { evolutionSummary, progressFor } from '../completion/evolution.js';

const DAY_MS = 86_400_000;
const WEEK_LABELS = { sun: 'الأحد', mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت' };

const round = (value, digits = 0) => {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
};
const clampPercent = (value) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
const percentOf = (done, total) => (total > 0 ? clampPercent((done / total) * 100) : 0);
const pausedOn = (routine, day) => Boolean(routine?.pausedUntil && String(routine.pausedUntil) >= day);
const availableOn = (routine, ms, day) =>
  Boolean(routine) && !routine.archivedAt && !pausedOn(routine, day) && isScheduledOn({ days: routine.days }, ms);

export function daySeries(routines, logs, today, timeZone, days = 90) {
  const out = [];
  const active = (routines || []).filter((routine) => !routine.archivedAt);
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const ms = Date.parse(`${date}T12:00:00Z`);
    const scheduled = active.filter((routine) => availableOn(routine, ms, date));
    const log = logs?.[date] || {};
    const done = scheduled.filter((routine) => log[routine.id] === 'done').length;
    const skipped = scheduled.filter((routine) => log[routine.id] === 'skipped').length;
    out.push({
      date,
      weekday: weekdayKey(ms, timeZone),
      label: WEEKDAY_LABELS[weekdayKey(ms, timeZone)] || '',
      total: scheduled.length,
      done,
      skipped,
      percent: percentOf(done, scheduled.length),
      rest: scheduled.length === 0,
      isToday: date === today,
    });
  }
  return out;
}

function rateOf(series) {
  const total = series.reduce((sum, day) => sum + day.total, 0);
  const done = series.reduce((sum, day) => sum + day.done, 0);
  return { total, done, rate: percentOf(done, total) };
}

function groupBreakdown(routines, logs, today, timeZone, days, keyOf, labels = {}) {
  const map = new Map();
  const active = (routines || []).filter((routine) => !routine.archivedAt);
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const ms = Date.parse(`${date}T12:00:00Z`);
    const log = logs?.[date] || {};
    for (const routine of active) {
      if (!availableOn(routine, ms, date)) continue;
      const key = keyOf(routine) || 'other';
      if (!map.has(key)) map.set(key, { key, label: labels[key] || key, total: 0, done: 0, skipped: 0 });
      const item = map.get(key);
      item.total += 1;
      if (log[routine.id] === 'done') item.done += 1;
      else if (log[routine.id] === 'skipped') item.skipped += 1;
    }
  }
  return [...map.values()]
    .map((item) => ({ ...item, rate: percentOf(item.done, item.total) }))
    .sort((a, b) => b.total - a.total);
}

function heatmapOf(series) {
  return series.map((day) => ({
    date: day.date,
    weekday: day.weekday,
    done: day.done,
    total: day.total,
    percent: day.percent,
    level: day.rest ? 0 : day.done === 0 ? 0 : day.percent >= 100 ? 4 : day.percent >= 67 ? 3 : day.percent >= 34 ? 2 : 1,
    rest: day.rest,
  }));
}

function weekdayStats(series) {
  const map = new Map(WEEKDAY_KEYS.map((key) => [key, { key, label: WEEK_LABELS[key], total: 0, done: 0, skips: 0, days: 0 }]));
  for (const day of series) {
    if (day.rest) continue;
    const item = map.get(day.weekday);
    if (!item) continue;
    item.total += day.total;
    item.done += day.done;
    item.skips += day.skipped;
    item.days += 1;
  }
  return WEEKDAY_KEYS.map((key) => map.get(key)).map((item) => ({ ...item, rate: percentOf(item.done, item.total) }));
}

function timeBuckets(routines, logs, today, timeZone, days = 30) {
  const buckets = [
    { id: 'dawn', label: 'قبل ٩ صباحًا', total: 0, done: 0 },
    { id: 'morning', label: '٩ – ١٢', total: 0, done: 0 },
    { id: 'afternoon', label: '١٢ – ٥ م', total: 0, done: 0 },
    { id: 'evening', label: '٥ – ٩ م', total: 0, done: 0 },
    { id: 'night', label: 'بعد ٩ م', total: 0, done: 0 },
    { id: 'all-day', label: '٢٤ ساعة', total: 0, done: 0 },
  ];
  const active = (routines || []).filter((routine) => !routine.archivedAt);
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const ms = Date.parse(`${date}T12:00:00Z`);
    const log = logs?.[date] || {};
    for (const routine of active) {
      if (!availableOn(routine, ms, date)) continue;
      const minutes = parseTimeToMinutes(routine.time);
      const bucket =
        minutes == null
          ? buckets[5]
          : minutes < 9 * 60
            ? buckets[0]
            : minutes < 12 * 60
              ? buckets[1]
              : minutes < 17 * 60
                ? buckets[2]
                : minutes < 21 * 60
                  ? buckets[3]
                  : buckets[4];
      bucket.total += 1;
      if (log[routine.id] === 'done') bucket.done += 1;
    }
  }
  return buckets.map((bucket) => ({ ...bucket, rate: percentOf(bucket.done, bucket.total) }));
}

function routineHealth(routines, logs, today, timeZone, days = 30) {
  const active = (routines || []).filter((routine) => !routine.archivedAt);
  return active
    .map((routine) => {
      let total = 0;
      let done = 0;
      let skipped = 0;
      let lastDone = routine.progress?.lastDoneDay || null;
      let streak = 0;
      let cursor = today;
      for (let i = 0; i < days; i += 1) {
        const date = addDays(today, -i);
        const ms = Date.parse(`${date}T12:00:00Z`);
        if (!availableOn(routine, ms, date)) continue;
        total += 1;
        const status = logs?.[date]?.[routine.id];
        if (status === 'done') done += 1;
        else if (status === 'skipped') skipped += 1;
        if (!lastDone && status === 'done') lastDone = date;
      }
      for (let i = 0; i < 400; i += 1) {
        const date = addDays(today, -i);
        const ms = Date.parse(`${date}T12:00:00Z`);
        if (!isScheduledOn({ days: routine.days }, ms, timeZone) || pausedOn(routine, date)) {
          cursor = addDays(cursor, -1);
          continue;
        }
        const status = logs?.[date]?.[routine.id];
        if (status === 'done') {
          streak += 1;
          cursor = addDays(cursor, -1);
          continue;
        }
        if (date === today && status !== 'skipped') {
          cursor = addDays(cursor, -1);
          continue;
        }
        break;
      }
      const rate = percentOf(done, total);
      const daysSince = lastDone ? Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${lastDone}T12:00:00Z`)) / DAY_MS)) : null;
      const risk = total >= 3 && rate < 40 ? 'high' : total >= 2 && (rate < 65 || (daysSince != null && daysSince >= 7)) ? 'medium' : 'low';
      const strength = clampPercent(rate * 0.65 + Math.min(streak, 30) / 30 * 35);
      return {
        id: routine.id,
        title: routine.title,
        icon: routine.icon,
        color: routine.color,
        priority: routine.priority,
        energy: routine.energy,
        time: routine.time,
        duration: routine.duration || null,
        systemName: routine.systemName || null,
        tags: Array.isArray(routine.tags) ? routine.tags : [],
        favorite: Boolean(routine.favorite),
        pausedUntil: routine.pausedUntil || null,
        total,
        done,
        skipped,
        rate,
        streak,
        lastDone,
        daysSince,
        strength,
        risk,
        suggestion:
          risk === 'high'
            ? 'اختصرها إلى نسخة دقيقتين، أو أوقفها مؤقتًا بدل تركها تتآكل.'
            : risk === 'medium'
              ? 'ثبّت محفّزًا واضحًا بعد عادة موجودة، وقلّل الحمل قليلًا.'
              : 'إيقاع ثابت — لا تضف تعقيدًا الآن.',
      };
    })
    .sort((a, b) => b.strength - a.strength || b.streak - a.streak);
}

function loadOf(todayItems, nowMinutes) {
  const timed = todayItems.filter((item) => item.time);
  const minutes = todayItems.reduce((sum, item) => sum + (Number(item.duration) || 10), 0);
  const highEnergy = todayItems.filter((item) => item.energy === 'high').length;
  const core = todayItems.filter((item) => item.priority === 'core').length;
  const overdue = todayItems.filter((item) => {
    const start = parseTimeToMinutes(item.time);
    return start != null && nowMinutes > start + 30 && item.status !== 'done' && item.status !== 'skipped';
  });
  const score = Math.round(todayItems.length * 8 + minutes / 2 + highEnergy * 6 + core * 3);
  return {
    count: todayItems.length,
    minutes,
    highEnergy,
    core,
    timed: timed.length,
    allDay: todayItems.length - timed.length,
    overdue: overdue.length,
    overdueItems: overdue.map((item) => ({ id: item.id, title: item.title, time: item.time })),
    score,
    status: score >= 95 ? 'overload' : score >= 65 ? 'busy' : score >= 30 ? 'balanced' : 'light',
  };
}

function conflictsOf(routines) {
  const active = (routines || []).filter((routine) => !routine.archivedAt && routine.time && !pausedOn(routine, new Date().toISOString().slice(0, 10)));
  const sorted = active
    .map((routine) => {
      const start = parseTimeToMinutes(routine.time);
      return { id: routine.id, title: routine.title, start, end: start + (Number(routine.duration) || 20) };
    })
    .sort((a, b) => a.start - b.start);
  const conflicts = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (sorted[j].start >= sorted[i].end) break;
      conflicts.push({
        a: { id: sorted[i].id, title: sorted[i].title, time: formatMinutes(sorted[i].start) },
        b: { id: sorted[j].id, title: sorted[j].title, time: formatMinutes(sorted[j].start) },
      });
    }
  }
  return conflicts;
}

function freeGaps(todayItems) {
  const blocked = todayItems
    .filter((item) => item.time)
    .map((item) => {
      const start = parseTimeToMinutes(item.time);
      return { start, end: start + (Number(item.duration) || 20) };
    })
    .sort((a, b) => a.start - b.start);
  const gaps = [];
  let cursor = 6 * 60;
  for (const item of blocked) {
    if (item.start > cursor) gaps.push({ start: cursor, end: item.start, minutes: item.start - cursor });
    cursor = Math.max(cursor, item.end);
  }
  if (23 * 60 > cursor) gaps.push({ start: cursor, end: 23 * 60, minutes: 23 * 60 - cursor });
  return gaps
    .filter((gap) => gap.minutes >= 30)
    .sort((a, b) => b.minutes - a.minutes)
    .slice(0, 3)
    .map((gap) => ({ ...gap, from: formatMinutes(gap.start), to: formatMinutes(gap.end) }));
}

function forecastOf(evolution, series) {
  const last14 = series.slice(-14);
  const done = last14.reduce((sum, day) => sum + day.done, 0);
  const dailyDone = done / Math.max(1, last14.length);
  const dailyXp = dailyDone * 11;
  const remaining = Math.max(0, (evolution.xpForNext || 0) - (evolution.xpIntoLevel || 0));
  return {
    dailyDone: round(dailyDone, 1),
    dailyXp: round(dailyXp, 1),
    xpRemaining: remaining,
    daysToNextLevel: dailyXp > 0 && remaining > 0 ? Math.ceil(remaining / dailyXp) : remaining === 0 ? 0 : null,
    nextLevel: (evolution.level || 1) + (remaining === 0 ? 1 : 1),
  };
}

export function buildBadges({ evolution, health, totalDone, totalSkips, perfectDays, streak, series, goals, journal, focus, reviews, routines }) {
  const earned = (condition) => Boolean(condition);
  const maxLevel = Math.max(0, ...(routines || []).map((routine) => progressFor(routine).level));
  const perfect7 = series.slice(-7).filter((day) => !day.rest && day.total > 0 && day.done === day.total).length;
  const earlyDone = health.some((item) => item.done > 0 && item.time && parseTimeToMinutes(item.time) < 9 * 60);
  const nightDone = health.some((item) => item.done > 0 && item.time && parseTimeToMinutes(item.time) >= 21 * 60);
  const allDayDone = health.some((item) => item.done >= 5 && !item.time);
  const systemComplete = health.some((item) => item.systemName && item.done >= 5 && item.rate >= 80);
  const goalsDone = (goals || []).filter((goal) => goal.complete).length;
  const doneGoals = goalsDone;
  const badge = (id, name, emoji, description, isEarned, progress = 0) => ({
    id,
    name,
    emoji,
    description,
    earned: isEarned,
    progress: clampPercent(progress),
  });
  return [
    badge('first-step', 'الخطوة الأولى', '👣', 'أنجز أول روتين', earned(totalDone >= 1), totalDone * 100),
    badge('ten-done', 'عشرة وأكثر', '🔟', 'عشرة إنجازات', earned(totalDone >= 10), (totalDone / 10) * 100),
    badge('fifty-done', 'خمسون', '🏅', 'خمسون إنجازًا', earned(totalDone >= 50), (totalDone / 50) * 100),
    badge('hundred-done', 'المئة', '💯', 'مئة إنجاز', earned(totalDone >= 100), (totalDone / 100) * 100),
    badge('streak-3', 'ثلاثة أيام', '🌱', 'سلسلة ٣ أيام', earned(streak >= 3), (streak / 3) * 100),
    badge('streak-7', 'أسبوع كامل', '🔥', 'سلسلة ٧ أيام', earned(streak >= 7), (streak / 7) * 100),
    badge('streak-30', 'شهر من الثبات', '🌙', 'سلسلة ٣٠ يومًا', earned(streak >= 30), (streak / 30) * 100),
    badge('perfect-day', 'يوم مثالي', '✅', 'أنجز كل روتينات يوم', earned(perfectDays >= 1), perfectDays * 100),
    badge('perfect-week', 'أسبوع مثالي', '🌟', 'خمسة أيام كاملة في أسبوع', earned(perfect7 >= 5), (perfect7 / 5) * 100),
    badge('level-5', 'مستوى ٥', '🌿', 'روتين يصل للمستوى الخامس', earned(maxLevel >= 5), (maxLevel / 5) * 100),
    badge('level-10', 'مستوى ١٠', '🏆', 'روتين يصل للمستوى العاشر', earned(maxLevel >= 10), (maxLevel / 10) * 100),
    badge('xp-1000', 'ألف خبرة', '⚡', '١٠٠٠ XP', earned(evolution.totalXp >= 1000), (evolution.totalXp / 1000) * 100),
    badge('early-bird', 'طائر الصباح', '🌅', 'أنجزت روتينًا قبل ٩', earned(earlyDone), earlyDone ? 100 : 0),
    badge('night-owl', 'سيد الليل', '🌙', 'أنجزت روتينًا بعد ٩ م', earned(nightDone), nightDone ? 100 : 0),
    badge('all-day', 'مرن', '🕊️', 'روتين ٢٤ ساعة أنجزته ٥ مرات', earned(allDayDone), allDayDone ? 100 : 0),
    badge('system-master', 'قائد نظام', '🧭', 'أتممت نظامًا بمعدل ٨٠٪', earned(systemComplete), systemComplete ? 100 : 0),
    badge('goal-getter', 'صائد الأهداف', '🎯', 'أكملت هدفًا', earned(goalsDone >= 1), goalsDone * 100),
    badge('journal-10', 'كاتب النفس', '📓', '١٠ تدوينات', earned((journal || []).length >= 10), ((journal || []).length / 10) * 100),
    badge('focus-10', 'ساعة تركيز', '⏳', '١٠ جلسات تركيز', earned((focus || []).length >= 10), ((focus || []).length / 10) * 100),
    badge('review-4', 'مراجع نفسه', '🪞', '٤ مراجعات', earned((reviews || []).length >= 4), ((reviews || []).length / 4) * 100),
    badge('collector', 'جامع العادات', '🧩', '١٠ روتينات نشطة', earned((routines || []).filter((r) => !r.archivedAt).length >= 10), ((routines || []).filter((r) => !r.archivedAt).length / 10) * 100),
    badge('no-skip', 'بلا تخطّي', '🛡️', '٢٠ إنجازًا وتخطّي واحد كحد أقصى', earned(totalDone >= 20 && totalSkips <= 1), clampPercent((totalDone / 20) * 100 - totalSkips * 10)),
    badge('legend', 'الأسطورة', '✨', 'روتين بمستوى ١٢', earned(maxLevel >= 12), (maxLevel / 12) * 100),
    badge('consistency', 'الثبات', '📈', 'استمرارية ٨٠٪ لثلاثين يومًا', earned(health.some((item) => item.rate >= 80 && item.total >= 20)), Math.max(0, ...health.map((item) => item.rate))),
  ];
}

export function buildChallenges({ series, streak, totalDone, mega }) {
  const today = series[series.length - 1] || { done: 0, total: 0 };
  const week = series.slice(-7);
  const month = series.filter((day) => day.date.slice(0, 7) === (series[series.length - 1]?.date || '').slice(0, 7));
  const weekRate = rateOf(week).rate;
  const monthDone = month.reduce((sum, day) => sum + day.done, 0);
  const state = mega?.challenges || {};
  const challenge = (id, title, description, value, target, unit, icon) => {
    const record = state[id] || {};
    const percent = target > 0 ? clampPercent((value / target) * 100) : 0;
    return {
      id,
      title,
      description,
      value: round(value, 0),
      target,
      unit,
      icon,
      percent,
      claimable: percent >= 100 && !record.claimedAt,
      claimedAt: record.claimedAt || null,
    };
  };
  return [
    challenge('daily-three', 'ثلاثية اليوم', 'أنجز ثلاثة روتينات اليوم', today.done, Math.max(1, Math.min(3, today.total || 3)), 'روتين', '⚡'),
    challenge('weekly-80', 'أسبوع الثمانين', 'التزام ٨٠٪ خلال سبعة أيام', weekRate, 80, '٪', '📈'),
    challenge('weekly-perfect', 'أسبوع بلا ثغرات', 'خمسة أيام كاملة هذا الأسبوع', week.filter((day) => !day.rest && day.total > 0 && day.done === day.total).length, 5, 'يوم', '🌟'),
    challenge('monthly-fifty', 'خمسون في الشهر', 'أنجز ٥٠ روتينًا هذا الشهر', monthDone, 50, 'إنجاز', '🏅'),
    challenge('streak-seven', 'سبعة متتالية', 'حافظ على سلسلة سبعة أيام', streak, 7, 'يوم', '🔥'),
    challenge('streak-thirty', 'شهر الثبات', 'سلسلة ثلاثين يومًا', streak, 30, 'يوم', '🌙'),
    challenge('total-hundred', 'المئة الكبرى', '١٠٠ إنجاز إجمالي', totalDone, 100, 'إنجاز', '💯'),
  ];
}

export function buildMega({ state, routines, logs, timeZone, today, now = Date.now() }) {
  const active = (routines || []).filter((routine) => !routine.archivedAt);
  const series90 = daySeries(active, logs, today, timeZone, 90);
  const series30 = series90.slice(-30);
  const series14 = series90.slice(-14);
  const week = series90.slice(-7);
  const previous = series90.slice(-14, -7);
  const thisWeek = rateOf(week);
  const prevWeek = rateOf(previous);
  const streak = currentStreak(active, logs, today, timeZone);
  const best = bestStreak(active, logs, timeZone);
  const evolution = evolutionSummary(active);
  const totalDone = active.reduce((sum, routine) => sum + progressFor(routine).doneCount, 0);
  const totalSkips = series90.reduce((sum, day) => sum + day.skipped, 0);
  const perfectDays = series90.filter((day) => !day.rest && day.total > 0 && day.done === day.total).length;
  const activeDays = series90.filter((day) => day.done > 0).length;
  const totalMinutes = series90.reduce((sum, day) => {
    const log = logs?.[day.date] || {};
    return (
      sum +
      active.reduce((inner, routine) => {
        if (log[routine.id] !== 'done') return inner;
        return inner + (Number(routine.duration) || 5);
      }, 0)
    );
  }, 0);
  const consistency = percentOf(activeDays, series90.filter((day) => day.total > 0).length);
  const todayItems = active
    .filter((routine) => availableOn(routine, now, today))
    .map((routine) => ({
      id: routine.id,
      title: routine.title,
      icon: routine.icon,
      time: routine.time,
      duration: routine.duration,
      priority: routine.priority,
      energy: routine.energy,
      status: logs?.[today]?.[routine.id] || null,
    }));
  const load = loadOf(todayItems, minutesOf(now, timeZone));
  const health = routineHealth(active, logs, today, timeZone, 30);
  const atRisk = health.filter((item) => item.risk !== 'low');
  const conflicts = conflictsOf(active);
  const gaps = freeGaps(todayItems);
  const forecast = forecastOf(evolution, series90);
  const badges = buildBadges({
    evolution,
    health,
    totalDone,
    totalSkips,
    perfectDays,
    streak,
    series: series90,
    goals: [],
    journal: state.mega?.journal || [],
    focus: state.mega?.focus || [],
    reviews: state.mega?.reviews || [],
    routines: active,
  });
  const earnedBadges = badges.filter((badge) => badge.earned);
  const points = totalDone * 10 + perfectDays * 25 + earnedBadges.length * 50 + streak * 5 + (state.mega?.journal?.length || 0) * 5;
  const completion7 = thisWeek.rate;
  const burnoutScore =
    (load.score >= 95 ? 2 : load.score >= 65 ? 1 : 0) +
    (completion7 < 50 ? 2 : completion7 < 70 ? 1 : 0) +
    (totalSkips >= totalDone * 0.25 ? 1 : 0) +
    (load.overdue >= 3 ? 1 : 0) +
    (atRisk.length >= 3 ? 1 : 0);
  const burnout = {
    score: burnoutScore,
    level: burnoutScore >= 5 ? 'high' : burnoutScore >= 3 ? 'medium' : 'low',
    label: burnoutScore >= 5 ? 'خطر إرهاق مرتفع' : burnoutScore >= 3 ? 'انتبه للحمل' : 'إيقاع صحي',
    advice:
      burnoutScore >= 5
        ? 'أوقف روتينين مؤقتًا، واختر روتينًا واحدًا فقط لبقية الأسبوع.'
        : burnoutScore >= 3
          ? 'قلّل الحمل اليومي ٢٠٪ وأضف يوم راحة واحدًا.'
          : 'حافظ على العدد الحالي؛ الزيادة التدريجية أفضل من القفزة.',
  };
  const momentum = {
    current: completion7,
    previous: prevWeek.rate,
    delta: completion7 - prevWeek.rate,
    direction: completion7 > prevWeek.rate ? 'up' : completion7 < prevWeek.rate ? 'down' : 'flat',
    label: completion7 > prevWeek.rate ? 'زخم صاعد' : completion7 < prevWeek.rate ? 'تراجع بسيط' : 'ثبات',
  };
  const smartPlan = [];
  const untimed = active.filter((routine) => !routine.time && !pausedOn(routine, today));
  if (untimed.length) {
    smartPlan.push({
      id: 'schedule-untimed',
      title: `جدولة ${untimed.length} روتين بلا وقت`,
      detail: gaps.length ? `أفضل فراغ: ${gaps[0].from} – ${gaps[0].to}` : 'سنوزّعها على الصباح والمساء.',
      action: 'schedule',
      tone: 'mint',
    });
  }
  if (conflicts.length) {
    smartPlan.push({
      id: 'resolve-conflict',
      title: `حل ${conflicts.length} تعارض في المواعيد`,
      detail: `«${conflicts[0].a.title}» و«${conflicts[0].b.title}» في نفس النافذة.`,
      action: 'balance',
      tone: 'honey',
    });
  }
  if (load.status === 'overload') {
    smartPlan.push({
      id: 'reduce-load',
      title: 'خفّف حمل اليوم',
      detail: `${load.minutes} دقيقة و${load.count} روتينًا — اختر روتينًا واحدًا مؤقتًا للتعافي.`,
      action: 'pause-low',
      tone: 'rose',
    });
  }
  if (atRisk.length) {
    smartPlan.push({
      id: 'rescue-risk',
      title: `أنقذ ${atRisk.length} روتين متعثر`,
      detail: atRisk[0].suggestion,
      action: 'focus',
      tone: 'lilac',
    });
  }
  const noAnchor = active.filter((routine) => !routine.anchor);
  if (noAnchor.length) {
    smartPlan.push({
      id: 'add-anchor',
      title: `أضف محفّزًا لـ ${noAnchor.length} روتين`,
      detail: 'اربطه بعادة موجودة: «بعد القهوة، أقرأ صفحتين».',
      action: 'habit',
      tone: 'sky',
    });
  }
  const missionCandidate = todayItems
    .filter((item) => item.status !== 'done' && item.status !== 'skipped')
    .sort((a, b) => (a.priority === 'core' ? -1 : 0) - (b.priority === 'core' ? -1 : 0) || (a.time || '99:99').localeCompare(b.time || '99:99'))[0];
  const monthSeries = series90.filter((day) => day.date.slice(0, 7) === today.slice(0, 7));
  const monthDone = monthSeries.reduce((sum, day) => sum + day.done, 0);
  const monthActive = monthSeries.filter((day) => day.done > 0).length;
  const monthPerfect = monthSeries.filter((day) => !day.rest && day.total > 0 && day.done === day.total).length;
  return {
    today,
    generatedAt: new Date(now).toISOString(),
    summary: {
      momentum,
      consistency,
      weekRate: completion7,
      weekCompletion: weekCompletion(active, logs, today, timeZone),
      rate30: rateOf(series30).rate,
      rate90: rateOf(series90).rate,
      streak,
      bestStreak: best,
      totalDone,
      totalSkips,
      activeDays,
      perfectDays,
      totalMinutes,
      todayDone: todayItems.filter((item) => item.status === 'done').length,
      todayTotal: todayItems.length,
      earnedBadges: earnedBadges.length,
      totalBadges: badges.length,
      points,
      level: evolution.level,
      stage: evolution.stageName,
      stageEmoji: evolution.stageEmoji,
      xp: evolution.totalXp,
      xpPercent: evolution.percent,
      xpForNext: evolution.xpForNext,
      xpIntoLevel: evolution.xpIntoLevel,
    },
    evolution,
    forecast,
    load,
    burnout,
    todayItems,
    mission: missionCandidate
      ? {
          id: missionCandidate.id,
          title: missionCandidate.title,
          icon: missionCandidate.icon,
          time: missionCandidate.time,
          priority: missionCandidate.priority,
          reason: missionCandidate.priority === 'core' ? 'أساسي اليوم — ابدأ به.' : 'أقرب خطوة صغيرة الآن.',
        }
      : { title: 'أنجزت كل شيء اليوم', reason: 'استرح أو راجع أسبوعك بهدوء.', complete: true },
    heatmap: heatmapOf(series90),
    weekday: weekdayStats(series90),
    timeBuckets: timeBuckets(active, logs, today, timeZone, 30),
    breakdowns: {
      priority: groupBreakdown(active, logs, today, timeZone, 30, (routine) => routine.priority, { core: 'أساسي', support: 'مساند', bonus: 'إضافي' }),
      energy: groupBreakdown(active, logs, today, timeZone, 30, (routine) => routine.energy, { high: 'طاقة عالية', medium: 'متوسطة', low: 'خفيفة' }),
      systems: groupBreakdown(active, logs, today, timeZone, 30, (routine) => routine.systemName || 'شخصي', {}),
    },
    health,
    atRisk,
    conflicts,
    gaps,
    smartPlan,
    challenges: buildChallenges({ series: series90, streak, totalDone, mega: state.mega }),
    badges,
    goals: [],
    journal: (state.mega?.journal || []).slice(-12).reverse(),
    moods: state.mega?.moods || {},
    focus: state.mega?.focus || [],
    reviews: (state.mega?.reviews || []).slice(-8).reverse(),
    monthlyRecap: {
      month: today.slice(0, 7),
      done: monthDone,
      activeDays: monthActive,
      perfectDays: monthPerfect,
      rate: percentOf(monthDone, monthSeries.reduce((sum, day) => sum + day.total, 0)),
      bestDay: monthSeries.filter((day) => day.done > 0).sort((a, b) => b.done - a.done)[0] || null,
    },
    nextBestAction: smartPlan[0] || null,
    settings: state.mega?.settings || {},
  };
}

function minutesOf(now, timeZone) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(now));
    return ((Number(parts.find((part) => part.type === 'hour')?.value) || 0) * 60 + (Number(parts.find((part) => part.type === 'minute')?.value) || 0)) % 1440;
  } catch {
    const date = new Date(now);
    return date.getHours() * 60 + date.getMinutes();
  }
}

/** يحوّل أهداف المستخدم إلى تقدم مقروء (يعتمد على نفس السجل). */
export function buildGoals(goals, mega) {
  const summary = mega?.summary || {};
  const values = {
    done: summary.totalDone || 0,
    streak: summary.streak || 0,
    perfect: summary.perfectDays || 0,
    active: summary.activeDays || 0,
    minutes: summary.totalMinutes || 0,
    level: summary.level || 1,
    journal: (mega?.journal || []).length,
    focus: (mega?.focus || []).length,
    review: (mega?.reviews || []).length,
  };
  return (Array.isArray(goals) ? goals : []).map((goal) => {
    const value = goal.type === 'manual' ? Number(goal.manualValue) || 0 : values[goal.type] || 0;
    const target = Math.max(1, Number(goal.target) || 1);
    const percent = clampPercent((value / target) * 100);
    return {
      ...goal,
      value,
      percent,
      complete: percent >= 100,
      daysLeft: goal.deadline ? Math.ceil((Date.parse(`${goal.deadline}T12:00:00Z`) - Date.now()) / DAY_MS) : null,
      claimed: Boolean(goal.claimedAt),
    };
  });
}
