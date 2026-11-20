/**
 * قراءة ملفات الكتب — ميزة فرعية داخل "كتبي".
 * ------------------------------------------------------------
 * يحوّل الملف إلى فصول HTML آمنة (نص + صور) تُعرض في القارئ:
 *  • PDF   عبر محرك pdf.js المحلي (نص + صفحات ممسوحة كصور)
 *  • EPUB / DOCX عبر قارئ ZIP المدمج
 *  • TXT / MD / HTML / RTF / CSV / JSON كنص منسّق
 *  • صور مباشرة كصفحة مصوّرة
 * كل شيء يحدث في المتصفح؛ لا يُرفع الملف إلى أي خادم.
 */
import { openZip } from './zip.js';

const IMAGE_BUDGET = 16 * 1024 * 1024; // حد بيانات الصور داخل الكتاب بعد التصغير
const MAX_IMAGES = 120;

const DROP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'audio',
  'video',
  'source',
  'track',
  'base',
]);

const ALLOWED_ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan'],
  ol: ['start', 'type'],
  li: ['value'],
  '*': ['dir', 'lang'],
};

export const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const arDigits = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

const formatBytes = (bytes) => {
  const units = ['بايت', 'ك.ب', 'م.ب', 'غ.ب'];
  let i = 0;
  let n = Number(bytes) || 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
};

function decodeBytes(bytes) {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const bad = (utf8.match(/\uFFFD/g) || []).length;
  if (bad <= Math.max(2, utf8.length / 400)) return utf8;
  try {
    const cp = new TextDecoder('windows-1256', { fatal: false }).decode(bytes);
    const badCp = (cp.match(/\uFFFD/g) || []).length;
    if (badCp < bad) return cp;
  } catch {
    /* غير مدعوم في بعض المتصفحات */
  }
  try {
    return new TextDecoder('iso-8859-1').decode(bytes);
  } catch {
    return utf8;
  }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, type, quality) {
  if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas'))), type, quality));
}

async function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob);
    } catch {
      /* SVG أو صيغة غير مدعومة في createImageBitmap */
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

/** يصغّر الصورة ويحوّلها إلى data URL لتبقى الكتب خفيفة وسريعة */
export async function prepareImage(blob, { maxSide = 1400, quality = 0.82, budget } = {}) {
  if (!blob || !/^image\//.test(blob.type || '')) return null;
  if (budget && budget.left <= 0) return null;
  const bitmap = await loadBitmap(blob);
  const width = bitmap.width || bitmap.naturalWidth || 0;
  const height = bitmap.height || bitmap.naturalHeight || 0;
  if (!width || !height) return null;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));

  // ملف صغير أصلًا: احتفظ به بجودته إن لم يكن أكبر من الحد
  if (scale === 1 && blob.size <= 420_000) {
    const src = await blobToDataUrl(blob);
    if (budget) budget.left -= src.length;
    return { src, width, height, bytes: blob.size };
  }

  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(outW, outH) : Object.assign(document.createElement('canvas'), { width: outW, height: outH });
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);
  ctx.drawImage(bitmap, 0, 0, outW, outH);
  if (bitmap.close) bitmap.close();

  let out = await canvasToBlob(canvas, 'image/webp', quality);
  if (!out || out.type !== 'image/webp') out = await canvasToBlob(canvas, 'image/jpeg', quality);
  if (out.size > 700_000) out = await canvasToBlob(canvas, 'image/jpeg', 0.68);
  const src = await blobToDataUrl(out);
  if (budget) budget.left -= src.length;
  return { src, width: outW, height: outH, bytes: out.size };
}

function resolveZipPath(baseFile, src) {
  const clean = String(src || '').split('#')[0].split('?')[0].trim();
  if (!clean || /^data:/i.test(clean)) return clean;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean) || clean.startsWith('//')) return null;
  let decoded = clean;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    /* مسار عربي غير مشفّر */
  }
  const stack = baseFile.split('/').slice(0, -1);
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

function textFromNode(node) {
  if (!node) return '';
  const blocks = new Set(['P', 'DIV', 'BR', 'LI', 'TR', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'FIGURE', 'FIGCAPTION', 'SECTION', 'ARTICLE']);
  // نجمع الأجزاء ونحتفظ بآخر محرف فقط.
  // فحص آخر محرف عبر Regex على النص المتراكم بعد كل عقدة يجعل الوقت تربيعيًا
  // (كتب طويلة = آلاف العقد × نص متزايد)، وهو سبب بطء الاستيراد سابقًا.
  const parts = [];
  let last = '';
  const append = (text) => {
    if (!text) return;
    parts.push(text);
    last = text[text.length - 1];
  };
  const walk = (current) => {
    if (current.nodeType === 3) {
      append(current.nodeValue || '');
      return;
    }
    if (current.nodeType !== 1) return;
    // عناصر تعليمية بحتة (مثل «صفحة ٢ (صورة)») لا تدخل نصّ الكتاب ولا البحث
    if (current.hasAttribute('data-no-text')) return;
    const isBlock = blocks.has(current.tagName);
    if (isBlock && last && !/\s/.test(last)) append('\n');
    for (const child of current.childNodes) walk(child);
    if (isBlock && last !== '\n') append('\n');
  };
  walk(node);
  return parts.join('').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** تنظيف HTML الكتاب من أي سكربت/نمط/رابط خطر */
async function sanitizeBody(body, { resolveImage, budget, stats } = {}) {
  const doc = document.implementation.createHTMLDocument('book');
  const out = doc.createElement('div');

  async function clean(node) {
    if (node.nodeType === 3) return doc.createTextNode(node.nodeValue);
    if (node.nodeType !== 1) return null;
    const tag = node.tagName.toLowerCase();
    if (DROP_TAGS.has(tag)) return null;
    if (tag === 'img') {
      const raw = node.getAttribute('src') || '';
      let prepared = null;
      if (/^data:image\/(?:png|jpe?g|webp|gif);/i.test(raw)) {
        if (raw.length < 900_000 && (stats.imageCount || 0) < MAX_IMAGES && (!budget || budget.left > 0)) {
          prepared = { src: raw, width: null, height: null };
          if (budget) budget.left -= raw.length;
        }
      } else if (resolveImage) {
        prepared = await resolveImage(raw);
      }
      if (!prepared?.src) return null;
      const img = doc.createElement('img');
      img.setAttribute('src', prepared.src);
      img.setAttribute('alt', node.getAttribute('alt') || '');
      if (node.getAttribute('title')) img.setAttribute('title', node.getAttribute('title'));
      if (prepared.width) img.setAttribute('width', prepared.width);
      if (prepared.height) img.setAttribute('height', prepared.height);
      img.setAttribute('loading', 'lazy');
      stats.imageCount = (stats.imageCount || 0) + 1;
      return img;
    }

    // نستبدل العناوين الضخمة بعناوين داخل الكتاب
    const map = { h1: 'h2', h2: 'h3', h3: 'h4', h4: 'h5', h5: 'h6', h6: 'h6' };
    const clone = doc.createElement(map[tag] || (['p', 'div', 'br', 'hr', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 'u', 's', 'sub', 'sup', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'figure', 'figcaption', 'span', 'small', 'mark', 'a', 'dl', 'dt', 'dd'].includes(tag) ? tag : 'div'));

    if (tag === 'a') {
      const href = String(node.getAttribute('href') || '');
      if (/^https?:\/\//i.test(href)) {
        clone.setAttribute('href', href);
        clone.setAttribute('target', '_blank');
        clone.setAttribute('rel', 'noopener noreferrer');
      }
      if (node.getAttribute('title')) clone.setAttribute('title', node.getAttribute('title'));
    } else {
      for (const attr of [...(ALLOWED_ATTRS[tag] || []), ...(ALLOWED_ATTRS['*'] || [])]) {
        if (attr === 'src' || attr === 'href' || attr === 'alt') continue;
        const value = node.getAttribute(attr);
        if (value != null && value.length < 200) clone.setAttribute(attr, value);
      }
    }

    for (const child of [...node.childNodes]) {
      const cleaned = await clean(child);
      if (cleaned) clone.appendChild(cleaned);
    }
    if (clone.tagName === 'DIV' && !clone.attributes.length) {
      // حاوية بلا دلالة: نرفع أبناءها مباشرة
      const fragment = doc.createDocumentFragment();
      while (clone.firstChild) fragment.appendChild(clone.firstChild);
      return fragment;
    }
    return clone;
  }

  for (const child of [...body.childNodes]) {
    const cleaned = await clean(child);
    if (cleaned) out.appendChild(cleaned);
  }
  return out;
}

function makeChapter({ title, html, index }) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const text = textFromNode(holder);
  return {
    id: `c${index}`,
    title: String(title || '').trim() || `الفصل ${arDigits(index + 1)}`,
    html,
    text: text.slice(0, 300_000),
    imageCount: holder.querySelectorAll('img').length,
    words: (text.match(/[\p{L}\p{N}]+/gu) || []).length,
  };
}

/** حد أقصى لحجم الفصل الواحد: يحمي القارئ من فصول ضخمة تُبطئ الترقيم */
const MAX_CHAPTER_HTML = 45_000;

function splitTextAtWord(text, room) {
  const limit = Math.max(1, Math.min(text.length, room));
  const windowText = text.slice(0, limit);
  const breakAt = Math.max(windowText.lastIndexOf(' '), windowText.lastIndexOf('\n'), windowText.lastIndexOf('،'));
  const cut = breakAt > limit * 0.55 ? breakAt + 1 : limit;
  return [text.slice(0, cut), text.slice(cut)];
}

/** يقسم عنصرًا واحدًا طويلًا (فقرة فيها آلاف الأسطر) مع الحفاظ على شكله */
function splitLongElement(element, maxChars) {
  const pieces = [];
  let current = element.cloneNode(false);
  let length = 0;
  const flush = () => {
    if (!current.childNodes.length) return;
    pieces.push(current.outerHTML);
    current = element.cloneNode(false);
    length = 0;
  };

  for (const child of [...element.childNodes]) {
    if (child.nodeType === 3) {
      let text = child.nodeValue || '';
      while (text) {
        const room = maxChars - length;
        if (text.length <= room) {
          current.appendChild(document.createTextNode(text));
          length += text.length;
          break;
        }
        const [head, tail] = splitTextAtWord(text, Math.max(1, room));
        current.appendChild(document.createTextNode(head));
        text = tail;
        flush();
      }
    } else if (child.nodeType === 1) {
      const serialized = child.outerHTML;
      if (serialized.length > maxChars * 1.2) {
        flush();
        pieces.push(...splitLongElement(child, maxChars));
      } else {
        if (length + serialized.length > maxChars && current.childNodes.length) flush();
        current.appendChild(child.cloneNode(true));
        length += serialized.length;
      }
    }
  }
  flush();
  return pieces.length ? pieces : [element.outerHTML];
}

/** يقسم HTML فصل طويل عند حدود الكتل/الأسطر بدل تركه فقرة واحدة ضخمة */
function splitChapterHtml(html, maxChars) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const parts = [];
  let current = '';
  let length = 0;
  const flush = () => {
    if (current.trim()) parts.push(current);
    current = '';
    length = 0;
  };

  const add = (piece) => {
    if (!piece) return;
    if (length + piece.length > maxChars) flush();
    current += piece;
    length += piece.length;
  };

  for (const node of [...holder.childNodes]) {
    if (node.nodeType === 1) {
      const serialized = node.outerHTML;
      if (serialized.length > maxChars) {
        for (const piece of splitLongElement(node, maxChars)) add(piece);
      } else {
        add(serialized);
      }
    } else if (node.nodeType === 3) {
      let text = node.nodeValue || '';
      if (!text.trim()) continue;
      while (text) {
        const [head, tail] = splitTextAtWord(text, maxChars);
        add(escapeHtml(head));
        text = tail;
        if (text) flush();
      }
    }
  }
  flush();
  return parts.length ? parts : [html];
}

function capLongChapters(chapters, maxChars = MAX_CHAPTER_HTML) {
  const out = [];
  // لا نحسب بيانات الصور المضمّنة (base64) في حجم الفصل، وإلا انقسم كل فصل فيه
  // صورة PDF إلى عشرات الفصول الوهمية وامتلأ الفهرس بعناوين مكررة.
  const weight = (html) => String(html).replace(/data:[^"')\s]+/g, 'data:').length;
  for (const chapter of chapters) {
    const html = String(chapter.html || '');
    if (weight(html) <= maxChars) {
      out.push(chapter);
      continue;
    }
    const parts = splitChapterHtml(html, maxChars);
    const baseTitle = String(chapter.title || 'فصل').trim() || 'فصل';
    parts.forEach((part, index) => {
      const title = parts.length > 1 ? `${baseTitle} (${arDigits(index + 1)})` : baseTitle;
      out.push(makeChapter({ title, html: part, index: out.length }));
    });
  }
  return out;
}

function splitPlainChapters(text, fallbackTitle) {
  const lines = text.replace(/\r/g, '').split('\n');
  const headingRe = /^\s*(?:#{1,3}\s*)?(?:الفصل|الباب|الجزء|القسم|المقدمة|مقدمة|الخاتمة|خاتمة|التمهيد|تمهيد)(?:\s|:|$).{0,80}$/;
  const marks = [];
  lines.forEach((line, index) => {
    if (headingRe.test(line) && line.trim().length <= 90) marks.push({ index, title: line.replace(/^\s*#{1,3}\s*/, '').trim(), markdown: /^\s*#{1,3}\s/.test(line) });
  });
  if (marks.length >= 2) {
    const chapters = [];
    if (marks[0].index > 0) {
      const intro = lines.slice(0, marks[0].index).join('\n').trim();
      if (intro.length > 40) chapters.push({ title: fallbackTitle || 'البداية', markdown: false, body: intro });
    }
    marks.forEach((mark, i) => {
      const end = marks[i + 1]?.index ?? lines.length;
      chapters.push({ title: mark.title, markdown: mark.markdown, body: lines.slice(mark.index + 1, end).join('\n').trim() });
    });
    return chapters.filter((c) => c.body.length > 20);
  }

  // لا عناوين: نقسم بحسب الطول عند حدود الفقرات
  const chunks = [];
  let current = '';
  for (const paragraph of text.split(/\n{2,}/)) {
    if ((current + paragraph).length > 14_000 && current.length > 2000) {
      chunks.push(current);
      current = '';
    }
    current += `${paragraph}\n\n`;
  }
  if (current.trim()) chunks.push(current);
  return chunks.map((body, i) => ({
    title: chunks.length === 1 ? fallbackTitle || 'النص' : `المجزوءة ${arDigits(i + 1)}`,
    markdown: false,
    body: body.trim(),
  }));
}

/* ---------------- CSV / JSON ---------------- */
function csvToTable(source) {
  const text = String(source || '').replace(/\r\n?/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const limited = rows.slice(0, 1500);
  if (!limited.length) return '';
  const width = Math.max(...limited.map((r) => r.length));
  const head = limited[0];
  const body = limited.slice(1);
  return `<table><thead><tr>${head
    .map((value) => `<th>${escapeHtml(value.trim())}</th>`)
    .join('')}</tr></thead><tbody>${body
    .map(
      (r) =>
        `<tr>${Array.from({ length: width }, (_, index) => `<td>${escapeHtml((r[index] || '').trim())}</td>`).join('')}</tr>`
    )
    .join('')}</tbody></table>`;
}

/* ---------------- RTF مبسّط ---------------- */
const RTF_SKIP_DESTINATIONS = new Set([
  'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'object', 'header', 'headerl', 'headerr',
  'footer', 'footerl', 'footerr', 'footnote', 'fldinst', 'xe', 'tc',
  'bkmkstart', 'bkmkend', 'listtable', 'listoverridetable', 'revtbl', 'rsidtbl', 'generator',
]);

/** يستخرج نصًا مقروءًا من RTF: يتجاهل الجداول والصور، ويفكّ \uN و\'hh */
export function rtfToText(source) {
  const raw = String(source || '');
  const cp = /\\ansicpg(\d+)/.exec(raw)?.[1];
  let decoder = null;
  if (cp) {
    try {
      decoder = new TextDecoder(`windows-${cp}`, { fatal: false });
    } catch {
      decoder = null;
    }
  }
  const decodeByte = (byte) => {
    if (decoder) return decoder.decode(Uint8Array.of(byte));
    try {
      return new TextDecoder('windows-1256', { fatal: false }).decode(Uint8Array.of(byte));
    } catch {
      return String.fromCharCode(byte);
    }
  };

  let out = '';
  let i = 0;
  let skip = false;
  let ucSkip = 1;
  let pendingSkip = 0;
  const stack = [];

  const append = (text) => {
    if (skip) return;
    out += text;
  };

  while (i < raw.length) {
    const ch = raw[i];
    if (ch === '{') {
      stack.push({ skip, ucSkip });
      i += 1;
      continue;
    }
    if (ch === '}') {
      const prev = stack.pop();
      skip = prev ? prev.skip : false;
      ucSkip = prev ? prev.ucSkip : 1;
      pendingSkip = 0;
      i += 1;
      continue;
    }
    if (ch === '\\') {
      const next = raw[i + 1];
      if (next === '\\' || next === '{' || next === '}') {
        if (pendingSkip > 0) pendingSkip -= 1;
        else append(next);
        i += 2;
        continue;
      }
      if (next === "'") {
        const hex = raw.slice(i + 2, i + 4);
        if (/^[0-9a-f]{2}$/i.test(hex)) {
          if (pendingSkip > 0) pendingSkip -= 1;
          else append(decodeByte(parseInt(hex, 16)));
          i += 4;
          continue;
        }
        i += 2;
        continue;
      }
      if (next === '*') {
        skip = true;
        i += 2;
        continue;
      }
      const match = /^\\([a-z]+)(-?\d+)? ?/i.exec(raw.slice(i));
      if (!match) {
        i += 2;
        continue;
      }
      const name = match[1].toLowerCase();
      const value = match[2] != null ? Number(match[2]) : null;
      i += match[0].length;
      if (RTF_SKIP_DESTINATIONS.has(name)) {
        skip = true;
        continue;
      }
      if (name === 'uc' && value != null) {
        ucSkip = Math.max(0, value);
        continue;
      }
      if (name === 'u' && value != null) {
        if (pendingSkip > 0) pendingSkip -= 1;
        else append(String.fromCodePoint(value < 0 ? value + 65536 : value));
        pendingSkip = ucSkip;
        continue;
      }
      if (name === 'par' || name === 'line' || name === 'sect' || name === 'page') {
        append('\n');
        continue;
      }
      if (name === 'tab') {
        append('\t');
        continue;
      }
      continue;
    }
    if (pendingSkip > 0) {
      pendingSkip -= 1;
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      i += 1;
      continue;
    }
    append(ch);
    i += 1;
  }

  return out
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/* ---------------- Markdown مبسّط وآمن ---------------- */
function inlineMarkdown(text) {
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, '<code>$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return out;
}

export function markdownToHtml(source) {
  const lines = String(source || '').replace(/\r/g, '').split('\n');
  const out = [];
  let paragraph = [];
  let list = null;
  let inCode = false;
  let code = [];
  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    out.push(`<${list.tag}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };

  for (const line of lines) {
    if (/^```/.test(line.trim())) {
      flushParagraph();
      flushList();
      if (inCode) {
        out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
        code = [];
      }
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(4, heading[1].length + 1);
      out.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(?:---+|\*\*\*+)\s*$/.test(line)) {
      flushParagraph();
      flushList();
      out.push('<hr />');
      continue;
    }
    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      flushParagraph();
      flushList();
      out.push(`<blockquote>${inlineMarkdown(quote[1])}</blockquote>`);
      continue;
    }
    const ordered = /^\s*\d+\.\s+(.*)$/.exec(line);
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (ordered || bullet) {
      flushParagraph();
      const tag = ordered ? 'ol' : 'ul';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((ordered || bullet)[1]);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  if (inCode && code.length) out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
  return out.join('\n');
}

/* ---------------- EPUB ---------------- */
async function parseEpub(bytes, file, onProgress) {
  const zip = openZip(bytes);
  onProgress?.('قراءة بنية EPUB…', 0.2);
  const containerXml = await zip.text('META-INF/container.xml');
  let opfPath = null;
  if (containerXml) {
    const doc = new DOMParser().parseFromString(containerXml, 'application/xml');
    const rootfile = [...doc.getElementsByTagName('*')].find((el) => el.localName === 'rootfile');
    opfPath = rootfile?.getAttribute('full-path') || null;
  }
  if (!opfPath) opfPath = zip.find(/\.opf$/i);
  if (!opfPath) throw new Error('ملف EPUB لا يحتوي على ملف محتوى (OPF)');

  const opf = new DOMParser().parseFromString(await zip.text(opfPath), 'application/xml');
  const byLocal = (name) => [...opf.getElementsByTagName('*')].filter((el) => el.localName === name);
  const title = byLocal('title')[0]?.textContent?.trim() || file.name.replace(/\.[^.]+$/, '');
  const author = byLocal('creator')[0]?.textContent?.trim() || '';
  const manifest = new Map();
  for (const item of byLocal('item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, { href, type: item.getAttribute('media-type') || '', props: item.getAttribute('properties') || '' });
  }
  const spine = byLocal('itemref')
    .map((el) => el.getAttribute('idref'))
    .map((id) => (id ? manifest.get(id) : null))
    .filter(Boolean)
    .filter((item) => /html|xhtml/i.test(item.type) || /\.x?html?$/i.test(item.href));

  const budget = { left: IMAGE_BUDGET };
  const stats = { imageCount: 0 };
  const warnings = [];
  const chapters = [];

  const readImage = async (src, baseFile) => {
    const path = resolveZipPath(baseFile, src);
    if (!path) return null;
    const data = await zip.read(path).catch(() => null);
    if (!data) return null;
    const mime = /\.png$/i.test(path)
      ? 'image/png'
      : /\.gif$/i.test(path)
        ? 'image/gif'
        : /\.webp$/i.test(path)
          ? 'image/webp'
          : /\.svg$/i.test(path)
            ? 'image/svg+xml'
            : 'image/jpeg';
    try {
      return await prepareImage(new Blob([data], { type: mime }), { maxSide: 1400, budget });
    } catch {
      warnings.push(`تعذّر عرض صورة: ${path.split('/').pop()}`);
      return null;
    }
  };

  const list = spine.length ? spine : [...manifest.values()].filter((item) => /html|xhtml/i.test(item.type)).slice(0, 200);

  // غلاف EPUB: properties="cover-image" أو <meta name="cover" content="id">
  let cover = null;
  try {
    const coverMeta = byLocal('meta').find((el) => (el.getAttribute('name') || '').toLowerCase() === 'cover');
    const coverItem =
      [...manifest.values()].find((item) => /cover-image/i.test(item.props)) ||
      (coverMeta ? manifest.get(coverMeta.getAttribute('content')) : null);
    const coverPath = coverItem?.href ? resolveZipPath(opfPath, coverItem.href) : null;
    const data = coverPath ? await zip.read(coverPath).catch(() => null) : null;
    if (data) {
      const mime = /\.png$/i.test(coverPath)
        ? 'image/png'
        : /\.gif$/i.test(coverPath)
          ? 'image/gif'
          : /\.webp$/i.test(coverPath)
            ? 'image/webp'
            : /\.svg$/i.test(coverPath)
              ? 'image/svg+xml'
              : 'image/jpeg';
      const prepared = await prepareImage(new Blob([data], { type: mime }), {
        maxSide: 520,
        quality: 0.78,
        budget: { left: 2_000_000 },
      });
      cover = prepared?.src || null;
    }
  } catch {
    /* الغلاف اختياري — الكتاب يُقرأ بدونه */
  }
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    const path = resolveZipPath(opfPath, item.href);
    if (!path) continue;
    const source = await zip.text(path).catch(() => null);
    if (!source) continue;
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const heading = doc.querySelector('body h1, body h2, body h3') || doc.querySelector('title');
    const headingText = heading?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const body = doc.body || doc.documentElement;
    const cleaned = await sanitizeBody(body, {
      resolveImage: (src) => readImage(src, path),
      budget,
      stats,
    });
    const html = cleaned.innerHTML;
    if (textFromNode(cleaned).length < 12 && !cleaned.querySelector('img')) continue;
    chapters.push(makeChapter({ title: headingText, html, index: chapters.length }));
    if (chapters.length % 5 === 0) onProgress?.(`تجهيز الفصول… ${arDigits(chapters.length)}`, 0.3 + (i / Math.max(1, list.length)) * 0.65);
  }

  if (!chapters.length) throw new Error('لم أجد فصولًا قابلة للقراءة في هذا EPUB');
  return { title, author, chapters, warnings, imageCount: stats.imageCount, cover };
}

/* ---------------- DOCX ---------------- */
function attrByLocal(el, local) {
  for (const attr of el.attributes || []) if (attr.localName === local || attr.name === local) return attr.value;
  return null;
}

async function parseDocx(bytes, file, onProgress) {
  const zip = openZip(bytes);
  onProgress?.('قراءة مستند Word…', 0.25);
  const documentXml = await zip.text('word/document.xml');
  if (!documentXml) throw new Error('ملف DOCX لا يحتوي على محتوى document.xml');
  const relsXml = await zip.text('word/_rels/document.xml.rels');
  const rels = new Map();
  if (relsXml) {
    const relDoc = new DOMParser().parseFromString(relsXml, 'application/xml');
    for (const rel of relDoc.getElementsByTagName('*')) {
      if (rel.localName !== 'Relationship') continue;
      const id = rel.getAttribute('Id');
      const target = rel.getAttribute('Target');
      if (id && target) rels.set(id, resolveZipPath('word/document.xml', target));
    }
  }

  const budget = { left: IMAGE_BUDGET };
  const stats = { imageCount: 0 };
  const warnings = [];
  const imageCache = new Map();
  const readImage = async (path) => {
    if (!path) return null;
    if (imageCache.has(path)) return imageCache.get(path);
    const data = await zip.read(path).catch(() => null);
    if (!data) return null;
    const mime = /\.png$/i.test(path) ? 'image/png' : /\.gif$/i.test(path) ? 'image/gif' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg';
    const prepared = await prepareImage(new Blob([data], { type: mime }), { maxSide: 1400, budget }).catch(() => null);
    imageCache.set(path, prepared);
    return prepared;
  };

  const doc = new DOMParser().parseFromString(documentXml, 'application/xml');
  const body = [...doc.getElementsByTagName('*')].find((el) => el.localName === 'body');
  if (!body) throw new Error('بنية مستند Word غير متوقعة');

  const docTitle = [...doc.getElementsByTagName('*')].find((el) => el.localName === 'title')?.textContent?.trim();
  const htmlParts = [];
  let headingCount = 0;

  const textOf = (el) => {
    let text = '';
    for (const node of el.getElementsByTagName('*')) {
      if (node.localName === 't') text += node.textContent || '';
      else if (node.localName === 'tab') text += ' ';
      else if (node.localName === 'br') text += '\n';
    }
    return text.replace(/[ \t]+/g, ' ').trim();
  };

  const imagesOf = async (el) => {
    const out = [];
    for (const blip of el.getElementsByTagName('*')) {
      if (blip.localName !== 'blip') continue;
      const embed = attrByLocal(blip, 'embed') || blip.getAttribute('r:embed');
      const path = embed ? rels.get(embed) : null;
      const image = await readImage(path);
      if (image?.src) out.push(image);
    }
    return out;
  };

  const renderParagraph = async (p) => {
    const text = textOf(p);
    const images = await imagesOf(p);
    const style = [...p.getElementsByTagName('*')].find((el) => el.localName === 'pStyle')?.getAttribute('w:val') || '';
    const headingLevel = /Heading\s*([1-6])/i.exec(style)?.[1] || (/عنوان\s*([1-6])/.test(style) ? RegExp.$1 : null);
    if (headingLevel) headingCount += 1;
    if (text) {
      const tag = headingLevel ? `h${Math.min(4, Number(headingLevel) + 1)}` : 'p';
      htmlParts.push(`<${tag}>${escapeHtml(text).replace(/\n/g, '<br />')}</${tag}>`);
    }
    for (const image of images) {
      if (stats.imageCount >= MAX_IMAGES) break;
      stats.imageCount += 1;
      htmlParts.push(`<figure><img src="${image.src}" alt="" width="${image.width}" height="${image.height}" loading="lazy" /></figure>`);
    }
  };

  const renderTable = (table) => {
    const rows = [];
    for (const tr of table.getElementsByTagName('*')) {
      if (tr.localName !== 'tr') continue;
      const cells = [];
      for (const cell of tr.children || []) {
        if (cell.localName !== 'tc') continue;
        cells.push(`<td>${escapeHtml(textOf(cell)).replace(/\n/g, '<br />')}</td>`);
      }
      if (cells.length) rows.push(`<tr>${cells.join('')}</tr>`);
    }
    if (rows.length) htmlParts.push(`<table><tbody>${rows.join('')}</tbody></table>`);
  };

  const children = [...body.children];
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (child.localName === 'p') await renderParagraph(child);
    else if (child.localName === 'tbl') renderTable(child);
    if (i % 120 === 0) onProgress?.(`تجهيز الصفحات… ${arDigits(i)}`, 0.3 + (i / Math.max(1, children.length)) * 0.65);
  }

  const html = htmlParts.join('\n') || '<p>لا يوجد نص في هذا المستند.</p>';
  const chapterTitle = headingCount > 1 ? (docTitle || 'المحتوى') : file.name.replace(/\.[^.]+$/, '');
  return {
    title: docTitle || file.name.replace(/\.[^.]+$/, ''),
    author: '',
    chapters: [makeChapter({ title: chapterTitle, html, index: 0 })],
    warnings,
    imageCount: stats.imageCount,
  };
}

/* ---------------- PDF ---------------- */
let pdfModulePromise = null;
async function loadPdfEngine() {
  if (!pdfModulePromise) {
    pdfModulePromise = import('/vendor/pdfjs/pdf.mjs').then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.mjs';
      return mod;
    });
  }
  return pdfModulePromise;
}

function normalizePdfLine(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\u06CC/g, '\u064A') // ی فارسی → ي
    .replace(/\u06BE/g, '\u0647') // ھ → ه
    .replace(/\u06C1/g, '\u0647')
    .replace(/\u06C0/g, '\u0647')
    .replace(/\u06A9/g, '\u0643') // ک → ك
    .replace(/\u06D2/g, '\u064A')
    .replace(/[\u200E\u200F\u202A-\u202E]/g, '')
    // بعض خطوط PDF تُخزّن تركيبات لام–ألف (لا/لأ/لإ/لآ/لى) معكوسة داخل السطر،
    // فتصل «الأساس» بصورة «األساس». هذه التسلسلات غير صحيحة إملائيًا فنردّها.
    .replace(/األ/g, 'الأ')
    .replace(/اإل/g, 'الإ')
    .replace(/اآل/g, 'الآ')
    .replace(/ىل/g, 'لى')
    // «التىي» تسلسل ناتج عن رسم النقطتين كحرف مستقل بعد الألف المقصورة.
    .replace(/ىي/g, 'ي')
    .replace(/يى(?=\s|$|[^\u0621-\u064A])/g, 'ي')
    .replace(/(^|\s)\.([A-Za-z][A-Za-z0-9.+#-]*)(?=$|\s)/g, '$1$2.')
    .replace(/\s+([\u064B-\u065F\u0670])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

const ARABIC_RANGE = '\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF';
const ARABIC_LETTER_RANGE = '\u0621-\u064A\u0671-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF';
const ARABIC_LETTER_RUN_RE = new RegExp(`[${ARABIC_LETTER_RANGE}]+`, 'g');
const ARABIC_LETTER_TEST_RE = new RegExp(`[${ARABIC_LETTER_RANGE}]`);
const ARABIC_TEST_RE = new RegExp(`[${ARABIC_RANGE}]`);
const ARABIC_WORD_SPLIT_RE = new RegExp(`[^${ARABIC_RANGE}]+`);
const ARABIC_DIACRITICS_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED]/g;
let arabicSegmenter = null;
try {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    arabicSegmenter = new Intl.Segmenter('ar', { granularity: 'grapheme' });
  }
} catch {
  arabicSegmenter = null;
}

const COMMON_ARABIC_WORDS = new Set([
  'على', 'إلى', 'في', 'من', 'عن', 'أن', 'إن', 'التي', 'الذي', 'الذين', 'هذا', 'هذه',
  'ذلك', 'تلك', 'كان', 'كانت', 'يكون', 'مع', 'بعد', 'قبل', 'كل', 'لكن', 'أو', 'ثم',
  'قد', 'بين', 'عند', 'حتى', 'إذا', 'لم', 'لن', 'له', 'لها', 'به', 'بها', 'عليه',
  'عليها', 'إليه', 'إليها', 'كما', 'حيث', 'منذ', 'خلال', 'حول', 'ضد', 'نحو', 'دون',
  'غير', 'بعض', 'جميع', 'أي', 'أيها', 'يا', 'هو', 'هي', 'هم', 'هن', 'نحن', 'أنت',
  'التي', 'حين', 'أو', 'لكن', 'كذلك', 'أيضا', 'أيضًا', 'الآن', 'دائما', 'دائمًا',
  'بحيث', 'لكي', 'إن', 'إنه', 'أيضا', 'فقط', 'كلما', 'أخرى', 'أخرى', 'اخرى', 'آخر',
  'أنا', 'ما', 'لا', 'و', 'ف', 'ب', 'ل', 'ك', 'تحت', 'تأثير', 'الحديث', 'الإدمان',
  'الإباحية', 'الإنترنت', 'الجنسية', 'المواد', 'أضرار', 'الكتاب', 'المؤلف', 'النسخة',
  'العربية', 'ترجمة', 'وتقديم', 'بدر', 'دماغك',
]);

function graphemes(value) {
  const text = String(value || '');
  if (!text) return [];
  return arabicSegmenter
    ? [...arabicSegmenter.segment(text)].map((part) => part.segment)
    : Array.from(text);
}

/** بعض ملفات PDF تخزّن المقاطع العربية بترتيب بصري داخل العنصر نفسه. */
function reverseArabicText(value) {
  const text = String(value || '');
  if (!ARABIC_LETTER_TEST_RE.test(text)) {
    // عنصر لاتيني/أرقام فقط داخل سطر مخزّن بصريًا: نعكسه ليصبح منطقيًا مقروءًا.
    if (/[A-Za-z0-9]/.test(text)) return graphemes(text).reverse().join('');
    return text;
  }
  if (!/[A-Za-z0-9٠-٩۰-۹]/.test(text)) {
    return graphemes(text).reverse().join('');
  }
  // عند اختلاط عربي بلاتيني/أرقام: نعكس النص كله ثم نعيد كل مقطع
  // لاتيني أو رقمي إلى ترتيبه المنطقي حتى يبقى مقروءًا.
  return graphemes(text)
    .reverse()
    .join('')
    .replace(/[A-Za-z0-9٠-٩][A-Za-z0-9٠-٩+.#:\-/]*/g, (run) => graphemes(run).reverse().join(''));
}

function arabicTextScore(value) {
  const text = normalizePdfLine(value);
  if (!text || !ARABIC_TEST_RE.test(text)) return 0;
  let score = 0;
  const words = text.split(ARABIC_WORD_SPLIT_RE).filter(Boolean);
  for (const raw of words) {
    const word = raw.replace(ARABIC_DIACRITICS_RE, '');
    if (!word) continue;
    if (COMMON_ARABIC_WORDS.has(word)) score += 6;
    if (word.startsWith('ال') && word.length >= 4) score += 2;
    if (/^(?:و|ف|ب|ل|ك)[\u0621-\u064A]{2,}/.test(word) && !COMMON_ARABIC_WORDS.has(word)) score += 1;
    if (/(?:ة|ات|ون|ين|ان|ها|هم|هن|كم|نا|ية)$/.test(word)) score += 1;
    if (/(?:ال|من|في|ون|ات|ية|ها|هم|ين|ان)/.test(word)) score += 1;
    if (/ى(?=.)/.test(word)) score -= 6;
    if (/إا|أا|اإ|اأ/.test(word)) score -= 6;
    if (/اا/.test(word)) score -= 4;
    if (/ة./.test(word)) score -= 3;
    if (/^[\u0621-\u064A]$/.test(word) && !/^[وفبلكاأإ]$/.test(word)) score -= 3;
    if (word.length > 18) score -= 2;
  }

  // الكلمات اللاتينية تُقيَّم منفصلة: «hsilgnE» عكس بصري، و«English» سليمة.
  const latinWords = text.match(/[A-Za-z][A-Za-z'’-]*/g) || [];
  for (const word of latinWords) {
    if (/[a-z][A-Z]/.test(word) || /[A-Z]$/.test(word)) score -= 4;
    else if (/^[A-Z]/.test(word)) score += 2;
    else score += 1;
  }
  return score;
}

function scorePdfLines(lines) {
  return lines.reduce((total, line) => total + arabicTextScore(line.text), 0);
}

/**
 * إصلاح الكلمات العربية المخزّنة بترتيب بصري:
 * لكل كلمة نجرّب كل الاحتمالات ونختار الأعلى في التقييم اللغوي:
 *  1. الكلمة كما هي (ترتيب منطقي صحيح)
 *  2. عكس مقاطعها العربية فقط (عند اختلاطها بحروف لاتينية أو أرقام)
 *  3. عكس الحروف كلها (ترتيب بصري خالص)
 * وبهذا تُصلح الكلمات المعكوسة حتى داخل الأسطر المختلطة عربي/إنجليزي.
 */
function repairArabicTokens(value) {
  return String(value || '')
    .split(/(\s+)/)
    .map((token) => {
      if (!token || !ARABIC_TEST_RE.test(token)) return token;
      const candidates = [token];
      const runsReversed = reverseArabicText(token);
      if (runsReversed !== token) candidates.push(runsReversed);
      const fullyReversed = graphemes(token).reverse().join('');
      if (!candidates.includes(fullyReversed)) candidates.push(fullyReversed);
      // عكس كامل مع إعادة المقاطع اللاتينية/الأرقام إلى وضعها المقروء:
      // يصلح السطور التي خُزّنت بصريًا واحتوت كلمات إنجليزية أو أرقامًا.
      if (/[A-Za-z0-9]/.test(token)) {
        const mixed = fullyReversed.replace(/[A-Za-z0-9][A-Za-z0-9+#.-]*/g, (run) => graphemes(run).reverse().join(''));
        if (!candidates.includes(mixed)) candidates.push(mixed);
      }
      if (candidates.length === 1) return token;
      let best = token;
      let bestScore = arabicTextScore(token);
      for (const candidate of candidates.slice(1)) {
        const score = arabicTextScore(candidate);
        // هامش صغير إجباري: لا نعكس كلمة سليمة مثل «يهدف» لمجرد أنها تبدأ بحرف
        // جرّ أو تنتهي بلاحقة، وإلا أفسدنا أسطرًا صحيحة كما يحدث في PDF من Word.
        if (score > bestScore + 2) {
          best = candidate;
          bestScore = score;
        }
      }
      return best;
    })
    .join('');
}

function repairPdfLines(lines) {
  return lines.map((line) => ({ ...line, text: repairArabicTokens(line.text) }));
}

/**
 * PDF لا يخزّن النص العربي بترتيب منطقي دائمًا:
 * بعض الملفات تُرجع الحروف/المقاطع بترتيب بصري من اليسار إلى اليمين،
 * فتصبح الجملة معكوسة عند عرضها. نعيد بناء السطر:
 *  - نجمع العناصر على نفس خط الأساس بتفاوت صغير (الحركات قد تنزل قليلًا)
 *  - نرتّبها بصريًا، ثم نعكسها إذا كان السطر عربيًا
 *  - نطبّع أشكال العرض العربية (NFKC) ومسافات الكلمات
 */
function reconstructPdfLine(lineItems, baseline = 0, reverseChars = false) {
  const visual = [...lineItems].sort(
    (a, b) => (Number(a.transform?.[4]) || 0) - (Number(b.transform?.[4]) || 0)
  );
  const all = visual.map((item) => item.str || '').join('');
  const rtlCount = (all.match(/[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const ltrCount = (all.match(/[A-Za-z]/g) || []).length;
  // لا نعتمد على عدد الحروف فقط: سطر عربي فيه كلمة إنجليزية طويلة قد يبدو لاتينيًا.
  // الأغلبية تُحسب على مستوى المقاطع/الكلمات أيضًا.
  const rtlItems = visual.filter((item) => ARABIC_TEST_RE.test(item.str || '')).length;
  const isRtl = rtlCount > 0 && (rtlCount >= ltrCount || rtlItems * 2 >= visual.length);

  const textOf = (item) => {
    const raw = item.str || '';
    return reverseChars ? reverseArabicText(raw) : raw;
  };
  // بعض خطوط Word ترسم آخر حرف (ر/ي/ى) كعنصر مستقل بعرض صفر عند حافة
  // التشكيلة. نُلحقه بالتشكيلة الأقرب حتى لا يُقرأ كانفصال في منتصف الكلمة
  // وحتى لا تُحسب له مسافة زائفة (مثل «ف ي» بدل «في»).
  const isZeroWidthLetter = (item) =>
    (Number(item.width) || 0) === 0 && /^[\u0621-\u064A]$/.test((item.str || '').trim());
  const runs = [];
  const marks = [];
  for (const item of visual) {
    if (isZeroWidthLetter(item)) marks.push(item);
    // نسخة محلية: لا نعدّل كائنات pdf.js المشتركة بين بناء السطر العادي والمعكوس.
    else runs.push({ ...item });
  }
  for (const mark of marks) {
    const markX = Number(mark.transform?.[4]) || 0;
    const fontSize = Math.abs(Number(mark.transform?.[3]) || Number(mark.height) || 10);
    let target = null;
    let bestDistance = Infinity;
    for (const run of runs) {
      if (!ARABIC_TEST_RE.test(run.str || '')) continue;
      const distance = Math.abs((Number(run.transform?.[4]) || 0) - markX);
      if (distance < bestDistance) {
        bestDistance = distance;
        target = run;
      }
    }
    if (target && bestDistance <= Math.max(4, fontSize * 1.2)) {
      // الحرف الأخير يلي التشكيلة التي يبدأ عندها في اتجاه القراءة العربية.
      if (isRtl) target.str = `${target.str || ''}${mark.str}`;
      else target.str = `${mark.str}${target.str || ''}`;
    }
  }

  const ordered = (isRtl ? [...runs].reverse() : runs).filter((item) => {
    if ((item.str || '').trim()) return true;
    const size = Math.abs(Number(item.transform?.[3]) || Number(item.height) || 10);
    return (Number(item.width) || 0) >= size * 0.12;
  });

  // نستنتج المسافات من الفجوة الهندسية حتى لو كان بعض العناصر يفتقد مسافة صريحة.
  let text = '';
  ordered.forEach((item, index) => {
    const part = textOf(item);
    if (!part) return;
    text += part;
    const next = ordered[index + 1];
    if (!next) return;
    const nextPart = textOf(next);
    if (!nextPart || /\s$/.test(text) || /^\s/.test(nextPart)) return;
    const x = Number(item.transform?.[4]) || 0;
    const nextX = Number(next.transform?.[4]) || 0;
    const width = Number(item.width) || 0;
    const nextWidth = Number(next.width) || 0;
    const gap = isRtl ? x - (nextX + nextWidth) : nextX - (x + width);
    const fontSize = Math.abs(Number(item.transform?.[3]) || Number(item.height) || 10);
    if (gap > Math.max(2, fontSize * 0.26)) text += ' ';
  });

  const normalized = normalizePdfLine(text);
  if (!normalized) return null;
  const size = Math.max(
    0,
    ...lineItems.map((item) => Math.abs(Number(item.transform?.[3]) || Number(item.height) || 0))
  );
  return { text: normalized, y: Number(baseline) || 0, size };
}

function groupPdfBaselines(items) {
  const entries = [];
  for (const item of items) {
    if (!item || !item.str) continue;
    const y = Number(item.transform?.[5]) || 0;
    const x = Number(item.transform?.[4]) || 0;
    const width = Number(item.width) || 0;
    const size = Math.abs(Number(item.transform?.[3]) || Number(item.height) || 10) || 10;
    // علامات منفصلة بعرض صفر: حروف نازلة أو حركات ترسمها بعض ملفات Word خارج
    // تشكيلتها الأساسية وعلى خط أساس مختلف قليلًا.
    const isMark = width === 0 && /^[\u0621-\u064A\u064B-\u065F\u0670]$/.test(item.str.trim());
    entries.push({ y, x, size, isMark, item });
  }

  const groups = [];
  // أولًا: التشكيلات الحقيقية تحدّد الأسطر (تفاوت صغير جدًا).
  for (const entry of entries.filter((candidate) => !candidate.isMark)) {
    let group = null;
    let bestDistance = Infinity;
    for (const candidate of groups) {
      const distance = Math.abs(candidate.y - entry.y);
      if (distance <= 4 && distance < bestDistance) {
        group = candidate;
        bestDistance = distance;
      }
    }
    if (!group) {
      group = { y: entry.y, size: entry.size, items: [] };
      groups.push(group);
    }
    group.items.push(entry.item);
  }
  // ثانيًا: نضم كل علامة إلى أقرب تشكيلة، بمقارنة موضعها الأفقي بحافة بداية
  // التشكيلة (وليس مجرد خط الأساس)، لأنها تُرسم عند نهاية الكلمة في RTL.
  for (const entry of entries.filter((candidate) => candidate.isMark)) {
    let group = null;
    let best = Infinity;
    for (const candidate of groups) {
      const dy = Math.abs(candidate.y - entry.y);
      if (dy > Math.max(6, entry.size * 0.85)) continue;
      let edgeDistance = Infinity;
      for (const item of candidate.items) {
        const itemX = Number(item.transform?.[4]) || 0;
        edgeDistance = Math.min(edgeDistance, Math.abs(itemX - entry.x));
      }
      const score = edgeDistance + dy * 0.5;
      if (score < best) {
        best = score;
        group = candidate;
      }
    }
    if (!group) {
      group = { y: entry.y, size: entry.size, items: [] };
      groups.push(group);
    }
    group.items.push(entry.item);
  }
  return groups
    .sort((a, b) => b.y - a.y)
    .map(({ y, items: lineItems }) => ({
      y,
      items: [...lineItems].sort((a, b) => (Number(a.transform?.[4]) || 0) - (Number(b.transform?.[4]) || 0)),
    }));
}

function splitPdfSegments(group, pageWidth) {
  const threshold = Math.max(7, pageWidth * 0.02);
  const segments = [];
  let current = [];
  let minX = Infinity;
  let maxX = -Infinity;
  const push = () => {
    if (!current.length) return;
    segments.push({ items: current, minX, maxX, center: (minX + maxX) / 2, y: group.y });
    current = [];
    minX = Infinity;
    maxX = -Infinity;
  };

  for (const item of group.items) {
    const x = Number(item.transform?.[4]) || 0;
    const width = Number(item.width) || 0;
    if (current.length && x - maxX > threshold) push();
    current.push(item);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + width);
  }
  push();
  return segments;
}

/** يكتشف فاصل عمودين من الفراغات المتكررة في منتصف الصفحة */
function detectPdfGutter(groups, pageWidth) {
  const votes = [];
  for (const group of groups) {
    const segments = splitPdfSegments(group, pageWidth);
    if (segments.length < 2) continue;
    let best = null;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const gap = segments[i + 1].minX - segments[i].maxX;
      if (gap < pageWidth * 0.025) continue;
      if (!best || gap > best.gap) {
        best = { gap, center: (segments[i].maxX + segments[i + 1].minX) / 2 };
      }
    }
    if (best) votes.push(best.center);
  }
  if (votes.length < 3) return null;
  votes.sort((a, b) => a - b);
  const median = votes[Math.floor(votes.length / 2)];
  const near = votes.filter((value) => Math.abs(value - median) <= pageWidth * 0.03);
  if (near.length < Math.max(3, Math.ceil(votes.length * 0.45))) return null;

  let left = 0;
  let right = 0;
  for (const group of groups) {
    for (const segment of splitPdfSegments(group, pageWidth)) {
      if (segment.maxX < median) left += 1;
      else if (segment.minX > median) right += 1;
    }
  }
  if (Math.min(left, right) < 3 || Math.min(left, right) < (left + right) * 0.18) return null;
  return median;
}

function isPdfPageRtl(items) {
  const all = items.map((item) => item.str || '').join('');
  const rtl = (all.match(/[\u0590-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length;
  const ltr = (all.match(/[A-Za-z]/g) || []).length;
  return rtl > 0 && rtl >= ltr;
}

function mergePdfSegmentLines(segments, { breakFirst = false, breakLast = false, reverseChars = false } = {}) {
  const groups = [];
  for (const segment of segments) {
    let group = groups.find((candidate) => Math.abs(candidate.y - segment.y) <= 3);
    if (!group) {
      group = { y: segment.y, items: [] };
      groups.push(group);
    }
    group.items.push(...segment.items);
  }
  const lines = groups
    .sort((a, b) => b.y - a.y)
    .map(({ y, items }) => reconstructPdfLine(items, y, reverseChars))
    .filter(Boolean);
  if (breakFirst && lines[0]) lines[0].breakBefore = true;
  if (breakLast && lines[lines.length - 1]) lines[lines.length - 1].breakAfter = true;
  return lines;
}

function buildPdfLines(items, pageWidth = 0, reverseChars = false) {
  const groups = groupPdfBaselines(items);
  if (!pageWidth) return groups.map((group) => reconstructPdfLine(group.items, group.y, reverseChars)).filter(Boolean);

  const gutter = detectPdfGutter(groups, pageWidth);
  if (!gutter) return groups.map((group) => reconstructPdfLine(group.items, group.y, reverseChars)).filter(Boolean);

  const segments = [];
  for (const group of groups) segments.push(...splitPdfSegments(group, pageWidth));
  const full = [];
  const columns = [];
  for (const segment of segments) {
    const margin = pageWidth * 0.04;
    const crossesGutter = segment.minX < gutter - margin && segment.maxX > gutter + margin;
    if (crossesGutter || segment.maxX - segment.minX > pageWidth * 0.55) full.push(segment);
    else columns.push(segment);
  }

  const rtl = isPdfPageRtl(items);
  const emitRegion = (region) => {
    const right = region.filter((segment) => segment.center >= gutter);
    const left = region.filter((segment) => segment.center < gutter);
    const rightLines = mergePdfSegmentLines(right, { breakFirst: true, reverseChars });
    const leftLines = mergePdfSegmentLines(left, { breakFirst: true, reverseChars });
    return rtl ? [...rightLines, ...leftLines] : [...leftLines, ...rightLines];
  };

  const anchors = mergePdfSegmentLines(full, { reverseChars });
  for (const anchor of anchors) {
    anchor.breakBefore = true;
    anchor.breakAfter = true;
  }
  const out = [];
  let upper = Infinity;
  for (const anchor of anchors) {
    out.push(...emitRegion(columns.filter((segment) => segment.y < upper && segment.y > anchor.y)));
    out.push(anchor);
    upper = anchor.y;
  }
  out.push(...emitRegion(columns.filter((segment) => segment.y < upper)));
  return out;
}

function linesFromPdfItems(items, pageWidth = 0) {
  const normal = buildPdfLines(items, pageWidth, false);
  if (!items.some((item) => ARABIC_TEST_RE.test(item.str || ''))) return normal;

  const reversed = buildPdfLines(items, pageWidth, true);

  // نختار اتجاه السطر من النص الخام أولًا (قبل أي إصلاح كلمة بكلمة)، لأن
  // إصلاح الكلمات في سطر معكوس يجعله يبدو أفضل في التقييم بينما يبقى ترتيب
  // كلماته مقلوبًا. بعد اختيار الاتجاه نصلح الكلمات الشاذة فقط.
  if (normal.length !== reversed.length) {
    const candidates = [normal, reversed];
    let best = normal;
    let bestScore = scorePdfLines(normal);
    for (const candidate of candidates.slice(1)) {
      const score = scorePdfLines(candidate);
      if (score > bestScore + 1) {
        best = candidate;
        bestScore = score;
      }
    }
    return repairPdfLines(best);
  }

  return normal.map((line, index) => {
    const reversedLine = reversed[index];
    const normalScore = arabicTextScore(line.text);
    const reversedScore = reversedLine ? arabicTextScore(reversedLine.text) : Number.NEGATIVE_INFINITY;
    const chosen = reversedScore > normalScore + 1 ? reversedLine : line;
    return { ...chosen, text: repairArabicTokens(chosen.text) };
  });
}

async function parsePdf(bytes, file, onProgress) {
  let pdfjs;
  try {
    pdfjs = await loadPdfEngine();
  } catch {
    throw new Error('محرك PDF غير متاح حاليًا. أعد تشغيل البناء (npm run build) أو اقرأ الكتاب بصيغة EPUB.');
  }
  const loading = pdfjs.getDocument({
    data: bytes,
    cMapUrl: '/vendor/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/vendor/pdfjs/standard_fonts/',
    isEvalSupported: false,
    useSystemFonts: true,
    // تحذيرات الخطوط التالفة في بعض ملفات PDF ليست أخطاء قراءة، ولا نزعج المستخدم بها
    verbosity: 0,
  });
  const pdf = await loading.promise;
  onProgress?.('فتح PDF…', 0.15);
  let meta = {};
  let outline = null;
  try {
    meta = (await pdf.getMetadata())?.info || {};
  } catch {
    /* لا بيانات وصفية */
  }
  try {
    outline = await pdf.getOutline();
  } catch {
    /* لا فهرس */
  }

  const pageCount = pdf.numPages;
  const metaTitle = String(meta.Title || '').trim();
  const title = metaTitle && !/^(about:blank|untitled|document|بدون عنوان)$/i.test(metaTitle)
    ? metaTitle
    : file.name.replace(/\.[^.]+$/, '');
  const author = String(meta.Author || '').trim();

  // غلاف PDF: نرسم الصفحة الأولى كصورة مصغّرة (بدون رفع الملف)
  let cover = null;
  try {
    const firstPage = await pdf.getPage(1);
    const base = firstPage.getViewport({ scale: 1 });
    const scale = Math.min(2, 520 / Math.max(base.width || 1, base.height || 1));
    const viewport = firstPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(viewport.width));
    canvas.height = Math.max(1, Math.round(viewport.height));
    const context = canvas.getContext('2d', { alpha: false });
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await firstPage.render({ canvasContext: context, viewport }).promise;
    const webp = canvas.toDataURL('image/webp', 0.75);
    cover = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.76);
    firstPage.cleanup?.();
  } catch {
    /* الصفحة الأولى قد تكون محمية — نولّد غلافًا احتياطيًا */
  }

  // حدود الفصول من الفهرس إن أمكن
  const boundaries = [];
  if (Array.isArray(outline) && outline.length) {
    for (const item of outline) {
      try {
        const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
        if (!Array.isArray(dest) || !dest[0]) continue;
        const pageIndex = await pdf.getPageIndex(dest[0]);
        if (Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < pageCount) {
          boundaries.push({ page: pageIndex, title: String(item.title || '').trim() || `الفصل ${arDigits(boundaries.length + 1)}` });
        }
      } catch {
        /* تجاهل عنصر فهرس معطوب */
      }
    }
  }
  if (boundaries.length < 2) {
    boundaries.length = 0;
    const step = pageCount > 120 ? 10 : pageCount > 50 ? 6 : 5;
    for (let page = 0; page < pageCount; page += step) {
      const end = Math.min(pageCount, page + step);
      boundaries.push({
        page,
        title: end === page + 1 ? `الصفحة ${arDigits(page + 1)}` : `الصفحات ${arDigits(page + 1)}–${arDigits(end)}`,
      });
    }
  }
  boundaries.sort((a, b) => a.page - b.page);
  if (boundaries[0].page > 0) boundaries.unshift({ page: 0, title: 'البداية' });

  const budget = { left: IMAGE_BUDGET };
  const warnings = [];
  const chapters = [];
  let imageCount = 0;
  let renderedPages = 0;
  let brokenPages = 0;
  // صفحات PDF تُعرض كصور افتراضيًا: كثير من ملفات PDF العربية تحمل خطوطًا
  // بترميز خاطئ أو حروفًا مفصولة، فيخرج النص مشوّهًا حتى بعد كل محاولات
  // الإصلاح. الصورة هي المصدر الأمين، والنص المستخرج يُحفظ معها (مخفيًا)
  // للبحث والمساعد الذكي، ويمكن للقارئ التبديل إليه من «مظهر القراءة».
  const PAGE_IMAGE_LIMIT = 300;
  const PAGE_IMAGE_BUDGET = 60_000_000; // حد تقريبي لمجموع الصور المضمّنة
  let imageBytes = 0;
  const renderPageImage = async (page, pageNumber, { textHtml = '', broken = false } = {}) => {
    try {
      const viewport = page.getViewport({ scale: 1.3 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      let dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      // صورة الصفحة التالفة ضرورية دائمًا، فنضغطها أكثر بدل إسقاطها إذا تجاوزت الحد.
      if (dataUrl.length >= 1_200_000) dataUrl = canvas.toDataURL('image/jpeg', 0.62);
      if (dataUrl.length >= 1_200_000 && !broken) return false;
      const label = arDigits(pageNumber + 1);
      // نص الصفحة التالفة يُحفظ للقراءة الآلية فقط (المساعد) ولا يظهر ولا يدخل البحث؛
      // فهو مفيد كسياق تقريبي، لكنه ليس جديرًا بالعرض أو الاقتباس.
      const textBlock = textHtml
        ? `<div class="pdf-page-text" data-page-text${broken ? ' data-raw="1" data-no-text' : ''}>${textHtml}</div>`
        : '';
      return {
        html: `<figure class="pdf-page" data-page="${pageNumber + 1}" data-broken="${broken ? '1' : '0'}"><img src="${dataUrl}" alt="صفحة ${label} من الكتاب" loading="lazy" /><figcaption data-no-text>صفحة ${label} (صورة)</figcaption>${textBlock}</figure>`,
        bytes: dataUrl.length,
      };
    } catch {
      return null;
    }
  };

  for (let b = 0; b < boundaries.length; b += 1) {
    const start = boundaries[b].page;
    const end = (boundaries[b + 1]?.page ?? pageCount) - 1;
    const htmlParts = [];
    for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber + 1);
      const pageWidth = page.getViewport({ scale: 1 }).width;
      let content = { items: [] };
      try {
        content = await page.getTextContent();
      } catch {
        /* صفحة تالفة */
      }
      // بعض ملفات Word تصدّر الحروف النازلة كعناصر منفصلة بعرض صفر، ويكون خطّها
      // نفسه بترميز خاطئ، فيخرج النص مشوّهًا مهما أصلحنا الترتيب. نكتشف هذه
      // الحالة مبكرًا: الصورة هي المعروض، والنص التالف لا يُحفظ أصلًا.
      const letterItems = content.items.filter(
        (item) => item && item.str && item.str.trim() && ARABIC_TEST_RE.test(item.str)
      );
      const isolatedLetters = letterItems.filter(
        (item) => (Number(item.width) || 0) === 0 && /^[\u0621-\u064A]$/.test(item.str.trim())
      ).length;
      const brokenText = isolatedLetters >= 6 && isolatedLetters / Math.max(1, letterItems.length) > 0.08;
      const lines = linesFromPdfItems(content.items, pageWidth);
      if (brokenText) brokenPages += 1;

      // نجمع نص الصفحة أولًا مستقلًا، ليوضع داخل بطاقة الصورة (مخفيًا) للبحث
      // وللمساعد الذكي، وليُعرض كنص عند اختيار ذلك من مظهر القراءة.
      const pageParts = [];
      if (lines.length) {
        let paragraph = [];
        const flush = () => {
          if (!paragraph.length) return;
          pageParts.push(`<p>${escapeHtml(paragraph.join(' '))}</p>`);
          paragraph = [];
        };
        const gaps = lines.slice(1).map((line, index) => lines[index].y - line.y).filter((gap) => gap > 0);
        gaps.sort((a, b) => a - b);
        const typicalGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
        const sizes = lines.map((line) => line.size).filter((size) => size > 0).sort((a, b) => a - b);
        const typicalSize = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 0;
        for (let i = 0; i < lines.length; i += 1) {
          const current = lines[i];
          const line = current.text;
          const previous = paragraph[paragraph.length - 1];
          const heading = typicalSize > 0 && current.size > typicalSize * 1.16 && line.length < 160;
          if (current.breakBefore || heading) flush();
          else if (previous) {
            const gap = lines[i - 1].y - current.y;
            if (typicalGap && gap > typicalGap * 1.7) flush();
          }
          paragraph.push(line);
          if (current.breakAfter || heading) flush();
          else if (/[.!?؟۔…:]$/.test(line) && paragraph.join(' ').length > 160) flush();
        }
        flush();
      }
      const rawTextHtml = pageParts.join('\n');
      const pageTextHtml = brokenText ? '' : rawTextHtml;

      // الصور ضرورية للصفحات التالفة، أما السليمة فلها نص بديل بعد بلوغ السقف.
      const withinBudget = imageBytes < PAGE_IMAGE_BUDGET;
      const wantsImage = brokenText || renderedPages < PAGE_IMAGE_LIMIT;
      if (wantsImage && (withinBudget || brokenText)) {
        const figure = await renderPageImage(page, pageNumber, { textHtml: rawTextHtml, broken: brokenText });
        if (figure) {
          htmlParts.push(figure.html);
          imageBytes += figure.bytes;
          imageCount += 1;
          renderedPages += 1;
        } else if (pageTextHtml) {
          // تعذّر رسم الصورة: نعرض النص السليم بدل فقدان الصفحة
          htmlParts.push(pageTextHtml);
        } else if (brokenText) {
          warnings.push(`تعذّر عرض الصفحة ${arDigits(pageNumber + 1)} كصورة`);
        }
      } else if (pageTextHtml) {
        // سقف الصور حمايةً لمساحة الجهاز: ما بعده يُعرض نصًا إن كان سليمًا
        htmlParts.push(pageTextHtml);
      } else {
        warnings.push(`تعذّر عرض الصفحة ${arDigits(pageNumber + 1)} كصورة (امتلأت مساحة الصور).`);
      }
      page.cleanup?.();
      // نمنح الواجهة فرصة للتنفّس بين الصفحات كي لا تتجمد أثناء استيراد كتاب كبير.
      if (pageNumber % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      if (pageNumber % 4 === 0) onProgress?.(`تجهيز الصفحات… صفحة ${arDigits(pageNumber + 1)} من ${arDigits(pageCount)}`, 0.2 + ((b + (pageNumber - start) / Math.max(1, end - start + 1)) / boundaries.length) * 0.75);
    }
    const html = htmlParts.join('\n');
    if (html.trim()) {
      const startLabel = start + 1;
      const endLabel = end + 1;
      const titleText = boundaries[b].title || `الصفحات ${startLabel}–${endLabel}`;
      chapters.push(
        Object.assign(makeChapter({ title: titleText, html, index: chapters.length }), {
          pageFrom: startLabel,
          pageTo: endLabel,
        })
      );
    }
  }

  try {
    await pdf.destroy();
  } catch {
    /* لا شيء */
  }
  if (!chapters.length) throw new Error('لم أستطع استخراج نص من هذا PDF. جرّب ملفًا غير ممسوح أو استخدم EPUB.');
  const sample = chapters.slice(0, 6).map((chapter) => chapter.text).join(' ');
  const sampleWords = sample.split(/\s+/).filter((word) => word.length > 1);
  const suspicious = sampleWords.filter((word) => /ى(?=.)|إا|اا|ة(?=[ء-ي])/.test(word)).length;
  if (sampleWords.length > 80 && suspicious / sampleWords.length > 0.035) {
    warnings.push('نص هذا PDF تالف داخليًا: الحروف نفسها مرتّبة بشكل خاطئ في الملف، وليست المشكلة في القارئ. جرّب نسخة أخرى أو نسخة OCR.');
  }
  if (brokenPages) {
    warnings.push(
      'خطوط هذا الملف تصدّر بعض الحروف بترميز خاطئ، فتعذّر استخراج نص موثوق من بعض الصفحات. تُعرض صفحات PDF كصور لتبقى واضحة، ويمكنك تحويلها إلى نص من «مظهر القراءة». للحصول على نص قابل للبحث بدقة استخدم نسخة OCR من الكتاب.'
    );
  }
  return { title, author, chapters, warnings, imageCount, cover, pageCount, pageFrom: 1, pageTo: pageCount };
}

/* ---------------- ملفات نصية وصور ---------------- */
async function parseTextLike(bytes, file, onProgress) {
  const raw = decodeBytes(bytes);
  const name = file.name.toLowerCase();
  const cleanName = file.name.replace(/\.[^.]+$/, '');
  let htmlChapters = [];
  let imageCount = 0;

  if (/\.(html?|xhtml)$/.test(name)) {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    const cleaned = await sanitizeBody(doc.body || doc.documentElement, { budget: { left: IMAGE_BUDGET }, stats: { imageCount: 0 } });
    htmlChapters = [{ title: doc.title?.trim() || cleanName, html: cleaned.innerHTML, markdown: false }];
  } else if (/\.(md|markdown)$/.test(name)) {
    const parts = raw.split(/(?=^#{1,2}\s+)/m).filter((p) => p.trim());
    htmlChapters = (parts.length ? parts : [raw]).map((part) => {
      const titleMatch = /^#{1,2}\s+(.+)$/m.exec(part);
      return { title: titleMatch?.[1]?.trim() || cleanName, html: markdownToHtml(part), markdown: true };
    });
  } else if (/\.csv$/.test(name)) {
    const table = csvToTable(raw);
    htmlChapters = [
      {
        title: cleanName,
        markdown: false,
        html: table || `<p>${escapeHtml(raw)}</p>`,
      },
    ];
  } else if (/\.json$/.test(name)) {
    let pretty = raw;
    let jsonTitle = cleanName;
    try {
      const data = JSON.parse(raw);
      pretty = JSON.stringify(data, null, 2);
      if (data && typeof data === 'object' && typeof data.title === 'string') jsonTitle = data.title;
    } catch {
      /* نص JSON غير صالح — يُعرض كما هو */
    }
    htmlChapters = [
      {
        title: jsonTitle,
        markdown: false,
        html: `<pre><code>${escapeHtml(pretty)}</code></pre>`,
      },
    ];
  } else if (/\.rtf$/.test(name)) {
    const plain = rtfToText(raw);
    const parts = splitPlainChapters(plain, cleanName);
    htmlChapters = parts.map((chapter) => ({
      title: chapter.title,
      markdown: false,
      html: chapter.body
        .split(/\n{2,}/)
        .map((part) => `<p>${escapeHtml(part.trim()).replace(/\n/g, '<br />')}</p>`)
        .join('\n'),
    }));
  } else {
    const chapters = splitPlainChapters(raw, cleanName);
    htmlChapters = chapters.map((chapter) => ({
      title: chapter.title,
      markdown: chapter.markdown,
      html: chapter.markdown
        ? markdownToHtml(chapter.body)
        : chapter.body
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br />')}</p>`)
            .join('\n'),
    }));
  }

  onProgress?.('تنسيق النص…', 0.8);
  const budget = { left: IMAGE_BUDGET };
  const stats = { imageCount: 0 };
  const chapters = [];
  for (let i = 0; i < htmlChapters.length; i += 1) {
    const doc = document.implementation.createHTMLDocument('chapter');
    doc.body.innerHTML = htmlChapters[i].html;
    const cleaned = await sanitizeBody(doc.body, { budget, stats });
    const html = cleaned.innerHTML;
    if (textFromNode(cleaned).length < 5 && !cleaned.querySelector('img')) continue;
    chapters.push(makeChapter({ title: htmlChapters[i].title, html, index: chapters.length }));
    if (i % 20 === 0) onProgress?.(`تجهيز الفصول… ${arDigits(i + 1)}`, 0.8 + (i / htmlChapters.length) * 0.15);
  }
  imageCount = stats.imageCount;
  if (!chapters.length) throw new Error('الملف فارغ أو لا يحتوي نصًا قابلاً للقراءة');
  // إن كان في النص صورة (HTML/Markdown) نستخدم أولها غلافًا
  const firstImage = htmlChapters.map((chapter) => chapter.html || '').join('').match(/<img[^>]+src="([^"]+)"/i);
  const cover = firstImage?.[1]?.startsWith('data:image/') ? firstImage[1] : null;
  return { title: cleanName, author: '', chapters, warnings: [], imageCount, cover };
}

async function parseImageBook(file) {
  const prepared = await prepareImage(file, { maxSide: 1800, budget: { left: 8 * 1024 * 1024 } });
  if (!prepared) throw new Error('تعذّر قراءة هذه الصورة');
  const title = file.name.replace(/\.[^.]+$/, '');
  let cover = prepared.src;
  try {
    const small = await prepareImage(file, { maxSide: 520, quality: 0.78, budget: { left: 2_000_000 } });
    if (small?.src) cover = small.src;
  } catch {
    /* نستخدم الصورة الكبيرة إن فشل التصغير */
  }
  const html = `<figure><img src="${prepared.src}" alt="${escapeHtml(title)}" width="${prepared.width}" height="${prepared.height}" /><figcaption>${escapeHtml(file.name)}</figcaption></figure><p>هذا الكتاب عبارة عن صورة واحدة. استخدم مساعد القراءة لشرح محتواها إن فعّلت التحليل البصري.</p>`;
  return {
    title,
    author: '',
    chapters: [makeChapter({ title, html, index: 0 })],
    warnings: ['هذا الملف صورة. سيعمل عرضه وشرحه العام، أما استخراج النص منه فيحتاج ملفًا نصيًا أو PDF.'],
    imageCount: 1,
    cover,
  };
}

/** أرشيف صور (CBZ): كل مجموعة صفحات تصبح فصلًا — للقصص والمانغا والصور المتسلسلة */
async function parseComicArchive(bytes, file, onProgress) {
  const zip = openZip(bytes);
  const names = zip
    .names()
    .filter((name) => IMAGE_EXT.test(name) && !name.startsWith('__MACOSX/') && !/\/\._/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
  if (!names.length) throw new Error('الأرشيف لا يحتوي صورًا قابلة للقراءة');
  const budget = { left: IMAGE_BUDGET };
  // غلاف CBZ: أول صورة في الأرشيف
  let cover = null;
  try {
    const firstData = await zip.read(names[0]);
    if (firstData) {
      const firstType = /\.png$/i.test(names[0]) ? 'image/png' : /\.webp$/i.test(names[0]) ? 'image/webp' : /\.gif$/i.test(names[0]) ? 'image/gif' : 'image/jpeg';
      const firstPrepared = await prepareImage(new Blob([firstData], { type: firstType }), {
        maxSide: 520,
        quality: 0.78,
        budget: { left: 2_000_000 },
      });
      cover = firstPrepared?.src || null;
    }
  } catch {
    /* الغلاف اختياري */
  }
  const perChapter = 12;
  const chapters = [];
  const total = Math.min(names.length, MAX_IMAGES);
  let imageCount = 0;
  for (let start = 0; start < total && chapters.length < 400; start += perChapter) {
    const group = names.slice(start, Math.min(start + perChapter, total));
    const figures = [];
    for (const name of group) {
      try {
        const data = await zip.read(name);
        if (!data) continue;
        const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/jpeg';
        const prepared = await prepareImage(new Blob([data], { type }), { maxSide: 1700, quality: 0.84, budget });
        if (!prepared) continue;
        const label = name.split('/').pop();
        figures.push(
          `<figure><img src="${prepared.src}" alt="${escapeHtml(label)}" width="${prepared.width}" height="${prepared.height}" loading="lazy" /><figcaption>${escapeHtml(label)}</figcaption></figure>`
        );
        imageCount += 1;
      } catch {
        /* صفحة تالفة لا تمنع بقية الصفحات */
      }
    }
    if (!figures.length) continue;
    const end = Math.min(start + perChapter, total);
    chapters.push(
      makeChapter({
        title: names.length > perChapter ? `الصفحات ${arDigits(start + 1)}–${arDigits(end)}` : file.name.replace(/\.[^.]+$/, ''),
        html: figures.join('\n'),
        index: chapters.length,
      })
    );
    onProgress?.(`تجهيز الصور… ${arDigits(Math.min(total, start + perChapter))}/${arDigits(total)}`, 0.2 + (start / total) * 0.7);
  }
  if (!chapters.length) throw new Error('تعذّر تجهيز صور هذا الأرشيف');
  return {
    title: file.name.replace(/\.[^.]+$/, ''),
    author: '',
    chapters,
    warnings: names.length > total ? [`عُرضت أول ${arDigits(total)} صورة فقط للحفاظ على سرعة القارئ.`] : [],
    imageCount,
    cover,
  };
}

/* ---------------- الواجهة ---------------- */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export async function parseBookFile(file, onProgress = () => {}) {
  if (!file || !file.size) throw new Error('الملف فارغ');
  if (file.size > 90 * 1024 * 1024) throw new Error('الملف كبير جدًا (الحد 90 م.ب)');
  const name = file.name || 'كتاب';
  const ext = (name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  onProgress('قراءة الملف…', 0.05);

  let parsed;
  if (ext === '.epub') parsed = await parseEpub(bytes, file, onProgress);
  else if (ext === '.docx') parsed = await parseDocx(bytes, file, onProgress);
  else if (ext === '.cbz') parsed = await parseComicArchive(bytes, file, onProgress);
  else if (ext === '.pdf') parsed = await parsePdf(bytes, file, onProgress);
  else if (IMAGE_EXT.test(ext) || /^image\//.test(file.type)) parsed = await parseImageBook(file);
  else if (ext === '.doc' || ext === '.mobi' || ext === '.azw' || ext === '.azw3' || ext === '.fb2') {
    throw new Error('هذه الصيغة غير مدعومة بعد. حوّل الكتاب إلى PDF أو EPUB أو DOCX ثم أضفه.');
  } else {
    const raw = decodeBytes(bytes);
    const replacementRatio = (raw.match(/\uFFFD/g) || []).length / Math.max(1, raw.length);
    const letterRatio = (raw.match(/[\p{L}\p{N}\s.,،؛:!?؟"'()\-]/gu) || []).length / Math.max(1, raw.length);
    if (replacementRatio > 0.1 || letterRatio < 0.55) {
      throw new Error('لم أتعرف على هذا الملف كنص أو كتاب مدعوم. الصيغ المدعومة: PDF وEPUB وDOCX وTXT وMD وHTML وRTF وCSV وJSON والصور.');
    }
    parsed = await parseTextLike(bytes, file, onProgress);
  }

  const formatMap = {
    '.pdf': 'PDF',
    '.epub': 'EPUB',
    '.docx': 'DOCX',
    '.cbz': 'CBZ',
    '.md': 'Markdown',
    '.markdown': 'Markdown',
    '.html': 'HTML',
    '.htm': 'HTML',
    '.txt': 'نص',
    '.rtf': 'RTF',
    '.csv': 'CSV',
    '.json': 'JSON',
  };
  const format = IMAGE_EXT.test(ext) || /^image\//.test(file.type) ? 'صورة' : formatMap[ext] || (ext ? ext.slice(1).toUpperCase() : 'ملف');
  const chapters = capLongChapters(parsed.chapters).map((chapter, index) => ({ ...chapter, id: `c${index}` }));
  const totalWords = chapters.reduce((sum, c) => sum + (c.words || 0), 0);
  onProgress('تم التجهيز', 1);

  return {
    version: 1,
    id: crypto.randomUUID(),
    title: String(parsed.title || name.replace(/\.[^.]+$/, '')).slice(0, 180) || 'كتاب بلا عنوان',
    author: String(parsed.author || '').slice(0, 120),
    format,
    sourceName: name,
    size: file.size,
    sizeLabel: formatBytes(file.size),
    totalWords,
    imageCount: parsed.imageCount || 0,
    pageCount: Number(parsed.pageCount) || 0,
    chapters: chapters.slice(0, 400),
    warnings: [...new Set(parsed.warnings || [])].slice(0, 8),
    cover: parsed.cover || null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export { capLongChapters, formatBytes, linesFromPdfItems };
