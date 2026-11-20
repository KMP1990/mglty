/**
 * Netlify Scheduled Function — تشغيل المجدول الدوري بدون خادم دائم.
 * كل دقيقة يقرأ الحسابات من Blobs ويرسل تذكيرات الروتين/القراءة/الغياب.
 */
import { connectLambda } from '@netlify/blobs';
import { bootstrap } from './_bootstrap.mjs';

export const config = { schedule: '* * * * *' };

export default async function runReminders(event = {}) {
  if (event.blobs) connectLambda(event);
  const { ctx } = await bootstrap();
  const scheduler = ctx?.services?.reminders;
  if (!scheduler?.tickOnce) {
    return { statusCode: 503, body: JSON.stringify({ ok: false, error: 'reminders_unavailable' }) };
  }
  await scheduler.tickOnce();
  return { statusCode: 200, body: JSON.stringify({ ok: true, at: new Date().toISOString() }) };
}
