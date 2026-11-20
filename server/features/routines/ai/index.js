/**
 * محرّك الذكاء الاصطناعي للروتين — تصميم مقصود:
 * ------------------------------------------------------------
 * يعمل دائمًا، فورًا، ودون إنترنت ودون مفاتيح: محرّك قواعد وخبرة سلوكية
 * يحلّل بياناتك الحقيقية (ساعات، إنجاز، تعثّر أيام، فجوات) ويقترح تعديلات.
 * إن أضفت مفتاح مزوّد LLM (OPENAI_API_KEY أو ANTHROPIC_API_KEY) تُغنى النصائح
 * بتحليل لغوي أعمق — مع رجوع آمن للمحرك المحلي عند أي فشل.
 *
 * الملفات الفرعية:
 *   insights.js  — التحليل الإحصائي والاكتشافات
 *   plan.js      — بناء خطة اليوم
 *   advice.js    — صياغة النصائح (قواعد + LLM اختياري)
 */
import { buildInsights } from './insights.js';
import { buildDayPlan } from './plan.js';
import { buildAdvice, askModel } from './advice.js';
import { buildSystemReview, systemAdvice } from './systems.js';

export { createLlmConfig } from '../../../shared/llm.js';

export function createRoutineCoach({ logger = console, llm = null } = {}) {
  return {
    /** تحليل كامل + خطة + نصائح — نتيجة واحدة جاهزة للواجهة */
    async review({ routines, logs, settings, now = Date.now(), today, timeZone }) {
      const insights = buildInsights({ routines, logs, settings, now, today, timeZone });
      const plan = buildDayPlan({ routines, logs, insights, now, today, timeZone });
      const advice = buildAdvice({ insights, plan, routines });

      // طبقة أنظمة الروتين: توصية مبنية على الفراغات الحقيقية في عاداتك
      let systemReview = { recommendation: null, runnerUp: null, matches: [] };
      try {
        systemReview = await buildSystemReview({ routines, logs, today, timeZone, now });
      } catch (err) {
        logger?.warn?.('routines_system_review_failed', { message: err?.message });
      }
      const extra = systemAdvice(systemReview);
      if (extra) advice.push(extra);

      let narrative = null;
      if (llm) {
        narrative = await askModel(
          llm,
          {
            routineCount: routines.length,
            completionRate: insights.weekCompletion,
            streak: insights.streak,
            todayProgress: insights.today,
            struggles: insights.weakest,
            bestWindow: insights.bestWindow,
            suggestions: advice.map((a) => a.title),
          },
          logger
        );
      }

      return {
        engine: llm ? 'hybrid' : 'local',
        generatedAt: new Date().toISOString(),
        insights,
        plan,
        advice,
        systems: {
          recommendation: systemReview.recommendation,
          runnerUp: systemReview.runnerUp,
          matches: systemReview.matches.map((m) => ({
            id: m.id,
            name: m.name,
            icon: m.icon,
            color: m.color,
            score: m.score,
            headline: m.headline,
            applied: m.applied,
          })),
        },
        narrative,
      };
    },

    buildInsights,
    buildDayPlan,
    buildAdvice,
  };
}

