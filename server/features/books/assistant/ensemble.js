/**
 * «مجلس النماذج» — يشغّل أكثر من نموذج مجاني، يقارن، ويختار الأفضل.
 * ------------------------------------------------------------
 * • دفعتان: نموذجان بالتوازي، ثم نموذج ثالث إذا لم تكن الجودة كافية.
 * • كل نموذج مستقل: فشل واحد لا يلغي الباقي.
 * • لا نعرض خطأ المزوّد للقارئ؛ إن فشل الجميع نرجع للملخص المحلي.
 */
import { askLlmDetailed, parseJsonObject } from '../../../shared/llm.js';
import { SYSTEM } from './prompt.js';
import { chooseBest, fuseCandidates } from './quality.js';
import { failureCode } from './errors.js';

const GOOD_ENOUGH = Number(process.env.AI_GOOD_SCORE || 62);

async function attempt(config, { messages, task, logger, timeoutMs, maxTokens }) {
  try {
    const result = await askLlmDetailed(config, {
      system: SYSTEM,
      messages,
      maxTokens,
      json: true,
      timeoutMs,
      logger,
    });
    if (!result?.text) {
      return { config, result, error: result?.error || { code: 'empty' } };
    }
    let parsed = parseJsonObject(result.text);
    if (!parsed && task === 'ask' && String(result.text).trim().length > 20) {
      parsed = { answer: String(result.text).trim().slice(0, 1200) };
    }
    if (!parsed) return { config, result, error: { code: 'bad_json' } };
    return { config, result, parsed };
  } catch (error) {
    logger.warn?.('books_ensemble_attempt_failed', { provider: config?.provider, code: failureCode(error) });
    return { config, error: { code: failureCode(error) } };
  }
}

/**
 * @returns {{ok:boolean, best?:object, candidates?:object[], attempts:number, failures:string[]}}
 */
export async function runEnsemble({
  configs = [],
  messages = [],
  task = 'summary',
  keywords = [],
  pageText = '',
  multi = false,
  logger = console,
  limit = Number(process.env.AI_ENSEMBLE_LIMIT) || 4,
  timeoutMs = Number(process.env.AI_ENSEMBLE_TIMEOUT_MS) || 18_000,
  maxTokens = 2000,
} = {}) {
  const plan = (configs || []).filter(Boolean).slice(0, Math.max(1, limit));
  const attempts = [];
  const failures = [];

  for (let index = 0; index < plan.length; index += 2) {
    const batch = plan.slice(index, index + 2);
    if (!batch.length) break;
    const results = await Promise.all(batch.map((config) => attempt(config, { messages, task, logger, timeoutMs, maxTokens })));
    for (const item of results) {
      attempts.push(item);
      if (item.error) failures.push(failureCode(item.error));
      if (item.error) {
        logger.warn?.('books_model_failed', { task, provider: item.config?.provider, model: item.config?.model, code: failureCode(item.error) });
      }
    }
    const parsed = attempts.filter((item) => item.parsed);
    if (parsed.length) {
      const best = chooseBest(parsed, { task, keywords, pageText, multi });
      if (best && best.score >= GOOD_ENOUGH) break;
    }
  }

  const parsed = attempts.filter((item) => item.parsed);
  const best = chooseBest(parsed, { task, keywords, pageText, multi });
  if (!best) return { ok: false, attempts: attempts.length, failures };
  return {
    ok: true,
    best: fuseCandidates(best, parsed),
    candidates: parsed,
    attempts: attempts.length,
    failures,
    score: best.score,
  };
}
