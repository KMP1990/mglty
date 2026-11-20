/**
 * تطبيع شكل إجابة النموذج — أرقام، نصوص، قوائم، مخطط، وصفحات.
 * ------------------------------------------------------------
 * فصلناه عن المحرك حتى يبقى `index.js` منطقًا فقط، وحتى يمكن اختبار
 * التنظيف والتطبيع دون استدعاء أي مزوّد.
 */
import { cleanText, limitText } from './text.js';

export const clampText = (value, max = 1400) => cleanText(value, { max });
export const clampRaw = (value, max = 18_000) => String(value || '').replace(/\u0000/g, '').slice(0, max);

export function normalizeList(value, max = 8, maxChars = 320) {
  if (Array.isArray(value)) return value.map((v) => limitText(v, maxChars)).filter(Boolean).slice(0, max);
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n+|(?<=[.!?؟۔…])\s+/)
      .map((v) => limitText(v, maxChars))
      .filter(Boolean)
      .slice(0, max);
  }
  return [];
}

export function normalizeExplanation(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return { label: 'توضيح', text: limitText(item, 1500) };
      if (item && typeof item === 'object') {
        return {
          label: limitText(item.label || item.title || 'توضيح', 80),
          text: limitText(item.text || item.body || item.value, 1500),
        };
      }
      return null;
    })
    .filter((item) => item && item.text)
    .slice(0, 8);
}

export function normalizeTerms(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (item && typeof item === 'object') {
        return {
          term: limitText(item.term || item.word || item.name, 60),
          meaning: limitText(item.meaning || item.definition || item.text, 420),
        };
      }
      if (typeof item === 'string') {
        const [term, ...rest] = item.split(/[:=—-]/);
        if (rest.length) return { term: limitText(term, 60), meaning: limitText(rest.join(' '), 420) };
      }
      return null;
    })
    .filter((t) => t && t.term && t.meaning)
    .slice(0, 8);
}

export function normalizeImages(value, fallback) {
  const out = [];
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 6)) {
      if (!item || typeof item !== 'object') continue;
      out.push({
        index: Number(item.index) || out.length + 1,
        kind: limitText(item.kind || item.type || 'رسمة توضيحية', 80),
        what: limitText(item.what || item.description || item.text, 700),
        why: limitText(item.why || item.importance, 500),
        how: normalizeList(item.how || item.steps, 4, 220),
        caption: item.caption ? limitText(item.caption, 220) : null,
      });
    }
  }
  if (!out.length) return fallback;
  return out.map((image, index) => ({
    ...image,
    why: image.why || fallback[index]?.why || 'تساعد الرسمة على تثبيت الفكرة وربط أجزائها.',
    how: image.how.length ? image.how : fallback[index]?.how || [],
  }));
}

export function normalizeDiagram(value, fallback) {
  if (!value || typeof value !== 'object') return fallback || null;
  const branches = (Array.isArray(value.branches) ? value.branches : [])
    .map((branch) => {
      if (!branch) return null;
      if (typeof branch === 'string') return { label: limitText(branch, 60), leaves: [] };
      const label = limitText(branch.label || branch.title || branch.name, 60);
      if (!label) return null;
      const leaves = normalizeList(branch.leaves || branch.items || branch.children, 4, 80);
      return { label, leaves };
    })
    .filter(Boolean)
    .slice(0, 6);
  if (branches.length < 2) return fallback || null;
  return { type: 'mindmap', title: limitText(value.title || 'خريطة الأفكار', 80), branches };
}

export function normalizeKeywords(value, fallback = []) {
  const list = normalizeList(value, 8, 48);
  if (list.length) return list;
  return Array.isArray(fallback) ? fallback.slice(0, 8).map((item) => limitText(item, 48)).filter(Boolean) : [];
}

export function normalizeFacts(value, fallback = []) {
  const list = [];
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 6)) {
      if (item && typeof item === 'object') {
        const text = limitText(item.text || item.fact || item.value, 230);
        if (!text) continue;
        list.push({
          text,
          value: limitText(item.value ?? item.number ?? '', 30),
          label: limitText(item.label || item.title || 'العدد', 60),
        });
      } else if (typeof item === 'string') {
        const text = limitText(item, 230);
        if (text) list.push({ text, value: '', label: 'تفصيل' });
      }
    }
  }
  const source = list.length ? list : Array.isArray(fallback) ? fallback : [];
  const seen = new Set();
  const out = [];
  for (const item of source) {
    const text = limitText(typeof item === 'string' ? item : item?.text, 230);
    if (!text) continue;
    const key = text.slice(0, 90);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      text,
      value: limitText(typeof item === 'object' ? item?.value : '', 30),
      label: limitText(typeof item === 'object' ? item?.label || 'العدد' : 'تفصيل', 60),
    });
  }
  return out.slice(0, 5);
}

export function normalizePageBriefs(value) {
  let list = [];
  if (Array.isArray(value)) {
    list = value
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const page = String(item.page ?? item.number ?? '').trim();
        const text = limitText(item.text || item.summary || item.brief, 240);
        if (!page || !text) return null;
        return { page, text };
      })
      .filter(Boolean);
  }
  // لا نستخدم نص الصفحة الخام كـ«ملخص» — إما ملخصات من النموذج أو لا شيء.
  // نُزيل أي تكرار لنفس الصفحة (بعض النماذج ترجع صفحة ١ مرتين).
  const byPage = new Map();
  for (const item of list) {
    const key = item.page || item.text.slice(0, 60);
    if (byPage.has(key)) continue;
    byPage.set(key, item);
  }
  return [...byPage.values()].slice(0, 8);
}
