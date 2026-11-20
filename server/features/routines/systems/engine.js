/**
 * عقل أنظمة الروتين — أدوات التحليل المشتركة بين الأنظمة الخمسة.
 * -----------------------------------------------------------------
 * كل نظام له ملف brain.js خاص، لكن الجميع يقرأ من هنا:
 *  • تطبيع النصوص العربية لمقارنة الأسماء ومنع التكرار.
 *  • حساب الالتزام الحقيقي لكل روتين ونافذة زمنية.
 *  • اكتشاف الروتينات المتأخرة والفراغات في كل نظام.
 * لا تخمين ولا أرقام عشوائية: كل إشارة محسوبة من السجل الفعلي.
 */
import { addDays, isScheduledOn, minutesOfDay, parseTimeToMinutes } from '../schedule.js';

export const PRIORITIES = ['core', 'support', 'bonus'];
export const ENERGY_LEVELS = ['high', 'medium', 'low'];

const TASHKEEL = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;

/** تطبيع نص عربي/رقمي لمقارنة العناوين بثبات */
export function normalizeTitle(value) {
  return String(value ?? '')
    .replace(TASHKEEL, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\u0621-\u064A0-9a-zA-Z]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

export function activeOnly(routines) {
  return (Array.isArray(routines) ? routines : []).filter((r) => r && !r.archivedAt);
}

/** عدد الروتينات التي تحمل إحدى الكلمات المفتاحية في عنوانها */
export function titleMatchCount(routines, words) {
  const list = activeOnly(routines);
  const wanted = (Array.isArray(words) ? words : [words]).map(normalizeTitle).filter(Boolean);
  return list.filter((r) => {
    const title = normalizeTitle(r.title);
    return wanted.some((word) => title.includes(word));
  }).length;
}

/** الروتينات الأساسية لنظام غير الموجودة بعد عند المستخدم */
export function missingCore(system, routines) {
  const existing = new Set(activeOnly(routines).map((r) => normalizeTitle(r.title)));
  return (system?.routines || []).filter(
    (r) => r.priority === 'core' && !existing.has(normalizeTitle(r.title))
  );
}

function timeWindow(time) {
  const minutes = parseTimeToMinutes(time);
  if (minutes == null) return 'anytime';
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  if (minutes < 21 * 60) return 'evening';
  return 'night';
}

function rateOf(bucket) {
  return bucket.scheduled ? Math.round((bucket.done / bucket.scheduled) * 100) : 0;
}

/**
 * قياس شامل لحالة المستخدم — يُمرَّر لكل عقل نظام.
 * @returns {object} إحصاءات محسوبة من سجل الأيام الحقيقي.
 */
export function buildMetrics({ routines, logs = {}, today, timeZone = 'UTC', now = Date.now(), days = 14 }) {
  const active = activeOnly(routines);
  const dayLog = logs?.[today] || {};
  const windows = {
    morning: { done: 0, scheduled: 0 },
    afternoon: { done: 0, scheduled: 0 },
    evening: { done: 0, scheduled: 0 },
    night: { done: 0, scheduled: 0 },
    anytime: { done: 0, scheduled: 0 },
  };
  const perRoutine = [];

  for (const routine of active) {
    const windowKey = timeWindow(routine.time);
    let scheduled = 0;
    let done = 0;
    let skipped = 0;
    for (let i = 0; i < days; i += 1) {
      const day = addDays(today, -i);
      const ms = Date.parse(`${day}T12:00:00Z`);
      if (!isScheduledOn({ days: routine.days }, ms, timeZone)) continue;
      scheduled += 1;
      const status = logs?.[day]?.[routine.id];
      if (status === 'done') done += 1;
      else if (status === 'skipped') skipped += 1;
    }
    windows[windowKey].scheduled += scheduled;
    windows[windowKey].done += done;
    perRoutine.push({
      id: routine.id,
      title: routine.title,
      time: routine.time || null,
      window: windowKey,
      isSystem: Boolean(routine.systemId),
      scheduled,
      done,
      skipped,
      rate: scheduled ? Math.round((done / scheduled) * 100) : 0,
      streak: Number(routine.streak) || 0,
    });
  }

  // إحصاءات اليوم
  const todayScheduled = active.filter((r) =>
    isScheduledOn({ days: r.days }, Date.parse(`${today}T12:00:00Z`), timeZone)
  );
  const todayDone = todayScheduled.filter((r) => dayLog[r.id] === 'done').length;
  const todaySkipped = todayScheduled.filter((r) => dayLog[r.id] === 'skipped').length;

  // الروتينات المتأخرة اليوم (وقتها مضى ولم تُسجَّل)
  const nowMinutes = minutesOfDay(now, timeZone);
  const overdue = todayScheduled.filter((r) => {
    const minutes = parseTimeToMinutes(r.time);
    return minutes != null && minutes < nowMinutes && !dayLog[r.id];
  });

  const totalScheduled = perRoutine.reduce((sum, r) => sum + r.scheduled, 0);
  const totalDone = perRoutine.reduce((sum, r) => sum + r.done, 0);
  const completion = totalScheduled ? Math.round((totalDone / totalScheduled) * 100) : 0;
  const totalMinutes = active.reduce((sum, r) => sum + (Number(r.duration) || 15), 0);
  const timedCount = active.filter((r) => r.time).length;
  const systemFamilies = new Set(active.map((r) => r.systemId).filter(Boolean));

  return {
    active,
    activeCount: active.length,
    timedCount,
    untimedCount: active.length - timedCount,
    totalMinutes,
    completion,
    today: {
      total: todayScheduled.length,
      done: todayDone,
      skipped: todaySkipped,
      percent: todayScheduled.length ? Math.round((todayDone / todayScheduled.length) * 100) : 0,
    },
    overdue: overdue.length,
    overdueTitles: overdue.slice(0, 3).map((r) => r.title),
    windows: {
      morning: { ...windows.morning, rate: rateOf(windows.morning) },
      afternoon: { ...windows.afternoon, rate: rateOf(windows.afternoon) },
      evening: { ...windows.evening, rate: rateOf(windows.evening) },
      night: { ...windows.night, rate: rateOf(windows.night) },
      anytime: { ...windows.anytime, rate: rateOf(windows.anytime) },
    },
    perRoutine,
    trackedSystems: systemFamilies.size,
    appliedCount: active.filter((r) => r.systemId).length,
  };
}

/** درجات الثقة في التوصية — أعلى = أفضلية أعلى، مع سبب واضح */
export function scoreFrom({ base, completion, activeCount, overdue, missing, signals = 0 }) {
  let score = base;
  if (completion >= 70) score += 10;
  else if (completion > 0 && completion < 35) score -= 6;
  if (activeCount === 0) score += 12;
  else if (activeCount > 9) score -= 8;
  if (overdue >= 3) score -= 8;
  else if (overdue > 0) score -= 3;
  score += Math.min(3, missing) * 6 + signals;
  return clamp(score, 18, 98);
}

export function verdictOf(score) {
  if (score >= 74) return 'strong';
  if (score >= 46) return 'partial';
  return 'empty';
}

/** يبني إشارات موحّدة للعرض في الواجهة */
export function signal(label, value, tone = 'neutral') {
  return { label, value, tone };
}
