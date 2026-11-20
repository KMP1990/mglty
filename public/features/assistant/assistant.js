/**
 * مساعد القراءة — لوحة محادثة ذكية داخل القارئ.
 * ------------------------------------------------------------
 * • كل رسالة = محادثة مستقلة: لها بطاقة سؤال وبطاقة رد خاصة بها.
 *   لا يكتب رد جديد فوق رد قديم، ولا تُخلط إجابات الرسائل السابقة.
 * • محادثة أولًا: المستخدم يرسل رسالته، والمساعد يرد (لا أزرار مهام جاهزة).
 * • صفحات متعددة: «صفحة ٥ و٧ و١٢» أو «الصفحات ٥–٨» تُجمع وتُلخّص معًا.
 * • بحث ذكي في الكتاب كله يُغذّي الإجابة بمقتطفات وأرقام صفحات.
 * • مخططات أفكار SVG تُرسم داخل حدود البطاقة دائمًا (بلا خروج أو قص).
 * • نماذج مجانية مدمجة تلقائيًا (بلا اختيار) + OCR عربي لصور الصفحات.
 * • ملف الكتاب النصي و PDF يظهران بوسم واضح فوق المحادثة.
 */
import { escapeHtml, sound } from '../../assets/core/core.js';
import { booksApi } from '../books/api.js';
import { ocrImage } from '../books/ocr.js';
import { renderAssistantText as safeText, cleanForDisplay, cleanList, summaryLines } from './text.js';

const arDigits = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

/** يحوّل الأرقام الهندية/الفارسية إلى لاتينية */
function latinDigits(value) {
  return String(value || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

function candidateLabel(item = {}) {
  const base = FREE_PROVIDER_NAMES[item.provider] || item.provider || 'نموذج';
  if (item.provider === 'pollinations' && item.model) return `Pollinations · ${item.model}`;
  return base;
}

const FREE_PROVIDER_NAMES = {
  pollinations: 'Pollinations',
  google: 'Gemini',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  mistral: 'Mistral',
  cerebras: 'Cerebras',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
};

/** أرقام ترتيبية عربية شائعة داخل الكلام («صفحة السابعة») */
const ORDINALS = {
  'الحادي عشر': 11,
  'الحادية عشرة': 11,
  'الثاني عشر': 12,
  'الثانية عشرة': 12,
  'العشرون': 20,
  'العشرين': 20,
  'الثلاثون': 30,
  'الثلاثين': 30,
  'الأولى': 1,
  'الأول': 1,
  'الاولى': 1,
  'الاول': 1,
  'اول': 1,
  'أول': 1,
  'الثانية': 2,
  'الثاني': 2,
  'الثالثة': 3,
  'الثالث': 3,
  'الرابعة': 4,
  'الرابع': 4,
  'الخامسة': 5,
  'الخامس': 5,
  'السادسة': 6,
  'السادس': 6,
  'السابعة': 7,
  'السابع': 7,
  'الثامنة': 8,
  'الثامن': 8,
  'التاسعة': 9,
  'التاسع': 9,
  'العاشرة': 10,
  'العاشر': 10,
};

const PAGE_WORD =
  '(?:ال)?(?:صفحة|صفحه|صفح|صفحات|صور|صورة|صوره|شكل|أشكال|اشكال|لوحة|لوحه|رسمة|رسمه|مخطط|رقم|image|images|img|figure|page|pages|p|ص)';
const ORDINAL_KEYS = Object.keys(ORDINALS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/** كل أرقام الصفحات في الرسالة: أرقام، ترتيبية، نطاقات «٥–٨» */
function extractPageNumbers(question) {
  const text = latinDigits(question).trim();
  const found = new Set();

  // نطاق: «الصفحات ٥–٨» أو «صفحة 5 إلى 8» أو «5-8»
  const rangeRe = new RegExp(`(?:${PAGE_WORD}\\s*)?(\\d{1,3})\\s*(?:-|–|—|الى|إلى|to)\\s*(\\d{1,3})`, 'gi');
  for (const match of text.matchAll(rangeRe)) {
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (!from || !to) continue;
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    for (let page = start; page <= end && found.size < 10; page += 1) found.add(page);
  }

  // أرقام مرتبطة بكلمة صفحة/صورة/شكل/رقم
  const numericRe = new RegExp(`(?:${PAGE_WORD})\\s*(?:رقم\\s*)?[.:#-]?\\s*(\\d{1,4})`, 'gi');
  for (const match of text.matchAll(numericRe)) {
    const page = Number(match[1]);
    if (page > 0) found.add(page);
  }
  const reversedRe = /رقم\s*(?:ال)?(?:صفحة|صفحه|صورة|صوره|شكل|لوحة|رسمة|لوحه|مخطط)\s*[.:#-]?\s*(\d{1,4})/g;
  for (const match of text.matchAll(reversedRe)) {
    const page = Number(match[1]);
    if (page > 0) found.add(page);
  }

  // ترتيبي: «صورة السابعة»
  const ordinalRe = new RegExp(`(?:${PAGE_WORD})\\s+(${ORDINAL_KEYS})`, 'g');
  for (const match of text.matchAll(ordinalRe)) {
    if (ORDINALS[match[1]]) found.add(ORDINALS[match[1]]);
  }

  // قائمة بعد كلمة صفحة: «صفحة ٥ و٧ و١٢» أو «صور 7, 8, 9»
  if (found.size && new RegExp(PAGE_WORD, 'i').test(text)) {
    const listRe = /(\d{1,4})\s*(?:و|,|،|&|and)\s*(\d{1,4})/gi;
    for (const match of text.matchAll(listRe)) {
      for (const value of [match[1], match[2]]) {
        const page = Number(value);
        if (page > 0 && page < 2000) found.add(page);
      }
    }
  }

  // رسالة أرقام فقط: «5 7 12» أو «٥، ٧، ١٢»
  if (!found.size && /^[\d\s،,.;و+&-]+$/.test(text)) {
    for (const match of text.matchAll(/\d{1,4}/g)) {
      const page = Number(match[0]);
      if (page > 0) found.add(page);
    }
  }

  return [...found].sort((a, b) => a - b).slice(0, 8);
}

/** هل الرسالة مجرد إشارة صفحات بلا سؤال؟ */
function isPageOnly(question) {
  const text = latinDigits(question)
    .replace(new RegExp(PAGE_WORD, 'gi'), ' ')
    .replace(new RegExp(ORDINAL_KEYS, 'g'), ' ')
    .replace(/(?:رقم|إلى|الى|to|من|حتى|لحد|and|ثم)/gi, ' ')
    .replace(/[،,.;:!?؟]/g, ' ')
    .replace(/و/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 && /^[\d\s\-–—+&]*$/.test(text) && /\d/.test(text);
}

function captureImage(img) {
  if (!img || !img.naturalWidth) return null;
  try {
    const max = 860;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch {
    return null;
  }
}

const MODEL_BADGES = {
  vision: 'يقرأ الصور',
  flagship: 'الأقوى',
  fast: 'سريع',
  cheap: 'اقتصادي',
  free: 'مجاني',
  local: 'محلي',
};

/** تقسيم نص عربي إلى أسطر قصيرة داخل SVG بدل أن يفيض خارج البطاقة */
function splitSvgText(value, maxChars = 38, maxLines = 2) {
  const words = String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const rest = lines.slice(maxLines - 1).join(' ');
    lines.length = maxLines - 1;
    lines.push(`${rest.slice(0, Math.max(4, maxChars - 1))}…`);
  }
  return lines;
}

/**
 * مخطط أفكار عمودي داخل عرض البطاقة.
 * viewBox بعرض ٣٨٠ فقط، وكل النصوص مقصوصة/مقسّمة داخل المستطيلات،
 * ثم يُعرض SVG بـ width:100% height:auto — فلا يعبر الحدود على أي شاشة.
 */
function renderDiagram(diagram) {
  if (!diagram || !Array.isArray(diagram.branches) || diagram.branches.length < 2) return '';
  const branches = diagram.branches.slice(0, 6);
  const width = 380;
  const rowH = 86;
  const cardW = 326;
  const cardX = 42;
  const cardH = 66;
  const titleLines = splitSvgText(diagram.title || 'خريطة الأفكار', 34, 2);
  const titleH = 34 + (titleLines.length - 1) * 18;
  const top = 14;
  const railStart = top + titleH + 18;
  const height = railStart + branches.length * rowH + 16;
  const spineX = 22;
  const centerX = width / 2;

  const titleText = titleLines
    .map((line, index) => `<tspan x="${centerX}" dy="${index === 0 ? 0 : 18}">${escapeHtml(line)}</tspan>`)
    .join('');

  const connectors = branches
    .map((_, index) => {
      const y = railStart + index * rowH + cardH / 2;
      return `<path d="M ${spineX} ${y} H ${cardX}" class="ai-diagram-wire" />`;
    })
    .join('');

  const nodes = branches
    .map((branch, index) => {
      const y = railStart + index * rowH;
      const lines = splitSvgText(branch.label || 'فكرة', 35, 2);
      const leaves = (branch.leaves || []).filter(Boolean).join('، ');
      const leafLine = leaves ? splitSvgText(leaves, 42, 1)[0] : '';
      const labelText = lines
        .map((line, lineIndex) => `<tspan x="${cardX + cardW - 16}" dy="${lineIndex === 0 ? 0 : 17}">${escapeHtml(line)}</tspan>`)
        .join('');
      return `<g class="ai-diagram-branch">
        <rect x="${cardX}" y="${y}" width="${cardW}" height="${cardH}" rx="16" class="ai-diagram-node" />
        <rect x="${cardX}" y="${y}" width="4" height="${cardH}" rx="2" class="ai-diagram-accent" />
        <circle cx="${cardX + 22}" cy="${y + 21}" r="9" class="ai-diagram-dot" />
        <text x="${cardX + 22}" y="${y + 25}" text-anchor="middle" class="ai-diagram-num">${arDigits(index + 1)}</text>
        <text x="${cardX + cardW - 16}" y="${y + 26}" text-anchor="start" direction="rtl" class="ai-diagram-label">${labelText}</text>
        ${leafLine ? `<text x="${cardX + cardW - 16}" y="${y + 52}" text-anchor="start" direction="rtl" class="ai-diagram-leaves">${escapeHtml(leafLine)}</text>` : ''}
      </g>`;
    })
    .join('');

  const svg = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="auto" role="img" aria-label="${escapeHtml(diagram.title || 'مخطط أفكار')}" xmlns="http://www.w3.org/2000/svg" class="ai-diagram-svg" preserveAspectRatio="xMidYMin meet">
    <style>
      .ai-diagram-label{font-family:'Noto Sans Arabic','Tajawal',system-ui,sans-serif;font-size:12px;font-weight:700;fill:var(--reader-ink,currentColor)}
      .ai-diagram-leaves{font-family:'Noto Sans Arabic','Tajawal',system-ui,sans-serif;font-size:10px;fill:var(--reader-muted,currentColor);opacity:.78}
      .ai-diagram-num{font-family:'Cairo','Noto Sans Arabic',system-ui,sans-serif;font-size:9px;font-weight:800;fill:var(--reader-page,#fff)}
      .ai-diagram-title{font-family:'Cairo','Noto Sans Arabic',system-ui,sans-serif;font-size:15px;font-weight:800;fill:var(--reader-ink,currentColor)}
      .ai-diagram-node{fill:color-mix(in srgb,var(--reader-page,#fff) 82%, var(--reader-accent,#0f766e) 8%);stroke:var(--reader-line,#cbd5e1);stroke-width:1}
      .ai-diagram-title-card{fill:color-mix(in srgb,var(--reader-accent,#0f766e) 12%, var(--reader-page,#fff));stroke:var(--reader-line,#cbd5e1);stroke-width:1}
      .ai-diagram-accent{fill:var(--reader-accent,#0f766e);opacity:.85}
      .ai-diagram-dot{fill:var(--reader-accent,#0f766e);opacity:.9}
      .ai-diagram-wire{fill:none;stroke:var(--reader-accent,#0f766e);stroke-opacity:.28;stroke-width:2;stroke-linecap:round}
    </style>
    <rect x="${centerX - 150}" y="${top}" width="300" height="${titleH}" rx="18" class="ai-diagram-title-card" />
    <text x="${centerX}" y="${top + 23}" text-anchor="middle" direction="rtl" class="ai-diagram-title">${titleText}</text>
    <path d="M ${spineX} ${top + titleH + 4} V ${railStart + (branches.length - 1) * rowH + cardH / 2}" class="ai-diagram-wire" />
    ${connectors}
    ${nodes}
  </svg>`;

  return `<details class="ai-diagram" open>
    <summary>مخطط الفكرة</summary>
    <div class="ai-diagram-canvas">${svg}</div>
    <div class="ai-diagram-actions">
      <button type="button" data-diagram-copy>نسخ المخطط كنص</button>
      <button type="button" data-diagram-download>تنزيل SVG</button>
    </div>
  </details>`;
}

/** وسم نوع الملف/الكتاب الذي تقرأه الآن */
function formatLabel(ctx = {}) {
  const raw = String(ctx.format || ctx.bookFormat || '').trim();
  const format = raw.toUpperCase();
  if (!raw) return 'كتاب';
  if (raw === 'نص' || ['TXT', 'MD', 'MARKDOWN', 'CSV', 'JSON', 'RTF', 'HTML', 'HTM', 'DOCX'].includes(format)) return 'ملف نصي';
  if (raw === 'صورة' || ['PNG', 'JPG', 'JPEG', 'WEBP', 'GIF', 'BMP', 'AVIF'].includes(format)) return 'صورة';
  if (format === 'PDF') return 'PDF';
  if (format === 'EPUB') return 'كتاب إلكتروني';
  if (format === 'CBZ' || format === 'CBR') return 'صور/مانغا';
  return 'كتاب';
}

export function createAiPanel({ root, getContext, getPageContext, getPagesContext, searchBook, onNavigate, onToast }) {
  root.innerHTML = `
    <div class="ai-drawer" data-ai-drawer hidden aria-label="مساعد القراءة">
      <header class="ai-drawer-head">
        <div class="ai-drawer-title">
          <span class="ai-spark" aria-hidden="true">✦</span>
          <div><strong>مساعد القراءة</strong><small data-ai-engine>عدة نماذج تتشاور — تختار الأفضل</small></div>
        </div>
        <div class="ai-head-actions">
          <button class="reader-icon" type="button" data-ai-new title="محادثة جديدة" aria-label="محادثة جديدة">＋</button>
          <button class="reader-icon" type="button" data-ai-search-btn title="بحث ذكي في الكتاب" aria-label="بحث في الكتاب">⌕</button>
          <button class="reader-icon" type="button" data-ai-settings-btn title="كيف يعمل المساعد" aria-label="كيف يعمل المساعد">ⓘ</button>
          <button class="reader-icon" type="button" data-ai-close aria-label="إغلاق المساعد">✕</button>
        </div>
      </header>

      <button class="ai-model-bar" type="button" data-ai-model-open>
        <span class="ai-model-dot" data-ai-model-dot></span>
        <span class="ai-model-text">
          <b data-ai-model-name>مساعد متعدد النماذج</b>
          <small data-ai-model-sub>يشاور عدة نماذج ويختار الأفضل</small>
        </span>
        <span class="ai-model-chevron" aria-hidden="true">▾</span>
      </button>

      <div class="ai-drawer-scroll" data-ai-scroll>
        <div class="ai-search-panel" data-ai-search-panel hidden>
          <div class="ai-search-row">
            <input class="input" data-ai-search-input placeholder="ابحث في الكتاب: التلاعب، الثقة، الإعجاب…" maxlength="120" />
            <button class="ai-search-close" type="button" data-ai-search-close aria-label="إغلاق البحث">✕</button>
          </div>
          <div class="ai-search-results" data-ai-search-results></div>
        </div>

        <div class="ai-context" data-ai-context></div>

        <div class="ai-welcome" data-ai-welcome>
          <div class="ai-welcome-orb" aria-hidden="true">✦</div>
          <p><strong>هلا بيك 👋</strong> أنا المساعد الذكي — أشاور عدة نماذج، وألخّصلك الصفحة بجملة وحدة بلا شرح زائد.</p>
          <p>اكتب رقم صفحة، أو <b>«لخّص»</b>، أو اسأل سؤالًا مباشرًا عن النص.</p>
          <button class="ai-quick-summary" type="button" data-ai-quick-summary>✦ لخّص الصفحة الحالية</button>
          <p class="ai-welcome-hint">كل رسالة محادثة مستقلة وردّها الخاص. المخطط يظهر فقط إذا طلبته.</p>
        </div>

        <div class="ai-thread" data-ai-thread aria-live="polite"></div>
      </div>

      <div class="ai-chat">
        <form class="ai-ask" data-ai-form>
          <input class="input" data-ai-input placeholder="رقم صفحة أو سؤال…" autocomplete="off" maxlength="600" />
          <button class="btn btn-primary btn-sm" type="submit" data-ai-send aria-label="إرسال">إرسال</button>
        </form>
        <div class="ai-note" data-ai-note>عدة نماذج مجانية تتشاور + OCR عربي. ملف الكتاب يبقى على جهازك.</div>
      </div>

      <div class="ai-sheet" data-ai-sheet hidden>
        <div class="ai-sheet-card" role="dialog" aria-label="النماذج والإعدادات">
          <header class="ai-sheet-head">
            <div><strong>كيف يعمل المساعد</strong><small>عدة نماذج تتشاور — بلا إعداد</small></div>
            <button class="reader-icon" type="button" data-ai-sheet-close aria-label="إغلاق">✕</button>
          </header>
          <div class="ai-sheet-body" data-ai-sheet-body></div>
        </div>
      </div>
    </div>`;

  const el = {
    drawer: root.querySelector('[data-ai-drawer]'),
    engine: root.querySelector('[data-ai-engine]'),
    context: root.querySelector('[data-ai-context]'),
    scroll: root.querySelector('[data-ai-scroll]'),
    welcome: root.querySelector('[data-ai-welcome]'),
    thread: root.querySelector('[data-ai-thread]'),
    form: root.querySelector('[data-ai-form]'),
    input: root.querySelector('[data-ai-input]'),
    send: root.querySelector('[data-ai-send]'),
    note: root.querySelector('[data-ai-note]'),
    modelName: root.querySelector('[data-ai-model-name]'),
    modelSub: root.querySelector('[data-ai-model-sub]'),
    modelDot: root.querySelector('[data-ai-model-dot]'),
    sheet: root.querySelector('[data-ai-sheet]'),
    sheetBody: root.querySelector('[data-ai-sheet-body]'),
    searchPanel: root.querySelector('[data-ai-search-panel]'),
    searchInput: root.querySelector('[data-ai-search-input]'),
    searchResults: root.querySelector('[data-ai-search-results]'),
  };

  const state = {
    status: null,
    catalog: null,
    open: false,
    busy: false,
    initialized: false,
    focusPages: [],
    searchTimer: null,
    turns: 0,
    activeTurn: null,
  };

  const replyOf = (turn) => turn?.querySelector('[data-reply]') || null;

  function scrollToEnd() {
    requestAnimationFrame(() => {
      if (el.scroll) el.scroll.scrollTop = el.scroll.scrollHeight;
    });
  }

  function setBusy(busy, label, turn = state.activeTurn) {
    state.busy = busy;
    el.drawer.dataset.busy = busy ? 'true' : 'false';
    el.send.disabled = busy;
    el.send.innerHTML = busy ? '<span class="spinner" aria-hidden="true"></span>' : 'إرسال';
    root.querySelectorAll('[data-ai-thinking]').forEach((node) => node.remove());
    if (busy) {
      const reply = replyOf(turn);
      if (reply) {
        reply.insertAdjacentHTML(
          'beforeend',
          `<div class="ai-thinking" data-ai-thinking><span class="ai-orb"></span><span>${escapeHtml(label || 'أقرأ وأقارن أفضل ملخص…')}</span></div>`
        );
        scrollToEnd();
      }
    }
  }

  function pageLabel() {
    if (!state.focusPages.length) return '';
    return state.focusPages.length === 1
      ? `صفحة ${arDigits(state.focusPages[0])}`
      : `صفحات ${state.focusPages.map((n) => arDigits(n)).join('، ')}`;
  }

  function refreshContextLabel() {
    const ctx = getContext();
    const focus = pageLabel();
    el.context.innerHTML = `
      <span class="ai-context-chip ai-context-book">${escapeHtml(ctx.chapterTitle || 'هذه الصفحة')}</span>
      <span class="ai-context-chip">${escapeHtml(ctx.locationLabel || `صفحة ${arDigits(ctx.pageNumber)}`)}</span>
      <span class="ai-context-chip ai-context-format" data-format-chip>${escapeHtml(formatLabel(ctx))}</span>
      ${ctx.images?.length ? `<span class="ai-context-chip ai-context-img">🖼 ${arDigits(ctx.images.length)} صورة</span>` : ''}
      ${focus ? `<button class="ai-context-chip ai-focus-chip" type="button" data-clear-focus title="إلغاء متابعة الصفحات">📌 ${escapeHtml(focus)} ✕</button>` : ''}`;
    refreshModelLabel();
  }

  function refreshModelLabel() {
    const vision = Boolean(state.status?.vision);
    const available = Array.isArray(state.status?.available) ? state.status.available : [];
    el.modelName.textContent = 'مساعد متعدد النماذج';
    el.modelSub.textContent = available.length
      ? `${arDigits(available.length)} نماذج مجانية تتشاور — تختار الأفضل${vision ? ' + OCR للصور' : ''}`
      : 'المحرّك المحلي + OCR عربي';
    el.modelDot.dataset.state = vision ? 'vision' : 'text';
    if (state.status) {
      el.engine.textContent = vision
        ? 'عدة نماذج مجانية تقرأ النص والصور وتختار أفضل ملخص'
        : 'عدة نماذج مجانية + OCR عربي تلقائي';
    }
  }

  function turnLabel(ctx = getContext(), targets = []) {
    const parts = [];
    if (targets?.length) {
      parts.push(targets.length === 1 ? `صفحة ${arDigits(targets[0])}` : `صفحات ${targets.map((n) => arDigits(n)).join('، ')}`);
    } else {
      parts.push(ctx.locationLabel || `صفحة ${arDigits(ctx.pageNumber)}`);
    }
    parts.push(formatLabel(ctx));
    return parts.filter(Boolean).join(' · ');
  }

  /** كل رسالة تبدأ محادثة/بطاقة مستقلة، حتى لا يمسح ردّها ردود الرسائل السابقة */
  function createTurn(question, ctx, targets) {
    state.turns += 1;
    const turn = document.createElement('article');
    turn.className = 'ai-turn';
    turn.dataset.turnId = String(state.turns);
    turn.dataset.question = question;
    turn.innerHTML = `
      <div class="ai-turn-user">
        <span class="ai-turn-avatar" aria-hidden="true">أنت</span>
        <div class="ai-turn-bubble"><p>${safeText(question)}</p></div>
      </div>
      <div class="ai-turn-reply" data-reply></div>`;
    const separator = document.createElement('div');
    separator.className = 'ai-thread-sep';
    separator.innerHTML = `<span>محادثة ${arDigits(state.turns)}</span><small>${escapeHtml(turnLabel(ctx, targets))}</small>`;
    el.thread.append(separator, turn);
    el.welcome.hidden = true;
    state.activeTurn = turn;
    scrollToEnd();
    return turn;
  }

  function newConversation({ silent = false } = {}) {
    if (state.busy) {
      onToast('انتظر يخلص الرد الحالي، بعدها افتح محادثة جديدة', 'info');
      return;
    }
    el.thread.innerHTML = '';
    el.welcome.hidden = false;
    state.turns = 0;
    state.activeTurn = null;
    state.focusPages = [];
    refreshContextLabel();
    el.input.focus({ preventScroll: true });
    if (!silent) onToast('محادثة جديدة — كل رسالة إلها ردها الخاص', 'info');
  }

  function noticeMarkup(data) {
    const notes = [data.cloudError, data.notice].filter(Boolean);
    return notes.map((note) => `<div class="ai-note ai-note-warn">⚠️ ${safeText(note)}</div>`).join('');
  }

  function followUpsMarkup(items) {
    const list = [...new Set((items || []).filter(Boolean))].slice(0, 3);
    if (!list.length) return '';
    return `<div class="ai-followups">${list
      .map((item) => `<button type="button" data-follow="${escapeHtml(item)}">${escapeHtml(item)}</button>`)
      .join('')}</div>`;
  }

  function imagesMarkup(images) {
    if (!(images || []).length) return '';
    return `<section class="ai-block ai-images">
      <h4>شرح الرسومات والصور</h4>
      ${images
        .map(
          (image) => `<article class="ai-image-card">
            <header><span>${escapeHtml(image.kind || 'رسمة')}</span><small>${escapeHtml(String(image.index || ''))}</small></header>
            <p>${safeText(image.what)}</p>
            ${image.why ? `<p class="ai-why"><strong>لماذا هي مهمة؟</strong> ${safeText(image.why)}</p>` : ''}
            ${(image.how || []).length ? `<ol>${image.how.map((step) => `<li>${safeText(step)}</li>`).join('')}</ol>` : ''}
          </article>`
        )
        .join('')}
    </section>`;
  }

  function summaryMarkup(data) {
    const lines = summaryLines(data);
    const summary = cleanForDisplay(data.summary || data.answer || '').replace(/^الزبدة:\s*/u, '');
    const keywords = cleanList(data.keywords, 5);
    const shownText = [summary, ...(lines || []).map((line) => line.text)].join(' ');
    const facts = (Array.isArray(data.facts) ? data.facts : [])
      .map((fact) => (typeof fact === 'string' ? cleanForDisplay(fact) : cleanForDisplay(fact?.text)))
      .filter((fact) => fact && !shownText.includes(fact.slice(0, 32)))
      .slice(0, 3);
    const pageMeta = data.pageNumbers?.length
      ? data.pageNumbers.map((n) => `صفحة ${arDigits(n)}`).join('، ')
      : data.pageNumber
        ? `صفحة ${arDigits(data.pageNumber)}`
        : '';
    const label = lines && lines.length > 1 ? 'الصفحات تقول' : 'الصفحة تقول';
    return `
      <div class="asst-brief">
        <div class="asst-brief-head">
          <span class="asst-brief-label">${safeText(label || 'الصفحة تقول')}</span>
          ${pageMeta ? `<span class="asst-brief-page">${escapeHtml(pageMeta)}</span>` : ''}
        </div>
        ${
          lines
            ? `<div class="asst-pages">${lines
                .map(
                  (line) => `<div class="asst-page-line"><span class="asst-page-num">صفحة ${arDigits(line.page)}</span><p>${safeText(line.text)}</p></div>`
                )
                .join('')}</div>`
            : `<p class="asst-brief-text">${safeText(summary || 'الصفحة ما بيهة نص واضح حتى ألخّصه.')}</p>`
        }
        ${facts.length ? `<div class="asst-facts"><span class="asst-facts-label">تفاصيل وأرقام</span>${facts.map((fact) => `<p>${safeText(fact)}</p>`).join('')}</div>` : ''}
        ${keywords.length ? `<div class="asst-keywords">${keywords.map((word) => `<span>${safeText(word)}</span>`).join('')}</div>` : ''}
      </div>
      ${data.diagram ? renderDiagram(data.diagram) : ''}`;
  }

  function structuredMarkup(data) {
    return `
      ${data.headline ? `<h3 class="ai-headline">${safeText(data.headline)}</h3>` : ''}
      ${data.summary ? `<p class="ai-summary">${safeText(data.summary)}</p>` : ''}
      ${
        (data.points || []).length
          ? `<section class="ai-block"><h4>النقاط الأساسية</h4><ul>${data.points.map((point) => `<li>${safeText(point)}</li>`).join('')}</ul></section>`
          : ''
      }
      ${
        (data.explanation || []).length
          ? `<section class="ai-block"><h4>الشرح خطوة بخطوة</h4>${data.explanation
              .map(
                (item, index) =>
                  `<div class="ai-step"><span class="ai-step-num">${arDigits(index + 1)}</span><div><strong>${safeText(item.label)}</strong><p>${safeText(item.text)}</p></div></div>`
              )
              .join('')}</section>`
          : ''
      }
      ${
        (data.simple || []).length
          ? `<section class="ai-block ai-simple"><h4>بأبسط صيغة</h4>${data.simple.map((line) => `<p>• ${safeText(line)}</p>`).join('')}</section>`
          : ''
      }
      ${
        (data.terms || []).length
          ? `<section class="ai-block"><h4>مصطلحات</h4><dl class="ai-terms">${data.terms
              .map((term) => `<dt>${safeText(term.term)}</dt><dd>${safeText(term.meaning)}</dd>`)
              .join('')}</dl></section>`
          : ''
      }
      ${imagesMarkup(data.images)}
      ${data.diagram ? renderDiagram(data.diagram) : ''}
      ${
        (data.questions || []).length
          ? `<section class="ai-block ai-check"><h4>جرّب تفهم أكثر</h4><ul>${data.questions.map((q) => `<li>${safeText(q)}</li>`).join('')}</ul></section>`
          : ''
      }`;
  }

  function answerMarkup(data) {
    const answer = data.answer || data.summary || 'ما لكيت إجابة واضحة بهذه الصفحة.';
    return `<p class="ai-answer">${safeText(answer)}</p>
      ${(data.points || []).length && !data.answer ? `<section class="ai-block"><h4>النقاط الأساسية</h4><ul>${data.points.map((point) => `<li>${safeText(point)}</li>`).join('')}</ul></section>` : ''}
      ${imagesMarkup(data.images)}
      ${data.diagram ? renderDiagram(data.diagram) : ''}`;
  }

  function copyTextFor(data, isAsk) {
    if (isAsk) {
      return [
        data.answer || data.summary,
        ...(data.points || []),
        ...(data.diagram?.branches || []).map((branch) => `- ${branch.label}${branch.leaves?.length ? `: ${branch.leaves.join('، ')}` : ''}`),
      ]
        .filter(Boolean)
        .join(String.fromCharCode(10, 10));
    }
    if (data.task !== 'image') {
      const lines = summaryLines(data);
      return [
        cleanForDisplay(data.summary || data.answer || '').replace(/^الزبدة:\s*/u, ''),
        ...(lines ? lines.map((line) => `صفحة ${line.page}: ${line.text}`) : []),
        ...(Array.isArray(data.facts) ? data.facts.map((fact) => (typeof fact === 'string' ? fact : fact?.text)).filter(Boolean) : []),
        ...(data.diagram?.branches || []).map((branch) => `- ${branch.label}${branch.leaves?.length ? `: ${branch.leaves.join('، ')}` : ''}`),
      ]
        .filter(Boolean)
        .join(String.fromCharCode(10, 10));
    }
    return [
      data.headline,
      data.summary,
      ...(data.points || []),
      ...(data.explanation || []).map((item) => `${item.label}: ${item.text}`),
      ...(data.simple || []),
      ...(data.images || []).map((image) => `${image.kind}: ${image.what} ${image.why}`),
    ]
      .filter(Boolean)
      .join(String.fromCharCode(10, 10));
  }

  function bindDiagramActions(scope, diagram) {
    if (!diagram) return;
    scope.querySelector('[data-diagram-copy]')?.addEventListener('click', async () => {
      const text = `${diagram.title || 'مخطط الفكرة'}\n${(diagram.branches || [])
        .map((branch) => `- ${branch.label}${branch.leaves?.length ? `: ${branch.leaves.join('، ')}` : ''}`)
        .join('\n')}`;
      try {
        await navigator.clipboard.writeText(text);
        onToast('نُسخ المخطط');
      } catch {
        onToast('تعذّر النسخ', 'warning');
      }
    });
    scope.querySelector('[data-diagram-download]')?.addEventListener('click', () => {
      const svg = scope.querySelector('.ai-diagram svg');
      if (!svg) return;
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const blob = new Blob([clone.outerHTML], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'majalati-mindmap.svg';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });
  }

  function renderReply(turn, data, { isAsk = false } = {}) {
    const reply = replyOf(turn);
    if (!reply) return;
    const isSummaryTask = !isAsk && data.task !== 'image';
    const modelCount = Math.max(1, Number(data.modelsUsed) || 0);
    const cloud = data.engine === 'ensemble' || data.engine === 'hybrid';
    const engineLabel = isSummaryTask
      ? data.degraded || !cloud
        ? 'ملخص محلي'
        : data.cached
          ? 'تلخيص محفوظ'
          : modelCount > 1
            ? `تلخيص ${arDigits(modelCount)} نماذج`
            : 'تلخيص ذكي'
      : cloud
        ? data.vision
          ? `إجابة بصرية من ${arDigits(modelCount)} ${modelCount > 1 ? 'نماذج' : 'نموذج'}`
          : modelCount > 1
            ? `إجابة من ${arDigits(modelCount)} نماذج`
            : 'إجابة ذكية'
        : data.degraded
          ? 'إجابة محلية'
          : 'إجابة محلية';
    const isSummary = !isAsk && data.task !== 'image';
    const body = isAsk ? answerMarkup(data) : isSummary ? summaryMarkup(data) : structuredMarkup(data);
    reply.innerHTML = `
      <div class="ai-turn-reply-head">
        <span class="ai-result-engine" data-engine="${escapeHtml(data.engine || 'local')}">${escapeHtml(engineLabel)}${data.model && !isSummaryTask ? ` • ${escapeHtml(String(data.model).slice(0, 32))}` : ''}</span>
        <div class="ai-turn-actions">
          <button class="ai-speak" type="button" data-copy-turn title="نسخ هذا الرد">نسخ</button>
        </div>
      </div>
      ${noticeMarkup(data)}
      ${body}
      ${followUpsMarkup(data.followUps)}`;

    bindDiagramActions(reply, data.diagram);
    reply.querySelector('[data-copy-turn]')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copyTextFor(data, isAsk));
        onToast('نُسخ الرد');
      } catch {
        onToast('تعذّر النسخ من المتصفح', 'warning');
      }
    });
    scrollToEnd();
  }

  function renderReplyMessage(turn, html) {
    const reply = replyOf(turn);
    if (!reply) return;
    reply.innerHTML = html;
    scrollToEnd();
  }

  function renderError(turn, message) {
    renderReplyMessage(turn, `<div class="ai-turn-error"><span aria-hidden="true">⚠️</span><p>${safeText(message)}</p></div>`);
  }

  function showNeedsVision(ctx, { turn, asked = false } = {}) {
    const label =
      ctx.pageNumbers?.length > 1
        ? `صفحات ${ctx.pageNumbers.map((n) => arDigits(n)).join('، ')}`
        : `صفحة ${arDigits(ctx.pageNumber)}`;
    const message = [
      `${label} ما وصلني نصها.`,
      'أقرأ الصور تلقائيًا بالـOCR العربي. إذا فشلت القراءة، جرّب صورة أوضح أو صفحة فيها نص.',
    ].join(String.fromCharCode(10));
    if (turn) {
      renderReplyMessage(
        turn,
        `<div class="ai-empty ai-needs-vision"><p><strong>شنو صار؟</strong></p>${message
          .split(String.fromCharCode(10))
          .map((line) => (line ? `<p>${safeText(line)}</p>` : ''))
          .join('')}</div>`
      );
    }
    if (!asked) onToast(`${label} — تعذّرت قراءتها تلقائيًا`, 'info');
  }

  function updateThinking(label) {
    const node = root.querySelector('[data-ai-thinking] span:last-child');
    if (node && label) node.textContent = label;
  }

  /**
   * قراءة مجانية لصور الصفحات عندما لا يوجد نموذج رؤية سحابي.
   * OCR عربي محلي في المتصفح ثم يشرحه المساعد المجاني.
   */
  async function ocrContext(ctx) {
    if (!ctx) return ctx;
    const pages =
      Array.isArray(ctx.pages) && ctx.pages.length
        ? ctx.pages
        : [
            {
              number: ctx.pageNumber,
              text: ctx.pageText,
              textReliability: ctx.textReliability,
              approximate: ctx.approximate,
              images: ctx.images,
              imageElements: ctx.imageElements,
            },
          ];
    const flatImages = (ctx.imageElements || []).filter((img) => img?.tagName === 'IMG');
    let changed = false;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const needsOcr =
        !String(page.text || '').trim() ||
        page.textReliability === 'low' ||
        Boolean(ctx.brokenPage);
      if (!needsOcr) continue;
      const image =
        page.imageElements?.[0] ||
        flatImages[index] ||
        (pages.length === 1 ? flatImages[0] : null);
      if (!image) continue;
      updateThinking(`أقرأ صورة صفحة ${arDigits(page.number || ctx.pageNumber)} مجانًا (OCR)…`);
      try {
        const result = await ocrImage(image, {
          key: `${ctx.bookTitle || ''}:${page.number || ctx.pageNumber}`,
          onProgress: (event) => {
            if (event?.status === 'recognizing text') {
              const percent = Math.round((Number(event.progress) || 0) * 100);
              updateThinking(`أقرأ صورة صفحة ${arDigits(page.number || ctx.pageNumber)} مجانًا… ${arDigits(percent)}٪`);
            }
          },
        });
        if (result.text && result.text.length >= 12) {
          let correctedText = result.text;
          let corrected = false;
          try {
            updateThinking(`أصحح قراءة صفحة ${arDigits(page.number || ctx.pageNumber)} (عربي + إنجليزي)…`);
            const englishHint =
              Number(result.englishConfidence) >= 30
                ? result.englishText || ''
                : (String(result.englishText || '').match(/[A-Za-z][A-Za-z0-9.%/-]*|[0-9][0-9.,%/-]*/g) || []).join(' ');
            const fixed = await booksApi.fixOcr({ text: result.text, englishText: englishHint });
            if (fixed?.data?.text && fixed.data.text.length >= result.text.length * 0.45) {
              correctedText = fixed.data.text;
              corrected = fixed.data.corrected === true;
            }
          } catch {
            /* التصحيح المحلي داخل ocr.js يكفي عند تعذّر الخادم */
          }
          page.text = correctedText;
          page.textReliability = corrected ? 'high' : 'low';
          page.ocr = true;
          page.ocrCorrected = corrected;
          page.ocrConfidence = result.confidence;
          changed = true;
        }
      } catch {
        /* نكمل بالنص المتوفر أو نعرض خيار نموذج الرؤية */
      }
    }
    if (changed) {
      ctx.pages = pages;
      const LF = String.fromCharCode(10);
      ctx.pageText = pages.map((page) => `=== صفحة ${page.number} ===${LF}${page.text || ''}`).join(LF + LF);
      ctx.textReliability = pages.some((page) => page.textReliability === 'low') ? 'low' : 'high';
      ctx.ocr = true;
    }
    return ctx;
  }

  async function captureVisions(ctx, max = 3) {
    if (!state.status?.vision) return [];
    const images = [...new Set((ctx.imageElements || []).filter((img) => img && img.tagName === 'IMG'))];
    const out = [];
    for (const img of images) {
      if (out.length >= max) break;
      try {
        if (!img.complete) await img.decode?.();
      } catch {
        /* قد تفشل decode لكن الصورة جاهزة */
      }
      const data = captureImage(img);
      if (data) out.push(data);
    }
    return out;
  }

  let statusPromise = null;
  async function ensureStatus() {
    if (state.status && state.catalog) return state.status;
    if (!statusPromise) {
      statusPromise = Promise.allSettled([booksApi.status(), booksApi.models()])
        .then(([statusRes, modelsRes]) => {
          if (statusRes.status === 'fulfilled') state.status = statusRes.value.data;
          if (modelsRes.status === 'fulfilled') state.catalog = modelsRes.value.data;
          refreshModelLabel();
          el.note.textContent = state.status?.vision
            ? 'عدة نماذج مجانية تقرأ النص والصور وتختار الأفضل. ملف الكتاب يبقى على جهازك.'
            : 'عدة نماذج مجانية تتشاور + قراءة الصور بالـOCR العربي. ملف الكتاب يبقى على جهازك.';
          return state.status;
        })
        .catch(() => null)
        .finally(() => {
          if (!state.status) statusPromise = null;
        });
    }
    return statusPromise;
  }

  async function reloadCatalog() {
    try {
      const [statusRes, modelsRes] = await Promise.all([booksApi.status(), booksApi.models()]);
      state.status = statusRes.data;
      state.catalog = modelsRes.data;
      refreshModelLabel();
    } catch {
      /* تبقى الحالة السابقة */
    }
  }

  function openSheet() {
    el.sheet.hidden = false;
    if (!state.status) {
      el.sheetBody.innerHTML = '<div class="ai-sheet-loading"><span class="spinner"></span> أجهّز المساعد المجاني…</div>';
      ensureStatus().then(renderFreeSheet);
      return;
    }
    renderFreeSheet();
  }

  function renderFreeSheet() {
    const status = state.status || {};
    const available = Array.isArray(status.available) ? status.available : [];
    const labels = [...new Set(available.map(candidateLabel))];
    const ocrReady = status.ocr !== false;
    const visionLine = status.vision
      ? 'بعض النماذج تقرأ الصور مباشرة، وإذا تعذّر ذلك تُقرأ الصورة بالـOCR العربي تلقائيًا.'
      : 'الصور تُقرأ تلقائيًا بالـOCR العربي داخل جهازك، بلا إعداد ولا خطوات إضافية.';
    el.sheetBody.innerHTML = `
      <div class="ai-sheet-section ai-free-hero">
        <span class="ai-free-badge">✦ تلقائي</span>
        <h4>${labels.length ? `${arDigits(labels.length)} نماذج مجانية تتشاور` : 'المحرّك المحلي جاهز'}</h4>
        <p class="ai-sheet-hint">كل سؤال يمرّ على أكثر من نموذج، ونقارن الإجابات ونختار الأوضح والأصح. إذا كانت النماذج مشغولة، تحصل على ملخص محلي فورًا بلا رسالة خطأ.</p>
        <div class="ai-free-chips">
          ${labels.length ? labels.map((name) => `<span class="ai-free-chip">${escapeHtml(name)}</span>`).join('') : '<span class="ai-free-chip">المحرّك المحلي</span>'}
          ${ocrReady ? '<span class="ai-free-chip is-on">OCR عربي</span>' : ''}
          ${status.vision ? '<span class="ai-free-chip is-on">يقرأ الصور</span>' : '<span class="ai-free-chip">صور بالـOCR</span>'}
        </div>
      </div>
      <div class="ai-sheet-section">
        <h4>قراءة الصور</h4>
        <p class="ai-sheet-hint">${visionLine}</p>
      </div>
      <div class="ai-sheet-section">
        <h4>الخصوصية</h4>
        <p class="ai-sheet-hint">يُرسل نص الصفحة فقط عند طلب المساعدة. ملف الكتاب نفسه يبقى على جهازك ولا يُرفع إلى الخادم.</p>
      </div>`;
  }

  function closeSheet() {
    el.sheet.hidden = true;
  }

  function openSearch() {
    el.searchPanel.hidden = false;
    el.searchInput.focus();
  }

  function closeSearch() {
    el.searchPanel.hidden = true;
    el.searchInput.value = '';
    el.searchResults.innerHTML = '';
  }

  function runSearch(query) {
    if (!searchBook) return;
    const results = searchBook(query, 8);
    if (!query.trim()) {
      el.searchResults.innerHTML = '';
      return;
    }
    if (!results.length) {
      el.searchResults.innerHTML = '<div class="ai-empty ai-empty-inline"><p>ما لكيت نتائج. جرّب كلمة أقصر أو مرادفها.</p></div>';
      return;
    }
    el.searchResults.innerHTML = results
      .map(
        (result) => `<button type="button" class="ai-search-hit" data-hit-page="${result.page}" data-hit-index="${result.chapterIndex}">
          <span class="ai-search-page">صفحة ${arDigits(result.page)}</span>
          <span class="ai-search-snippet">${safeText(result.snippet)}</span>
        </button>`
      )
      .join('');
    el.searchResults.querySelectorAll('[data-hit-page]').forEach((hit) => {
      hit.addEventListener('click', () => {
        const page = Number(hit.dataset.hitPage);
        closeSearch();
        run('summary', { pages: [page], addToChat: true, question: `صفحة ${page}` });
      });
    });
  }

  /** مقتطفات من الكتاب تغذّي الأسئلة الشاملة */
  function buildBookContext(question, exclude = []) {
    if (!searchBook || !question.trim()) return '';
    const results = searchBook(question, 6).filter((result) => !exclude.includes(result.page));
    return results
      .slice(0, 3)
      .map((result) => `صفحة ${result.page} (${result.chapterTitle}): ${result.snippet}`)
      .join('\n');
  }

  async function run(task, { question = '', addToChat = false, pages = null, turn = null } = {}) {
    if (state.busy) return;
    await ensureStatus();
    let ctx = getContext();

    // محادثة مستقلة: الرسالة الجديدة تبدأ من موضع القراءة الحالي،
    // إلا إذا حدّد المستخدم صفحة/صفحات صراحةً أو طلب «هذه الصفحة».
    const explicit = (pages?.length ? pages : extractPageNumbers(question)).filter((n) => n > 0);
    if (!explicit.length) state.focusPages = [];
    const targets = explicit.length ? explicit : state.focusPages;

    // كل رسالة = بطاقة مستقلة. حتى لو كان الرد طويلًا، يبقى داخل بطاقته.
    if (!turn) turn = createTurn(question || 'لخّص هذه الصفحة', ctx, targets);
    state.activeTurn = turn;

    if (targets.length) {
      const pageCtx =
        targets.length === 1
          ? getPageContext
            ? await getPageContext(targets[0])
            : null
          : getPagesContext
            ? await getPagesContext(targets)
            : null;
      if (!pageCtx) {
        const total = Number(ctx.pageCount) || 0;
        const hint = total
          ? `الكتاب ${arDigits(total)} صفحة — جرّب رقمًا بين ١ و${arDigits(total)}.`
          : 'هذا الكتاب ما بيه صفحات مرقّمة، جرّب رقم الفصل.';
        renderError(turn, `ما لكيت ${targets.length > 1 ? 'هذي الصفحات' : `صفحة ${arDigits(targets[0])}`}. ${hint}`);
        onToast(`ما لكيت ${targets.length > 1 ? 'هذي الصفحات' : `صفحة ${arDigits(targets[0])}`}`, 'warning');
        return;
      }
      if (pageCtx.missing?.length) onToast(`ما لكيت ${pageCtx.missing.length} صفحة ضمن الطلب`, 'warning');
      ctx = pageCtx;
      state.focusPages = pageCtx.pageNumbers || targets;
      refreshContextLabel();
    }

    // لا نموذج رؤية؟ نقرأ الصورة بالـOCR العربي المجاني بدل الاعتذار.
    if (ctx.images?.length && (ctx.brokenPage || !ctx.pageText?.trim() || ctx.textReliability === 'low')) {
      setBusy(true, 'أقرأ صورة الصفحة مجانًا (OCR)…', turn);
      try {
        ctx = await ocrContext(ctx);
      } finally {
        setBusy(false, null, turn);
      }
    }

    if (!ctx.pageText?.trim() && !ctx.images?.length) {
      renderError(turn, 'هذه الصفحة فارغة — انتقل إلى صفحة فيها نص أو صورة.');
      onToast('هذه الصفحة فارغة — انتقل إلى صفحة فيها نص أو صورة', 'info');
      refreshContextLabel();
      return;
    }
    if (task === 'image' && !ctx.images?.length) {
      renderReplyMessage(turn, '<div class="ai-empty"><p>لا توجد صورة في هذه الصفحة.</p><p>اسأل عن فكرة في النص بدلًا من ذلك.</p></div>');
      refreshContextLabel();
      return;
    }

    // صفحة مصوّرة بلا نص والمزوّد لا يرى الصور: نوضّح الخيار بدل شرح فارغ
    if (!ctx.pageText?.trim() && ctx.images?.length && !state.status?.vision) {
      showNeedsVision(ctx, { turn, asked: Boolean(targets.length) });
      refreshContextLabel();
      return;
    }

    setBusy(true, null, turn);
    try {
      const visionImages = await captureVisions(ctx, 3);
      const payloadPages = (
        ctx.pages || [
          {
            number: ctx.pageNumber,
            text: ctx.pageText,
            images: ctx.images,
            textReliability: ctx.textReliability,
            approximate: ctx.approximate,
          },
        ]
      ).map((page) => ({
        number: page.number,
        text: page.text,
        images: (page.images || []).map(({ alt, caption }) => ({ alt, caption })),
        textReliability: page.textReliability,
        approximate: page.approximate,
      }));
      const bookContext = task === 'ask' ? buildBookContext(question, ctx.pageNumbers || [ctx.pageNumber]) : '';
      const payload = {
        task,
        pages: payloadPages,
        pageText: ctx.pageText,
        question,
        title: ctx.bookTitle,
        chapterTitle: ctx.chapterTitle,
        pageNumber: ctx.pageNumber,
        images: (ctx.images || []).map(({ alt, caption }) => ({ alt, caption })),
        // محادثة مستقلة: لا نُرسل تاريخ رسائل أخرى حتى لا يتلوّن الرد الجديد بالقديم.
        history: [],
        visionImages,
        bookContext,
        textReliability: ctx.textReliability === 'low' ? 'low' : 'high',
        approximatePage: Boolean(ctx.approximate),
        ocr: ctx.ocr === true,
      };
      const res = await booksApi.help(payload);
      const data = res.data;
      sound.play('ai');
      if (data?.needsVision) {
        showNeedsVision(ctx, { turn, asked: true });
        return;
      }
      if (data?.notice) onToast(data.notice, 'info');
      renderReply(turn, data, { isAsk: task === 'ask' });
    } catch (err) {
      onToast(err?.message || 'تعذّر تشغيل المساعد', 'error');
      renderError(turn, err?.message || 'تعذّر الاتصال بالمساعد الآن. حاول مرة أخرى.');
    } finally {
      setBusy(false, null, turn);
      refreshContextLabel();
    }
  }

  function show() {
    state.open = true;
    el.drawer.hidden = false;
    root.dataset.open = 'true';
    refreshContextLabel();
    el.input.focus({ preventScroll: true });
    if (!state.initialized) {
      state.initialized = true;
      ensureStatus();
    }
  }

  function close() {
    state.open = false;
    el.drawer.hidden = true;
    root.dataset.open = 'false';
    closeSheet();
  }

  el.drawer.addEventListener('click', (e) => {
    if (e.target.closest('[data-clear-focus]')) {
      state.focusPages = [];
      refreshContextLabel();
      onToast('رجعت أتابع موضع القراءة الحالي', 'info');
      return;
    }
    if (e.target.closest('[data-ai-quick-summary]')) {
      // الزر مقصود به «الصفحة الحالية» دائمًا، لا آخر صفحات طُلبت قبل قليل.
      return run('summary', { question: 'لخّص هذه الصفحة', addToChat: true });
    }
    if (e.target.closest('[data-ai-new]')) return newConversation();
    if (e.target.closest('[data-ai-close]')) return close();
    if (e.target.closest('[data-ai-model-open]')) return openSheet();
    if (e.target.closest('[data-ai-settings-btn]')) return openSheet();
    if (e.target.closest('[data-ai-search-btn]')) return openSearch();
    if (e.target.closest('[data-ai-search-close]')) return closeSearch();
    if (e.target.closest('[data-ai-sheet-close]')) return closeSheet();
    if (e.target === el.sheet) return closeSheet();
    const follow = e.target.closest('[data-follow]');
    if (follow) {
      const text = follow.dataset.follow;
      return run('ask', { question: text, addToChat: true });
    }
  });

  el.searchInput?.addEventListener('input', () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => runSearch(el.searchInput.value), 200);
  });

  el.form.addEventListener('submit', (e) => {
    e.preventDefault();
    const question = el.input.value.trim();
    if (!question || state.busy) return;
    el.input.value = '';
    const pages = extractPageNumbers(question);
    if (isPageOnly(question) || (pages.length && question.length < 40 && !/[؟?]/.test(question))) {
      run('summary', { pages, addToChat: true, question });
      return;
    }
    run('ask', { question, addToChat: true, pages: pages.length ? pages : null });
  });

  return {
    show,
    close,
    isOpen: () => state.open,
    toggle() {
      if (state.open) close();
      else show();
    },
    destroy() {
      close();
      root.innerHTML = '';
    },
    refresh: refreshContextLabel,
    newConversation,
    run,
  };
}
