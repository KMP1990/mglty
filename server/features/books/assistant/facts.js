/**
 * استخراج «الوقائع» من الصفحة: الأعداد، العدّ، والقوائم المهمة.
 * ------------------------------------------------------------
 * القارئ لا يريد تعريفًا فقط؛ يريد «وعددها ٦» إن كانت الصفحة تذكر ذلك.
 * نلتقط الجمل التي تحمل رقمًا/عددًا أو قائمة، ونعرضها كتفاصيل صغيرة
 * حتى لو كان الملخص نفسه مختصرًا.
 */
import { cleanText, limitText } from './text.js';

const NUMBER_WORDS = {
  'أحد عشر': 11,
  'اثنا عشر': 12,
  'اثني عشر': 12,
  'ثلاثة عشر': 13,
  'أربعة عشر': 14,
  'خمسة عشر': 15,
  'ستة عشر': 16,
  'سبعة عشر': 17,
  'ثمانية عشر': 18,
  'تسعة عشر': 19,
  'عشرون': 20,
  'ثلاثون': 30,
  'أربعون': 40,
  'خمسون': 50,
  'ستون': 60,
  'سبعون': 70,
  'ثمانون': 80,
  'تسعون': 90,
  'مئة': 100,
  'مائة': 100,
  'واحد': 1,
  'واحدة': 1,
  'اثنان': 2,
  'اثنتان': 2,
  'ثلاثة': 3,
  'ثلاث': 3,
  'أربعة': 4,
  'أربع': 4,
  'خمسة': 5,
  'خمس': 5,
  'ستة': 6,
  'ست': 6,
  'سبعة': 7,
  'سبع': 7,
  'ثمانية': 8,
  'ثماني': 8,
  'تسعة': 9,
  'تسع': 9,
  'عشرة': 10,
  'عشر': 10,
};

const NUMBER_WORD_RE = new RegExp(
  `(${Object.keys(NUMBER_WORDS)
    .sort((a, b) => b.length - a.length)
    .join('|')})`,
  'u'
);

const COUNT_CUE =
  /(?:عدد(?:ها|هم|هن)?|وعدد(?:ها|هم|هن)?|مجموع(?:ها|هم)?|أنواع|أقسام|عناصر|خطوات|مراحل|أشياء|خصائص|شروط|أركان|مكونات|فئات|مجموعات|صور|أمثلة|قواعد|مبادئ|أسباب|نتائج|فوائد|أضرار|مراتب|درجات|حالات|أجزاء|مستويات|فروع|عوامل|قواعد|أدوات)/u;

function latinDigits(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function splitSentences(text) {
  return String(text || '')
    .replace(/[ \t]+/g, ' ')
    .split(/(?<=[.!?؟۔…])\s+|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberIn(sentence) {
  const digit = sentence.match(/[0-9٠-٩۰-۹]+/);
  if (digit) return { raw: digit[0], index: digit.index, value: latinDigits(digit[0]) };
  const word = sentence.match(NUMBER_WORD_RE);
  if (word) return { raw: word[0], index: word.index, value: String(NUMBER_WORDS[word[0]] || '') };
  return null;
}

/**
 * @returns {Array<{text:string, value:string, label:string}>}
 */
export function extractFacts(text, { limit = 6 } = {}) {
  const clean = cleanText(text, { max: 0, keepLines: false });
  const out = [];
  const seen = new Set();

  for (const sentence of splitSentences(clean)) {
    if (sentence.length < 10 || sentence.length > 360) continue;
    if (/^(?:صفحة|page)\s*[\d٠-٩]+/iu.test(sentence)) continue;
    if (/^[\d٠-٩۰-۹\s.,،:;؛-]+$/u.test(sentence)) continue;

    const found = numberIn(sentence);
    if (!found) continue;
    // نُفضّل الجمل التي فيها إشارة عدّ/قائمة، لكن لا نهمل رقمًا واضحًا في جملة مفيدة.
    const hasCue = COUNT_CUE.test(sentence);
    if (!hasCue && sentence.length < 28) continue;

    const before = sentence.slice(Math.max(0, found.index - 36), found.index).trim();
    const label = before.split(/\s+/).slice(-3).join(' ') || 'العدد';
    const fact = {
      text: limitText(sentence, 230),
      value: String(found.value || '').trim(),
      label: limitText(label, 60),
    };
    const key = `${fact.value}:${fact.text.slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
    if (out.length >= limit) break;
  }
  return out;
}
