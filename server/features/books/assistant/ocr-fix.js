/**
 * تصحيح OCR ثنائي اللغة — عربي + إنجليزي.
 * ------------------------------------------------------------
 * • العربي هو الأساس، والإنجليزي قراءة ثانية تساعد في الأرقام/الأسماء/الوحدات.
 * • لا نترجم النص النهائي؛ نُعيد بناء العربية نفسها بعد فهمها ومقارنتها.
 * • إذا فشلت النماذج نُطبّق تصحيحًا محليًا للمسافات والأخطاء الشائعة.
 * • لا تُعرض أي رسالة تحذير للقارئ؛ التصحيح شفاف.
 */
import crypto from 'node:crypto';
import { askLlmDetailed, parseJsonObject } from '../../../shared/llm.js';
import { cleanText, looksCorrupted } from './text.js';

const cache = new Map();
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 80;

const SYSTEM_OCR = `أنت مصحح OCR عربي دقيق جدًا.
مهمتك إعادة بناء النص العربي المقروء من صورة، لا شرحه ولا تلخيصه.

قواعد:
- أصلح المسافات المفقودة والكلمات المقطوعة والحروف الملتصقة.
- أصلح أخطاء OCR الشائعة (هاء/ها، همزات، علامات ترقيم، حروف متشابهة).
- استعن بالقراءة الإنجليزية التقريبية فقط لتثبيت الأرقام والأسماء والمصطلحات والوحدات.
- إذا ساعدتك الترجمة الإنجليزية على فهم جملة مشوّهة، افهمها بالإنجليزية ثم أعد صياغتها بالعربية بنفس المعنى.
- لا تتوسع في المعنى، لا تضف جملة، لا تحذف فكرة، ولا تغيّر الأسلوب.
- أعد النص العربي كاملًا بترتيبه الأصلي وفقراته.
- أعد JSON فقط: {"text":"النص المصحح"}؛ بلا شرح ولا مقدمة.`;

function localRepair(value) {
  let text = cleanText(value, { max: 0, keepLines: true });
  const replacements = [
    [/لميكن/g, 'لم يكن'],
    [/أنيجعل/g, 'أن يجعل'],
    [/ذكاءومصداقية/g, 'ذكاء ومصداقية'],
    [/وإرياكناء/g, 'وإرباكنا'],
    [/يفهمهاء/g, 'يفهمها'],
    [/خبيرومثقف/g, 'خبير ومثقف'],
    [/المعرفةالحقيقية/g, 'المعرفة الحقيقية'],
    [/منتج ماء على/g, 'منتج ما، على'],
    [/حتىحقيقية/g, 'حتى حقيقية'],
    [/([ء-ي](?:ة|ات|ون|ين|اء))ال([ء-ي]{3,})/gu, '$1 ال$2'],
    [/([ء-ي]{3,})ال([ء-ي]{3,})/gu, '$1 ال$2'],
    [/أنواعمختلفة/g, 'أنواع مختلفة'],
    [/علىال/g, 'على ال'],
    [/إلىال/g, 'إلى ال'],
    [/(^|\s)ه\s+(التفصيل)/gu, '$1هذا $2'],
    [/([\u0621-\u064A])هاء(?=[\s،.!؟:؛]|$)/gu, '$1ها'],
    [/[:؛]\s*؛/g, ':'],
    [/؛\s*؛/g, '؛'],
  ];
  for (const [from, to] of replacements) text = text.replace(from, to);
  return text
    .replace(/([،؛.!؟:])(?=[^\s\d])/g, '$1 ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cacheKey(arabic, english) {
  return crypto.createHash('sha1').update(`${arabic}\u0000${english}`).digest('hex');
}

function getCached(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function setCached(key, value) {
  cache.set(key, { at: Date.now(), value });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value);
}

/**
 * @param {{configs?: object[], arabicText?: string, englishText?: string, logger?: object}} input
 * @returns {Promise<{text:string, corrected:boolean, provider?:string|null, model?:string|null}>}
 */
export async function correctOcrText({ configs = [], arabicText = '', englishText = '', logger = console } = {}) {
  const arabic = cleanText(arabicText, { max: 12_000, keepLines: true });
  const english = cleanText(englishText, { max: 6_000, keepLines: true });
  if (!arabic) return { text: '', corrected: false, provider: null, model: null };

  const fallback = localRepair(arabic);
  const key = cacheKey(arabic, english);
  const cached = getCached(key);
  if (cached) return cached;

  const message = [
    'النص العربي الخام من OCR:',
    '"""',
    arabic,
    '"""',
    english ? 'القراءة الإنجليزية التقريبية لنفس الصورة (للمساعدة فقط):' : '',
    english ? '"""' : '',
    english || '',
    english ? '"""' : '',
    'أعد النص العربي المصحح كاملًا في JSON.',
  ]
    .filter(Boolean)
    .join('\n');

  // نموذجان بالتوازي: نأخذ أول نص صالح، والباقي احتياط. لا نُطيل انتظار القارئ.
  const attempts = await Promise.allSettled(
    (configs || []).slice(0, 2).map(async (config) => {
      const result = await askLlmDetailed(config, {
        system: SYSTEM_OCR,
        messages: [{ role: 'user', content: message }],
        maxTokens: 3000,
        json: true,
        timeoutMs: 20_000,
        logger,
      });
      if (!result?.text) return null;
      const parsed = parseJsonObject(result.text);
      const text = cleanText(parsed?.text || (!parsed ? result.text : ''), { max: 12_000, keepLines: true });
      if (!text || looksCorrupted(text)) return null;
      if (text.length < arabic.length * 0.45 || text.length > arabic.length * 1.8) return null;
      return { text, corrected: true, provider: config.provider, model: result.model || config.model };
    })
  );
  for (const attempt of attempts) {
    if (attempt.status === 'fulfilled' && attempt.value) {
      setCached(key, attempt.value);
      return attempt.value;
    }
    if (attempt.status === 'rejected') {
      logger.warn?.('ocr_fix_failed', { code: attempt.reason?.code || attempt.reason?.name || 'failed' });
    }
  }

  const value = { text: fallback, corrected: false, provider: null, model: null };
  setCached(key, value);
  return value;
}

export { localRepair };
