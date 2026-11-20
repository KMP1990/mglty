/**
 * مزامنة القراءة مع الخادم (ميزة فرعية داخل «كتبي»).
 * ------------------------------------------------------------
 * الكتاب ومحتواه لا يغادران الجهاز. نُرسل فقط لقطة صغيرة:
 * عنوان الكتاب/الفصل، النسبة، آخر يوم قراءة، دقائق وصفحات القراءة.
 * الفائدة: تذكير القراءة والملخص اليومي يصله عبر Web Push
 * حتى لو لم يفتح التطبيق لعدة أيام، وتظهر إحصاءات القراءة عبر أجهزته.
 */
import { api, appStore } from '../../assets/core/core.js';
import { lastRead, readingStats, readingStreak } from './store.js';

const MIN_INTERVAL_MS = 40_000;

let lastSentAt = 0;
let inflight = null;
let pendingPayload = null;

function buildPayload({ book = null, location = null } = {}) {
  const last = lastRead();
  const stats = readingStats();
  const target = book || (last ? { id: last.id, title: last.title } : null);
  if (!target && !stats.lastReadAt) return null;
  return {
    bookId: target?.id || last?.id || null,
    bookTitle: target?.title || last?.title || null,
    chapterTitle: location?.chapterTitle || last?.chapterTitle || null,
    chapterIndex: location?.chapterIndex ?? 0,
    pageIndex: location?.pageIndex ?? 0,
    pageCount: location?.pageCount ?? 0,
    percent: location?.percent ?? target?.progress?.percent ?? last?.percent ?? 0,
    minutesToday: stats.minutesToday || 0,
    pagesToday: stats.pagesToday || 0,
    minutesTotal: stats.minutesTotal || 0,
    pagesTotal: stats.pagesTotal || 0,
    days: stats.days || 0,
    streakDays: readingStreak(stats),
    lastReadDate: stats.lastReadDate,
    lastReadAt: stats.lastReadAt,
  };
}

async function send(payload) {
  if (!payload || !appStore.state.authenticated) return null;
  if (inflight) {
    pendingPayload = payload;
    return inflight;
  }
  inflight = api
    .put('/api/books/reading', payload, { silent: true })
    .then((res) => res?.data || null)
    .catch(() => null)
    .finally(() => {
      inflight = null;
      lastSentAt = Date.now();
      if (pendingPayload) {
        const next = pendingPayload;
        pendingPayload = null;
        void send(next);
      }
    });
  return inflight;
}

/**
 * يُستدعى عند فتح الكتاب، وكل دقيقة قراءة، وعند إغلاقه.
 * force=true يتجاوز كتم الـ40 ثانية (فتح/إغلاق/إخفاء الصفحة).
 */
export function syncReadingSnapshot({ book = null, location = null, force = false } = {}) {
  const payload = buildPayload({ book, location });
  if (!payload) return Promise.resolve(null);
  if (!force && Date.now() - lastSentAt < MIN_INTERVAL_MS) return Promise.resolve(null);
  return send(payload);
}

export function resetReadingSyncClock() {
  lastSentAt = 0;
}
