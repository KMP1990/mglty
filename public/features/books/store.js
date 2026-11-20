/**
 * تخزين كتبي — ميزة فرعية داخل "كتبي".
 * ------------------------------------------------------------
 * يستخدم طبقة الحفظ القوي المشتركة (features/save):
 *  • فهرس خفيف في سجل واحد (عنوان/تقدم/إحصاءات)
 *  • كل كتاب في سجل مستقل مشفّر — لا تُقرأ كل الكتب عند فتح المكتبة
 *  • مكتبة وتفضيلات مستقلة لكل حساب، مع ترحيل المكتبة القديمة مرة واحدة
 */
import { appStore } from '../../assets/core/core.js';
import { getSaveService } from '../save/save.js';
import { parseBookFile } from './parse.js';
import { generatedCover, generatedCoverHue } from './cover.js';

const LEGACY = { index: 'books:index', book: 'books:book', prefs: 'mr:books:prefs', last: 'mr:books:last' };
const LEGACY_OWNER_KEY = 'mr:books:legacy-owner';

const scopeKeys = (uid = appStore.state.user?.id || 'guest') => ({
  uid,
  index: `books:${uid}:index`,
  book: `books:${uid}:book`,
  prefs: `mr:books:${uid}:prefs`,
  last: `mr:books:${uid}:last`,
  reading: `mr:books:${uid}:reading`,
});

export const READER_THEMES = [
  { id: 'paper', label: 'ورقي', swatch: '#fbf7ee' },
  { id: 'sepia', label: 'سيبيا', swatch: '#f2e3c8' },
  { id: 'night', label: 'ليلي', swatch: '#1c1b22' },
  { id: 'ocean', label: 'محيط', swatch: '#0f2634' },
  { id: 'forest', label: 'حديقة', swatch: '#12241c' },
  { id: 'rose', label: 'وردي', swatch: '#fbeef2' },
];

export const DEFAULT_PREFS = {
  theme: 'paper',
  fontSize: 19,
  lineHeight: 1.95,
  font: 'serif',
  spread: true,
  justify: true,
  showHints: true,
  width: 'medium',
  // طريقة القراءة: flow | paged | spread | focus
  mode: 'flow',
  autoScroll: false,
  autoSpeed: 3,
};

const defaultIndex = () => ({
  version: 1,
  books: [],
  settings: {},
  updatedAt: null,
});

let indexPromise = null;
let indexWriteQueue = Promise.resolve();
let saveService = null;
let activeScope = null;
let legacyChecked = false;

const save = () => (saveService ||= getSaveService());

function scope() {
  const next = scopeKeys();
  if (!activeScope || next.uid !== activeScope.uid) {
    activeScope = next;
    indexPromise = null;
    indexWriteQueue = Promise.resolve();
  }
  return next;
}

function normalizeIndex(raw) {
  if (!raw || !Array.isArray(raw.books)) return defaultIndex();
  return {
    ...defaultIndex(),
    ...raw,
    books: raw.books
      .filter((book) => book && typeof book.id === 'string')
      .map((book) => ({
        ...book,
        cover:
          book.cover ||
          generatedCover({
            title: book.title,
            author: book.author,
            format: book.format,
            hue: book.coverHue,
          }),
        coverKind: book.coverKind || (book.cover ? 'auto' : 'generated'),
        bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
        progress: {
          chapterIndex: 0,
          pageInChapter: 0,
          pageCount: 0,
          percent: 0,
          ...(book.progress || {}),
        },
      })),
  };
}

/**
 * ترحيل المكتبة القديمة (قبل ربط الكتب بالحساب) إلى أول حساب يفتحها.
 * لا نكرر الترحيل ولا نلمس بيانات أي حساب آخر.
 */
async function migrateLegacy(keys) {
  if (!keys.uid || keys.uid === 'guest' || legacyChecked) return false;
  legacyChecked = true;
  try {
    if (localStorage.getItem(LEGACY_OWNER_KEY)) return false;
    const legacy = await save().load(LEGACY.index, 'current', { fallback: null });
    const oldIndex = legacy.value ? normalizeIndex(legacy.value) : null;
    if (!oldIndex?.books?.length) return false;

    const migrated = { ...oldIndex, books: [] };
    for (const meta of oldIndex.books) {
      try {
        const stored = await save().load(LEGACY.book, meta.id, { fallback: null });
        if (!stored.value) continue;
        await save().save(keys.book, stored.value, {
          id: meta.id,
          meta: { kind: 'book', title: meta.title, format: meta.format },
          mirror: false,
        });
        migrated.books.push(meta);
      } catch {
        /* كتاب تالف لا يمنع ترحيل البقية */
      }
    }
    if (!migrated.books.length) return false;

    await save().save(keys.index, migrated, { id: 'current', meta: { kind: 'books-index' }, mirror: false });
    const legacyPrefs = localStorage.getItem(LEGACY.prefs);
    if (legacyPrefs && !localStorage.getItem(keys.prefs)) localStorage.setItem(keys.prefs, legacyPrefs);
    const legacyLast = localStorage.getItem(LEGACY.last);
    if (legacyLast && !localStorage.getItem(keys.last)) localStorage.setItem(keys.last, legacyLast);
    localStorage.setItem(LEGACY_OWNER_KEY, keys.uid);
    return true;
  } catch {
    return false;
  }
}

export async function loadIndex({ force = false } = {}) {
  const keys = scope();
  if (force) indexPromise = null;
  if (!indexPromise) {
    indexPromise = (async () => {
      try {
        const current = await save().load(keys.index, 'current', { fallback: null });
        if (current.value) return normalizeIndex(current.value);
        await migrateLegacy(keys);
        const migrated = await save().load(keys.index, 'current', { fallback: null });
        return normalizeIndex(migrated.value || defaultIndex());
      } catch {
        return defaultIndex();
      }
    })();
  }
  return indexPromise;
}

function writeIndex(index) {
  const { index: indexKey } = scope();
  index.updatedAt = new Date().toISOString();
  indexPromise = Promise.resolve(index);
  indexWriteQueue = indexWriteQueue
    .catch(() => { })
    .then(() => save().save(indexKey, index, { id: 'current', meta: { kind: 'books-index' }, mirror: false }))
    .catch(() => { });
  return indexWriteQueue;
}

export function loadPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(scope().prefs) || 'null');
    return { ...DEFAULT_PREFS, ...(raw && typeof raw === 'object' ? raw : {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(scope().prefs, JSON.stringify({ ...DEFAULT_PREFS, ...prefs }));
  } catch {
    /* التخزين المحلي ممتلئ أو محجوب — القارئ يعمل بالقيم الافتراضية */
  }
}

export function lastRead() {
  try {
    return JSON.parse(localStorage.getItem(scope().last) || 'null');
  } catch {
    return null;
  }
}

export function setLastRead(value) {
  try {
    const key = scope().last;
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* تجاهل */
  }
}

const localDay = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const emptyReadingStats = () => ({
  lastReadDate: null,
  lastReadAt: null,
  days: 0,
  minutesToday: 0,
  pagesToday: 0,
  minutesTotal: 0,
  pagesTotal: 0,
  today: null,
  activeDays: [],
});

/** آخر يوم قرأ فيه المستخدم + دقائق/صفحات القراءة — لتذكير القراءة والإحصاءات */
export function readingStats() {
  try {
    const raw = JSON.parse(localStorage.getItem(scope().reading) || 'null');
    if (!raw || typeof raw !== 'object') return emptyReadingStats();
    return { ...emptyReadingStats(), ...raw, activeDays: Array.isArray(raw.activeDays) ? raw.activeDays.slice(-180) : [] };
  } catch {
    return emptyReadingStats();
  }
}

function commitReadingStats(stats) {
  try {
    localStorage.setItem(scope().reading, JSON.stringify(stats));
  } catch {
    /* التخزين ممتلئ/محجوب — القارئ يستمر */
  }
  return stats;
}

function addActiveDay(stats, day) {
  if (!stats.activeDays.includes(day)) stats.activeDays = [...stats.activeDays, day].sort().slice(-180);
  stats.days = stats.activeDays.length;
  return stats;
}

export function markReadingToday() {
  const stats = readingStats();
  const today = localDay();
  if (stats.lastReadDate !== today) {
    // عداد اليوم يبدأ من جديد عند تغيّر التاريخ
    stats.minutesToday = 0;
    stats.pagesToday = 0;
  }
  stats.lastReadDate = today;
  stats.lastReadAt = new Date().toISOString();
  stats.today = today;
  addActiveDay(stats, today);
  return commitReadingStats(stats);
}

/** يسجّل زمن/صفحات جلسة القراءة الحالية (يُستدعى كل دقيقة تقريبًا) */
export function recordReading({ seconds = 0, pages = 0 } = {}) {
  const stats = markReadingToday();
  const safeSeconds = Math.max(0, Math.min(3600, Number(seconds) || 0));
  const safePages = Math.max(0, Math.min(200, Number(pages) || 0));
  stats.minutesToday = Math.round(((Number(stats.minutesToday) || 0) + safeSeconds / 60) * 10) / 10;
  stats.pagesToday = (Number(stats.pagesToday) || 0) + safePages;
  stats.minutesTotal = Math.round(((Number(stats.minutesTotal) || 0) + safeSeconds / 60) * 10) / 10;
  stats.pagesTotal = (Number(stats.pagesTotal) || 0) + safePages;
  return commitReadingStats(stats);
}

/** سلسلة أيام القراءة المتتالية (محسوبة من الأيام النشطة) */
export function readingStreak(stats = readingStats()) {
  const days = new Set(stats.activeDays || []);
  if (!days.size) return 0;
  let cursor = new Date();
  const toKey = (d) => {
    const offset = d.getTimezoneOffset() * 60_000;
    return new Date(d.getTime() - offset).toISOString().slice(0, 10);
  };
  let key = toKey(cursor);
  if (!days.has(key)) {
    cursor = new Date(cursor.getTime() - 86_400_000);
    key = toKey(cursor);
  }
  let streak = 0;
  while (days.has(key) && streak < 400) {
    streak += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
    key = toKey(cursor);
  }
  return streak;
}

export function readingReminderState() {
  const pref = appStore.state.user?.preferences?.readingReminder;
  return {
    enabled: pref?.enabled === true,
    time: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(pref?.time || '')) ? pref.time : '20:30',
  };
}

export function updateReadingReminderState(patch) {
  const user = appStore.state.user;
  if (!user) return null;
  const current = user.preferences || {};
  const next = {
    ...current,
    readingReminder: {
      enabled: patch.enabled ?? (current.readingReminder?.enabled === true),
      time: patch.time ?? current.readingReminder?.time ?? '20:30',
    },
  };
  appStore.set({ user: { ...user, preferences: next } });
  return next.readingReminder;
}

export async function listBooks() {
  const index = await loadIndex();
  return [...index.books].sort((a, b) => String(b.lastOpenedAt || b.createdAt).localeCompare(String(a.lastOpenedAt || a.createdAt)));
}

export async function importBookFile(file, onProgress) {
  const keys = scope();
  const book = await parseBookFile(file, onProgress);
  await save().save(keys.book, book, {
    id: book.id,
    meta: { kind: 'book', title: book.title, format: book.format },
    mirror: false,
  });
  const index = await loadIndex();
  const meta = {
    id: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    sourceName: book.sourceName,
    size: book.size,
    sizeLabel: book.sizeLabel,
    totalWords: book.totalWords,
    chapterCount: book.chapters.length,
    chapterTitles: book.chapters.slice(0, 60).map((c) => c.title),
    imageCount: book.imageCount,
    warnings: book.warnings || [],
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
    lastOpenedAt: null,
    progress: { chapterIndex: 0, pageInChapter: 0, pageCount: 0, percent: 0 },
    bookmarks: [],
    cover: book.cover || generatedCover({ title: book.title, author: book.author, format: book.format }),
    coverKind: book.cover ? 'auto' : 'generated',
    coverHue: generatedCoverHue(book.title),
  };
  index.books = [meta, ...index.books.filter((b) => b.id !== book.id)];
  await writeIndex(index);
  return meta;
}

export async function openBook(id) {
  const res = await save().load(scope().book, id, { fallback: null });
  if (!res.value) throw new Error('تعذّر فتح الكتاب — قد يكون محذوفًا أو تالفًا');
  const index = await loadIndex();
  const meta = index.books.find((b) => b.id === id) || null;
  if (meta) {
    meta.lastOpenedAt = new Date().toISOString();
    meta.updatedAt = meta.updatedAt || new Date().toISOString();
    await writeIndex(index);
  }
  return { book: res.value, meta, recovered: res.recovered };
}

export async function updateProgress(id, patch) {
  const index = await loadIndex();
  const meta = index.books.find((b) => b.id === id);
  if (!meta) return null;
  meta.progress = { ...meta.progress, ...patch, at: new Date().toISOString() };
  meta.lastOpenedAt = meta.progress.at;
  if (meta.progress.chapterTitle) meta.lastChapterTitle = meta.progress.chapterTitle;
  markReadingToday();
  await writeIndex(index);
  setLastRead({
    id,
    title: meta.title,
    chapterTitle: meta.lastChapterTitle || '',
    percent: meta.progress.percent || 0,
    at: meta.progress.at,
  });
  return meta;
}

export async function updateBookMeta(id, patch) {
  const index = await loadIndex();
  const meta = index.books.find((b) => b.id === id);
  if (!meta) return null;
  Object.assign(meta, patch, { updatedAt: new Date().toISOString() });
  await writeIndex(index);
  return meta;
}

export async function removeBook(id) {
  await save().remove(scope().book, id);
  const index = await loadIndex();
  index.books = index.books.filter((b) => b.id !== id);
  await writeIndex(index);
  const last = lastRead();
  if (last?.id === id) setLastRead(null);
}

export async function renameBook(id, title) {
  const clean = String(title || '').trim().slice(0, 180);
  if (!clean) throw new Error('اكتب عنوانًا للكتاب');
  const keys = scope();
  const { book, meta } = await openBook(id);
  book.title = clean;
  book.updatedAt = new Date().toISOString();
  const patch = { title: clean };
  // الغلاف المولّد يتبع العنوان الجديد؛ الغلاف المستخرج أو الشخصي يبقى كما هو
  if (!meta?.coverKind || meta.coverKind === 'generated') {
    book.cover = generatedCover({ title: clean, author: book.author, format: book.format });
    book.coverKind = 'generated';
    patch.cover = book.cover;
    patch.coverKind = 'generated';
    patch.coverHue = generatedCoverHue(clean);
  }
  await save().save(keys.book, book, { id, meta: { kind: 'book', title: clean, format: book.format }, mirror: false });
  return updateBookMeta(id, patch);
}

/** تغيير غلاف الكتاب بصورة يختارها المستخدم (تُصغَّر قبل الحفظ). */
export async function setBookCover(id, dataUrl) {
  if (!/^data:image\//i.test(String(dataUrl || ''))) throw new Error('صورة الغلاف غير صالحة');
  const keys = scope();
  const res = await save().load(keys.book, id, { fallback: null });
  if (!res.value) throw new Error('تعذّر فتح الكتاب — قد يكون محذوفًا أو تالفًا');
  const book = res.value;
  book.cover = dataUrl;
  book.coverKind = 'custom';
  book.updatedAt = new Date().toISOString();
  await save().save(keys.book, book, {
    id,
    meta: { kind: 'book', title: book.title, format: book.format },
    mirror: false,
  });
  return updateBookMeta(id, { cover: dataUrl, coverKind: 'custom' });
}

/** حذف مكتبة حساب بالكامل من هذا الجهاز — يُستدعى عند حذف الحساب */
export async function clearBooksForUser(userId) {
  if (!/^[a-f0-9]{24}$/.test(String(userId || ''))) return false;
  const keys = scopeKeys(userId);
  try {
    const idx = await save().load(keys.index, 'current', { fallback: null });
    for (const meta of idx.value?.books || []) {
      try {
        await save().purge(keys.book, meta.id);
      } catch {
        /* تجاهل */
      }
    }
    await save().purge(keys.index, 'current');
  } catch {
    /* لا نمنع حذف الحساب بسبب فشل تنظيف محلي */
  }
  try {
    localStorage.removeItem(keys.prefs);
    localStorage.removeItem(keys.last);
    localStorage.removeItem(keys.reading);
    localStorage.removeItem(`mr:books:${userId}:first-book-notified`);
    localStorage.removeItem(`mr:books:${userId}:reading-reminder`);
  } catch { }
  if (appStore.state.user?.id === userId) {
    indexPromise = null;
    activeScope = null;
  }
  return true;
}
