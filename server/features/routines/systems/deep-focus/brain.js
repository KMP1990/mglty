/**
 * عقل نظام التركيز العميق.
 * يقيس: وجود نوافذ محمية، نسبة الالتزام، والتأخير الحالي.
 */
import { buildMetrics, clamp, missingCore, scoreFrom, signal, titleMatchCount, verdictOf } from '../engine.js';

const FOCUS_WORDS = ['تركيز', 'عميق', 'نافذه', 'مذاكره', 'عمل'];

export default {
  id: 'deep-focus',
  evaluate({ system, routines, logs, today, timeZone, now }) {
    const m = buildMetrics({ routines, logs, today, timeZone, now });
    const focusRoutines = titleMatchCount(m.active, FOCUS_WORDS);
    const missing = missingCore(system, m.active);
    const score = scoreFrom({
      base: 40,
      completion: m.completion,
      activeCount: m.activeCount,
      overdue: m.overdue,
      missing: missing.length,
      signals: Math.min(18, focusRoutines * 6) + (m.timedCount >= 3 ? 6 : 0),
    });

    const headline =
      m.activeCount === 0
        ? 'لم تبدأ بعد — نافذة تركيز واحدة اليوم تكفي لتغيير الأسبوع.'
        : missing.length
          ? `لديك ${missing.length} روتين أساسي ناقص من النظام — أضفه وستشعر بالفرق خلال أيام.`
          : m.overdue
            ? 'هناك نافذة فات وقتها اليوم — أنجز أول ٥ دقائق منها الآن، لا تؤجلها للغد.'
            : 'نظامك نشط. احمِ نافذتك الأولى من الإشعارات، فهي التي تصنع اليوم.';

    return {
      score: clamp(score),
      verdict: verdictOf(score),
      headline,
      signals: [
        signal('نوافذ تركيز', `${focusRoutines}`, focusRoutines >= 2 ? 'good' : 'warn'),
        signal('التزام أسبوعين', `${m.completion}%`, m.completion >= 65 ? 'good' : 'warn'),
        signal('متأخر اليوم', `${m.overdue}`, m.overdue ? 'warn' : 'good'),
        signal('أساسيات ناقصة', `${missing.length}`, missing.length ? 'warn' : 'good'),
      ],
      nextSteps: missing.slice(0, 2).map((r) => `أضف «${r.title}»${r.time ? ` عند ${r.time}` : ''}`),
    };
  },
};
