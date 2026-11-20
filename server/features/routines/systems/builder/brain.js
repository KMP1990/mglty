/**
 * عقل نظام البناء والتعلم.
 * يقيس: وجود حلقة تعلّم/إنتاج، الالتزام، وهل المشروع يتقدم فعلًا.
 */
import { buildMetrics, clamp, missingCore, scoreFrom, signal, titleMatchCount, verdictOf } from '../engine.js';

const LEARNING_WORDS = ['تعلم', 'قراءه', 'كتابه', 'مشروع', 'مراجعه', 'استرجاع', 'خطه'];

export default {
  id: 'builder',
  evaluate({ system, routines, logs, today, timeZone, now }) {
    const m = buildMetrics({ routines, logs, today, timeZone, now });
    const learningRoutines = titleMatchCount(m.active, LEARNING_WORDS);
    const missing = missingCore(system, m.active);
    const score = scoreFrom({
      base: 38,
      completion: m.completion,
      activeCount: m.activeCount,
      overdue: m.overdue,
      missing: missing.length,
      signals: Math.min(16, learningRoutines * 4) + (learningRoutines >= 3 ? 10 : 0) + (m.windows.morning.rate >= 60 ? 5 : 0),
    });

    const headline =
      m.activeCount === 0
        ? 'لا تحتاج خطة ضخمة — ٢٥ دقيقة تعلّم غدًا هي بداية نظام كامل.'
        : missing.length
          ? `نظامك ناقص ${missing.length} أساسيات. ابدأ بـ«${missing[0].title}» فقط هذا الأسبوع.`
          : m.completion < 40
            ? 'أفكارك أكبر من وقتك. قلّل جلسة واحدة واجعلها ثابتة قبل أن تضيف غيرها.'
            : m.overdue
              ? 'هناك خطوة فات موعدها اليوم — ١٠ دقائق منها الآن أفضل من تأجيلها.'
              : 'حلقتك التعليمية تعمل. وثّق مخرجاتك أسبوعيًا لترى التقدم الحقيقي.';

    return {
      score: clamp(score),
      verdict: verdictOf(score),
      headline,
      signals: [
        signal('روتينات البناء', `${learningRoutines}`, learningRoutines >= 3 ? 'good' : 'warn'),
        signal('التزام أسبوعين', `${m.completion}%`, m.completion >= 60 ? 'good' : 'warn'),
        signal('التزام الصباح', `${m.windows.morning.rate}%`, m.windows.morning.rate >= 60 ? 'good' : 'warn'),
        signal('أساسيات ناقصة', `${missing.length}`, missing.length ? 'warn' : 'good'),
      ],
      nextSteps: missing.slice(0, 2).map((r) => `أضف «${r.title}»${r.time ? ` عند ${r.time}` : ''}`),
    };
  },
};
