/**
 * عقل نظام الهدوء الذهني.
 * يقيس: روتينات التهدئة، التزام الليل، والتأخير الذي يولّد التوتر.
 */
import { buildMetrics, clamp, missingCore, scoreFrom, signal, titleMatchCount, verdictOf } from '../engine.js';

const CALM_WORDS = ['تنفس', 'تدوين', 'هدوء', 'امتنان', 'صامت', 'اغلاق', 'شاشه'];

export default {
  id: 'calm',
  evaluate({ system, routines, logs, today, timeZone, now }) {
    const m = buildMetrics({ routines, logs, today, timeZone, now });
    const calmRoutines = titleMatchCount(m.active, CALM_WORDS);
    const missing = missingCore(system, m.active);
    const score = scoreFrom({
      base: 42,
      completion: m.completion,
      activeCount: m.activeCount,
      overdue: m.overdue,
      missing: missing.length,
      signals: Math.min(18, calmRoutines * 6) + (m.windows.night.rate >= 60 ? 8 : 0),
    });

    const headline =
      m.activeCount === 0
        ? 'ابدأ بـ٣ دقائق تنفس فقط. الهدوء مهارة تُبنى بالتكرار لا بالنية.'
        : m.overdue
          ? 'يومك متأخر قليلًا — اسمح لنفسك بتخطي روتين واحد اليوم بدل مطاردة كل شيء.'
          : missing.length
            ? `أضف «${missing[0].title}» — خطوة صغيرة تعيد لك مساحة داخلية.`
            : m.windows.night.rate < 50
              ? 'ليلك هو الحلقة الأضعف. اجعل إغلاق اليوم موعدًا ثابتًا لا اختياريًا.'
              : 'إيقاعك هادئ ومستقر. احمِ ليلك من الشاشات وسترى فرقًا في صباحك.';

    return {
      score: clamp(score),
      verdict: verdictOf(score),
      headline,
      signals: [
        signal('روتينات التهدئة', `${calmRoutines}`, calmRoutines >= 2 ? 'good' : 'warn'),
        signal('التزام الليل', `${m.windows.night.rate}%`, m.windows.night.rate >= 55 ? 'good' : 'warn'),
        signal('متأخر اليوم', `${m.overdue}`, m.overdue ? 'warn' : 'good'),
        signal('أساسيات ناقصة', `${missing.length}`, missing.length ? 'warn' : 'good'),
      ],
      nextSteps: missing.slice(0, 2).map((r) => `أضف «${r.title}»${r.time ? ` عند ${r.time}` : ''}`),
    };
  },
};
