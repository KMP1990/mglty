/**
 * عرض نص المساعد — طبقة واحدة تمنع تلخبط الحروف وتقطيع الكلمات.
 * -----------------------------------------------------------------
 * • NFKC يحوّل أشكال العرض العربية (ﻻ، ﺃ) إلى حروف عادية.
 * • يحذف محارف الاتجاه/العرض الصفري التي تُسبب قلب الكلمات.
 * • لا يغيّر الإملاء ولا يرتّب الحروف من جديد.
 * • لا يستخدم `letter-spacing` ولا يكسر الكلمات (CSS في assistant.css).
 */
import { escapeHtml } from '../../assets/core/core.js';

const BIDI_AND_ZERO = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;
const REPLACEMENT = /\uFFFD/g;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function cleanForDisplay(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(CONTROL, '')
    .replace(REPLACEMENT, '')
    .replace(BIDI_AND_ZERO, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([،؛,.!?؟:])/g, '$1')
    .replace(/([،؛,.!?؟:])\1+/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** نص آمن للعرض داخل HTML مع دعم **عريض** فقط */
export function renderAssistantText(value) {
  return escapeHtml(cleanForDisplay(value))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br />');
}

/** قائمة نصوص نظيفة بلا تكرار */
export function cleanList(value, max = 6) {
  const list = Array.isArray(value) ? value : [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const text = cleanForDisplay(item);
    if (!text) continue;
    const key = text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** أسطر الملخص عند عدة صفحات، أو null لملخص صفحة واحدة */
export function summaryLines(data) {
  if (!Array.isArray(data?.pageBriefs) || !data.pageBriefs.length) return null;
  const seen = new Set();
  const lines = [];
  for (const item of data.pageBriefs) {
    const page = String(item?.page ?? '').trim();
    const text = cleanForDisplay(item?.text);
    if (!text) continue;
    const key = page || text.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({ page, text });
  }
  // صفحة واحدة = خلاصة واحدة، لا سطران مكرران بنفس رقم الصفحة
  return lines.length > 1 ? lines : null;
}
