/**
 * عقل نظام الطاقة الحيوية.
 * يقيس: الماء والضوء والحركة والنوم وانتظام الأوقات.
 */
import { buildMetrics, clamp, missingCore, scoreFrom, signal, titleMatchCount, verdictOf } from '../engine.js';

const BODY_WORDS = ['ماء', 'ضوء', 'مشي', 'حركه', 'قوه', 'تمدد', 'نوم', 'وجبه'];
const MORNING_WORDS = ['ماء', 'ضوء', 'صباح'];

export default {
  id: 'energy',
  evaluate({ system, routines, logs, today, timeZone, now }) {
    const m = buildMetrics({ routines, logs, today, timeZone, now });
    const bodyRoutines = titleMatchCount(m.active, BODY_WORDS);
    const morningHabits = titleMatchCount(m.active, MORNING_WORDS);
    const missing = missingCore(system, m.active);
    const score = scoreFrom({
      base: 38,
      completion: m.completion,
      activeCount: m.activeCount,
      overdue: m.overdue,
      missing: missing.length,
      signals: Math.min(16, bodyRoutines * 4) + (morningHabits >= 2 ? 10 : 0) + (m.windows.morning.rate >= 60 ? 6 : 0),
    });

    const headline =
      m.activeCount === 0
        ? 'ابدأ بكوب ماء واحد غدًا — هذا أول روتين في النظام وأسهل واحد.'
        : missing.length
          ? `جسدك يطلب ${missing.length} أساسيات ناقصة: ${missing.slice(0, 2).map((r) => `«${r.title}»`).join(' و ')}.`
          : morningHabits < 2
            ? 'أضف ضوء الصباح بجانب الماء — الثنائي الذي يغيّر إيقاع اليوم كله.'
            : m.windows.night.rate < 50
              ? 'التزامك المسائي أضعف — اجعل التمدد والنوم خطوة واحدة لا تُفاوض.'
              : 'طاقتك في تحسّن. حافظ على مواعيد النوم ولا تستبدلها بقهوة إضافية.';

    return {
      score: clamp(score),
      verdict: verdictOf(score),
      headline,
      signals: [
        signal('روتينات الجسد', `${bodyRoutines}`, bodyRoutines >= 3 ? 'good' : 'warn'),
        signal('التزام الصباح', `${m.windows.morning.rate}%`, m.windows.morning.rate >= 60 ? 'good' : 'warn'),
        signal('التزام الليل', `${m.windows.night.rate}%`, m.windows.night.rate >= 55 ? 'good' : 'warn'),
        signal('أساسيات ناقصة', `${missing.length}`, missing.length ? 'warn' : 'good'),
      ],
      nextSteps: missing.slice(0, 2).map((r) => `أضف «${r.title}»${r.time ? ` عند ${r.time}` : ''}`),
    };
  },
};
