/**
 * خطة اليوم الذكية (ميزة فرعية داخل ai).
 * ترتّب روتينات اليوم فعليًا حسب: الوقت المحدد ← الطاقة (صباحًا أولًا) ← الأهمية،
 * وتقترح انتظامًا زمنيًا للروتينات التي لا وقت لها، وترشّح ما لا يتناسب مع الوقت الحالي.
 */
import { formatMinutes, isScheduledOn, minutesOfDay } from '../schedule.js';

const ENERGY_RANK = { rose: 0, honey: 1, mint: 2, sky: 3, lilac: 4, sand: 5 };
const DURATION_DEFAULT = 15;

export function buildDayPlan({ routines, logs, insights, now = Date.now(), today, timeZone }) {
  const dayLog = logs[today] || {};
  const activeForToday = routines
    .filter((r) => !r.archivedAt && isScheduledOn({ days: r.days }, now, timeZone))
    .map((r) => ({
      ...r,
      status: dayLog[r.id] || null,
      timeMinutes: r.time ? Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3)) : null,
    }));

  const nowMinutes = minutesOfDay(now, timeZone);

  const blocks = activeForToday
    .slice()
    .sort((a, b) => {
      if (a.timeMinutes == null && b.timeMinutes == null) return (ENERGY_RANK[a.color] ?? 9) - (ENERGY_RANK[b.color] ?? 9);
      if (a.timeMinutes == null) return 1;
      if (b.timeMinutes == null) return -1;
      return a.timeMinutes - b.timeMinutes;
    })
    .map((r, index) => {
      const done = r.status === 'done';
      const skipped = r.status === 'skipped';
      const late = !done && !skipped && r.timeMinutes != null && r.timeMinutes < nowMinutes;
      return {
        id: r.id,
        title: r.title,
        icon: r.icon,
        color: r.color,
        time: r.time,
        timeLabel: r.time ? formatMinutes(r.timeMinutes) : null,
        duration: r.duration || DURATION_DEFAULT,
        status: r.status,
        order: index + 1,
        reason: done
          ? 'تم ✨'
          : skipped
            ? 'تم تخطّيه اليوم'
            : late
              ? 'فات وقته — اقتراح: أجهزه الآن أو انقله لليوم'
              : r.time
                ? 'مجدول في وقته'
                : 'بدون وقت محدد — مقترح حسب نشاطك',
        flag: late ? 'late' : done ? 'done' : skipped ? 'skipped' : 'todo',
        suggestedTime: !r.time ? suggestSlot(activeForToday, index) : null,
      };
    });

  // الزمن المقترح ينشر الروتينات بلا وقت على نصف ساعة مباعدة بعد أقرب وقت محدد
  const done = blocks.filter((b) => b.flag === 'done').length;
  const skipped = blocks.filter((b) => b.flag === 'skipped').length;
  const todo = blocks.filter((b) => b.flag === 'todo' || b.flag === 'late').length;

  const focus = blocks.find((b) => b.flag === 'late') || blocks.find((b) => b.flag === 'todo') || blocks[0] || null;

  const minutesLeft = blocks
    .filter((b) => b.flag === 'todo' || b.flag === 'late')
    .reduce((sum, b) => sum + (b.duration || DURATION_DEFAULT), 0);

  return {
    date: today,
    blocks,
    summary: { total: blocks.length, done, skipped, remaining: todo, minutesLeft },
    focus,
    overloaded: blocks.length > 8,
    headline: headlineFor({ total: blocks.length, done, todo, insights }),
  };
}

function suggestSlot(activeForToday, index) {
  const times = activeForToday.map((r) => r.timeMinutes).filter((t) => t != null).sort((a, b) => a - b);
  // نبدأ بعد آخر موعد محدد، أو من 8 صباحًا، بتباعد نصف ساعة بين الروتينات المرنة
  const base = times.length ? times[times.length - 1] + 30 : 8 * 60;
  const slot = Math.min(23 * 60, base + index * 30);
  return { minutes: slot, label: formatMinutes(slot) };
}

function headlineFor({ total, done, todo, insights }) {
  if (total === 0) return 'يومك خالٍ من الروتينات — أضف واحدًا صغيرًا لتبدأ.';
  if (done === total) return 'أنجزت كل روتينات اليوم. يوم رائع ✨';
  if (insights.streak >= 7) return `سلسلة ${insights.streak} أيام — لا تكسرها اليوم.`;
  if (todo === 1) return 'بقي روتين واحد فقط على إتمام اليوم.';
  if (done === 0) return 'ابدأ بالأسهل: خطوة صغيرة تكفي لتحريك اليوم.';
  return `بقيت ${todo} خطوات — تقدمك اليوم ${Math.round((done / total) * 100)}%.`;
}
