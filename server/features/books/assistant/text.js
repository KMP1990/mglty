/**
 * نظافة النص العربي — طبقة واحدة تمرّ عليها كل إجابة قبل عرضها.
 * ------------------------------------------------------------
 * الهدف: لا حروف ناقصة/مكرّرة/مقلوبة، لا محارف اتجاه مخفية، لا مسافات
 * غريبة، ولا أشكال عرض عربية (presentation forms) تختلف من خط لآخر.
 *
 * لا نغيّر الإملاء العربي (أ/إ/آ تبقى كما هي)؛ فقط نُطبّع تمثيل Unicode
 * وننظّف المحارف غير المرئية والمسافات والتكرار غير الطبيعي.
 */

const BIDI_AND_ZERO = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const TATWEEL = /\u0640/g;
const REPLACEMENT = /\uFFFD/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const PRESENTATION = /[\uFB50-\uFDFF\uFE70-\uFEFF]/;

/**
 * @param {unknown} value
 * @param {{max?: number, keepLines?: boolean}} options
 */
export function cleanText(value, { max = 4000, keepLines = false } = {}) {
  let out = String(value ?? '');
  if (!out) return '';
  // NFKC يحوّل أشكال العرض العربية (ﻻ، ﺃ…) إلى حروف عادية قابلة للعرض بأي خط.
  out = out.normalize('NFKC');
  out = out
    .replace(CONTROL, '')
    .replace(REPLACEMENT, '')
    .replace(BIDI_AND_ZERO, '')
    .replace(TATWEEL, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n');

  if (keepLines) {
    out = out
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  } else {
    out = out.replace(/\s+/g, ' ');
  }

  // علامات ترقيم ملتصقة أو مكررة من استخراج PDF/OCR
  out = out
    .replace(/\s+([،؛,.!?؟:])/g, '$1')
    .replace(/([،؛,.!?؟:])\1+/g, '$1')
    .replace(/([.!?؟])\s*\1+/g, '$1')
    .trim();

  return max > 0 ? out.slice(0, max) : out;
}

/** هل النص يبدو تالفًا لدرجة لا تُعرض؟ */
export function looksCorrupted(value) {
  const text = String(value ?? '');
  if (!text.trim()) return true;
  const bad = (text.match(/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) || []).length;
  if (bad / Math.max(1, text.length) > 0.01) return true;

  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 40) {
    const arabic = (letters.match(/[\u0600-\u06FF]/g) || []).length;
    if (arabic / letters.length < 0.2) return true;
  }

  // تكرار حرف عربي أربع مرات أو أكثر داخل كلمة = أثر استخراج/توليد تالف
  if (/([\u0621-\u064A])\1{3,}/u.test(text)) return true;
  return false;
}

/** تقصير آمن عند حدّ كلمة، دون قصّ حرف عربي في منتصف كلمة */
export function limitText(value, max = 260) {
  const text = cleanText(value, { max: 0 });
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(1, max - 1));
  const safe = cut.replace(/\s+\S*$/, '');
  return `${(safe || cut).trim()}…`;
}

function cleanValue(value, key = '') {
  if (typeof value === 'string') {
    const limits = {
      headline: 220,
      summary: 1200,
      answer: 1800,
      notice: 600,
      cloudError: 600,
      label: 90,
      text: 1000,
      term: 80,
      meaning: 480,
      what: 800,
      why: 600,
      caption: 260,
      title: 120,
      kind: 90,
    };
    return cleanText(value, { max: limits[key] || 600, keepLines: key === 'summary' || key === 'answer' });
  }
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, key));
  if (value && typeof value === 'object') {
    const out = Array.isArray(value) ? [] : {};
    for (const [childKey, childValue] of Object.entries(value)) {
      // الحقول التقنية لا نلمسها
      if (['engine', 'provider', 'model', 'vision', 'visionModel', 'needsVision', 'needsModel', 'degraded', 'task', 'pageNumbers', 'attempts', 'type', 'page', 'index'].includes(childKey)) {
        out[childKey] = childValue;
      } else {
        out[childKey] = cleanValue(childValue, childKey);
      }
    }
    return out;
  }
  return value;
}

/**
 * تنظيف عميق لحمولة المساعد كاملة قبل `res.json`.
 * يحافظ على البنية والأرقام، ويُنظّف كل نص معروض.
 */
export function sanitizeAssistantPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  return cleanValue(payload);
}

export { PRESENTATION };
