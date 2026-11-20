/**
 * حساب التقدم والسلاسل (ميزة فرعية داخل routines).
 * السلسلة = أيام متتالية فيها روتين واحد على الأقل "تم"، بحد أقصى اليوم السابق
 * إذا لم يُنجز شيء اليوم بعد (حتى لا تنكسر السلسلة في منتصف اليوم).
 */
import { addDays, isPausedOn, isScheduledOn, localDate } from './schedule.js';

export function routinesForDay(routines, ms, timeZone) {
  const day = localDate(ms, timeZone);
  return routines.filter(
    (r) => !r.archivedAt && !isPausedOn(r, day) && isScheduledOn({ days: r.days }, ms, timeZone)
  );
}

export function dayProgress(routines, logs, day, ms, timeZone) {
  const scheduled = routinesForDay(routines, ms, timeZone);
  const dayLog = logs[day] || {};
  const done = scheduled.filter((r) => dayLog[r.id] === 'done').length;
  const skipped = scheduled.filter((r) => dayLog[r.id] === 'skipped').length;
  const total = scheduled.length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  return { total, done, skipped, percent, remaining: Math.max(0, total - done - skipped) };
}

export function currentStreak(routines, logs, today, timeZone) {
  let streak = 0;
  let cursor = today;
  const todayStarted = Object.keys(logs[today] || {}).some((id) => logs[today][id] === 'done');

  for (let i = 0; i < 400; i += 1) {
    const dayLog = logs[cursor] || {};
    const ms = Date.parse(`${cursor}T12:00:00Z`);
    const scheduled = routinesForDay(routines, ms, timeZone);
    if (scheduled.length === 0) {
      // يوم راحة (لا شيء مجدول) لا يكسر السلسلة
      cursor = addDays(cursor, -1);
      continue;
    }
    const doneCount = scheduled.filter((r) => dayLog[r.id] === 'done').length;
    if (doneCount > 0) {
      streak += 1;
      cursor = addDays(cursor, -1);
      continue;
    }
    // اليوم الحالي بلا إنجاز بعد: لا يكسر السلسلة
    if (cursor === today && !todayStarted) {
      cursor = addDays(cursor, -1);
      continue;
    }
    break;
  }
  return streak;
}

export function bestStreak(routines, logs, timeZone) {
  const days = Object.keys(logs).sort();
  if (!days.length) return 0;
  let best = 0;
  let run = 0;
  let previous = null;
  for (const day of days) {
    const ms = Date.parse(`${day}T12:00:00Z`);
    const scheduled = routinesForDay(routines, ms, timeZone);
    const dayLog = logs[day] || {};
    const done = scheduled.filter((r) => dayLog[r.id] === 'done').length;
    if (done > 0) {
      run = previous && addDays(previous, 1) === day ? run + 1 : 1;
      best = Math.max(best, run);
      previous = day;
    } else if (scheduled.length > 0) {
      run = 0;
      previous = null;
    }
  }
  return best;
}

/**
 * نسبة الالتزام خلال آخر 7 أيام.
 * قاعدة عادلة: الأيام التي لم تُسجّل فيها أي نشاط ولم تكن قد بدأت بعد
 * (أي قبل أول يوم استخدام، أو اليوم الحالي قبل أن يبدأ) لا تُحسب في المقام،
 * وإلا فسإنسانًا جديدًا في يومه الأول يرى 1% بدل 100%.
 */
export function weekCompletion(routines, logs, today, timeZone) {
  // أول يوم لدينا فيه أي تسجيل أو إنشاء روتين
  const startCandidates = [
    ...Object.keys(logs || {}),
    ...routines.map((r) => (r.createdAt ? String(r.createdAt).slice(0, 10) : null)).filter(Boolean),
  ].sort();
  const firstDay = startCandidates[0] || today;

  let scheduledTotal = 0;
  let doneTotal = 0;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(today, -i);
    // نتجاهل الأيام السابقة لتاريخ بدء الاستخدام
    if (day < firstDay) continue;
    const ms = Date.parse(`${day}T12:00:00Z`);
    const scheduled = routinesForDay(routines, ms, timeZone);
    if (!scheduled.length) continue;
    const dayLog = logs[day] || {};
    const doneToday = scheduled.filter((r) => dayLog[r.id] === 'done').length;
    const skippedToday = scheduled.filter((r) => dayLog[r.id] === 'skipped').length;
    scheduledTotal += scheduled.length;
    doneTotal += doneToday;
    // اليوم الحالي بلا إنجاز بعد لا يُحاسب على أنه "تفويت" في نسبة الأسبوع
    if (day === today && doneToday === 0 && skippedToday === 0) scheduledTotal -= scheduled.length;
  }
  return scheduledTotal > 0 ? Math.round((doneTotal / scheduledTotal) * 100) : 0;
}

/** سجلّ مختصر لآخر أيام — يُستخدم في مخطط الالتزام بالواجهة */
export function recentHistory(routines, logs, today, timeZone, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const ms = Date.parse(`${day}T12:00:00Z`);
    const scheduled = routinesForDay(routines, ms, timeZone);
    const dayLog = logs[day] || {};
    const done = scheduled.filter((r) => dayLog[r.id] === 'done').length;
    const skipped = scheduled.filter((r) => dayLog[r.id] === 'skipped').length;
    out.push({
      date: day,
      total: scheduled.length,
      done,
      skipped,
      percent: scheduled.length ? Math.round((done / scheduled.length) * 100) : 0,
      isToday: day === today,
    });
  }
  return out;
}

/** حالة روتين في آخر أيام — لعرض نقاط أسبوعية على بطاقته */
export function perRoutineHistory(routine, logs, today, timeZone, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const day = addDays(today, -i);
    const ms = Date.parse(`${day}T12:00:00Z`);
    const scheduled = isScheduledOn({ days: routine.days }, ms, timeZone) && !isPausedOn(routine, day);
    out.push({
      date: day,
      scheduled,
      status: logs[day]?.[routine.id] || null,
      isToday: day === today,
    });
  }
  return out;
}

/** سلسلة لكل روتين على حدة */
export function perRoutineStreaks(routines, logs, today, timeZone) {
  const out = {};
  for (const routine of routines) {
    let streak = 0;
    let cursor = today;
    for (let i = 0; i < 400; i += 1) {
      const ms = Date.parse(`${cursor}T12:00:00Z`);
      if (!isScheduledOn({ days: routine.days }, ms, timeZone) || isPausedOn(routine, cursor)) {
        cursor = addDays(cursor, -1);
        continue;
      }
      const status = logs[cursor]?.[routine.id];
      if (status === 'done') {
        streak += 1;
        cursor = addDays(cursor, -1);
        continue;
      }
      if (cursor === today && status !== 'skipped') {
        cursor = addDays(cursor, -1);
        continue;
      }
      break;
    }
    out[routine.id] = streak;
  }
  return out;
}
