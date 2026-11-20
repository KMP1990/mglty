/**
 * ربط أنظمة الروتين بعقل المدرب.
 * يقرأ الأنظمة الخمسة ويعيد: أفضل تطابق، حالة الأنظمة المفعّلة، ونصيحة واحدة
 * تُضاف إلى نصائح المدرب — بلا تكرار إن كان النظام مفعّلًا ومكتملًا.
 */
import { evaluateAll } from '../systems/index.js';

export async function buildSystemReview(ctx) {
  const matches = await evaluateAll(ctx);
  return {
    recommendation: matches[0] || null,
    runnerUp: matches[1] || null,
    matches,
  };
}

export function systemAdvice(review) {
  const best = review?.recommendation;
  if (!best) return null;

  const appliedCore = best.applied?.count || 0;
  const complete = appliedCore >= (best.coreCount || 0) && best.score >= 72;
  if (complete) return null;

  const gap = Math.max(0, (best.coreCount || 0) - appliedCore);
  const body = gap
    ? `${best.headline} ينقصك ${gap} من أساسيات النظام. أضفها من صفحة «أنظمة جاهزة» بدفعة واحدة.`
    : best.headline;

  return {
    id: `system-${best.id}`,
    kind: 'structure',
    severity: 'secondary',
    title: `نظام «${best.name}» قد يناسبك الآن`,
    body,
  };
}
