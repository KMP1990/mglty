/**
 * قارئ الكتب — أربع طرق قراءة في واجهة واحدة.
 * ------------------------------------------------------------
 *  • تدفّق: الكتاب كاملًا في عمود واحد، وكل فصل يُحمَّل عند الاقتراب منه.
 *  • صفحات: فصل واحد مقسوم إلى صفحات حقيقية (أعمدة) مع تقليب أفقي.
 *  • مزدوج: صفحتان متجاورتان على الشاشات الواسعة.
 *  • تركيز: فقرة واحدة في كل مرة، بلا تشتيت.
 * الموضع يُحفظ كنسبة داخل الفصل، فينتقل بين الطرق الأربع بلا فقدان مكانك.
 * الواجهة: شريط علوي رقيق، بطاقة كتاب، فهرس/إشارات، بحث داخل الكتاب،
 * تمرير تلقائي، ولوحة مظهر مستقلة.
 *
 * لا يغادر شيء من محتوى الكتاب الجهاز؛ الحفظ يتم عبر store.js فقط.
 */
import { escapeHtml, toast, sound } from '../../assets/core/core.js';
import { READER_THEMES, DEFAULT_PREFS } from './store.js';
import { createAiPanel } from '../assistant/assistant.js';

const arNum = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
const WIDTHS = { narrow: 600, medium: 730, wide: 880 };
const THEME_IDS = new Set(READER_THEMES.map((theme) => theme.id));
const MODES = [
  { id: 'flow', label: 'تدفّق', hint: 'مرّر باستمرار في عمود واحد', icon: 'flow' },
  { id: 'paged', label: 'صفحات', hint: 'صفحة واحدة مع تقليب أنيق', icon: 'paged' },
  { id: 'spread', label: 'مزدوج', hint: 'صفحتان متجاورتان على الشاشات الواسعة', icon: 'spread' },
  { id: 'focus', label: 'تركيز', hint: 'فقرة واحدة بلا تشتيت', icon: 'focus' },
];
const MODE_IDS = new Set(MODES.map((mode) => mode.id));
const SPREAD_MIN_WIDTH = 820;
const reduceMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

const icons = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"/><path d="m12 5 7 7-7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>',
  type: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  // أيقونات طرق القراءة
  flow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4v13"/><path d="M6 20v.01"/><path d="M11 7h8M11 12h8M11 17h5"/></svg>',
  paged: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="3" width="13" height="18" rx="2"/><path d="M17 6h2a1 1 0 0 1 1 1v14"/><path d="M8 8h5M8 12h5"/></svg>',
  spread: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6c-2-1.4-4.3-2-7-2v14c2.7 0 5 .6 7 2 2-1.4 4.3-2 7-2V4c-2.7 0-5 .6-7 2z"/><path d="M12 6v14"/></svg>',
  focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M6.5 6.5 8 8M16 16l1.5 1.5M17.5 6.5 16 8M8 16l-1.5 1.5"/></svg>',
  auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
};

function normalizePrefs(raw = {}) {
  return {
    theme: THEME_IDS.has(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
    fontSize: clamp(Number(raw.fontSize) || DEFAULT_PREFS.fontSize, 15, 32),
    lineHeight: clamp(Number(raw.lineHeight) || DEFAULT_PREFS.lineHeight, 1.55, 2.5),
    width: WIDTHS[raw.width] ? raw.width : DEFAULT_PREFS.width || 'medium',
    font: raw.font === 'sans' ? 'sans' : 'serif',
    justify: raw.justify !== false,
    showHints: raw.showHints !== false,
    // صفحات PDF تُعرض كصور افتراضيًا؛ يمكن التبديل إلى النص المستخرج
    pdfView: raw.pdfView === 'text' ? 'text' : 'images',
    mode: MODE_IDS.has(raw.mode) ? raw.mode : DEFAULT_PREFS.mode || 'flow',
    autoScroll: raw.autoScroll === true,
    autoSpeed: clamp(Number(raw.autoSpeed) || DEFAULT_PREFS.autoSpeed || 3, 1, 5),
  };
}

function savedRatio(progress = {}) {
  const scroll = Number(progress?.scrollRatio);
  if (Number.isFinite(scroll)) return clamp(scroll, 0, 1);
  const page = Number(progress?.pageInChapter) || 0;
  const count = Number(progress?.pageCount) || 0;
  // توافق مع الموضع القديم المحفوظ بالصفحات
  return count > 1 ? clamp(page / (count - 1), 0, 1) : 0;
}

function normalizeBookmarks(rawList, single, chapters) {
  const list = Array.isArray(rawList) ? [...rawList] : single ? [single] : [];
  const seen = new Set();
  return list
    .filter((item) => item && Number.isFinite(Number(item.chapterIndex)))
    .map((item, index) => {
      const chapterIndex = clamp(Number(item.chapterIndex), 0, Math.max(0, chapters.length - 1));
      const ratio = clamp(
        Number.isFinite(Number(item.scrollRatio))
          ? Number(item.scrollRatio)
          : Number(item.pageCount) > 1
            ? Number(item.pageIndex || 0) / (Number(item.pageCount) - 1)
            : savedRatio(item),
        0,
        1
      );
      const key = `${chapterIndex}:${ratio.toFixed(2)}`;
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        id: String(item.id || `bm-${Date.now()}-${index}`),
        chapterIndex,
        scrollRatio: ratio,
        label: String(item.label || chapters[chapterIndex]?.title || `الفصل ${arNum(chapterIndex + 1)}`),
        excerpt: String(item.excerpt || ''),
        createdAt: item.createdAt || new Date().toISOString(),
      };
    })
    .filter(Boolean)
    .slice(-60);
}

function minutesLabel(minutes) {
  const value = Math.max(0, Math.round(minutes));
  if (!value) return 'أقل من دقيقة';
  if (value < 60) return `${arNum(value)} دقيقة`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${arNum(hours)} س ${arNum(rest)} د` : `${arNum(hours)} ساعة`;
}

export async function createReader({
  root,
  book,
  meta,
  prefs,
  onProgress,
  onBookmark,
  onPrefs,
  onReading,
  onExit,
  onCoverRequest,
}) {
  const chapters = Array.isArray(book?.chapters) ? book.chapters.filter((chapter) => chapter) : [];
  if (!chapters.length) throw new Error('هذا الكتاب لا يحتوي فصولًا قابلة للقراءة');

  const bookmarks = normalizeBookmarks(meta?.bookmarks, meta?.bookmark, chapters);
  const initialChapter = clamp(Number(meta?.progress?.chapterIndex) || 0, 0, chapters.length - 1);
  const initialRatio = savedRatio(meta?.progress || {});
  const state = {
    chapterIndex: initialChapter,
    ratio: initialRatio,
    percent: clamp(Number(meta?.progress?.percent) || 0, 0, 100),
    prefs: normalizePrefs(prefs),
    bookmarks,
    cover: meta?.cover || book.cover || '',
    destroyed: false,
    ready: false,
    lastTop: 0,
    sessionPages: 0,
    pageAcc: 0,
    visibleChapter: -1,
    searchResults: [],
    pagedIndex: -1,
  };

  const weights = chapters.map((chapter) => {
    const words = Number(chapter.words) || 0;
    const chars = String(chapter.text || '').length;
    const images = Number(chapter.imageCount) || 0;
    return Math.max(1, words, Math.ceil(chars / 6), images * 90);
  });
  const prefix = [];
  let totalWeight = 0;
  for (const weight of weights) {
    prefix.push(totalWeight);
    totalWeight += weight;
  }

  const initials = String(book.title || 'كتاب').trim().slice(0, 2) || 'ك';
  const coverMarkup = state.cover
    ? `<span class="reader2-thumb-fallback">${escapeHtml(initials)}</span><img data-cover-img src="${escapeHtml(state.cover)}" alt="" />`
    : `<span class="reader2-thumb-fallback">${escapeHtml(initials)}</span>`;

  root.innerHTML = `
  <div class="reader2" data-reader data-theme="${state.prefs.theme}" style="--r2-size:${state.prefs.fontSize}px;--r2-line:${state.prefs.lineHeight};--r2-width:${WIDTHS[state.prefs.width]}px">
    <div class="reader2-loading" data-loading>
      <span class="reader2-loader" aria-hidden="true"></span>
      <p>أفتح الكتاب…</p>
    </div>

    <div class="reader2-topbar" data-topbar>
      <header class="reader2-bar" data-bar>
        <button class="r2-icon r2-back" data-back type="button" aria-label="رجوع إلى مكتبتي">${icons.back}</button>
        <button class="reader2-book" data-open-cover type="button" aria-label="بطاقة الكتاب">
          <span class="reader2-thumb ${state.cover ? 'has-art' : ''}" data-thumb>${coverMarkup}</span>
          <span class="reader2-book-text">
            <strong data-book-title>${escapeHtml(book.title || 'كتاب')}</strong>
            <small data-chapter-now>الفصل ${arNum(initialChapter + 1)}</small>
          </span>
        </button>
        <div class="reader2-tools">
          ${
            String(book.format || '').toUpperCase() === 'PDF'
              ? `<button class="r2-quick-view" data-quick-pdf-view type="button" aria-label="تبديل عرض الصفحات بين الصور والنص" title="صور الصفحات / النص"><span data-quick-pdf-label>${state.prefs.pdfView === 'text' ? 'نص' : 'صور'}</span></button>`
              : ''
          }
          <button class="r2-icon" data-search type="button" aria-label="ابحث داخل الكتاب" title="ابحث داخل الكتاب">${icons.search}</button>
          <button class="r2-icon" data-toc type="button" aria-label="فهرس الكتاب" title="فهرس الكتاب">${icons.list}</button>
          <button class="r2-icon" data-display type="button" aria-label="مظهر القراءة" title="مظهر القراءة">${icons.type}</button>
          <button class="r2-icon" data-bookmark type="button" aria-label="إشارة مرجعية" title="إشارة مرجعية" aria-pressed="false">${icons.bookmark}</button>
          <button class="r2-icon r2-ai-button" data-ai type="button" aria-label="مساعد القراءة" title="مساعد القراءة">${icons.spark}</button>
        </div>
      </header>
      <div class="reader2-top-progress"><i data-top-progress></i></div>
    </div>

    <div class="reader2-stage" data-stage tabindex="-1">
      <div class="reader2-flow" data-flow>
        <section class="reader2-endcard" data-endcard>
          <span class="reader2-end-star" aria-hidden="true">✦</span>
          <h3>وصلت إلى نهاية الكتاب</h3>
          <p data-end-text></p>
          <div class="reader2-end-actions">
            <button class="reader2-pill" data-end-back type="button">العودة إلى البداية</button>
            <button class="reader2-pill is-ghost" data-end-library type="button">مكتبتي</button>
          </div>
        </section>
      </div>

      <div class="r2-paged" data-paged hidden>
        <div class="r2-paged-viewport" data-paged-viewport tabindex="-1">
          <div class="r2-paged-track" data-paged-track>
            <article class="r2-page-chapter" data-page-chapter></article>
          </div>
          <span class="r2-turn" data-turn aria-hidden="true"></span>
        </div>
      </div>

      <div class="r2-focus" data-focus hidden>
        <div class="r2-focus-stage">
          <div class="r2-focus-card">
            <header class="r2-focus-head">
              <span class="r2-eyebrow" data-focus-kicker></span>
              <h2 data-focus-title></h2>
            </header>
            <div class="r2-focus-stack reader2-chapter-body" data-focus-stack></div>
            <span class="r2-focus-count" data-focus-count></span>
          </div>
        </div>
        <button class="r2-focus-arrow is-prev" data-focus-prev type="button" aria-label="المقطع السابق">${icons.prev}</button>
        <button class="r2-focus-arrow is-next" data-focus-next type="button" aria-label="المقطع التالي">${icons.next}</button>
      </div>
    </div>

    <footer class="reader2-dock" data-dock>
      <button class="r2-nav r2-mode-btn" data-mode-cycle type="button" aria-label="طريقة القراءة" title="طريقة القراءة (M)">
        <span class="r2-mode-icon" data-mode-icon>${icons.flow}</span>
        <span class="r2-mode-label" data-mode-label>تدفّق</span>
      </button>
      <button class="r2-nav" data-prev type="button" aria-label="السابق" title="السابق">${icons.prev}</button>
      <div class="reader2-seek">
        <input type="range" min="0" max="1000" step="1" value="${Math.round(state.percent * 10)}" data-seek aria-label="موضع القراءة" />
        <div class="reader2-seek-meta"><span data-dock-chapter>…</span><b data-percent>${arNum(Math.round(state.percent))}٪</b></div>
      </div>
      <button class="r2-nav" data-next type="button" aria-label="التالي" title="التالي">${icons.next}</button>
    </footer>

    <div class="reader2-hint" data-hint></div>
    <div class="reader2-backdrop" data-backdrop hidden></div>

    <aside class="reader2-sheet" data-sheet="toc" role="dialog" aria-modal="true" aria-labelledby="r2-toc-title" hidden>
      <header class="reader2-sheet-head">
        <div><span class="r2-eyebrow">التنقّل</span><h3 id="r2-toc-title">فهرس الكتاب</h3></div>
        <button class="r2-icon" data-close-sheet type="button" aria-label="إغلاق">${icons.close}</button>
      </header>
      <div class="reader2-tabs" role="tablist" aria-label="أقسام الفهرس">
        <button type="button" data-tab="chapters" class="is-active" role="tab" aria-selected="true">الفصول <b data-chapter-count>${arNum(chapters.length)}</b></button>
        <button type="button" data-tab="bookmarks" role="tab" aria-selected="false">إشاراتي <b data-bookmark-count>${arNum(state.bookmarks.length)}</b></button>
      </div>
      <div class="reader2-sheet-body" data-toc-pane>
        <label class="reader2-searchbox">
          <span aria-hidden="true">${icons.search}</span>
          <input type="search" data-toc-filter placeholder="ابحث في عناوين الفصول…" autocomplete="off" />
        </label>
        <div class="reader2-toc-list" data-toc-list></div>
      </div>
      <div class="reader2-sheet-body" data-bookmarks-pane hidden></div>
    </aside>

    <aside class="reader2-sheet" data-sheet="search" role="dialog" aria-modal="true" aria-labelledby="r2-search-title" hidden>
      <header class="reader2-sheet-head">
        <div><span class="r2-eyebrow">داخل الكتاب</span><h3 id="r2-search-title">ابحث في كل الفصول</h3></div>
        <button class="r2-icon" data-close-sheet type="button" aria-label="إغلاق">${icons.close}</button>
      </header>
      <div class="reader2-sheet-body">
        <label class="reader2-searchbox is-large">
          <span aria-hidden="true">${icons.search}</span>
          <input type="search" data-search-input placeholder="اكتب كلمة أو عبارة…" autocomplete="off" />
        </label>
        <p class="reader2-search-note" data-search-note>أبحث في نص الكتاب كاملًا — بدون إنترنت.</p>
        <div class="reader2-search-results" data-search-results></div>
      </div>
    </aside>

    <aside class="reader2-sheet" data-sheet="display" role="dialog" aria-modal="true" aria-labelledby="r2-display-title" hidden>
      <header class="reader2-sheet-head">
        <div><span class="r2-eyebrow">الراحة</span><h3 id="r2-display-title">مظهر القراءة</h3></div>
        <button class="r2-icon" data-close-sheet type="button" aria-label="إغلاق">${icons.close}</button>
      </header>
      <div class="reader2-sheet-body">
        <section class="r2-control r2-control-modes">
          <div class="r2-control-head"><span>طريقة القراءة</span><small>بدّلها وقت ما تشاء ولا تفقد موضعك</small></div>
          <div class="reader2-modes" data-mode-buttons>
            ${MODES.map(
              (mode) =>
                `<button type="button" class="reader2-mode-card" data-mode-value="${mode.id}" aria-pressed="false">
                  <i aria-hidden="true">${icons[mode.icon]}</i>
                  <strong>${mode.label}</strong>
                  <small>${mode.hint}</small>
                </button>`
            ).join('')}
          </div>
        </section>
        <section class="r2-control">
          <div class="r2-control-head"><span>لون الصفحة</span><small>اختر ما يريح عينك</small></div>
          <div class="reader2-themes" data-themes>
            ${READER_THEMES.map(
              (theme) =>
                `<button type="button" class="reader2-theme" data-theme-id="${theme.id}" style="--swatch:${theme.swatch}" aria-label="${escapeHtml(theme.label)}"><i></i><span>${escapeHtml(theme.label)}</span></button>`
            ).join('')}
          </div>
        </section>
        <section class="r2-control">
          <div class="r2-control-head"><span>حجم الخط</span><b data-size-value>${arNum(state.prefs.fontSize)}</b></div>
          <input class="r2-range" type="range" min="15" max="32" step="1" value="${state.prefs.fontSize}" data-font-size aria-label="حجم الخط" />
        </section>
        <section class="r2-control">
          <div class="r2-control-head"><span>تباعد الأسطر</span><b data-line-value>${state.prefs.lineHeight.toFixed(2)}</b></div>
          <input class="r2-range" type="range" min="1.55" max="2.5" step="0.05" value="${state.prefs.lineHeight}" data-line-height aria-label="تباعد الأسطر" />
        </section>
        <section class="r2-control">
          <div class="r2-control-head"><span>عرض النص</span><small>أعمدة أضيق = تركيز أطول</small></div>
          <div class="reader2-segment" data-width-buttons>
            <button type="button" data-width-value="narrow">ضيّق</button>
            <button type="button" data-width-value="medium">متوازن</button>
            <button type="button" data-width-value="wide">واسع</button>
          </div>
        </section>
        <section class="r2-control">
          <div class="r2-control-head"><span>نوع الخط</span></div>
          <div class="reader2-segment" data-font-buttons>
            <button type="button" data-font-value="serif">مريح للقراءة</button>
            <button type="button" data-font-value="sans">واضح وعصري</button>
          </div>
        </section>
        <label class="reader2-switch">
          <span><strong>ضبط النص من الجانبين</strong><small>حواف مستقيمة للفقرات</small></span>
          <input type="checkbox" data-justify ${state.prefs.justify ? 'checked' : ''} />
        </label>
        <label class="reader2-switch">
          <span><strong>تمرير تلقائي</strong><small data-auto-note>يتحرّك الكتاب وحده حسب سرعتك</small></span>
          <input type="checkbox" data-auto-scroll ${state.prefs.autoScroll ? 'checked' : ''} />
        </label>
        <section class="r2-control">
          <div class="r2-control-head"><span>سرعة التمرير التلقائي</span><b data-auto-speed-value>${arNum(state.prefs.autoSpeed)}</b></div>
          <input class="r2-range" type="range" min="1" max="5" step="1" value="${state.prefs.autoSpeed}" data-auto-speed aria-label="سرعة التمرير التلقائي" />
        </section>
        ${
          String(book.format || '').toUpperCase() === 'PDF'
            ? `<section class="r2-control">
          <div class="r2-control-head"><span>طريقة عرض صفحات PDF</span><small>الصور أضمن للنص العربي</small></div>
          <div class="reader2-segment" data-pdf-view-buttons>
            <button type="button" data-pdf-view="images">صور الصفحات</button>
            <button type="button" data-pdf-view="text">النص المستخرج</button>
          </div>
        </section>`
            : ''
        }
        <section class="reader2-reading-stats" data-display-stats></section>
        <div class="reader2-display-actions">
          <button class="reader2-pill is-ghost" data-fullscreen type="button">${icons.expand} ملء الشاشة</button>
          <button class="reader2-pill is-ghost" data-reset-prefs type="button">استعادة المظهر الافتراضي</button>
        </div>
      </div>
    </aside>

    <aside class="reader2-sheet" data-sheet="cover" role="dialog" aria-modal="true" aria-labelledby="r2-cover-title" hidden>
      <header class="reader2-sheet-head">
        <div><span class="r2-eyebrow">بطاقة الكتاب</span><h3 id="r2-cover-title">عن هذا الكتاب</h3></div>
        <button class="r2-icon" data-close-sheet type="button" aria-label="إغلاق">${icons.close}</button>
      </header>
      <div class="reader2-sheet-body" data-cover-body></div>
    </aside>

    <aside class="reader2-sheet r2-end-sheet" data-sheet="end" role="dialog" aria-modal="true" aria-labelledby="r2-end-title" hidden>
      <header class="reader2-sheet-head">
        <div><span class="r2-eyebrow">النهاية</span><h3 id="r2-end-title">وصلت إلى آخر الكتاب</h3></div>
        <button class="r2-icon" data-close-sheet type="button" aria-label="إغلاق">${icons.close}</button>
      </header>
      <div class="reader2-sheet-body" data-end-body></div>
    </aside>

    <div class="reader-ai-host" data-ai-host></div>
  </div>`;

  const readerEl = root.querySelector('[data-reader]');
  const loading = root.querySelector('[data-loading]');
  const stage = root.querySelector('[data-stage]');
  const flow = root.querySelector('[data-flow]');
  const topProgress = root.querySelector('[data-top-progress]');
  const chapterNow = root.querySelector('[data-chapter-now]');
  const dockChapter = root.querySelector('[data-dock-chapter]');
  const percentEl = root.querySelector('[data-percent]');
  const seek = root.querySelector('[data-seek]');
  const bookmarkBtn = root.querySelector('[data-bookmark]');
  const hint = root.querySelector('[data-hint]');
  const backdrop = root.querySelector('[data-backdrop]');
  const endcard = root.querySelector('[data-endcard]');
  const pagedView = root.querySelector('[data-paged]');
  const pagedViewport = root.querySelector('[data-paged-viewport]');
  const pagedTrack = root.querySelector('[data-paged-track]');
  const pageChapter = root.querySelector('[data-page-chapter]');
  const turnEl = root.querySelector('[data-turn]');
  const focusView = root.querySelector('[data-focus]');
  const focusStack = root.querySelector('[data-focus-stack]');
  const focusTitle = root.querySelector('[data-focus-title]');
  const focusKicker = root.querySelector('[data-focus-kicker]');
  const focusCount = root.querySelector('[data-focus-count]');
  const modeLabel = root.querySelector('[data-mode-label]');
  const modeIcon = root.querySelector('[data-mode-icon]');
  const prevBtn = root.querySelector('[data-prev]');
  const nextBtn = root.querySelector('[data-next]');
  const autoToggle = root.querySelector('[data-auto-scroll]');
  const autoSpeedInput = root.querySelector('[data-auto-speed]');
  root.querySelectorAll('[data-cover-img]').forEach((img) => {
    img.addEventListener('error', () => {
      img.hidden = true;
    });
  });

  const paged = { index: -1, page: 0, count: 1, pitch: 1, cols: 1, ready: false, token: 0, pending: null };
  const focus = { index: -1, block: 0, blocks: [], token: 0 };
  const auto = { active: false, raf: 0, timer: null, last: 0 };
  let repaginateTimer = null;

  const sections = [];
  let io = null;
  let resizeObserver = null;
  let persistTimer = null;
  let prefsTimer = null;
  let resizeTimer = null;
  let reanchorTimer = null;
  let hintTimer = null;
  let searchTimer = null;
  let lastTocIndex = -1;
  let lastChromeChapter = -1;
  let lastChromePercent = -1;
  let activeSheet = null;
  let aiPanel = null;

  const chapterTitle = (index) => chapters[index]?.title || `الفصل ${arNum(index + 1)}`;
  const titleHasOrdinal = (title = '') =>
    /^(الفصل|الباب|الجزء|القسم|الصفحات|الصفحة|صفحة|chapter|part|page|pages)(?=\s|$|[:：-])/i.test(String(title).trim());
  const chapterLabel = (index) => {
    const title = chapterTitle(index);
    return chapters.length > 1 && !titleHasOrdinal(title) ? `الفصل ${arNum(index + 1)} · ${title}` : title;
  };

  const isPaged = () => state.prefs.mode === 'paged' || state.prefs.mode === 'spread';
  const isFocus = () => state.prefs.mode === 'focus';
  const modeInfo = () => MODES.find((mode) => mode.id === state.prefs.mode) || MODES[0];

  function chapterHeaderMarkup(index) {
    const chapter = chapters[index] || {};
    return `<header class="reader2-chapter-head">
      <span class="reader2-chapter-kicker" ${titleHasOrdinal(chapter.title) ? 'hidden' : ''}>${chapters.length > 1 ? `الفصل ${arNum(index + 1)}` : 'البداية'}</span>
      <h2>${escapeHtml(chapter.title || `الفصل ${arNum(index + 1)}`)}</h2>
      <span class="reader2-chapter-rule" aria-hidden="true"></span>
    </header>`;
  }

  /** يملأ حاوية المتن بمحتوى الفصل ويطبّع الصور والجداول */
  function fillChapterBody(body, chapter) {
    if (!body) return;
    body.innerHTML =
      chapter?.html ||
      String(chapter?.text || '')
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
        .join('');
    // كثير من ملفات EPUB تكرّر عنوان الفصل كعنوان أول داخل المتن؛
    // نزيله حتى لا يظهر مرتين تحت عنوان الفصل الجديد.
    const firstHeading = body.querySelector('h1, h2, h3, h4');
    const headingText = firstHeading?.textContent?.replace(/\s+/g, ' ').trim();
    const chapterName = String(chapter?.title || '').replace(/\s+/g, ' ').trim();
    if (firstHeading && chapterName && headingText === chapterName) firstHeading.remove();
    body.querySelectorAll('img').forEach((img) => {
      img.loading = 'lazy';
      img.decoding = 'async';
    });
    body.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('r2-table-wrap')) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'r2-table-wrap';
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    });
  }

  function percentFor(index, ratio) {
    const safeIndex = clamp(index, 0, chapters.length - 1);
    const before = prefix[safeIndex] || 0;
    return clamp(((before + weights[safeIndex] * clamp(ratio, 0, 1)) / Math.max(1, totalWeight)) * 100, 0, 100);
  }

  function locatePercent(percent) {
    const target = (clamp(percent, 0, 100) / 100) * totalWeight;
    for (let index = chapters.length - 1; index >= 0; index -= 1) {
      if (target >= prefix[index]) {
        return { index, ratio: clamp((target - prefix[index]) / Math.max(1, weights[index]), 0, 1) };
      }
    }
    return { index: 0, ratio: 0 };
  }

  function estimateHeight(chapter) {
    const width = Math.max(320, flow.clientWidth || stage.clientWidth || 720);
    const fontSize = state.prefs.fontSize;
    const chars = String(chapter?.text || '').length;
    const images = Number(chapter?.imageCount) || 0;
    const perLine = Math.max(18, Math.floor((width - 48) / (fontSize * 0.54)));
    const lines = Math.ceil(chars / perLine);
    // صفحات PDF المصوّرة أطول من الصور العادية (نسبة A4)، فنقدّر ارتفاعها بسخاء
    // حتى لا يقفز الموضع والمؤشر عند تحميل الصفحات الثقيلة.
    return Math.max(300, Math.round(lines * fontSize * state.prefs.lineHeight + images * Math.min(900, width * 1.45) + 180));
  }

  function buildSections() {
    const fragment = document.createDocumentFragment();
    if (Array.isArray(book.warnings) && book.warnings.length) {
      const notice = document.createElement('aside');
      notice.className = 'reader2-notice';
      notice.setAttribute('role', 'note');
      notice.innerHTML = `<span aria-hidden="true">⚠️</span><span>${escapeHtml(book.warnings[0])}</span>`;
      fragment.appendChild(notice);
    }
    chapters.forEach((chapter, index) => {
      const section = document.createElement('section');
      section.className = 'reader2-chapter';
      section.dataset.chapter = String(index);
      section.dataset.loaded = 'false';
      section.style.setProperty('--r2-est', `${estimateHeight(chapter)}px`);
      section.innerHTML = `${chapterHeaderMarkup(index)}<div class="reader2-chapter-body" data-body></div>`;
      sections.push(section);
      fragment.appendChild(section);
    });
    flow.insertBefore(fragment, endcard);
  }

  function hydrate(index, { force = false } = {}) {
    const section = sections[index];
    if (!section || (!force && section.dataset.loaded === 'true')) return false;
    if (section.dataset.loaded === 'true') return false;
    const body = section.querySelector('[data-body]');
    if (!body) return false;
    const chapter = chapters[index];
    const beforeHeight = section.getBoundingClientRect().height;
    const beforeTop = section.getBoundingClientRect().top;
    fillChapterBody(body, chapter);
    section.dataset.loaded = 'true';
    section.style.removeProperty('--r2-est');

    // إذا كان الفصل فوق الشاشة وكبُر بعد التحميل، نعوّض الانزياح
    // حتى لا يقفز النص الذي يقرأه المستخدم.
    const stageTop = stage.getBoundingClientRect().top;
    const afterHeight = section.getBoundingClientRect().height;
    if (beforeTop < stageTop && Math.abs(afterHeight - beforeHeight) > 2) {
      stage.scrollTop += afterHeight - beforeHeight;
    }
    return true;
  }

  function setupHydration() {
    if (typeof IntersectionObserver !== 'function') {
      sections.forEach((_, index) => hydrate(index));
      return;
    }
    io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(entry.target.dataset.chapter);
          hydrate(index);
          io.unobserve(entry.target);
        }
      },
      { root: stage, rootMargin: '130% 0px' }
    );
    sections.forEach((section) => io.observe(section));
  }

  /* ---------- طرق القراءة ---------- */
  function captureAnchor() {
    if (!state.ready) return { chapterIndex: state.chapterIndex, ratio: state.ratio };
    if (isPaged()) return { chapterIndex: paged.index < 0 ? state.chapterIndex : paged.index, ratio: pageToRatio(paged.page) };
    if (isFocus()) return { chapterIndex: focus.index < 0 ? state.chapterIndex : focus.index, ratio: state.ratio };
    const { index, ratio } = measurePosition();
    return { chapterIndex: index, ratio };
  }

  function restoreAnchor(anchor, { animate = false } = {}) {
    const index = clamp(anchor?.chapterIndex ?? state.chapterIndex, 0, chapters.length - 1);
    const ratio = clamp(anchor?.ratio ?? state.ratio, 0, 1);
    if (isPaged()) {
      renderPaged(index, { ratio, animate });
      return;
    }
    if (isFocus()) {
      renderFocus(index, { ratio });
      return;
    }
    flowGoToChapter(index, { ratio });
  }

  function syncModeControls() {
    const info = modeInfo();
    if (modeLabel) modeLabel.textContent = info.label;
    if (modeIcon) modeIcon.innerHTML = icons[info.icon];
    const modeButton = root.querySelector('[data-mode-cycle]');
    if (modeButton) {
      modeButton.title = `طريقة القراءة: ${info.label} — اضغط للتبديل (M)`;
      modeButton.setAttribute('aria-label', `طريقة القراءة الحالية: ${info.label}. اضغط للتبديل`);
    }
    root.querySelectorAll('[data-mode-value]').forEach((button) => {
      const active = button.dataset.modeValue === state.prefs.mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    if (prevBtn) {
      const label = isPaged() ? 'الصفحة السابقة' : isFocus() ? 'المقطع السابق' : 'الفصل السابق';
      prevBtn.title = label;
      prevBtn.setAttribute('aria-label', label);
    }
    if (nextBtn) {
      const label = isPaged() ? 'الصفحة التالية' : isFocus() ? 'المقطع التالي' : 'الفصل التالي';
      nextBtn.title = label;
      nextBtn.setAttribute('aria-label', label);
    }
    const note = root.querySelector('[data-auto-note]');
    if (note) {
      note.textContent = isPaged()
        ? 'يقلّب الصفحات تلقائيًا'
        : isFocus()
          ? 'ينتقل إلى المقطع التالي'
          : 'يتحرّك الكتاب وحده حسب سرعتك';
    }
    syncAutoControls();
  }

  function applyModeVisibility() {
    const mode = state.prefs.mode;
    flow.hidden = mode !== 'flow';
    pagedView.hidden = !isPaged();
    focusView.hidden = !isFocus();
    readerEl.dataset.mode = mode;
    stage.classList.toggle('is-locked', mode !== 'flow');
    syncModeControls();
  }

  function setMode(mode, { persist = true, silent = false } = {}) {
    const next = MODE_IDS.has(mode) ? mode : 'flow';
    if (next === state.prefs.mode) {
      syncModeControls();
      return;
    }
    const anchor = captureAnchor();
    stopAuto(true);
    state.prefs.mode = next;
    applyModeVisibility();
    restoreAnchor(anchor, { animate: false });
    if (next === 'spread' && pagedViewport.clientWidth < SPREAD_MIN_WIDTH) {
      showHint('المزدوج يعرض عمودين على الشاشات الواسعة — هنا صفحة واحدة');
    } else if (!silent) {
      showHint(`طريقة القراءة: ${modeInfo().label}`);
    }
    if (persist) {
      clearTimeout(prefsTimer);
      prefsTimer = setTimeout(() => onPrefs?.({ ...state.prefs }), 160);
    }
  }

  function cycleMode() {
    const wide = pagedViewport.clientWidth >= SPREAD_MIN_WIDTH;
    const available = MODES.filter((mode) => mode.id !== 'spread' || wide);
    const at = available.findIndex((mode) => mode.id === state.prefs.mode);
    setMode(available[(at + 1) % available.length].id);
  }

  function finishBook() {
    stopAuto(true);
    state.chapterIndex = chapters.length - 1;
    state.ratio = 1;
    state.percent = 100;
    updateTopChrome();
    schedulePersist();
    renderEndSheet();
    openSheet('end');
  }

  function renderEndSheet() {
    const body = root.querySelector('[data-end-body]');
    if (!body) return;
    const totalWords = chapters.reduce((sum, chapter) => sum + (Number(chapter.words) || 0), 0);
    const minutes = totalWords / 220;
    body.innerHTML = `
      <div class="r2-end-hero">
        <span aria-hidden="true">✦</span>
        <strong>أنهيت «${escapeHtml(book.title || 'الكتاب')}»</strong>
        <p>كل فصل قرأته بقي محفوظًا، وإشاراتك في مكانها.</p>
      </div>
      <div class="reader2-reading-stats">
        <div><small>الفصول</small><strong>${arNum(chapters.length)}</strong></div>
        <div><small>وقت القراءة التقديري</small><strong>${minutesLabel(minutes)}</strong></div>
        <div><small>إشاراتك</small><strong>${arNum(state.bookmarks.length)}</strong></div>
      </div>
      <div class="reader2-end-actions">
        <button class="reader2-pill" data-end-sheet-back type="button">العودة إلى البداية</button>
        <button class="reader2-pill is-ghost" data-end-sheet-toc type="button">${icons.list} الفهرس</button>
        <button class="reader2-pill is-ghost" data-end-sheet-library type="button">مكتبتي</button>
      </div>
      <p class="reader2-privacy">اختر طريقة قراءة أخرى من زر الطريقة في الشريط السفلي، وسيبقى موضعك كما هو.</p>`;
  }

  /* ---------- وضع الصفحات / المزدوج ---------- */
  function pageToRatio(page) {
    return paged.count > 1 ? clamp(page / (paged.count - 1), 0, 1) : 0;
  }

  function ratioToPage(ratio) {
    return paged.count > 1 ? clamp(Math.round(clamp(ratio, 0, 1) * (paged.count - 1)), 0, paged.count - 1) : 0;
  }

  function measurePaginationBase() {
    // يحترم إعداد «عرض النص» في وضعي الصفحات والمزدوج، مع حدّ أدنى للهاتف
    const target = (WIDTHS[state.prefs.width] || WIDTHS.medium) + 120;
    const pad = Math.max(16, Math.round((pagedViewport.clientWidth - target) / 2));
    if (pagedViewport.style.getPropertyValue('--r2-pad') !== `${pad}px`) {
      pagedViewport.style.setProperty('--r2-pad', `${pad}px`);
      void pagedViewport.offsetWidth;
    }
    const trackWidth = pagedTrack.clientWidth;
    if (!trackWidth) return;
    const gap = parseFloat(getComputedStyle(pagedTrack).columnGap) || 0;
    const cols = state.prefs.mode === 'spread' && pagedViewport.clientWidth >= SPREAD_MIN_WIDTH ? 2 : 1;
    if (paged.cols !== cols) {
      pagedTrack.style.columnCount = String(cols);
      paged.cols = cols;
    }
    pagedViewport.dataset.cols = String(cols);
    readerEl.style.setProperty('--r2-page-h', `${Math.max(240, Math.round(pagedTrack.clientHeight))}px`);
    void pagedTrack.offsetWidth;
    const trackRect = pagedTrack.getBoundingClientRect();
    let minLeft = trackRect.right;
    const nodes = pageChapter.querySelectorAll('[data-page-body], [data-page-body] > *, [data-page-body] img, [data-page-body] figure');
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (rect.width || rect.height) minLeft = Math.min(minLeft, rect.left);
    }
    const contentWidth = Math.max(trackWidth, trackRect.right - minLeft);
    paged.pitch = trackWidth + gap;
    paged.count = Math.max(1, Math.ceil((contentWidth + gap) / paged.pitch - 0.015));
    paged.ready = true;
  }

  function flashTurn(direction) {
    if (!turnEl || reduceMotion()) return;
    turnEl.classList.remove('is-go', 'is-back');
    void turnEl.offsetWidth;
    turnEl.classList.add(direction > 0 ? 'is-go' : 'is-back');
  }

  function setPage(page, { animate = true, persist = true, count = true } = {}) {
    const target = clamp(Math.round(page), 0, Math.max(0, paged.count - 1));
    const forward = target > paged.page;
    paged.page = target;
    if (forward && state.ready && count) state.sessionPages += 1;
    pagedTrack.style.transition =
      animate && !reduceMotion() ? 'transform 420ms cubic-bezier(0.22, 0.82, 0.28, 1)' : 'none';
    pagedTrack.style.transform = `translate3d(${target * paged.pitch}px, 0, 0)`;
    state.chapterIndex = paged.index;
    state.ratio = pageToRatio(target);
    state.percent = percentFor(paged.index, state.ratio);
    if (animate) flashTurn(forward ? 1 : -1);
    updateTopChrome();
    if (persist) schedulePersist();
  }

  function scheduleRepaginate() {
    clearTimeout(repaginateTimer);
    repaginateTimer = setTimeout(() => {
      if (state.destroyed || !isPaged()) return;
      // عند إعادة القياس قبل اكتمال أول تخطيط نُبقي النسبة المطلوبة
      const ratio = paged.pending != null ? paged.pending : pageToRatio(paged.page);
      measurePaginationBase();
      setPage(ratioToPage(ratio), { animate: false, persist: true, count: false });
      if (paged.count > 1) paged.pending = null;
    }, 220);
  }

  function renderPaged(index, { ratio = 0 } = {}) {
    if (!isPaged()) return Promise.resolve();
    const safeIndex = clamp(index, 0, chapters.length - 1);
    const token = ++paged.token;
    paged.index = safeIndex;
    state.chapterIndex = safeIndex;
    paged.ready = false;
    paged.page = 0;
    paged.count = 1;
    const targetRatio = clamp(ratio, 0, 1);
    paged.pending = targetRatio;
    const chapter = chapters[safeIndex] || {};
    pageChapter.innerHTML = `${chapterHeaderMarkup(safeIndex)}<div class="reader2-chapter-body" data-page-body></div>`;
    const body = pageChapter.querySelector('[data-page-body]');
    fillChapterBody(body, chapter);
    body.querySelectorAll('img').forEach((img) => {
      // صور الأعمدة خارج الشاشة لا يحمّلها المتصفح مع lazy، فنجعلها فورية
      img.loading = 'eager';
      if (img.complete) {
        scheduleRepaginate();
        return;
      }
      img.addEventListener('load', scheduleRepaginate, { once: true });
      img.addEventListener('error', scheduleRepaginate, { once: true });
    });
    pagedTrack.style.transition = 'none';
    pagedTrack.style.transform = 'translate3d(0, 0, 0)';
    pagedView.classList.remove('is-entering');
    void pagedView.offsetWidth;
    pagedView.classList.add('is-entering');
    // إن تأخّرت الخطوط أو الصور عن التخطيط الأول، نعيد القياس بعد جاهزيتها
    document.fonts?.ready?.then?.(() => {
      if (!state.destroyed && isPaged() && token === paged.token) scheduleRepaginate();
    });
    return new Promise((resolve) => {
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          if (state.destroyed || token !== paged.token || !isPaged()) {
            resolve(false);
            return;
          }
          measurePaginationBase();
          const wanted = paged.pending != null ? paged.pending : targetRatio;
          setPage(ratioToPage(wanted), { animate: false, persist: true, count: false });
          if (paged.count > 1) paged.pending = null;
          resolve(true);
        })
      );
    });
  }

  function pagedNext() {
    if (!paged.ready) return;
    paged.pending = null;
    if (paged.page < paged.count - 1) {
      setPage(paged.page + 1);
      return;
    }
    if (paged.index < chapters.length - 1) {
      flashTurn(1);
      renderPaged(paged.index + 1, { ratio: 0 });
      return;
    }
    finishBook();
  }

  function pagedPrev() {
    if (!paged.ready) return;
    paged.pending = null;
    if (paged.page > 0) {
      setPage(paged.page - 1);
      return;
    }
    if (paged.index > 0) {
      flashTurn(-1);
      renderPaged(paged.index - 1, { ratio: 1 });
      return;
    }
    setPage(0, { animate: false });
  }

  /** رقم الصفحة التي يقع فيها عنصر داخل التدفّق المتعدد الأعمدة (RTL) */
  function pageOfElement(element) {
    if (!element || !paged.pitch) return paged.page;
    const trackRect = pagedTrack.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    const distance = trackRect.right - rect.right;
    return clamp(Math.floor(distance / paged.pitch + 0.02), 0, Math.max(0, paged.count - 1));
  }

  /* ---------- وضع التركيز ---------- */
  function buildFocusChapter(index) {
    if (focus.index === index && focus.blocks.length) return;
    focus.index = index;
    focus.blocks = [];
    focusStack.innerHTML = '';
    const chapter = chapters[index] || {};
    const holder = document.createElement('div');
    fillChapterBody(holder, chapter);
    const blocks = [...holder.children].filter((node) => (node.textContent || '').trim() || node.querySelector?.('img'));
    const source = blocks.length ? blocks : [];
    source.forEach((node) => {
      const wrap = document.createElement('div');
      wrap.className = 'r2-focus-block';
      wrap.appendChild(node);
      focusStack.appendChild(wrap);
    });
    if (!source.length) {
      const empty = document.createElement('div');
      empty.className = 'r2-focus-block';
      empty.innerHTML = '<p>لا يوجد نص في هذا الفصل.</p>';
      focusStack.appendChild(empty);
    }
    focus.blocks = [...focusStack.querySelectorAll('.r2-focus-block')];
    focusTitle.textContent = chapterTitle(index);
    focusKicker.textContent = chapters.length > 1 ? `الفصل ${arNum(index + 1)}` : 'الكتاب';
  }

  function showFocusBlock(block, { animate = true } = {}) {
    const list = focus.blocks;
    if (!list.length) return;
    const target = clamp(Math.round(block), 0, list.length - 1);
    focus.block = target;
    list.forEach((node, index) => {
      const active = index === target;
      node.classList.toggle('is-active', active);
      node.classList.toggle('is-before', index < target);
      if (active && animate && !reduceMotion()) {
        node.classList.remove('is-in');
        void node.offsetWidth;
        node.classList.add('is-in');
      }
    });
    state.chapterIndex = focus.index;
    state.ratio = list.length > 1 ? target / (list.length - 1) : 0;
    state.percent = percentFor(focus.index, state.ratio);
    if (focusCount) focusCount.textContent = `${arNum(target + 1)} / ${arNum(list.length)}`;
    focusStack.scrollTop = 0;
    const frame = focusStack.closest('.r2-focus-stage');
    if (frame) frame.scrollTop = 0;
    updateTopChrome();
    schedulePersist();
  }

  function renderFocus(index, { ratio = 0, block = null } = {}) {
    if (!isFocus()) return;
    const safeIndex = clamp(index, 0, chapters.length - 1);
    buildFocusChapter(safeIndex);
    const target =
      block != null ? block : Math.round(clamp(ratio, 0, 1) * Math.max(0, focus.blocks.length - 1));
    showFocusBlock(target, { animate: true });
  }

  function focusNext() {
    if (focus.block < focus.blocks.length - 1) {
      showFocusBlock(focus.block + 1);
      return;
    }
    if (focus.index < chapters.length - 1) {
      buildFocusChapter(focus.index + 1);
      showFocusBlock(0);
      return;
    }
    finishBook();
  }

  function focusPrev() {
    if (focus.block > 0) {
      showFocusBlock(focus.block - 1);
      return;
    }
    if (focus.index > 0) {
      buildFocusChapter(focus.index - 1);
      showFocusBlock(focus.blocks.length - 1);
      return;
    }
    showFocusBlock(0, { animate: false });
  }

  /* ---------- التمرير التلقائي ---------- */
  function autoDwell() {
    return Math.round(17000 - clamp(state.prefs.autoSpeed, 1, 5) * 2400);
  }

  function autoPace() {
    return 10 + clamp(state.prefs.autoSpeed, 1, 5) * 16;
  }

  function syncAutoControls() {
    if (autoToggle) autoToggle.checked = state.prefs.autoScroll === true;
    if (autoSpeedInput) autoSpeedInput.value = String(state.prefs.autoSpeed);
    const value = root.querySelector('[data-auto-speed-value]');
    if (value) value.textContent = arNum(state.prefs.autoSpeed);
    readerEl.classList.toggle('is-auto', auto.active);
    readerEl.dataset.auto = auto.active ? 'on' : 'off';
  }

  function startAuto({ silent = false } = {}) {
    if (auto.active) return;
    state.prefs.autoScroll = true;
    auto.active = true;
    syncAutoControls();
    persistPrefsSoon();
    if (isPaged() || isFocus()) {
      auto.timer = setInterval(() => {
        if (!auto.active || state.destroyed || document.visibilityState !== 'visible' || activeSheet) return;
        if (isPaged()) pagedNext();
        else focusNext();
      }, autoDwell());
    } else {
      auto.last = performance.now();
      const step = (now) => {
        if (!auto.active || state.destroyed) return;
        const dt = Math.min(0.05, Math.max(0, (now - auto.last) / 1000));
        auto.last = now;
        if (isPaged() || isFocus()) {
          auto.raf = requestAnimationFrame(step);
          return;
        }
        if (document.visibilityState === 'visible' && !activeSheet) {
          stage.scrollTop += autoPace() * dt;
          if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) {
            stopAuto(true);
            return;
          }
        }
        auto.raf = requestAnimationFrame(step);
      };
      auto.raf = requestAnimationFrame(step);
    }
    if (!silent) showHint('بدأ التمرير التلقائي — أوقفه بالمس أو بمفتاح A');
  }

  function stopAuto(silent = false) {
    if (!auto.active && !auto.raf && !auto.timer) return;
    const wasActive = auto.active;
    auto.active = false;
    cancelAnimationFrame(auto.raf);
    clearInterval(auto.timer);
    auto.raf = 0;
    auto.timer = null;
    state.prefs.autoScroll = false;
    syncAutoControls();
    if (wasActive) persistPrefsSoon();
    if (wasActive && !silent) showHint('أوقفنا التمرير التلقائي');
  }

  function toggleAuto() {
    if (auto.active) stopAuto();
    else startAuto();
  }

  function goNext() {
    if (isPaged()) pagedNext();
    else if (isFocus()) focusNext();
    else nextChapter();
  }

  function goPrev() {
    if (isPaged()) pagedPrev();
    else if (isFocus()) focusPrev();
    else prevChapter();
  }

  function updateTopChrome() {
    const index = state.chapterIndex;
    const percent = clamp(state.percent, 0, 100);
    const rounded = Math.round(percent);
    if (chapterNow && (lastChromeChapter !== index || lastChromePercent !== rounded)) {
      const label = chapterLabel(index);
      chapterNow.textContent = label;
      chapterNow.title = label;
    }
    if (dockChapter) {
      if (isPaged()) dockChapter.textContent = `صفحة ${arNum(paged.page + 1)} من ${arNum(Math.max(1, paged.count))}`;
      else if (isFocus()) dockChapter.textContent = `مقطع ${arNum(focus.block + 1)} من ${arNum(Math.max(1, focus.blocks.length))}`;
      else dockChapter.textContent = chapters.length > 1 ? `الفصل ${arNum(index + 1)}` : book.title;
    }
    if (lastChromeChapter !== index || lastChromePercent !== rounded) {
      percentEl.textContent = `${arNum(rounded)}٪`;
      topProgress.style.width = `${percent}%`;
      if (document.activeElement !== seek) seek.value = String(Math.round(percent * 10));
      if (activeSheet === 'display') renderDisplayStats();
      lastChromeChapter = index;
      lastChromePercent = rounded;
    }
    const active = state.bookmarks.some(
      (bookmark) => bookmark.chapterIndex === index && Math.abs(bookmark.scrollRatio - state.ratio) < 0.015
    );
    bookmarkBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    bookmarkBtn.classList.toggle('is-on', active);
  }

  function schedulePersist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(flushProgress, 850);
  }

  function persistPrefsSoon(delay = 200) {
    if (state.destroyed) return;
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => onPrefs?.({ ...state.prefs }), delay);
  }

  function pageMeta() {
    if (isPaged()) return { pageInChapter: paged.page, pageCount: Math.max(1, paged.count) };
    if (isFocus()) return { pageInChapter: focus.block, pageCount: Math.max(1, focus.blocks.length) };
    return { pageInChapter: 0, pageCount: 1 };
  }

  function flushProgress() {
    clearTimeout(persistTimer);
    if (state.destroyed) return;
    const meta = pageMeta();
    onProgress?.({
      chapterIndex: state.chapterIndex,
      pageInChapter: meta.pageInChapter,
      pageCount: meta.pageCount,
      scrollRatio: state.percent >= 99.5 ? 1 : Number(state.ratio.toFixed(4)),
      percent: Number(state.percent.toFixed(1)),
      chapterTitle: chapterTitle(state.chapterIndex),
      at: new Date().toISOString(),
    });
  }

  function measurePosition() {
    const anchor = stage.scrollTop + 18;
    let low = 0;
    let high = sections.length - 1;
    let index = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (sections[mid].offsetTop <= anchor) {
        index = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    const section = sections[index];
    return {
      index,
      ratio: section ? clamp((anchor - section.offsetTop) / Math.max(1, section.offsetHeight), 0, 1) : 0,
    };
  }

  function recomputePosition() {
    if (state.prefs.mode !== 'flow') return;
    const top = stage.scrollTop;
    const { index, ratio } = measurePosition();
    const previous = state.chapterIndex;
    state.chapterIndex = index;
    state.ratio = ratio;
    state.percent = percentFor(index, ratio);
    const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
    if (index === chapters.length - 1 && top >= maxScroll - 6 && maxScroll > 8) {
      state.ratio = 1;
      state.percent = 100;
    }
    if (previous !== index) {
      if (activeSheet === 'toc') renderToc();
      if (activeSheet === 'display') renderDisplayStats();
    }
    updateTopChrome();
    schedulePersist();
  }

  // إيماءة المستخدم: 1 = نزول، -1 = صعود
  let gestureDir = 0;
  let lastGesture = 0;
  let touchY = 0;
  function noteGesture(dir) {
    gestureDir = dir;
    lastGesture = performance.now();
  }
  stage.addEventListener(
    'wheel',
    (event) => {
      if (Math.abs(event.deltaY) > 4) noteGesture(event.deltaY > 0 ? 1 : -1);
    },
    { passive: true }
  );
  stage.addEventListener(
    'touchstart',
    (event) => {
      touchY = event.touches[0]?.clientY ?? 0;
    },
    { passive: true }
  );
  stage.addEventListener(
    'touchmove',
    (event) => {
      const y = event.touches[0]?.clientY ?? touchY;
      // سحب الإصبع للأعلى = نزول في المحتوى
      if (Math.abs(y - touchY) > 6) noteGesture(y < touchY ? 1 : -1);
      touchY = y;
    },
    { passive: true }
  );

  let scrollFrame = 0;
  function onScroll() {
    if (state.destroyed || scrollFrame || state.prefs.mode !== 'flow') return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      if (state.destroyed || state.prefs.mode !== 'flow') return;
      const top = stage.scrollTop;
      const delta = top - state.lastTop;
      state.lastTop = top;
      if (delta > 0) {
        state.pageAcc += delta / Math.max(320, stage.clientHeight * 0.92);
        if (state.pageAcc >= 1) {
          const pages = Math.floor(state.pageAcc);
          state.pageAcc -= pages;
          state.sessionPages += pages;
        }
      }
      // اتجاه الشريط يُحدَّد من إيماءة المستخدم (عجلة/لمس) لا من فرق scrollTop،
      // لأن تحميل صور الصفحات يغيّر الارتفاعات فيبدو أحيانًا كأنه صعود مفاجئ.
      // المطلوب: يظهر مع النزول (القراءة) ويختفي عند الصعود.
      if (performance.now() - lastGesture < 700) {
        if (gestureDir < 0 && top > 90) readerEl.classList.add('is-compact');
        else if (gestureDir > 0 || top < 48) readerEl.classList.remove('is-compact');
      } else if (top < 48) {
        readerEl.classList.remove('is-compact');
      }
      recomputePosition();
    });
  }

  function scrollToRatio(index, ratio, { smooth = false } = {}) {
    if (state.prefs.mode !== 'flow') return;
    const safeIndex = clamp(index, 0, chapters.length - 1);
    hydrate(safeIndex);
    const section = sections[safeIndex];
    if (!section) return;
    const top = section.offsetTop + clamp(ratio, 0, 1) * section.offsetHeight - 18;
    stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
    state.chapterIndex = safeIndex;
    state.ratio = clamp(ratio, 0, 1);
    state.percent = percentFor(safeIndex, state.ratio);
    state.lastTop = Math.max(0, top);
    updateTopChrome();
    schedulePersist();
  }

  function flowGoToChapter(index, { ratio = 0, smooth = false } = {}) {
    const safeIndex = clamp(index, 0, chapters.length - 1);
    hydrate(safeIndex);
    return new Promise((resolve) => {
      requestAnimationFrame(() => {
        scrollToRatio(safeIndex, ratio, { smooth });
        resolve();
      });
    });
  }

  function goToChapter(index, { ratio = 0, smooth = false } = {}) {
    const safeIndex = clamp(index, 0, chapters.length - 1);
    if (isPaged()) {
      if (paged.index === safeIndex && paged.ready) {
        paged.pending = null;
        setPage(ratioToPage(ratio));
        return Promise.resolve(true);
      }
      return renderPaged(safeIndex, { ratio });
    }
    if (isFocus()) {
      if (focus.index === safeIndex && focus.blocks.length) {
        showFocusBlock(Math.round(clamp(ratio, 0, 1) * Math.max(0, focus.blocks.length - 1)));
      } else {
        renderFocus(safeIndex, { ratio });
      }
      return Promise.resolve();
    }
    return flowGoToChapter(safeIndex, { ratio, smooth });
  }

  function goToPercent(percent, { smooth = false } = {}) {
    const target = locatePercent(percent);
    return goToChapter(target.index, { ratio: target.ratio, smooth });
  }

  function nextChapter() {
    if (state.chapterIndex >= chapters.length - 1) {
      hydrate(chapters.length - 1);
      stage.scrollTo({ top: stage.scrollHeight, behavior: 'smooth' });
      return;
    }
    return goToChapter(state.chapterIndex + 1, { ratio: 0 });
  }

  function prevChapter() {
    return goToChapter(Math.max(0, state.chapterIndex - 1), { ratio: 0 });
  }

  function showHint(message) {
    if (state.prefs.showHints === false) return;
    hint.textContent = message;
    hint.classList.add('is-on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.remove('is-on'), 2200);
  }

  function commitBookmarks() {
    const list = state.bookmarks.slice(-60);
    const last = list[list.length - 1] || null;
    onBookmark?.(last, list);
    const count = root.querySelector('[data-bookmark-count]');
    if (count) count.textContent = arNum(list.length);
    if (activeSheet === 'toc') renderBookmarks();
    updateTopChrome();
  }

  function excerptAt(index, ratio) {
    const text = String(chapters[index]?.text || '').replace(/\s+/g, ' ').trim();
    if (!text) return '';
    const at = Math.round(text.length * clamp(ratio, 0, 1));
    const start = Math.max(0, at - 30);
    return `${start ? '…' : ''}${text.slice(start, start + 150).trim()}${at + 150 < text.length ? '…' : ''}`;
  }

  function toggleBookmark() {
    const index = state.chapterIndex;
    const ratio = state.ratio;
    const existing = state.bookmarks.findIndex(
      (bookmark) => bookmark.chapterIndex === index && Math.abs(bookmark.scrollRatio - ratio) < 0.015
    );
    if (existing >= 0) {
      state.bookmarks.splice(existing, 1);
      showHint('أُزيلت الإشارة');
      sound.play('pop');
    } else {
      state.bookmarks.push({
        id: `bm-${Date.now()}`,
        chapterIndex: index,
        scrollRatio: Number(ratio.toFixed(4)),
        label: chapterTitle(index),
        excerpt: excerptAt(index, ratio),
        createdAt: new Date().toISOString(),
      });
      showHint('حُفظ موضعك في إشاراتي');
      sound.play('bookmark');
    }
    commitBookmarks();
  }

  function renderToc() {
    const filterInput = root.querySelector('[data-toc-filter]');
    const list = root.querySelector('[data-toc-list]');
    if (!list) return;
    const term = String(filterInput?.value || '').trim().toLowerCase();
    const rows = chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(({ chapter, index }) => !term || String(chapter.title || '').toLowerCase().includes(term) || String(index + 1) === term);
    if (!rows.length) {
      list.innerHTML = `<p class="reader2-empty">لا فصل بهذا العنوان. جرّب كلمة أخرى.</p>`;
      return;
    }
    list.innerHTML = rows
      .map(({ chapter, index }) => {
        const current = index === state.chapterIndex;
        const percent = Math.round(percentFor(index, 0));
        return `<button type="button" class="reader2-toc-row ${current ? 'is-current' : ''}" data-goto-chapter="${index}">
          <span class="reader2-toc-num">${arNum(index + 1)}</span>
          <span class="reader2-toc-text"><strong>${escapeHtml(chapter.title || `الفصل ${arNum(index + 1)}`)}</strong><small>${arNum(Math.max(0, Number(chapter.words) || 0))} كلمة · يبدأ عند ${arNum(percent)}٪</small></span>
          ${current ? '<span class="reader2-now">الآن</span>' : ''}
        </button>`;
      })
      .join('');
    lastTocIndex = state.chapterIndex;
  }

  function renderBookmarks() {
    const pane = root.querySelector('[data-bookmarks-pane]');
    if (!pane) return;
    if (!state.bookmarks.length) {
      pane.innerHTML = `<div class="reader2-empty-state"><span aria-hidden="true">🔖</span><strong>لا إشارات بعد</strong><p>اضغط زر الإشارة في الشريط لحفظ موضعك، وستجده هنا.</p><button class="reader2-pill" data-add-bookmark type="button">أضف إشارة عند موضعي</button></div>`;
      return;
    }
    pane.innerHTML = `<div class="reader2-bookmark-list">${[...state.bookmarks]
      .reverse()
      .map((bookmark) => {
        const index = state.bookmarks.indexOf(bookmark);
        return `<div class="reader2-bookmark">
          <button class="reader2-bookmark-main" type="button" data-goto-bookmark="${index}">
            <span class="reader2-bookmark-title">${escapeHtml(bookmark.label || chapterTitle(bookmark.chapterIndex))}</span>
            <small>${escapeHtml(bookmark.excerpt || 'موضع محفوظ')}</small>
          </button>
          <button class="reader2-bookmark-del" type="button" data-del-bookmark="${index}" aria-label="حذف الإشارة">${icons.close}</button>
        </div>`;
      })
      .join('')}</div>`;
  }

  function clearSearchMarks() {
    root.querySelectorAll('mark.reader2-hit').forEach((mark) => {
      const text = document.createTextNode(mark.textContent || '');
      mark.replaceWith(text);
      text.parentNode?.normalize?.();
    });
  }

  function renderSearchResults(query) {
    const resultsEl = root.querySelector('[data-search-results]');
    const note = root.querySelector('[data-search-note]');
    if (!resultsEl || !note) return;
    const term = String(query || '').trim();
    if (term.length < 2) {
      state.searchResults = [];
      resultsEl.innerHTML = '';
      note.textContent = 'اكتب حرفين على الأقل للبحث في كل الفصول.';
      return;
    }
    const lower = term.toLowerCase();
    const results = [];
    for (let index = 0; index < chapters.length && results.length < 80; index += 1) {
      const text = String(chapters[index].text || '');
      const haystack = text.toLowerCase();
      let from = 0;
      let occurrence = 0;
      while (results.length < 80) {
        const at = haystack.indexOf(lower, from);
        if (at < 0) break;
        const start = Math.max(0, at - 55);
        const end = Math.min(text.length, at + term.length + 85);
        results.push({
          index,
          occurrence,
          query: term,
          snippet: `${start ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`,
        });
        from = at + Math.max(1, term.length);
        occurrence += 1;
        if (occurrence >= 4) break;
      }
    }
    state.searchResults = results;
    note.textContent = results.length
      ? `${arNum(results.length)} نتيجة${results.length >= 80 ? ' (تُعرض الأولى)' : ''}`
      : 'لا نتائج بهذه الكلمة. جرّب كلمة أقصر أو مرادفًا.';
    resultsEl.innerHTML = results.length
      ? results
          .map((result, resultIndex) => {
            const snippet = result.snippet;
            const at = snippet.toLowerCase().indexOf(lower);
            const highlighted =
              at < 0
                ? escapeHtml(snippet)
                : `${escapeHtml(snippet.slice(0, at))}<mark>${escapeHtml(snippet.slice(at, at + term.length))}</mark>${escapeHtml(snippet.slice(at + term.length))}`;
            return `<button type="button" class="reader2-result" data-search-result="${resultIndex}">
              <span class="reader2-result-head"><b>${escapeHtml(chapterTitle(result.index))}</b><i>${arNum(Math.round(percentFor(result.index, 0)))}٪</i></span>
              <p>${highlighted}</p>
            </button>`;
          })
          .join('')
      : `<div class="reader2-empty-state"><span aria-hidden="true">🔎</span><strong>لا شيء هنا</strong><p>جرّب كلمة من متن الكتاب، أو ابحث في الفهرس عن عنوان الفصل.</p></div>`;
  }

  /** يلفّ الظهور رقم occurrence من كلمة البحث داخل النطاق، ويعيده */
  function markOccurrence(scope, term, occurrence) {
    if (!scope || !term) return null;
    const lower = term.toLowerCase();
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node = null;
    let count = 0;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || '';
      const haystack = text.toLowerCase();
      let from = 0;
      while (from <= haystack.length) {
        const at = haystack.indexOf(lower, from);
        if (at < 0) break;
        if (count === occurrence) {
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + term.length);
          const mark = document.createElement('mark');
          mark.className = 'reader2-hit is-target';
          try {
            range.surroundContents(mark);
            return mark;
          } catch {
            return null;
          }
        }
        count += 1;
        from = at + Math.max(1, term.length);
      }
    }
    return null;
  }

  async function highlightOccurrence(index, query, occurrence) {
    const term = String(query || '');
    if (!term) return;
    const safeIndex = clamp(index, 0, chapters.length - 1);

    if (isPaged()) {
      if (paged.index !== safeIndex || !paged.ready) await renderPaged(safeIndex, { ratio: 0 });
      clearSearchMarks();
      const body = pageChapter.querySelector('[data-page-body]');
      const target = markOccurrence(body, term, occurrence);
      if (!target) return;
      setPage(pageOfElement(target), { animate: true });
      setTimeout(() => target?.classList.add('is-pulse'), 460);
      return;
    }

    if (isFocus()) {
      buildFocusChapter(safeIndex);
      const lower = term.toLowerCase();
      let remaining = Math.max(0, Number(occurrence) || 0);
      let targetBlock = 0;
      focus.blocks.forEach((node, blockIndex) => {
        const text = (node.textContent || '').toLowerCase();
        let at = 0;
        let hits = 0;
        while ((at = text.indexOf(lower, at)) !== -1) {
          hits += 1;
          at += Math.max(1, lower.length);
        }
        if (remaining < hits) {
          targetBlock = blockIndex;
          remaining = 0;
          return;
        }
        remaining -= hits;
        targetBlock = blockIndex;
      });
      showFocusBlock(targetBlock, { animate: false });
      const active = focus.blocks[targetBlock];
      active?.classList.add('is-pulse');
      setTimeout(() => active?.classList.remove('is-pulse'), 1800);
      return;
    }

    hydrate(safeIndex);
    clearSearchMarks();
    const body = sections[safeIndex]?.querySelector('[data-body]');
    const target = markOccurrence(body, term, occurrence);
    if (!target) return;
    target.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setTimeout(() => target?.classList.add('is-pulse'), 450);
  }

  function renderDisplayStats() {
    const box = root.querySelector('[data-display-stats]');
    if (!box) return;
    const totalWords = chapters.reduce((sum, chapter) => sum + (Number(chapter.words) || 0), 0);
    const remainingMinutes = (totalWords / 220) * (1 - state.percent / 100);
    const readMinutes = (totalWords / 220) * (state.percent / 100);
    box.innerHTML = `
      <div><small>موضعك</small><strong>${arNum(Math.round(state.percent))}٪</strong></div>
      <div><small>مقروء تقديرًا</small><strong>${minutesLabel(readMinutes)}</strong></div>
      <div><small>المتبقي</small><strong>${minutesLabel(remainingMinutes)}</strong></div>`;
  }

  function syncDisplayControls() {
    const p = state.prefs;
    const size = root.querySelector('[data-font-size]');
    const sizeValue = root.querySelector('[data-size-value]');
    const line = root.querySelector('[data-line-height]');
    const lineValue = root.querySelector('[data-line-value]');
    const justify = root.querySelector('[data-justify]');
    if (size) size.value = String(p.fontSize);
    if (sizeValue) sizeValue.textContent = arNum(p.fontSize);
    if (line) line.value = String(p.lineHeight);
    if (lineValue) lineValue.textContent = p.lineHeight.toFixed(2);
    if (justify) justify.checked = p.justify;
    if (autoToggle) autoToggle.checked = state.prefs.autoScroll === true;
    syncModeControls();
    root.querySelectorAll('[data-theme-id]').forEach((button) => {
      const active = button.dataset.themeId === p.theme;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-width-value]').forEach((button) => {
      const active = button.dataset.widthValue === p.width;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-font-value]').forEach((button) => {
      const active = button.dataset.fontValue === p.font;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    root.querySelectorAll('[data-pdf-view]').forEach((button) => {
      const active = button.dataset.pdfView === p.pdfView;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const quickView = root.querySelector('[data-quick-pdf-view]');
    if (quickView) {
      quickView.dataset.mode = p.pdfView;
      quickView.setAttribute('aria-pressed', p.pdfView === 'text' ? 'true' : 'false');
      const label = quickView.querySelector('[data-quick-pdf-label]');
      if (label) label.textContent = p.pdfView === 'text' ? 'نص' : 'صور';
      quickView.title = p.pdfView === 'text' ? 'العرض الحالي: النص — اضغط للصور' : 'العرض الحالي: صور — اضغط للنص';
    }
    renderDisplayStats();
  }

  function applyPrefs({ reanchor = false, persist = true } = {}) {
    const p = state.prefs;
    if (!p.autoScroll && auto.active) stopAuto(true);
    // نقيس الموضع الفعلي قبل أن يتغيّر التنسيق، لا نعتمد على آخر حالة محفوظة
    const anchor = reanchor ? captureAnchor() : null;
    readerEl.dataset.theme = p.theme;
    readerEl.style.setProperty('--r2-size', `${p.fontSize}px`);
    readerEl.style.setProperty('--r2-line', String(p.lineHeight));
    readerEl.style.setProperty('--r2-width', `${WIDTHS[p.width] || WIDTHS.medium}px`);
    readerEl.style.setProperty(
      '--r2-font',
      p.font === 'sans' ? 'var(--font-ui)' : 'var(--font-reading)'
    );
    readerEl.classList.toggle('is-justified', p.justify);
    readerEl.classList.toggle('is-pdf-text', p.pdfView === 'text');
    readerEl.classList.toggle(
      'is-pdf-images',
      String(book.format || '').toUpperCase() === 'PDF' && p.pdfView !== 'text'
    );
    applyModeVisibility();
    sections.forEach((section) => {
      if (section.dataset.loaded !== 'true') {
        section.style.setProperty('--r2-est', `${estimateHeight(chapters[Number(section.dataset.chapter)])}px`);
      }
    });
    syncDisplayControls();
    if (persist) {
      clearTimeout(prefsTimer);
      prefsTimer = setTimeout(() => onPrefs?.({ ...p }), 160);
    }
    if (reanchor) {
      if (isPaged() || isFocus()) {
        clearTimeout(reanchorTimer);
        reanchorTimer = setTimeout(() => restoreAnchor(anchor), 170);
      } else {
        requestAnimationFrame(() => restoreAnchor(anchor));
      }
    }
  }

  function renderCoverSheet() {
    const body = root.querySelector('[data-cover-body]');
    if (!body) return;
    const totalWords = chapters.reduce((sum, chapter) => sum + (Number(chapter.words) || 0), 0);
    body.innerHTML = `
      <div class="reader2-cover-hero">
        <div class="reader2-cover-art ${state.cover ? 'has-art' : ''}" data-cover-art>
          ${state.cover ? `<img data-cover-big src="${escapeHtml(state.cover)}" alt="" />` : `<span>${escapeHtml(initials)}</span>`}
        </div>
        <div class="reader2-cover-copy">
          <span class="r2-eyebrow">${escapeHtml(book.format || 'كتاب')}</span>
          <h3>${escapeHtml(book.title || 'كتاب')}</h3>
          <p>${escapeHtml(book.author || 'بدون مؤلف')}</p>
          <div class="reader2-cover-chips">
            <span>${arNum(chapters.length)} فصل</span>
            ${totalWords ? `<span>${arNum(totalWords)} كلمة</span>` : ''}
            <span>${escapeHtml(book.sizeLabel || '')}</span>
          </div>
        </div>
      </div>
      <div class="reader2-cover-progress">
        <div><span>تقدمك</span><b>${arNum(Math.round(state.percent))}٪</b></div>
        <div class="reader2-cover-bar"><i style="width:${clamp(state.percent, 0, 100)}%"></i></div>
        <small>${escapeHtml(chapterTitle(state.chapterIndex))}</small>
      </div>
      <div class="reader2-cover-actions">
        <button class="reader2-pill" data-change-cover type="button">🖼 تغيير صورة الغلاف</button>
        <button class="reader2-pill is-ghost" data-cover-toc type="button">${icons.list} فهرس الكتاب</button>
      </div>
      <p class="reader2-privacy">الغلاف مستخرج من ملف الكتاب تلقائيًا. يمكنك استبداله بصورة شخصية، وكل شيء يبقى على جهازك.</p>`;
  }

  function openSheet(name) {
    const existing = root.querySelector(`[data-sheet="${name}"]`);
    if (activeSheet === name && existing?.classList.contains('is-open')) {
      closeSheet();
      return;
    }
    closeSheet();
    const sheet = existing;
    if (!sheet) return;
    activeSheet = name;
    readerEl.classList.add('has-sheet');
    backdrop.hidden = false;
    sheet.hidden = false;
    if (name === 'toc') {
      root.querySelectorAll('[data-tab]').forEach((button) => {
        const active = button.dataset.tab === 'chapters';
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      root.querySelector('[data-toc-pane]').hidden = false;
      root.querySelector('[data-bookmarks-pane]').hidden = true;
      renderToc();
    }
    if (name === 'bookmarks') renderBookmarks();
    if (name === 'display') syncDisplayControls();
    if (name === 'cover') renderCoverSheet();
    if (name === 'search') {
      renderSearchResults(root.querySelector('[data-search-input]')?.value || '');
      setTimeout(() => root.querySelector('[data-search-input]')?.focus(), 120);
    }
    requestAnimationFrame(() => sheet.classList.add('is-open'));
    if (name === 'toc') setTimeout(() => root.querySelector('[data-toc-filter]')?.focus(), 180);
  }

  function closeSheet() {
    if (!activeSheet) return;
    const sheet = root.querySelector(`[data-sheet="${activeSheet}"]`);
    activeSheet = null;
    readerEl.classList.remove('has-sheet');
    backdrop.hidden = true;
    if (sheet) {
      sheet.classList.remove('is-open');
      setTimeout(() => {
        if (activeSheet === null) sheet.hidden = true;
      }, 260);
    }
  }

  function toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else if (readerEl.requestFullscreen) readerEl.requestFullscreen();
      else toast.info('ملء الشاشة غير متاح في هذا المتصفح');
    } catch {
      toast.info('ملء الشاشة غير متاح في هذا المتصفح');
    }
  }

  /* ---------- الأحداث ---------- */
  root.querySelector('[data-back]').addEventListener('click', () => {
    flushProgress();
    onExit?.();
  });

  root.querySelector('[data-search]').addEventListener('click', () => openSheet('search'));
  root.querySelector('[data-toc]').addEventListener('click', () => openSheet('toc'));
  root.querySelector('[data-display]').addEventListener('click', () => openSheet('display'));
  root.querySelector('[data-open-cover]').addEventListener('click', () => openSheet('cover'));
  root.querySelector('[data-ai]').addEventListener('click', () => aiPanel?.toggle());
  bookmarkBtn.addEventListener('click', toggleBookmark);

  root.querySelector('[data-prev]').addEventListener('click', goPrev);
  root.querySelector('[data-next]').addEventListener('click', goNext);
  root.querySelector('[data-mode-cycle]').addEventListener('click', cycleMode);
  root.querySelector('[data-focus-prev]').addEventListener('click', focusPrev);
  root.querySelector('[data-focus-next]').addEventListener('click', focusNext);
  seek.addEventListener('input', () => goToPercent(Number(seek.value) / 10));
  stage.addEventListener('scroll', onScroll, { passive: true });
  stage.addEventListener('wheel', () => stopAuto(true), { passive: true });
  stage.addEventListener('touchstart', () => stopAuto(true), { passive: true });

  backdrop.addEventListener('click', closeSheet);
  root.querySelectorAll('[data-close-sheet]').forEach((button) => button.addEventListener('click', closeSheet));

  root.querySelector('[data-sheet="toc"]').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (tab) {
      const bookmarksTab = tab.dataset.tab === 'bookmarks';
      root.querySelectorAll('[data-tab]').forEach((button) => {
        const active = button === tab;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      root.querySelector('[data-toc-pane]').hidden = bookmarksTab;
      root.querySelector('[data-bookmarks-pane]').hidden = !bookmarksTab;
      if (bookmarksTab) renderBookmarks();
      return;
    }
    const goto = event.target.closest('[data-goto-chapter]');
    if (goto) {
      closeSheet();
      goToChapter(Number(goto.dataset.gotoChapter), { ratio: 0 });
      return;
    }
    const add = event.target.closest('[data-add-bookmark]');
    if (add) {
      toggleBookmark();
      return;
    }
    const gotoBookmark = event.target.closest('[data-goto-bookmark]');
    if (gotoBookmark) {
      const bookmark = state.bookmarks[Number(gotoBookmark.dataset.gotoBookmark)];
      if (!bookmark) return;
      closeSheet();
      goToChapter(bookmark.chapterIndex, { ratio: bookmark.scrollRatio });
      return;
    }
    const removeBookmark = event.target.closest('[data-del-bookmark]');
    if (removeBookmark) {
      const index = Number(removeBookmark.dataset.delBookmark);
      state.bookmarks.splice(index, 1);
      commitBookmarks();
      renderBookmarks();
    }
  });

  root.querySelector('[data-toc-filter]').addEventListener('input', renderToc);

  const searchInput = root.querySelector('[data-search-input]');
  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => renderSearchResults(searchInput.value), 180);
  });
  root.querySelector('[data-search-results]').addEventListener('click', (event) => {
    const button = event.target.closest('[data-search-result]');
    if (!button) return;
    const result = state.searchResults[Number(button.dataset.searchResult)];
    if (!result) return;
    closeSheet();
    goToChapter(result.index, { ratio: 0 }).then(() => {
      setTimeout(() => highlightOccurrence(result.index, result.query, result.occurrence), 120);
    });
  });

  root.querySelector('[data-quick-pdf-view]')?.addEventListener('click', () => {
    state.prefs.pdfView = state.prefs.pdfView === 'text' ? 'images' : 'text';
    applyPrefs({ reanchor: true, persist: true });
    showHint(state.prefs.pdfView === 'text' ? 'عرض النص المستخرج' : 'عرض صور الصفحات');
  });

  root.querySelector('[data-sheet="display"]').addEventListener('click', (event) => {
    const modeButton = event.target.closest('[data-mode-value]');
    if (modeButton) {
      setMode(modeButton.dataset.modeValue);
      return;
    }
    const themeButton = event.target.closest('[data-theme-id]');
    if (themeButton) {
      state.prefs.theme = themeButton.dataset.themeId;
      applyPrefs({ persist: true });
      return;
    }
    const widthButton = event.target.closest('[data-width-value]');
    if (widthButton) {
      state.prefs.width = widthButton.dataset.widthValue;
      applyPrefs({ reanchor: true, persist: true });
      return;
    }
    const fontButton = event.target.closest('[data-font-value]');
    if (fontButton) {
      state.prefs.font = fontButton.dataset.fontValue;
      applyPrefs({ reanchor: true, persist: true });
      return;
    }
    if (event.target.closest('[data-quick-pdf-view]')) {
      state.prefs.pdfView = state.prefs.pdfView === 'text' ? 'images' : 'text';
      applyPrefs({ reanchor: true, persist: true });
      showHint(state.prefs.pdfView === 'text' ? 'عرض النص المستخرج' : 'عرض صور الصفحات');
      return;
    }
    const pdfViewButton = event.target.closest('[data-pdf-view]');
    if (pdfViewButton) {
      state.prefs.pdfView = pdfViewButton.dataset.pdfView === 'text' ? 'text' : 'images';
      applyPrefs({ reanchor: true, persist: true });
      return;
    }
    if (event.target.closest('[data-fullscreen]')) {
      toggleFullscreen();
      return;
    }
    if (event.target.closest('[data-reset-prefs]')) {
      state.prefs = normalizePrefs(DEFAULT_PREFS);
      applyPrefs({ reanchor: true, persist: true });
      showHint('استعدنا المظهر الافتراضي');
    }
  });

  root.querySelector('[data-font-size]').addEventListener('input', (event) => {
    state.prefs.fontSize = clamp(Number(event.target.value), 15, 32);
    applyPrefs({ reanchor: true, persist: true });
  });
  root.querySelector('[data-line-height]').addEventListener('input', (event) => {
    state.prefs.lineHeight = clamp(Number(event.target.value), 1.55, 2.5);
    applyPrefs({ reanchor: true, persist: true });
  });
  root.querySelector('[data-justify]').addEventListener('change', (event) => {
    state.prefs.justify = event.target.checked;
    applyPrefs({ reanchor: true, persist: true });
  });
  autoToggle?.addEventListener('change', (event) => {
    if (event.target.checked) startAuto();
    else stopAuto(true);
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => onPrefs?.({ ...state.prefs }), 160);
  });
  autoSpeedInput?.addEventListener('input', (event) => {
    state.prefs.autoSpeed = clamp(Number(event.target.value), 1, 5);
    syncAutoControls();
    if (auto.active) {
      stopAuto(true);
      startAuto({ silent: true });
    }
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => onPrefs?.({ ...state.prefs }), 160);
  });

  root.querySelector('[data-sheet="cover"]').addEventListener('click', (event) => {
    if (event.target.closest('[data-change-cover]')) {
      onCoverRequest?.();
      return;
    }
    if (event.target.closest('[data-cover-toc]')) {
      closeSheet();
      setTimeout(() => openSheet('toc'), 280);
    }
  });

  endcard.querySelector('[data-end-back]').addEventListener('click', () => goToChapter(0, { ratio: 0 }));
  endcard.querySelector('[data-end-library]').addEventListener('click', () => {
    flushProgress();
    onExit?.();
  });

  root.querySelector('[data-sheet="end"]').addEventListener('click', (event) => {
    if (event.target.closest('[data-end-sheet-back]')) {
      closeSheet();
      setTimeout(() => goToChapter(0, { ratio: 0 }), 160);
      return;
    }
    if (event.target.closest('[data-end-sheet-toc]')) {
      closeSheet();
      setTimeout(() => openSheet('toc'), 200);
      return;
    }
    if (event.target.closest('[data-end-sheet-library]')) {
      closeSheet();
      flushProgress();
      onExit?.();
    }
  });

  /* ---------- إيماءات الصفحات والتركيز ---------- */
  let pointerStart = null;
  function bindSwipe(surface, onForward, onBack, tapForward = true) {
    surface.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointerStart = { x: event.clientX, y: event.clientY, at: performance.now() };
      stopAuto(true);
    });
    surface.addEventListener('pointerup', (event) => {
      if (!pointerStart) return;
      const start = pointerStart;
      pointerStart = null;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (String(window.getSelection?.() || '').length) return;
        event.preventDefault();
        // في العربية الصفحة التالية إلى اليسار: سحب لليمين = التالي
        if (dx > 0) onForward();
        else onBack();
        return;
      }
      if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && performance.now() - start.at < 620) {
        if (event.target.closest('a, button, input, mark')) return;
        if (String(window.getSelection?.() || '').length) return;
        if (!tapForward) return;
        const rect = surface.getBoundingClientRect();
        const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);
        if (ratio < 0.28) onForward();
        else if (ratio > 0.72) onBack();
        else readerEl.classList.toggle('is-compact');
      }
    });
    surface.addEventListener('pointercancel', () => {
      pointerStart = null;
    });
  }
  bindSwipe(pagedViewport, pagedNext, pagedPrev, true);
  bindSwipe(focusView, focusNext, focusPrev, false);

  // عجلة الفأرة تقلب الصفحات في وضع الصفحات (مع مهلة تمنع القفز المتكرر)
  let wheelAcc = 0;
  let wheelLock = 0;
  stage.addEventListener(
    'wheel',
    (event) => {
      if (!isPaged() || activeSheet || event.ctrlKey || event.metaKey) return;
      const now = performance.now();
      if (now < wheelLock) {
        event.preventDefault();
        return;
      }
      wheelAcc += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (Math.abs(wheelAcc) < 70) {
        event.preventDefault();
        return;
      }
      const forward = wheelAcc > 0;
      wheelAcc = 0;
      wheelLock = now + 380;
      event.preventDefault();
      stopAuto(true);
      if (forward) pagedNext();
      else pagedPrev();
    },
    { passive: false }
  );

  stage.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (link) {
      event.preventDefault();
      toast.info('الروابط الخارجية معطّلة داخل القارئ');
      return;
    }
    if (readerEl.classList.contains('is-compact') && event.clientY < 72) readerEl.classList.remove('is-compact');
  });

  const onKey = (event) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)) return;
    if (['ArrowDown', 'PageDown', ' '].includes(event.key)) noteGesture(1);
    if (['ArrowUp', 'PageUp'].includes(event.key)) noteGesture(-1);
    if (event.key === 'Escape') {
      if (activeSheet) closeSheet();
      else if (aiPanel?.isOpen()) aiPanel.close();
      else if (auto.active) stopAuto();
      else if (readerEl.classList.contains('is-compact')) readerEl.classList.remove('is-compact');
      return;
    }
    if (activeSheet) return;
    const viewport = Math.max(240, stage.clientHeight * 0.86);
    const pagedMode = isPaged();
    const focusMode = isFocus();
    if (event.key === 'ArrowDown' || event.key === 'PageDown' || (event.key === ' ' && !event.shiftKey)) {
      event.preventDefault();
      stopAuto(true);
      if (pagedMode) pagedNext();
      else if (focusMode) focusNext();
      else stage.scrollBy({ top: viewport, behavior: 'smooth' });
    } else if (event.key === 'ArrowUp' || event.key === 'PageUp' || (event.key === ' ' && event.shiftKey)) {
      event.preventDefault();
      stopAuto(true);
      if (pagedMode) pagedPrev();
      else if (focusMode) focusPrev();
      else stage.scrollBy({ top: -viewport, behavior: 'smooth' });
    } else if (event.key === 'Home') {
      event.preventDefault();
      goToChapter(0, { ratio: 0 });
    } else if (event.key === 'End') {
      event.preventDefault();
      goToChapter(chapters.length - 1, { ratio: 1 });
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      stopAuto(true);
      goNext();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      stopAuto(true);
      goPrev();
    } else if (event.key === 'b' || event.key === 'B') {
      toggleBookmark();
    } else if (event.key === 'm' || event.key === 'M') {
      cycleMode();
    } else if (event.key === 'a' || event.key === 'A') {
      toggleAuto();
    } else if (event.key === '/') {
      event.preventDefault();
      openSheet('search');
    } else if (event.key === 't' || event.key === 'T') {
      openSheet('toc');
    } else if (event.key === 'd' || event.key === 'D') {
      openSheet('display');
    } else if (event.key === 'f' || event.key === 'F') {
      toggleFullscreen();
    }
  };
  document.addEventListener('keydown', onKey);

  /* ---------- الحفظ عند إخفاء الصفحة ---------- */
  let sessionAt = Date.now();
  function flushReading() {
    if (state.destroyed) return;
    const now = Date.now();
    const seconds = Math.max(0, Math.round((now - sessionAt) / 1000));
    sessionAt = now;
    const pages = state.sessionPages;
    state.sessionPages = 0;
    if (seconds < 5 && !pages) return;
    onReading?.({ seconds, pages });
  }
  const readingTimer = setInterval(() => {
    if (state.destroyed || document.visibilityState !== 'visible') return;
    flushReading();
  }, 45_000);

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      flushProgress();
      flushReading();
    } else {
      sessionAt = Date.now();
    }
  };
  const onPageHide = () => {
    flushProgress();
    flushReading();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  /* ---------- المساعد ---------- */
  const latinDigits = (value) =>
    String(value ?? '')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

  /** يستخرج نطاق الصفحات من عنوان فصل مثل «الصفحات ١–٦» */
  function rangeFromTitle(title) {
    const text = latinDigits(title || '');
    const match = /(?:الصفحات|الصفحة|صفحات|صفحة)\s*(\d{1,4})(?:\s*[–—-]\s*(\d{1,4}))?/.exec(text);
    if (!match) return null;
    const from = Number(match[1]);
    const to = Number(match[2] || match[1]);
    if (!from || !to) return null;
    return { from: Math.min(from, to), to: Math.max(from, to) };
  }

  function chapterRange(index) {
    const chapter = chapters[index];
    if (!chapter) return null;
    if (Number(chapter.pageFrom) && Number(chapter.pageTo)) {
      return { from: Number(chapter.pageFrom), to: Number(chapter.pageTo) };
    }
    return rangeFromTitle(chapter.title);
  }

  function pageCountOf() {
    const declared = Number(book.pageCount) || 0;
    if (declared > 0) return declared;
    let max = 0;
    chapters.forEach((_, index) => {
      const range = chapterRange(index);
      if (range) max = Math.max(max, range.to);
    });
    return max;
  }

  /** متن الفصل المعروض حاليًا حسب طريقة القراءة (للذكاء والصور) */
  function activeChapterBody(index = state.chapterIndex) {
    if (isPaged() && paged.index === index) return pageChapter.querySelector('[data-page-body]');
    if (isFocus() && focus.index === index) return focusStack;
    return sections[index]?.querySelector('[data-body]') || null;
  }

  /** رقم صفحة PDF الظاهرة الآن (لا رقم الفصل) */
  function currentPageNumber() {
    const chapter = chapters[state.chapterIndex] || {};
    const range = chapterRange(state.chapterIndex);
    const fallback = range?.from || Number(chapter.pageFrom) || state.chapterIndex + 1;
    const body = activeChapterBody(state.chapterIndex);
    const pages = body?.querySelectorAll('.pdf-page[data-page]');
    if (!pages || !pages.length) return fallback;
    const stageTop = stage.getBoundingClientRect().top + 96;
    let current = Number(pages[0].dataset.page) || fallback;
    for (const node of pages) {
      if (node.getBoundingClientRect().top <= stageTop) current = Number(node.dataset.page) || current;
      else break;
    }
    return current;
  }

  function imageForPage(body, page) {
    const direct = body?.querySelector(`.pdf-page[data-page="${page}"] img`);
    if (direct) return direct;
    const images = body ? [...body.querySelectorAll('img')] : [];
    return (
      images.find((img) => {
        const alt = latinDigits(img.getAttribute('alt') || '');
        const caption = latinDigits(img.closest('figure')?.querySelector('figcaption')?.textContent || '');
        const pattern = new RegExp(`(?:صفحة|صفحه|page)\\s*${page}(?:\\D|$)`);
        return pattern.test(alt) || pattern.test(caption);
      }) || null
    );
  }

  function textFromPage(figure) {
    const node = figure?.querySelector('.pdf-page-text');
    return {
      text: String(node?.textContent || '').trim(),
      low: Boolean(node?.hasAttribute('data-raw')),
    };
  }

  async function waitImage(img) {
    if (!img) return;
    img.loading = 'eager';
    if (img.complete) return;
    await new Promise((resolve) => {
      const done = () => resolve();
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
      setTimeout(done, 4000);
    });
  }

  /**
   * يقرأ صفحة محددة برقمها حتى لو لم تكن ظاهرة.
   * يدعم الكتب الجديدة (نطاق صفحات محفوظ) والقديمة (عنوان الفصل/alt الصورة)،
   * وإذا لم يكن الكتاب مرقّمًا بالصفحات يعامل الرقم كرقم فصل.
   */
  async function getPageContext(number) {
    const page = Math.round(Number(number));
    if (!Number.isFinite(page) || page < 1) return null;
    const total = pageCountOf();
    if (total && page > total) return null;

    let index = chapters.findIndex((_, i) => {
      const range = chapterRange(i);
      return range && page >= range.from && page <= range.to;
    });
    let approximate = false;
    if (index < 0 && !total && page <= chapters.length) {
      // كتاب بلا ترقيم صفحات (EPUB مثلًا): اعتبر الرقم رقم فصل
      index = page - 1;
      approximate = true;
    }
    if (index < 0) return null;

    hydrate(index);
    const body = sections[index]?.querySelector('[data-body]');
    let figure = body?.querySelector(`.pdf-page[data-page="${page}"]`);
    let img = figure?.querySelector('img') || imageForPage(body, page);
    if (!figure && img) figure = img.closest('figure');
    const pageInfo = textFromPage(figure);
    let pageText = pageInfo.text;

    // كتاب قديم: قد لا توجد بطاقة لهذه الصفحة إن كان نصها سليمًا زمان.
    if (!pageText && !img) {
      const chapterText = String(chapters[index].text || '').trim();
      if (!chapterText) return null;
      pageText = chapterText;
      approximate = true;
    }
    await waitImage(img);

    return {
      bookTitle: book.title,
      format: String(book.format || '').toUpperCase(),
      chapterTitle: chapterTitle(index),
      pageText: pageText.slice(0, 14_000),
      pageNumber: page,
      pageCount: total || chapters.length,
      chapterIndex: index,
      locationLabel: `صفحة ${arNum(page)}${total ? ` من ${arNum(total)}` : ''}${approximate ? ' (تقريبي)' : ''}`,
      images: img ? [{ alt: img.getAttribute('alt') || '', caption: figure?.querySelector('figcaption')?.textContent?.trim() || '' }] : [],
      imageElements: img ? [img] : [],
      isPageImage: Boolean(img) && !pageText,
      brokenPage: figure?.dataset.broken === '1',
      textReliability: pageInfo.low && !approximate ? 'low' : 'high',
      approximate,
    };
  }

  aiPanel = createAiPanel({
    root: root.querySelector('[data-ai-host]'),
    getContext: () => {
      const chapter = chapters[state.chapterIndex] || {};
      const body = activeChapterBody(state.chapterIndex);
      const pageNumber = currentPageNumber();
      const pageFigure = body?.querySelector(`.pdf-page[data-page="${pageNumber}"]`);
      const pageInfo = textFromPage(pageFigure);
      let text = pageInfo.text;
      if (!text) {
        const all = String(chapter.text || '');
        const at = Math.round(all.length * state.ratio);
        const start = Math.max(0, at - 2200);
        text = all.slice(start, start + 14_000);
      }
      const imageElements = pageFigure
        ? [...pageFigure.querySelectorAll('img')]
        : body
          ? [...body.querySelectorAll('img')].slice(0, 4)
          : [];
      const total = pageCountOf();
      return {
        bookTitle: book.title,
        format: String(book.format || '').toUpperCase(),
        chapterTitle: chapterTitle(state.chapterIndex),
        pageText: text.slice(0, 14_000),
        pageNumber,
        pageCount: total || chapters.length,
        chapterIndex: state.chapterIndex,
        locationLabel: total
          ? `صفحة ${arNum(pageNumber)} من ${arNum(total)}`
          : `الفصل ${arNum(state.chapterIndex + 1)} · ${arNum(Math.round(state.percent))}٪`,
        images: imageElements.map((img) => ({
          alt: img.getAttribute('alt') || '',
          caption: img.closest('figure')?.querySelector('figcaption')?.textContent?.trim() || img.getAttribute('title') || '',
        })),
        imageElements,
        textReliability: pageInfo.low ? 'low' : 'high',
      };
    },
    getPageContext,
    getPagesContext,
    searchBook,
    onNavigate: (chapterIndex) => goToChapter(chapterIndex, { ratio: 0 }),
    onToast: (message, variant) => toast[variant || 'info']?.(message) || toast.info(message),
  });

  function captureVisionImage() {
    const img = activeChapterBody(state.chapterIndex)?.querySelector('img');
    if (!img || !img.naturalWidth) return null;
    try {
      const max = 720;
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      const context = canvas.getContext('2d', { alpha: false });
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.78);
    } catch {
      return null;
    }
  }


  /** صفحات متعددة في سياق واحد — للمساعد الذكي */
  async function getPagesContext(numbers) {
    const list = [...new Set((numbers || []).map((n) => Math.round(Number(n))).filter((n) => n > 0))].sort((a, b) => a - b).slice(0, 8);
    if (!list.length) return null;
    const results = [];
    const missing = [];
    for (const number of list) {
      const ctx = await getPageContext(number);
      if (ctx) results.push(ctx);
      else missing.push(number);
    }
    if (!results.length) return null;
    const labels = results.map((ctx) => ctx.pageNumber);
    return {
      bookTitle: book.title,
      format: String(book.format || '').toUpperCase(),
      chapterTitle: results.length === 1 ? results[0].chapterTitle : `صفحات ${arNum(labels[0])}–${arNum(labels[labels.length - 1])}`,
      pageText: results.map((ctx) => `=== صفحة ${ctx.pageNumber} ===\n${ctx.pageText}`).join('\n\n').slice(0, 22_000),
      pageNumber: labels[0],
      pageNumbers: labels,
      pageCount: pageCountOf() || chapters.length,
      chapterIndex: results[0].chapterIndex,
      locationLabel: `صفحات ${labels.map((n) => arNum(n)).join('، ')}`,
      images: results.flatMap((ctx) => ctx.images || []),
      imageElements: results.flatMap((ctx) => ctx.imageElements || []),
      isPageImage: results.every((ctx) => ctx.isPageImage),
      brokenPage: results.some((ctx) => ctx.brokenPage),
      textReliability: results.some((ctx) => ctx.textReliability === 'low') ? 'low' : 'high',
      approximate: results.some((ctx) => ctx.approximate),
      missing,
      pages: results.map((ctx) => ({
        number: ctx.pageNumber,
        text: ctx.pageText,
        textReliability: ctx.textReliability,
        approximate: ctx.approximate,
        images: ctx.images,
        imageElements: ctx.imageElements || [],
      })),
    };
  }

  /* ---------- بحث ذكي في الكتاب كله ---------- */
  const normalizeSearch = (value) =>
    String(value || '')
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ؤ/g, 'و')
      .replace(/ئ/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();

  let searchCache = null;
  function htmlToPlain(html) {
    const box = document.createElement('div');
    box.innerHTML = String(html || '');
    box.querySelectorAll('script,style,figcaption,img').forEach((node) => node.remove());
    return String(box.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function buildSearchIndex() {
    if (searchCache) return searchCache;
    const entries = [];
    const figureRe = /<figure class="pdf-page"[^>]*data-page="(\d+)"[^>]*>([\s\S]*?)<\/figure>/g;
    chapters.forEach((chapter, chapterIndex) => {
      const html = String(chapter.html || '');
      const figureMatches = [...html.matchAll(figureRe)];
      let pageEntries = 0;
      if (figureMatches.length) {
        for (const match of figureMatches) {
          const inner = match[2] || '';
          const textMatch = inner.match(/<div class="pdf-page-text"[^>]*>([\s\S]*?)<\/div>/);
          const text = htmlToPlain(textMatch ? textMatch[1] : '');
          if (!text) continue;
          entries.push({ page: Number(match[1]) || chapterIndex + 1, chapterIndex, text, norm: normalizeSearch(text) });
          pageEntries += 1;
        }
      }
      if (!pageEntries) {
        // كتاب قديم (صور بلا نص مخفي) أو فصل عادي: نبحث في نص الفصل كاملًا
        const text = String(chapter.text || htmlToPlain(html)).trim();
        const title = String(chapter.title || '').trim();
        if (text || title) {
          entries.push({
            page: Number(chapter.pageFrom) || chapterIndex + 1,
            chapterIndex,
            text: text || title,
            norm: normalizeSearch(`${title} ${text}`),
          });
        }
      }
    });
    searchCache = entries;
    return entries;
  }

  function searchBook(query, limit = 6) {
    const needle = normalizeSearch(query);
    if (needle.length < 2) return [];
    const tokens = needle.split(' ').filter((token) => token.length >= 2);
    const results = [];
    for (const entry of buildSearchIndex()) {
      let score = 0;
      const haystack = entry.norm;
      if (haystack.includes(needle)) score += 12;
      for (const token of tokens) {
        let at = haystack.indexOf(token);
        let hits = 0;
        while (at !== -1 && hits < 8) {
          hits += 1;
          at = haystack.indexOf(token, at + token.length);
        }
        if (hits) score += hits * (token.length >= 4 ? 2 : 1);
      }
      if (!score) continue;
      const at = haystack.indexOf(tokens[0] || needle);
      const start = Math.max(0, at - 90);
      const snippet = entry.text.slice(start, start + 260).replace(/^[^\s]*\s/, '').trim();
      results.push({
        page: entry.page,
        chapterIndex: entry.chapterIndex,
        chapterTitle: chapterTitle(entry.chapterIndex),
        snippet,
        score,
      });
    }
    results.sort((a, b) => b.score - a.score || a.page - b.page);
    return results.slice(0, Math.max(1, Math.min(12, limit)));
  }

  /* ---------- البدء ---------- */
  try {
    await Promise.race([
      Promise.allSettled([
        document.fonts?.load(`${state.prefs.fontSize}px "Noto Sans Arabic"`),
        document.fonts?.load(`${state.prefs.fontSize}px "Noto Naskh Arabic"`),
        document.fonts?.load(`${state.prefs.fontSize}px Cairo`),
      ]),
      // لا نترك القارئ معلّقًا إذا تأخرت الخطوط أو حُجب تحميلها
      new Promise((resolve) => setTimeout(resolve, 1600)),
    ]);
  } catch {
    /* الخط البديل يكفي */
  }
  buildSections();
  applyPrefs({ persist: false });
  hydrate(initialChapter);
  setupHydration();
  applyModeVisibility();
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  stage.scrollTop = 0;
  if (isPaged()) {
    await renderPaged(initialChapter, { ratio: initialRatio });
  } else if (isFocus()) {
    renderFocus(initialChapter, { ratio: initialRatio });
  } else {
    scrollToRatio(initialChapter, initialRatio);
    requestAnimationFrame(recomputePosition);
    // بعد اكتمال أول تخطيط (الخطوط/الغلاف/ارتفاع النهاية) نثبّت الموضع مرة أخرى
    setTimeout(() => {
      if (!state.destroyed) recomputePosition();
    }, 460);
  }
  state.ready = true;
  updateTopChrome();
  loading.classList.add('is-done');
  setTimeout(() => {
    if (!state.destroyed) loading.hidden = true;
  }, 320);
  if (state.prefs.autoScroll) startAuto({ silent: true });

  resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.destroyed) return;
      if (isPaged()) {
        const ratio = pageToRatio(paged.page);
        measurePaginationBase();
        setPage(ratioToPage(ratio), { animate: false, persist: false, count: false });
        updateTopChrome();
        return;
      }
      if (isFocus()) return;
      const anchor = measurePosition();
      sections.forEach((section) => {
        if (section.dataset.loaded !== 'true') {
          section.style.setProperty('--r2-est', `${estimateHeight(chapters[Number(section.dataset.chapter)])}px`);
        }
      });
      scrollToRatio(anchor.index, anchor.ratio);
    }, 180);
  });
  resizeObserver.observe(stage);
  // إذا وصلت الخطوط متأخّرة بعد فتح القارئ، نعيد تثبيت الموضع
  document.fonts?.ready?.then?.(() => {
    if (state.destroyed) return;
    if (isPaged()) {
      scheduleRepaginate();
      return;
    }
    if (!isFocus()) {
      const anchor = measurePosition();
      scrollToRatio(anchor.index, anchor.ratio);
    }
  });

  // عرض أولي للفهرس حتى تكون اللوحة جاهزة قبل فتحها
  renderToc();
  const endText = root.querySelector('[data-end-text]');
  if (endText) {
    endText.textContent = `قرأت ${arNum(chapters.length)} فصلًا، ووصلت إلى آخر صفحة. يمكنك العودة إلى أي فصل من الفهرس، أو اختيار طريقة قراءة أخرى.`;
  }
  updateTopChrome();

  function setCover(src) {
    if (!src || !/^data:image\//i.test(String(src))) return;
    state.cover = src;
    const thumb = root.querySelector('[data-thumb]');
    let img = thumb?.querySelector('[data-cover-img]');
    if (thumb && !img) {
      thumb.innerHTML = `<span class="reader2-thumb-fallback">${escapeHtml(initials)}</span><img data-cover-img alt="" />`;
      img = thumb.querySelector('[data-cover-img]');
    }
    if (img) {
      img.hidden = false;
      img.onerror = () => {
        img.hidden = true;
      };
      img.src = src;
    }
    thumb?.classList.add('has-art');
    const big = root.querySelector('[data-cover-big]');
    if (big) big.src = src;
    renderCoverSheet();
  }

  function destroy() {
    if (state.destroyed) return;
    flushProgress();
    flushReading();
    state.destroyed = true;
    stopAuto(true);
    clearTimeout(persistTimer);
    clearTimeout(prefsTimer);
    clearTimeout(resizeTimer);
    clearTimeout(reanchorTimer);
    clearTimeout(hintTimer);
    clearTimeout(searchTimer);
    clearTimeout(repaginateTimer);
    clearInterval(readingTimer);
    io?.disconnect?.();
    resizeObserver?.disconnect?.();
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    aiPanel?.destroy?.();
    root.innerHTML = '';
  }

  return {
    destroy,
    setCover,
    goToChapter,
    goToPercent,
    captureVisionImage,
    get book() {
      return book;
    },
    get state() {
      return state;
    },
    getLocation() {
      const meta = pageMeta();
      return {
        chapterIndex: state.chapterIndex,
        chapterTitle: chapterTitle(state.chapterIndex),
        pageIndex: meta.pageInChapter,
        pageCount: meta.pageCount,
        mode: state.prefs.mode,
        scrollRatio: Number(state.ratio.toFixed(4)),
        percent: Math.round(state.percent),
      };
    },
  };
}
