/**
 * جودة الإجابة — «خلية الحكم» بين عدة نماذج.
 * ------------------------------------------------------------
 * لا نأخذ أول رد يصل. نقيّم كل مرشّح بمقاييس عربية واضحة:
 *  • نسبة العربية وسلامة الحروف (رفض النص المشوّه).
 *  • طول مناسب للخلاصة، وعدد جمل معقول.
 *  • تغطية الكلمات المفتاحية الحقيقية للصفحة.
 *  • خصم للمقدمات والحشو والتكرار.
 * ثم نختار الأفضل، وندمج منه ومن غيره الكلمات/النقاط بلا تكرار.
 */
import { cleanText, looksCorrupted } from './text.js';

const FILLER = [
  /^(?:بالتأكيد|بالطبع|حسناً|حسنا|هذه الصفحة تتحدث عن|تتحدث هذه الصفحة عن|يتحدث النص عن|في هذا النص|في هذه الصفحة)/u,
  /(?:في الختام|خلاصة القول|كما ذكرنا سابقاً|كما ذكرنا سابقًا|من المهم أن نلاحظ)/u,
];

const ARABIC = /[\u0600-\u06FF]/g;

export function arabicRatio(value) {
  const text = String(value || '');
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (!letters) return 0;
  return (letters.match(ARABIC) || []).length / letters.length;
}

function sentenceCount(value) {
  return String(value || '')
    .split(/[.!?؟۔…]+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 3).length;
}

function normalizeWord(value) {
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueStrings(list, max = 6) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const text = cleanText(item, { max: 260 });
    if (!text) continue;
    const key = normalizeWord(text).slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * @param {object} parsed إجابة JSON من نموذج
 * @param {{task:string, keywords:string[], pageText?:string, multi?:boolean}} context
 */
export function scoreCandidate(parsed, { task = 'summary', keywords = [], pageText = '', multi = false } = {}) {
  if (!parsed || typeof parsed !== 'object') return -1000;
  const text = cleanText(task === 'ask' ? parsed.answer || parsed.summary : parsed.summary || parsed.answer, { max: 1600 });
  if (!text) return -1000;

  let score = 0;
  if (looksCorrupted(text)) return -1000;

  const ratio = arabicRatio(text);
  if (ratio < 0.35) score -= 45;
  else score += Math.min(24, ratio * 24);

  const length = text.length;
  if (length < 45) score -= 22;
  else if (length <= 520) score += 26;
  else if (length <= 900) score += 8;
  else score -= 8;

  const sentences = sentenceCount(text);
  if (sentences <= 0) score -= 15;
  else if (sentences <= 3) score += 12;
  else if (sentences <= 5) score += 2;
  else score -= 10;

  const pageHasNumbers = /[0-9٠-٩۰-۹]/u.test(pageText);
  const summaryHasNumbers = /[0-9٠-٩۰-۹]/u.test(text);
  if (pageHasNumbers && summaryHasNumbers) score += 10;
  else if (pageHasNumbers && !summaryHasNumbers) score -= 16;
  if (Array.isArray(parsed.facts) && parsed.facts.length) score += 6;

  const uniqueKeywords = uniqueStrings(keywords, 8);
  if (uniqueKeywords.length) {
    const haystack = normalizeWord(text);
    const hits = uniqueKeywords.filter((word) => haystack.includes(normalizeWord(word))).length;
    score += (hits / uniqueKeywords.length) * 22;
  }

  for (const pattern of FILLER) {
    if (pattern.test(text)) score -= 9;
  }

  // تكرار جملة أو شطر حرفيًا
  const chunks = text.split(/[.!?؟۔…]+/u).map((part) => normalizeWord(part)).filter((part) => part.length > 20);
  if (new Set(chunks).size < chunks.length) score -= 8;

  if (task === 'summary' && multi && /[\d٠-٩]/.test(text)) score += 5;
  if (Array.isArray(parsed.keywords) && parsed.keywords.length >= 2) score += 4;
  if (task === 'summary' && Array.isArray(parsed.pageBriefs) && parsed.pageBriefs.length >= 2) score += 4;

  // تغطية الصفحة: إذا ذكر ملخص الصفحة كلمات موجودة فعلًا فيها
  if (pageText) {
    const pageWords = new Set(
      normalizeWord(pageText)
        .split(/[^\p{L}\p{N}]+/u)
        .filter((word) => word.length > 3)
        .slice(0, 300)
    );
    const summaryWords = normalizeWord(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 3);
    if (summaryWords.length) {
      const overlap = summaryWords.filter((word) => pageWords.has(word)).length;
      score += Math.min(14, (overlap / summaryWords.length) * 14);
    }
  }

  return Math.round(score * 10) / 10;
}

/** يختار أفضل مرشّح من قائمة `{parsed, ...}` */
export function chooseBest(candidates, context) {
  return (candidates || [])
    .filter((item) => item?.parsed)
    .map((item) => ({ ...item, score: scoreCandidate(item.parsed, context) }))
    .filter((item) => item.score > -100)
    .sort((a, b) => b.score - a.score)[0] || null;
}

/**
 * دمج خفيف: خلاصة الأفضل تبقى كما هي، لكن الكلمات/النقاط/المتابعات
 * تُجمع من بقية النماذج بلا تكرار. الهدف إجابة أغنى لا فقرة مكررة.
 */
export function fuseCandidates(best, others = []) {
  if (!best?.parsed) return null;
  const all = [best, ...(others || []).filter((item) => item?.parsed && item !== best)];
  const parsed = { ...best.parsed };
  parsed.keywords = uniqueStrings(all.flatMap((item) => item.parsed.keywords || []), 6);
  parsed.points = uniqueStrings(all.flatMap((item) => item.parsed.points || []), 4);
  parsed.followUps = uniqueStrings(all.flatMap((item) => item.parsed.followUps || []), 3);
  parsed.terms = all.flatMap((item) => item.parsed.terms || []).slice(0, 5);
  const briefs = [];
  const seenPages = new Set();
  for (const item of all.flatMap((entry) => entry.parsed.pageBriefs || [])) {
    const key = String(item?.page || item?.text || '').slice(0, 80);
    if (!key || seenPages.has(key)) continue;
    seenPages.add(key);
    briefs.push(item);
    if (briefs.length >= 8) break;
  }
  if (briefs.length) parsed.pageBriefs = briefs;
  return { ...best, parsed };
}
