/**
 * عقل نظام التوازن الشامل.
 * يقيس: توزّع الروتينات على جوانب الحياة، الحِمل اليومي، ووجود راحة مقصودة.
 */
import { buildMetrics, clamp, missingCore, scoreFrom, signal, titleMatchCount, verdictOf } from '../engine.js';

const BALANCE_WORDS = ['ماء', 'تنفس', 'اولويات', 'حركه', 'تواصل', 'مال', 'تدوين', 'نوم', 'راحه'];

export default {
  id: 'balance',
  evaluate({ system, routines, logs, today, timeZone, now }) {
    const m = buildMetrics({ routines, logs, today, timeZone, now });
    const balanceRoutines = titleMatchCount(m.active, BALANCE_WORDS);
    const missing = missingCore(system, m.active);
    const loadPenalty = m.activeCount > 9 ? 10 : 0;
    const score = scoreFrom({
      base: 40,
      completion: m.completion,
      activeCount: Math.min(m.activeCount, 9),
      overdue: m.overdue,
      missing: missing.length,
      signals: Math.min(16, balanceRoutines * 4) + (m.activeCount > 0 && m.activeCount <= 8 ? 8 : 0) - loadPenalty,
    });

    const headline =
      m.activeCount === 0
        ? 'ابدأ بثلاث أولويات فقط. التوازن ليس قائمة طويلة، بل قائمة صادقة.'
        : m.activeCount > 9
          ? 'قائمتك ممتلئة أكثر من طاقتك. أرشف روتينين قبل أن تضيف أي شيء جديد.'
          : missing.length
            ? `أضف «${missing[0].title}» — الجانب الذي لا يُسجَّل هو الذي يضيع.`
            : m.overdue
              ? 'تأخرت خطوة اليوم — أنجز أصغرها الآن واترك الباقي بلا ذنب.'
              : m.completion < 40
                ? 'لا تحاول الالتزام بكل شيء. اختر روتينين أساسيين هذا الأسبوع فقط.'
                : 'نظامك متوازن ومستدام. راقب أن تكون الراحة جزءًا من الخطة لا استثناءً.';

    return {
      score: clamp(score),
      verdict: verdictOf(score),
      headline,
      signals: [
        signal('جوانب مغطاة', `${balanceRoutines}`, balanceRoutines >= 3 ? 'good' : 'warn'),
        signal('حِمل اليوم', `${m.totalMinutes} دقيقة`, m.totalMinutes <= 120 ? 'good' : 'warn'),
        signal('التزام أسبوعين', `${m.completion}%`, m.completion >= 60 ? 'good' : 'warn'),
        signal('أساسيات ناقصة', `${missing.length}`, missing.length ? 'warn' : 'good'),
      ],
      nextSteps: missing.slice(0, 2).map((r) => `أضف «${r.title}»${r.time ? ` عند ${r.time}` : ''}`),
    };
  },
};
