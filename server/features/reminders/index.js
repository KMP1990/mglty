/**
 * ميزة التذكير (ميزة رئيسية) — المجدول الدوري.
 * يعمل مع العلامة `reminders/<userId>.json` الموجودة داخل ملف الروتين.
 * يبدأ من app.js بعد تركيب features/routines وfeatures/notifications.
 */
import { createReminderScheduler } from './scheduler.js';

export default {
  register(app, ctx) {
    void app;
    const auth = ctx.services?.auth;
    const routines = ctx.services?.routines;
    if (!auth || !routines) throw new Error('reminders feature requires auth + routines features');

    const scheduler = createReminderScheduler({
      config: ctx.config,
      logger: ctx.logger,
      routineStore: routines.store,
      notifications: ctx.services?.notifications,
      presence: ctx.services?.presence || null,
      users: auth.users || null,
    });

    ctx.services = { ...(ctx.services || {}), reminders: scheduler };
    if (process.env.DISABLE_SCHEDULER !== 'true') scheduler.start();
  },
};
