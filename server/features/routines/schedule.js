/**
 * نطاق بيانات الروتين (ميزة فرعية داخل routines).
 * يوفّر توقيت المستخدم و"تاريخ اليوم" المحلي — كل الحسابات تعتمد عليه
 * حتى لا يختلّ عدّ الأيام بسبب فروق UTC في أي منطقة زمنية.
 */

/** التاريخ المحلي بصيغة YYYY-MM-DD */
export function localDate(ms = Date.now(), timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(ms));
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return new Date(ms).toISOString().slice(0, 10);
  }
}

/** اسم اليوم بالعربية داخل نطاق المستخدم */
export function localWeekday(ms = Date.now(), timeZone = 'UTC') {
  try {
    return new Intl.DateTimeFormat('ar', { timeZone, weekday: 'long' }).format(new Date(ms));
  } catch {
    return '';
  }
}

/** الدقائق منذ منتصف الليل في نطاق المستخدم */
export function minutesOfDay(ms = Date.now(), timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(new Date(ms));
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return (h % 24) * 60 + m;
  } catch {
    const d = new Date(ms);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  }
}

/** ISO لأول لحظة من اليوم المحلي (لحساب "منذ") */
export function startOfLocalDay(ms = Date.now(), timeZone = 'UTC') {
  return minutesOfDay(ms, timeZone) * 60 * 1000;
}

/** إضافة أيام على تاريخ YYYY-MM-DD */
export function addDays(dateStr, delta) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** ترتيب أسبوعي مستقر: 0 = الأحد */
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export const WEEKDAY_KEYS = WEEKDAYS;
export const WEEKDAY_LABELS = {
  sun: 'الأحد',
  mon: 'الاثنين',
  tue: 'الثلاثاء',
  wed: 'الأربعاء',
  thu: 'الخميس',
  fri: 'الجمعة',
  sat: 'السبت',
};

export function weekdayKey(ms = Date.now(), timeZone = 'UTC') {
  try {
    const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(new Date(ms)).toLowerCase();
    return short.slice(0, 3);
  } catch {
    return WEEKDAYS[new Date(ms).getUTCDay()];
  }
}

export function isScheduledOn(schedule, ms, timeZone) {
  if (!schedule) return true;
  const days = schedule.days;
  if (!Array.isArray(days) || days.length === 0 || days.length === 7) return true;
  return days.includes(weekdayKey(ms, timeZone));
}

/** هل الروتين موقوف مؤقتًا في هذا اليوم؟ (pausedUntil >= اليوم يعني موقوفًا) */
export function isPausedOn(routine, day) {
  return Boolean(routine?.pausedUntil && String(routine.pausedUntil) >= String(day));
}

/** دقائق "HH:MM" → رقم، مع حماية من قيم غريبة */
export function parseTimeToMinutes(value, fallback = null) {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  if (!m) return fallback;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function formatMinutes(minutes) {
  if (minutes == null) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const suffix = h >= 12 ? 'م' : 'ص';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const toAr = (n) => String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  return `${toAr(h12)}:${toAr(String(m).padStart(2, '0'))} ${suffix}`;
}
