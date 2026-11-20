/**
 * بناء «الخلاصة الواحدة» — لا شرح، لا تكرار، لا فقرات طويلة.
 * ------------------------------------------------------------
 * نأخذ أفضل جمل الصفحة التي اختارها المحرك المحلي، ثم نُنتج:
 *   • headline  : عنوان ثابت قصير للبطاقة.
 *   • summary   : خلاصة واحدة (جملتان كحد أقصى للصفحة الواحدة).
 *   • points    : تفاصيل إضافية غير مكررة (للاستخدام الاختياري).
 *   • keywords  : كلمات مفتاحية تُعرض كشرائح صغيرة.
 *   • pageBriefs: سطر لكل صفحة عند تلخيص عدة صفحات.
 */
import { cleanText, limitText } from './text.js';

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = cleanText(item, { max: 0 });
    if (!text || text.length < 10) continue;
    const key = text.replace(/\s+/g, ' ').slice(0, 120);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/**
 * @param {{
 *   important?: string[],
 *   keywords?: string[],
 *   pageBriefs?: Array<{page: string|number, text: string}>,
 *   multi?: boolean,
 *   fallback?: string,
 *   pageNumber?: number|string,
 * }} input
 */
export function buildBrief({ important = [], keywords = [], pageBriefs = [], multi = false, fallback = '', pageNumber = '' } = {}) {
  const sentences = uniq(important);
  const briefs = (Array.isArray(pageBriefs) ? pageBriefs : [])
    .map((item) => ({
      page: String(item?.page ?? '').trim(),
      text: limitText(item?.text, 220),
    }))
    .filter((item) => item.text);

  let summary = '';
  if (multi && briefs.length) {
    summary = briefs
      .slice(0, 5)
      .map((item) => `صفحة ${item.page}: ${item.text}`)
      .join(' — ');
  } else {
    summary = sentences
      .slice(0, 2)
      .map((sentence) => limitText(sentence, 230))
      .join(' ');
  }
  summary = cleanText(summary || fallback, { max: 760 });
  if (!summary) summary = 'الصفحة ما بيهة نص واضح حتى ألخّصه. جرّب صفحة ثانية.';

  const points = multi && briefs.length
    ? briefs.slice(0, 5).map((item) => `صفحة ${item.page}: ${item.text}`)
    : sentences.slice(2, 6).map((sentence) => limitText(sentence, 190));

  const kicker = pageNumber ? `ملخص صفحة ${pageNumber}` : multi ? 'ملخص الصفحات' : 'ملخص الصفحة';

  return {
    headline: kicker,
    summary,
    points,
    keywords: uniqKeywords(keywords).slice(0, 5),
    pageBriefs: briefs,
  };
}

function uniqKeywords(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const word = cleanText(item, { max: 48 });
    if (!word) continue;
    const key = word.toLocaleLowerCase('ar');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(word);
  }
  return out;
}
