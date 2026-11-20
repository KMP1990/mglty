/**
 * مجدول التذكير الخادمي — قلب وصول الإشعارات والتطبيق مغلق.
 * ------------------------------------------------------------
 * كل دقيقة يفحص المستخدمين ويرسل ما يستحق:
 *   • تذكير الروتين المستحق: كل تذكيرات اليوم للنشطين، وتذكير واحد
 *     يوميًا للغائبين (حتى لا تنقطع الإشعارات بعد يومين غياب)
 *   • دفعة مسائية + خطة صباحية
 *   • تذكير قراءة خادمي (يعتمد على مزامنة تقدّم القراءة من الجهاز)
 *   • ملخص يومي صباحي، ورسالة عودة بعد الغياب (كل يومين ثم أسبوعيًا)
 *   • حصاد أسبوعي يوم الأحد مساءً
 *
 * كل التذكيرات غير الأمنية تحترم «ساعات الهدوء»، ويمكن إيقاف كل نوع
 * من تفضيلات الإشعارات (تذكيرات الروتين/الإنجازات/أحداث النظام).
 *
 * كل إشعار يُحفظ في صندوق الإشعارات ثم يُدفع عبر Web Push، لذلك يصل
 * على الهاتف حتى لو كان التطبيق مغلقًا لعدة أيام. كل التكرار ممنوع
 * بسجل داخل ملف الروتين (`nudges`) وملف الحضور (`presence.reminders`).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { localDate, minutesOfDay, isScheduledOn, formatMinutes, parseTimeToMinutes, weekdayKey } from '../routines/schedule.js';
import { buildDailyDigest, buildReengage, buildWeekly, buildReadingReminder } from './digest.js';

const TICK_MS = 60_000;
const DAY_MS = 86_400_000;
const ID_RE = /^[a-f0-9]{24}\.json$/;

export function createReminderScheduler({ config, logger, routineStore, notifications, presence = null, users = null }) {
  let timer = null;
  let running = false;

  const routinesDir = path.join(config.dataDir, 'routines');
  const usersDir = path.join(config.dataDir, 'users');

  async function idsIn(dir) {
    try {
      return (await fs.readdir(dir)).filter((f) => ID_RE.test(f)).map((f) => f.replace('.json', ''));
    } catch {
      return [];
    }
  }

  async function userIds() {
    const ids = new Set([...(await idsIn(routinesDir)), ...(await idsIn(usersDir))]);
    return [...ids];
  }

  function parseStoredTime(value, fallback) {
    return parseTimeToMinutes(value, parseTimeToMinutes(fallback, 8 * 60 + 30));
  }

  function inQuietHours(minutes, quiet) {
    if (!quiet || quiet.enabled === false) return false;
    const from = parseTimeToMinutes(quiet.from, 23 * 60);
    const to = parseTimeToMinutes(quiet.to, 7 * 60);
    if (from === to) return false;
    return from < to ? minutes >= from && minutes < to : minutes >= from || minutes < to;
  }

  async function ensureNudgeDay(state, today) {
    state.nudges = state.nudges && typeof state.nudges === 'object' ? state.nudges : {};
    state.nudges[today] = state.nudges[today] || {};
    for (const day of Object.keys(state.nudges)) {
      if (day < localDate(Date.now() - 30 * DAY_MS, state.settings?.timeZone)) delete state.nudges[day];
    }
    return state.nudges[today];
  }

  async function tickOnce(now = Date.now()) {
    const ids = await userIds();
    for (const userId of ids) {
      try {
        const user = users ? await users.findById(userId) : null;
        if (users && !user) continue;

        const state = await routineStore.read(userId);
        const settings = state.settings || {};
        const reminders = settings.reminders || {};
        const timeZone = settings.timeZone || 'Asia/Riyadh';
        const today = localDate(now, timeZone);
        const nowMinutes = minutesOfDay(now, timeZone);

        const pres = presence
          ? await presence.read(userId)
          : { lastSeenAt: null, reminders: {}, reading: null };
        const lastSeen = Date.parse(pres.lastSeenAt || user?.lastLoginAt || user?.createdAt || 0) || 0;
        const daysAway = lastSeen ? Math.max(0, (now - lastSeen) / DAY_MS) : 0;
        const live = notifications?.connectedCount?.(userId) > 0;
        const recent = live || daysAway < 2;
        const prefs = user?.preferences || {};
        const notifPrefs = prefs.notifications || {};
        const reading = pres.reading || null;
        const quiet = inQuietHours(nowMinutes, notifPrefs.quietHours);
        pres.reminders = pres.reminders && typeof pres.reminders === 'object' ? pres.reminders : {};

        const pending = [];
        let presenceChanged = false;
        let routineChanged = false;

        /* ---------- 1) تذكيرات الروتين اليومية ---------- */
        const routineRemindersOn = reminders.enabled !== false && notifPrefs.routineReminders !== false;
        if (!quiet && routineRemindersOn) {
          const active = state.routines.filter((r) => !r.archivedAt);
          if (active.length) {
            const dayLog = state.logs?.[today] || {};
            const log = await ensureNudgeDay(state, today);
            let changed = false;

            if (recent) {
              for (const routine of active) {
                if (!routine.time || !isScheduledOn(routine, now, timeZone) || dayLog[routine.id]) continue;
                const minutes = parseTimeToMinutes(routine.time);
                if (minutes == null) continue;
                const already = log[routine.id];
                const due = nowMinutes >= minutes && nowMinutes - minutes <= 30;
                if (due && already !== routine.time) {
                  pending.push({
                    type: 'reminder',
                    title: `حان وقت: ${routine.title}`,
                    body: routine.note ? routine.note.slice(0, 120) : `موعدك ${formatMinutes(minutes)} — ابدأ بخطوة صغيرة.`,
                    link: `/routines?focus=${encodeURIComponent(routine.id)}`,
                    priority: 'normal',
                    data: { source: 'routines', event: 'routine-time', routineId: routine.id },
                  });
                  log[routine.id] = routine.time;
                  changed = true;
                }
              }

              const remaining = active.filter((r) => isScheduledOn(r, now, timeZone) && !dayLog[r.id]);
              if (reminders.eveningNudge !== false && !log.evening && nowMinutes >= 20 * 60 + 30 && nowMinutes <= 23 * 60 && remaining.length > 0) {
                pending.push({
                  type: 'reminder',
                  title: `بقيت ${remaining.length} من روتيناتك اليوم`,
                  body: remaining.slice(0, 3).map((r) => `• ${r.title}`).join('\n'),
                  link: '/routines?filter=today',
                  priority: 'normal',
                  data: { source: 'routines', event: 'evening-nudge', remaining: remaining.length },
                });
                log.evening = true;
                changed = true;
              }

              // الملخص اليومي يغطي خطة الصباح؛ لا نرسل الاثنين معًا
              const digestCoversMorning = notifPrefs.digest !== false;
              if (!digestCoversMorning && reminders.morningPlan !== false && notifPrefs.systemEvents !== false && !log.morning && nowMinutes >= 7 * 60 + 30 && nowMinutes <= 10 * 60) {
                const target = active.filter((r) => isScheduledOn(r, now, timeZone)).length;
                if (target > 0) {
                  pending.push({
                    type: 'system',
                    title: 'صباح الخير — خطتك جاهزة ☀️',
                    body: `لديك ${target} ${target === 1 ? 'روتين' : 'روتينات'} اليوم. ابدأ بالأسهل.`,
                    link: '/routines?filter=today',
                    priority: 'normal',
                    data: { source: 'routines', event: 'morning-plan' },
                  });
                  log.morning = true;
                  changed = true;
                }
              }
            } else if (pres.reminders.awayRoutineDate !== today) {
              // الغائب: تذكير واحد فقط يوميًا عند أول روتين مستحق — يبقى مفيدًا
              // بعد أسابيع من عدم فتح التطبيق، ولا يتحول إلى إغراق.
              const dueRoutine = active.find((routine) => {
                if (!routine.time || !isScheduledOn(routine, now, timeZone) || dayLog[routine.id]) return false;
                const minutes = parseTimeToMinutes(routine.time);
                return minutes != null && nowMinutes >= minutes && nowMinutes - minutes <= 180;
              });
              if (dueRoutine) {
                const minutes = parseTimeToMinutes(dueRoutine.time);
                pending.push({
                  type: 'reminder',
                  title: `تذكير اليوم: ${dueRoutine.title}`,
                  body: dueRoutine.note
                    ? dueRoutine.note.slice(0, 120)
                    : `موعدك ${formatMinutes(minutes)} — خطوة واحدة اليوم تُعيد الإيقاع.`,
                  link: `/routines?focus=${encodeURIComponent(dueRoutine.id)}`,
                  priority: 'normal',
                  data: {
                    source: 'routines',
                    event: 'away-routine',
                    routineId: dueRoutine.id,
                    daysAway: Math.round(daysAway),
                  },
                });
                pres.reminders.awayRoutineDate = today;
                presenceChanged = true;
              }
            }
            if (changed) routineChanged = true;
          }
        }

        /* ---------- 2) تذكير القراءة — مستقل عن نشاط التطبيق ---------- */
        const readingPref = prefs.readingReminder;
        // لا نذكّر بكتاب لا نعرف عنوانه (الخادم لا يرى الكتب، فقط اللقطة المزامنة)
        if (!quiet && reading?.bookTitle && readingPref?.enabled === true && prefs.notifications?.push !== false) {
          const target = parseStoredTime(readingPref.time, '20:30');
          const due = nowMinutes >= target && nowMinutes - target <= 240;
          const readToday = reading?.lastReadDate === today;
          if (due && !readToday && pres.reminders?.readingDate !== today) {
            pending.push(buildReadingReminder(reading));
            pres.reminders.readingDate = today;
            presenceChanged = true;
          }
        }

        /* ---------- 3) الملخص اليومي / العودة بعد الغياب ---------- */
        const digestEnabled = notifPrefs.digest !== false && !quiet;
        if (digestEnabled) {
          const target = parseStoredTime(notifPrefs.digestTime, '08:30');
          const due = nowMinutes >= target && nowMinutes - target <= 180;
          if (due) {
            if (recent) {
              if (pres.reminders?.digestDate !== today) {
                const item = buildDailyDigest({ state, reading, now, timeZone, today });
                if (item) {
                  pending.push(item);
                  pres.reminders.digestDate = today;
                  presenceChanged = true;
                }
              }
            } else if (daysAway >= 2) {
              const lastReengage = Date.parse(pres.reminders?.reengageAt || 0) || 0;
              const gap = (daysAway >= 7 ? 7 : 2) * DAY_MS;
              let sentAway = false;
              if (notifPrefs.reengage !== false && now - lastReengage >= gap) {
                pending.push(buildReengage({ state, reading, daysAway, now, timeZone, today }));
                pres.reminders.reengageAt = new Date(now).toISOString();
                // نعلّم اليوم أيضًا حتى لا يضيف فحص لاحق ملخصًا يوميًا ثانيًا.
                pres.reminders.awayDigestDate = today;
                presenceChanged = true;
                sentAway = true;
              }
              // ملخص يومي للغائب حتى لو لم يحن موعد رسالة العودة (افتراضيًا مفعّل).
              if (!sentAway && notifPrefs.awayReminders !== false && pres.reminders.awayDigestDate !== today) {
                const item = buildDailyDigest({ state, reading, now, timeZone, today });
                if (item) {
                  pending.push({
                    ...item,
                    title: 'روتيناتك اليوم تنتظرك 🌤️',
                    data: { ...(item.data || {}), source: 'digest', event: 'away-digest', daysAway: Math.round(daysAway) },
                  });
                  pres.reminders.awayDigestDate = today;
                  presenceChanged = true;
                }
              }
            }
          }
        }

        /* ---------- 4) حصاد أسبوعي (الأحد مساءً) ---------- */
        if (recent && digestEnabled && weekdayKey(now, timeZone) === 'sun' && nowMinutes >= 19 * 60 && nowMinutes <= 21 * 60 + 59) {
          if (pres.reminders?.weeklyDate !== today) {
            const item = buildWeekly({ state, reading, now, timeZone, today });
            if (item) {
              pending.push(item);
              pres.reminders.weeklyDate = today;
              presenceChanged = true;
            }
          }
        }

        if (pending.length) {
          await notifications.notify(userId, pending);
          logger.info('reminders_sent', { userId, count: pending.length, awayDays: Math.round(daysAway) });
        }
        if (routineChanged) await routineStore.write(userId, state);
        if (presenceChanged && presence) await presence.write(userId, pres);
      } catch (err) {
        logger.warn('reminder_tick_failed', { userId, message: err?.message });
      }
    }
  }

  return {
    start() {
      if (timer) return;
      running = true;
      // أول فحص بعد 20 ثانية من الإقلاع، ثم كل دقيقة
      timer = setTimeout(async function loop() {
        if (!running) return;
        try {
          await tickOnce();
        } catch (err) {
          logger.warn('reminder_loop_error', { message: err?.message });
        }
        timer = setTimeout(loop, TICK_MS);
      }, 20_000);
      timer.unref?.();
      logger.info('reminder_scheduler_started', { tickMs: TICK_MS });
    },
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      timer = null;
    },
    tickOnce,
  };
}
