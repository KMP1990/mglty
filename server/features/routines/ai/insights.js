/**
 * تحليل سلوكي للروتين (ميزة فرعية داخل ai).
 * كل رقم هنا محسوب من السجل الحقيقي — لا تخمين.
 */
import { addDays, minutesOfDay, isScheduledOn, WEEKDAY_LABELS } from '../schedule.js';
import { dayProgress, currentStreak, bestStreak, weekCompletion, perRoutineStreaks } from '../stats.js';

/** آخر 14 يومًا: حالة كل روتين لكل يوم */
function historyWindow(routines, logs, today, days = 14) {
  const window = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const dayLog = logs[day] || {};
    window.push({
      day,
      items: routines
        .filter((r) => !r.archivedAt)
        .map((r) => ({ routine: r, scheduled: isScheduledOn({ days: r.days }, Date.parse(`${day}T12:00:00Z`), 'UTC'), status: dayLog[r.id] || null })),
    });
  }
  return window;
}

function hourBucket(time) {
  if (!time) return 'غير محدد';
  const hour = Number(time.slice(0, 2));
  if (hour < 6) return 'قبل الفجر';
  if (hour < 12) return 'الصباح';
  if (hour < 17) return 'بعد الظهر';
  if (hour < 21) return 'المساء';
  return 'الليل';
}

export function buildInsights({ routines, logs, settings, now = Date.now(), today, timeZone }) {
  const active = routines.filter((r) => !r.archivedAt);
  const todayStats = dayProgress(active, logs, today, now, timeZone);
  const streak = currentStreak(active, logs, today, timeZone);
  const best = bestStreak(active, logs, timeZone);
  const week = weekCompletion(active, logs, today, timeZone);
  const routineStreaks = perRoutineStreaks(active, logs, today, timeZone);
  const window = historyWindow(active, logs, today);
  const nowMinutes = minutesOfDay(now, timeZone);

  // نسبة إنجاز كل روتين خلال نافذة الأسبوعين
  const perRoutine = active.map((routine) => {
    let scheduled = 0;
    let done = 0;
    let skipped = 0;
    for (const day of window) {
      const entry = day.items.find((i) => i.routine.id === routine.id);
      if (!entry?.scheduled) continue;
      scheduled += 1;
      if (entry.status === 'done') done += 1;
      if (entry.status === 'skipped') skipped += 1;
    }
    return {
      id: routine.id,
      title: routine.title,
      time: routine.time,
      rate: scheduled ? Math.round((done / scheduled) * 100) : 0,
      scheduled,
      done,
      skipped,
      streak: routineStreaks[routine.id] || 0,
    };
  });

  const weakest = [...perRoutine].filter((r) => r.scheduled >= 2).sort((a, b) => a.rate - b.rate).slice(0, 3);
  const strongest = [...perRoutine].filter((r) => r.scheduled >= 2).sort((a, b) => b.rate - a.rate).slice(0, 3);

  // أفضل نافذة زمنية: النطاق الذي فيه أعلى نسبة إنجاز
  const buckets = new Map();
  for (const r of active) {
    const key = hourBucket(r.time);
    const stat = perRoutine.find((p) => p.id === r.id);
    const bucket = buckets.get(key) || { key, done: 0, scheduled: 0 };
    bucket.done += stat?.done || 0;
    bucket.scheduled += stat?.scheduled || 0;
    buckets.set(key, bucket);
  }
  const bucketList = [...buckets.values()].map((b) => ({ ...b, rate: b.scheduled ? Math.round((b.done / b.scheduled) * 100) : 0 }));
  const bestWindow = bucketList.sort((a, b) => b.rate - a.rate)[0] || null;

  // أيام الأسبوع الأضعف (للتوصية بالتوزيع)
  const byWeekday = new Map();
  for (const day of window) {
    const weekday = new Date(`${day.day}T12:00:00Z`).getUTCDay();
    const scheduled = day.items.filter((i) => i.scheduled).length;
    const done = day.items.filter((i) => i.status === 'done').length;
    const entry = byWeekday.get(weekday) || { weekday, name: WEEKDAY_LABELS[['sun','mon','tue','wed','thu','fri','sat'][weekday]], done: 0, scheduled: 0 };
    entry.name = WEEKDAY_LABELS[['sun','mon','tue','wed','thu','fri','sat'][weekday]];
    entry.done += done;
    entry.scheduled += scheduled;
    byWeekday.set(weekday, entry);
  }
  const weekdayRates = [...byWeekday.values()].map((d) => ({ ...d, rate: d.scheduled ? Math.round((d.done / d.scheduled) * 100) : 100 }));
  const weakestDay = [...weekdayRates].sort((a, b) => a.rate - b.rate)[0] || null;

  // مؤشرات حِمْل اليوم: كم روتين مجدول، وكم متبقٍ بعد الوقت الحالي
  const upcoming = active
    .filter((r) => isScheduledOn({ days: r.days }, now, timeZone) && !(logs[today] || {})[r.id])
    .map((r) => ({
      id: r.id,
      title: r.title,
      time: r.time,
      timeMinutes: r.time ? Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3)) : null,
    }));

  const overdue = upcoming.filter((r) => r.timeMinutes != null && r.timeMinutes < nowMinutes);
  const overloaded = todayStats.total > 8;
  const tooManyInMorning = active.filter((r) => r.time && Number(r.time.slice(0, 2)) < 11).length > 4;

  return {
    today: todayStats,
    streak,
    bestStreak: best,
    weekCompletion: week,
    totalRoutines: active.length,
    perRoutine,
    weakest,
    strongest,
    bestWindow,
    weakestDay,
    weekdayRates,
    upcoming: upcoming.sort((a, b) => (a.timeMinutes ?? 9999) - (b.timeMinutes ?? 9999)),
    overdue,
    signals: { overloaded, tooManyInMorning, noRoutines: active.length === 0 },
    nowMinutes,
    timeZone,
    todayKey: today,
    reminders: settings?.reminders || {},
    historyWindow: window,
    needed: {
      energy: active.some((r) => r.color === 'honey' || /نوم|ماء|هواء|مشي|رياض/i.test(r.title)) ? 'ok' : 'missing',
    },
  };
}
