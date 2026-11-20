/**
 * تذكير القراءة — جسر بين مكتبة الجهاز ونظام إشعارات الحساب.
 * يعمل عند فتح التطبيق: إن حان الموعد ولم تقرأ اليوم، يُنشئ إشعارًا
 * persisted على الخادم (ويصل فورًا عبر SSE إن كان الاتصال مفتوحًا).
 */
import { api, appStore } from '../../assets/core/core.js';
import { listBooks, readingReminderState, readingStats } from './store.js';

const localDay = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
};

const minutesNow = () => {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
};

const reminderKey = (uid) => `mr:books:${uid}:reading-reminder`;

function lastReminderDate(uid) {
  try {
    return JSON.parse(localStorage.getItem(reminderKey(uid)) || 'null')?.date || null;
  } catch {
    return null;
  }
}

function markReminder(uid, date) {
  try {
    localStorage.setItem(reminderKey(uid), JSON.stringify({ date, at: new Date().toISOString() }));
  } catch { }
}

async function createReminder(book) {
  const title = book?.title ? `وقت القراءة — «${book.title}»` : 'وقت القراءة 📖';
  const body = book?.lastChapterTitle
    ? `توقفت عند «${book.lastChapterTitle}». عشر دقائق اليوم تكفي للمتابعة.`
    : 'كتابك ينتظرك. اقرأ صفحتين فقط وستعود العادة من جديد.';
  const res = await api.post(
    '/api/notifications/',
    { type: 'reminder', title, body, link: '/books', priority: 'normal', data: { source: 'books', event: 'reading-reminder' } },
    { silent: true }
  );
  return res?.data?.notification || null;
}

/** يُستدعى من الإقلاع مرة واحدة — لا يزعج إن قرأت اليوم أو أغلق التذكير */
export async function maybeNotifyReading() {
  const user = appStore.state.user;
  if (!appStore.state.authenticated || !user?.id) return false;
  const settings = readingReminderState();
  if (!settings.enabled) return false;

  const [hh, mm] = settings.time.split(':').map(Number);
  if (minutesNow() < hh * 60 + mm) return false;

  const today = localDay();
  const stats = readingStats();
  if (stats.lastReadDate === today) return false;
  if (lastReminderDate(user.id) === today) return false;

  try {
    const books = await listBooks();
    if (!books.length) return false;
    const current =
      books.find((book) => (book.progress?.percent || 0) > 0 && (book.progress?.percent || 0) < 100) ||
      books[0];
    const created = await createReminder(current);
    if (created) {
      markReminder(user.id, today);
      return true;
    }
  } catch {
    /* صامت: نحاول مرة أخرى في الإقلاع القادم */
  }
  return false;
}

/** زر «ذكّرني الآن» من الإعدادات — يتجاوز الوقت لكن لا يتجاوز غياب الكتب */
export async function sendReadingReminderNow() {
  const books = await listBooks();
  if (!books.length) throw new Error('أضف كتابًا أولًا حتى يكون لديك ما تقرأه');
  const current = books.find((book) => (book.progress?.percent || 0) > 0 && (book.progress?.percent || 0) < 100) || books[0];
  const notification = await createReminder(current);
  if (!notification) throw new Error('تعذّر إنشاء التذكير');
  return notification;
}
