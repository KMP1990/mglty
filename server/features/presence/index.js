/**
 * حضور المستخدم — نبض خفيف لكل حساب: data/presence/<userId>.json
 * ------------------------------------------------------------
 * نحتاجه لثلاثة أشياء:
 *  • معرفة «من غاب كم يوم» حتى يصل إشعار ترحيب/ملخص عند العودة أو عبر Push.
 *  • معرفة آخر نشاط قراءة (لأن الكتب نفسها تبقى على الجهاز ولا تُرفع للخادم).
 *  • سجل التذكيرات التي أُرسلت (ملخص يومي/أسبوعي/تذكير قراءة) لمنع التكرار.
 *
 * الكتابة مخففة: لا نكتب على القرص مع كل طلب، بل مرة كل نصف دقيقة كحد أقصى،
 * ما لم يكن التحديث مهمًا (حفظ تقدّم القراءة).
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { readJsonSafe, writeJsonSafe, backupName } from '../../shared/store.js';

const TOUCH_WRITE_MS = 30_000;
const ID_RE = /^[a-f0-9]{24}$/;

export const defaultReading = () => ({
  bookId: null,
  bookTitle: null,
  chapterTitle: null,
  chapterIndex: 0,
  pageIndex: 0,
  pageCount: 0,
  percent: 0,
  lastReadAt: null,
  lastReadDate: null,
  minutesToday: 0,
  pagesToday: 0,
  minutesTotal: 0,
  pagesTotal: 0,
  days: 0,
  streakDays: 0,
});

export const defaultPresence = (userId = null) => ({
  version: 1,
  userId,
  firstSeenAt: null,
  lastSeenAt: null,
  lastOpenAt: null,
  lastNotificationsAt: null,
  lastSource: null,
  opens: 0,
  reading: null,
  reminders: {},
});

function clampNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function cleanText(value, max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

/** يوحّد لقطة القراءة القادمة من العميل — لا نثق بأي شيء غير معروف */
export function normalizeReading(input = {}, previous = null) {
  const prev = previous || defaultReading();
  const out = { ...prev };
  if (input.bookId !== undefined) out.bookId = cleanText(input.bookId, 80) || null;
  if (input.bookTitle !== undefined) out.bookTitle = cleanText(input.bookTitle, 180) || null;
  if (input.chapterTitle !== undefined) out.chapterTitle = cleanText(input.chapterTitle, 180) || null;
  if (input.chapterIndex !== undefined) out.chapterIndex = clampNumber(input.chapterIndex, 0, 10_000, prev.chapterIndex);
  if (input.pageIndex !== undefined) out.pageIndex = clampNumber(input.pageIndex, 0, 100_000, prev.pageIndex);
  if (input.pageCount !== undefined) out.pageCount = clampNumber(input.pageCount, 0, 100_000, prev.pageCount);
  if (input.percent !== undefined) out.percent = clampNumber(input.percent, 0, 100, prev.percent);
  if (input.minutesToday !== undefined) out.minutesToday = clampNumber(input.minutesToday, 0, 1440, prev.minutesToday);
  if (input.pagesToday !== undefined) out.pagesToday = clampNumber(input.pagesToday, 0, 20_000, prev.pagesToday);
  if (input.minutesTotal !== undefined) out.minutesTotal = clampNumber(input.minutesTotal, 0, 10_000_000, prev.minutesTotal);
  if (input.pagesTotal !== undefined) out.pagesTotal = clampNumber(input.pagesTotal, 0, 10_000_000, prev.pagesTotal);
  if (input.days !== undefined) out.days = clampNumber(input.days, 0, 100_000, prev.days);
  if (input.streakDays !== undefined) out.streakDays = clampNumber(input.streakDays, 0, 100_000, prev.streakDays);
  if (typeof input.lastReadDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.lastReadDate)) out.lastReadDate = input.lastReadDate;
  if (typeof input.lastReadAt === 'string' && !Number.isNaN(Date.parse(input.lastReadAt))) out.lastReadAt = input.lastReadAt;
  if (!out.lastReadAt) out.lastReadAt = new Date().toISOString();
  if (!out.lastReadDate) out.lastReadDate = out.lastReadAt.slice(0, 10);
  return out;
}

export function createPresenceStore(config) {
  const dir = path.join(config.dataDir, 'presence');
  const cache = new Map();
  const writeQueues = new Map();
  const lastWrite = new Map();

  const filePath = (userId) => path.join(dir, `${userId}.json`);

  function enqueue(userId, task) {
    const previous = writeQueues.get(userId) || Promise.resolve();
    const next = previous.then(task, task).catch(() => {});
    writeQueues.set(userId, next);
    return next;
  }

  async function load(userId) {
    if (cache.has(userId)) return cache.get(userId);
    const raw = await readJsonSafe(filePath(userId), null);
    const state = { ...defaultPresence(userId), ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!state.reminders || typeof state.reminders !== 'object') state.reminders = {};
    cache.set(userId, state);
    return state;
  }

  async function persist(userId, state, { force = false } = {}) {
    const now = Date.now();
    if (!force && now - (lastWrite.get(userId) || 0) < TOUCH_WRITE_MS) return;
    lastWrite.set(userId, now);
    const snapshot = JSON.parse(JSON.stringify(state));
    await enqueue(userId, () => writeJsonSafe(filePath(userId), snapshot));
  }

  return {
    filePath,
    read: (userId) => (ID_RE.test(String(userId || '')) ? load(userId) : Promise.resolve(defaultPresence(userId))),
    async write(userId, state) {
      cache.set(userId, state);
      await persist(userId, state, { force: true });
    },

    /** نبض نشاط — يُستدعى من حارس الجلسة بعد كل طلب مسجّل */
    async touch(userId, { source = null, at = Date.now() } = {}) {
      if (!ID_RE.test(String(userId || ''))) return null;
      const state = await load(userId);
      state.lastSeenAt = new Date(at).toISOString();
      state.firstSeenAt ||= state.lastSeenAt;
      if (source) state.lastSource = cleanText(source, 80);
      await persist(userId, state);
      return state;
    },

    /** فتح التطبيق — لا يُحتسب أكثر من مرة كل 20 دقيقة */
    async markOpen(userId, { at = Date.now(), source = 'boot' } = {}) {
      if (!ID_RE.test(String(userId || ''))) return { missedOpen: false, previous: null };
      const state = await load(userId);
      const previousOpen = state.lastOpenAt;
      const missedOpen = !previousOpen || at - Date.parse(previousOpen) > 20 * 60 * 1000;
      if (missedOpen) {
        state.lastOpenAt = new Date(at).toISOString();
        state.firstSeenAt ||= state.lastOpenAt;
        state.opens = Number(state.opens || 0) + 1;
        state.lastSource = cleanText(source, 80);
        await persist(userId, state, { force: true });
      }
      return { missedOpen, previous: previousOpen, state };
    },

    async markNotificationsViewed(userId, { at = Date.now() } = {}) {
      if (!ID_RE.test(String(userId || ''))) return null;
      const state = await load(userId);
      const previous = state.lastNotificationsAt;
      state.lastNotificationsAt = new Date(at).toISOString();
      await persist(userId, state, { force: true });
      return { previous, state };
    },

    async saveReading(userId, input) {
      if (!ID_RE.test(String(userId || ''))) return null;
      const state = await load(userId);
      state.reading = normalizeReading(input, state.reading);
      await persist(userId, state, { force: true });
      return state.reading;
    },

    async setReminderStamp(userId, key, value = new Date().toISOString()) {
      if (!ID_RE.test(String(userId || ''))) return null;
      const state = await load(userId);
      state.reminders = { ...(state.reminders || {}), [key]: value };
      await persist(userId, state, { force: true });
      return state.reminders;
    },

    async flush(userId) {
      if (!cache.has(userId)) return;
      await persist(userId, cache.get(userId), { force: true });
    },

    /** حذف كامل عند حذف الحساب — لا نترك ملف حضور يتيمًا */
    async remove(userId) {
      if (!ID_RE.test(String(userId || ''))) return false;
      cache.delete(userId);
      lastWrite.delete(userId);
      const file = filePath(userId);
      const name = path.basename(file);
      await fs.rm(file, { force: true });
      await fs.rm(path.join(path.dirname(file), backupName(name)), { force: true });
      await fs.rm(path.join(path.dirname(file), `bakold.${name}`), { force: true });
      return true;
    },
  };
}

export default {
  register(app, ctx) {
    void app;
    if (!ctx.services?.presence) {
      ctx.services = { ...(ctx.services || {}), presence: createPresenceStore(ctx.config) };
    }
  },
};
