/**
 * نظام التذكير — ميزة فرعية داخل routines: مسارات إشعار الروتين.
 * POST /api/routines/nudge  { routineId?, date? }  — يرسل تذكيرًا فوريًا (يُستخدم من زر «ذكّرني»)
 * GET  /api/routines/reminders                        — حالة التذكيرات وما هو مستحق الآن
 */
import express from 'express';
import { wrap, notFound } from '../../shared/http.js';
import { localDate, minutesOfDay, isScheduledOn, formatMinutes } from './schedule.js';

export function registerReminderRoutes(router, { store, config, ctx, guards }) {
  void config;

  router.get(
    '/reminders',
    wrap(async (req, res) => {
      const connected = ctx.services.notifications?.connectedCount?.(req.auth.user.id) || 0;
      const state = await store.read(req.auth.user.id);
      const timeZone = state.settings.timeZone || 'Asia/Riyadh';
      const now = Date.now();
      const today = localDate(now, timeZone);
      const nowMinutes = minutesOfDay(now, timeZone);
      const active = state.routines.filter((r) => !r.archivedAt);

      const due = active
        .filter((r) => isScheduledOn(r, now, timeZone) && r.time && !state.logs[today]?.[r.id])
        .map((r) => ({ ...r, minutes: Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3)) }))
        .filter((r) => r.minutes <= nowMinutes && r.minutes >= nowMinutes - 120)
        .map((r) => ({ id: r.id, title: r.title, time: r.time, timeLabel: formatMinutes(r.minutes) }));

      res.json({
        ok: true,
        data: {
          settings: state.settings.reminders,
          timeZone,
          today,
          due,
          liveConnections: connected,
          deviceNotifications: true,
          note: 'التذكيرات تصل عبر التطبيق المفتوح لحظيًا، وعبر إشعارات النظام إن أذنت.',
        },
      });
    })
  );

  /** تذكير فوري — «ذكّرني بعد قليل» أو من زر الروتين */
  router.post(
    '/nudge',
    guards.requireCsrf,
    wrap(async (req, res) => {
      const state = await store.read(req.auth.user.id);
      const timeZone = state.settings.timeZone || 'Asia/Riyadh';
      const today = localDate(Date.now(), timeZone);
      const active = state.routines.filter((r) => !r.archivedAt);

      let targets = [];
      if (req.body?.routineId) {
        const routine = active.find((r) => r.id === req.body.routineId);
        if (!routine) throw notFound('الروتين غير موجود');
        targets = [routine];
      } else {
        targets = active.filter((r) => isScheduledOn(r, Date.now(), timeZone) && !state.logs[today]?.[r.id]).slice(0, 3);
      }

      if (!targets.length) {
        return res.json({ ok: true, data: { sent: 0, message: 'لا روتينات متبقية اليوم — أنت متقدّم ✨' } });
      }

      const created = await ctx.services.notifications?.notify?.(
        req.auth.user.id,
        targets.map((r) => ({
          type: 'reminder',
          title: `تذكير: ${r.title}`,
          body: r.time ? `موعدك ${formatMinutes(Number(r.time.slice(0, 2)) * 60 + Number(r.time.slice(3)))} — خطوة صغيرة الآن تكفي.` : 'لم يفت الأوان — خطوة صغيرة الآن تكفي.',
          link: '/routines',
          priority: 'high',
          data: { routineId: r.id },
        }))
      );

      res.json({ ok: true, data: { sent: created?.length || 0, routineIds: targets.map((t) => t.id) } });
    })
  );
}
