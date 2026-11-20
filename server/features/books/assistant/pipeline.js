/**
 * خط أنابيب الإجابة — يربط الذاكرة المؤقتة بمجلس النماذج.
 * نقطة واحدة تحدد: هل نعيد إجابة محفوظة، أم نسأل عدة نماذج؟
 */
import { getCached, setCached } from './cache.js';
import { runEnsemble } from './ensemble.js';

export async function runCloudPipeline({
  cacheKey = '',
  configs = [],
  messages = [],
  task = 'summary',
  keywords = [],
  pageText = '',
  multi = false,
  logger = console,
} = {}) {
  const cached = getCached(cacheKey);
  if (cached?.ok) return { ...cached, cached: true };

  const result = await runEnsemble({ configs, messages, task, keywords, pageText, multi, logger });
  if (result.ok) setCached(cacheKey, result);
  return { ...result, cached: false };
}
