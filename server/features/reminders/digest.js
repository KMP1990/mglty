/**
 * نصوص الملخصات والتذكيرات الذكية (ميزة فرعية داخل reminders).
 * دوال نقية قدر الإمكان حتى يسهل اختبارها وقراءتها.
 */
import { routinesForDay, currentStreak, weekCompletion } from '../routines/stats.js';

const arNum = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

export function readingSummary(reading) {
  if (!reading?.bookTitle) return '';
  const percent = Math.round(Number(reading.percent) || 0);
  const stop = reading.chapterTitle ? ` — توقفت في «${reading.chapterTitle}»` : '';
  return `«${reading.bookTitle}» عند ${arNum(percent)}٪${stop}`;
}

function routineCounts(state, now, timeZone, today) {
  const active = (state.routines || []).filter((r) => !r.archivedAt);
  const scheduled = routinesForDay(active, now, timeZone);
  const log = state.logs?.[today] || {};
  const done = scheduled.filter((r) => log[r.id] === 'done').length;
  return {
    active,
    scheduled,
    done,
    remaining: Math.max(0, scheduled.length - done),
    streak: currentStreak(active, state.logs || {}, today, timeZone),
  };
}

/** ملخص صباحي: روتينات اليوم + متابعة الكتاب */
export function buildDailyDigest({ state, reading, now, timeZone, today }) {
  const counts = routineCounts(state || {}, now, timeZone, today);
  const book = readingSummary(reading);
  if (!counts.scheduled.length && !book) return null;
  const lines = [];
  if (counts.scheduled.length) {
    lines.push(
      counts.remaining > 0
        ? `لديك ${arNum(counts.remaining)} من ${arNum(counts.scheduled.length)} روتين اليوم${counts.streak > 1 ? ` · سلسلتك ${arNum(counts.streak)} يوم` : ''}.`
        : `أنجزت روتينات اليوم${counts.streak > 1 ? ` · سلسلتك ${arNum(counts.streak)} يوم` : ''} — استمر بهدوء.`
    );
  }
  if (book) lines.push(`كتابك ${book}.`);
  return {
    type: 'digest',
    title: 'ملخص صباحك ☀️',
    body: lines.join('\n'),
    link: counts.remaining > 0 ? '/routines' : book ? '/books' : '/routines',
    priority: 'normal',
    icon: 'sun',
    data: { source: 'digest', event: 'daily', remaining: counts.remaining, streak: counts.streak },
  };
}

/** رسالة عودة بعد غياب — مرة كل يومين ثم أسبوعيًا لمن غاب طويلًا */
export function buildReengage({ state, reading, daysAway, now, timeZone, today }) {
  const counts = routineCounts(state || {}, now, timeZone, today);
  const book = readingSummary(reading);
  const days = Math.max(2, Math.round(daysAway));
  let body;
  if (book && counts.remaining) body = `${book}. ولديك ${arNum(counts.remaining)} روتين اليوم — ابدأ بالأسهل.`;
  else if (book) body = `${book}. صفحتان اليوم كفيلتان بإعادة العادة.`;
  else if (counts.remaining) body = `لديك ${arNum(counts.remaining)} روتين اليوم. خطوة صغيرة واحدة تكفي للعودة.`;
  else body = 'خطوة صغيرة واحدة اليوم تكفي لتستعيد إيقاعك — لا تحتاج يومًا كاملًا.';
  return {
    type: 'digest',
    title: days >= 7 ? `اشتقنا إليك — ${arNum(days)} أيام` : `عاد يومك ينتظرك 🌱`,
    body,
    link: book && !counts.remaining ? '/books' : '/routines',
    priority: 'normal',
    icon: 'sun',
    data: { source: 'digest', event: 'reengage', daysAway: days },
  };
}

/** حصاد الأسبوع: الالتزام + السلسلة + القراءة */
export function buildWeekly({ state, reading, now, timeZone, today }) {
  const counts = routineCounts(state || {}, now, timeZone, today);
  const book = readingSummary(reading);
  if (!counts.active.length && !book) return null;
  const completion = weekCompletion(counts.active, state?.logs || {}, today, timeZone);
  const lines = [`التزامك هذا الأسبوع ${arNum(completion)}٪${counts.streak > 0 ? ` · سلسلتك ${arNum(counts.streak)} يوم` : ''}.`];
  if (book) lines.push(`وكتابك ${book}.`);
  lines.push(completion >= 60 ? 'أسبوع جيد — اختر روتينًا واحدًا فقط لتثبيته أكثر.' : 'أسبوع جديد يبدأ الآن: قلّل العدد وزِد الاستمرار.');
  return {
    type: 'insight',
    title: 'حصاد أسبوعك 📊',
    body: lines.join('\n'),
    link: '/routines',
    priority: 'normal',
    icon: 'sparkles',
    data: { source: 'digest', event: 'weekly', completion, streak: counts.streak },
  };
}

/** تذكير قراءة خادمي — يعمل حتى لو لم يُفتح التطبيق */
export function buildReadingReminder(reading) {
  const title = reading?.bookTitle ? `وقت القراءة — «${reading.bookTitle}»` : 'وقت القراءة 📖';
  const body = reading?.chapterTitle
    ? `توقفت عند «${reading.chapterTitle}». عشر دقائق اليوم تكفي للمتابعة.`
    : 'كتابك ينتظرك. اقرأ صفحتين فقط وستعود العادة من جديد.';
  return {
    type: 'reminder',
    title,
    body,
    link: '/books',
    priority: 'normal',
    icon: 'book',
    data: { source: 'books', event: 'reading-reminder', bookId: reading?.bookId || null },
  };
}
