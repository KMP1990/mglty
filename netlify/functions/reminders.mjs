/**
 * Netlify Scheduled Function — تشغيل المجدول الدوري بدون خادم دائم.
 * كل دقيقة يقرأ الحسابات من Blobs ويرسل تذكيرات الروتين/القراءة/الغياب.
 */
import { connectLambda } from '@netlify/blobs';
import { bootstrap } from './_bootstrap.mjs';

export const config = { schedule: '* * * * *' };

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export default async function runReminders(event = {}) {
  // سياق Blobs يُمرَّر كنص في وضع Lambda فقط.
  if (typeof event?.blobs === 'string') {
    try {
      connectLambda(event);
    } catch {
      // Blobs مهيّأة عبر متغيّرات البيئة الحديثة.
    }
  }
  const { ctx } = await bootstrap();
  const scheduler = ctx?.services?.reminders;
  if (!scheduler?.tickOnce) return json(503, { ok: false, error: 'reminders_unavailable' });
  await scheduler.tickOnce();
  return json(200, { ok: true, at: new Date().toISOString() });
}
