/**
 * أحداث كتبي → إشعارات الحساب.
 * الرسائل تُحفظ في صندوق الإشعارات وتصل لحظيًا عبر SSE،
 * والكتاب نفسه يبقى مشفّرًا على الجهاز.
 */
import { api, appStore } from '../../assets/core/core.js';

async function push(payload) {
  if (!appStore.state.authenticated) return null;
  try {
    const res = await api.post('/api/notifications/', payload, { silent: true });
    return res?.data?.notification || null;
  } catch {
    return null;
  }
}

export async function notifyFirstBook(book) {
  const user = appStore.state.user;
  if (!user?.id) return null;
  const key = `mr:books:${user.id}:first-book-notified`;
  try {
    if (localStorage.getItem(key)) return null;
  } catch { }
  const created = await push({
    type: 'achievement',
    title: 'مكتبتك انطلقت 📚',
    body: `أضفت «${book.title}» إلى مكتبتك. اقرأ صفحتين اليوم وستبدأ عادة القراءة.`,
    link: '/books',
    priority: 'normal',
    data: { source: 'books', event: 'first-book', bookId: book.id },
  });
  if (created) {
    try {
      localStorage.setItem(key, new Date().toISOString());
    } catch { }
  }
  return created;
}

export async function notifyBookFinished(book) {
  return push({
    type: 'achievement',
    title: 'أنهيت كتابًا 🎉',
    body: `أتممت «${book.title}». خذ لحظة لتلخيص ما تعلمته، ثم اختر كتابك التالي.`,
    link: '/books',
    priority: 'high',
    data: { source: 'books', event: 'finished', bookId: book.id },
  });
}
