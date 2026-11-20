/**
 * ميزة الروتينات — المسارات (ميزة رئيسية).
 * GET    /api/routines/                 القائمة + إعدادات + تقدم اليوم + السلاسل
 * GET    /api/routines/today            لوحة اليوم (جاهزة للواجهة الرئيسية)
 * GET    /api/routines/systems          الأنظمة الخمسة + التوافق والتوصية
 * GET    /api/routines/systems/:id      تفاصيل نظام وروتيناته
 * POST   /api/routines/systems/:id/apply تفعيل نظام (merge/replace)
 * POST   /api/routines/                 إنشاء روتين
 * PATCH  /api/routines/:id              تعديل روتين
 * DELETE /api/routines/:id              حذف روتين
 * PUT    /api/routines/:id/status       تسجيل done | skipped | null ليوم
 * PUT    /api/routines/settings         المنطقة الزمنية + مفاتيح التذكير
 */
import express from 'express';
import { wrap, notFound, badRequest } from '../../shared/http.js';
import { createRateLimiter } from '../../shared/rate-limit.js';
import { createRoutineStore } from './store.js';
import { validateRoutineInput, validateSettings } from './validate.js';
import { dayProgress, currentStreak, bestStreak, weekCompletion, perRoutineStreaks, perRoutineHistory, routinesForDay, recentHistory } from './stats.js';
import { addDays, isPausedOn, isScheduledOn, localDate, localWeekday, minutesOfDay } from './schedule.js';
import { createRoutineCoach, createLlmConfig } from './ai/index.js';
import { registerReminderRoutes } from './reminders.js';
import { createCompletionService, progressFor } from './completion/index.js';
import { evaluateAll, evaluateSystem, getSystem, listSystems, planSystemRoutines } from './systems/index.js';
import { listLibrary } from './library/index.js';
import { runRoutineDiagnostics } from './health/checks.js';
import { registerMegaRoutes } from './mega/routes.js';

export default {
  register(app, ctx) {
    const { config, logger } = ctx;
    const auth = ctx.services?.auth;
    if (!auth) throw new Error('routines feature requires auth feature registered first');

    const store = createRoutineStore(config);
    const coach = createRoutineCoach({ logger, llm: createLlmConfig() });
    const completion = createCompletionService({ store, logger });
    ctx.services = { ...(ctx.services || {}), routines: { store, coach, completion } };

    const router = express.Router();
    const { guards } = auth;
    const limiter = createRateLimiter(config.rateLimit.api);
    logger.debug('routines_feature_registered', { basePath: '/api/routines' });

    router.use(guards.loadSession, guards.requireAuth);
    router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    /** يجمع كل ما تحتاجه الواجهة في بنية واحدة */
    async function buildBoard(userId, now = Date.now()) {
      const state = await store.read(userId);
      const timeZone = state.settings.timeZone || 'Asia/Riyadh';
      const today = localDate(now, timeZone);
      const active = state.routines.filter((r) => !r.archivedAt);
      const progress = dayProgress(active, state.logs, today, now, timeZone);
      const streaksByRoutine = perRoutineStreaks(active, state.logs, today, timeZone);

      const todayItems = routinesForDay(active, now, timeZone).map((r) => ({
        ...r,
        progress: progressFor(r),
        window: r.time ? 'timed' : '24h',
        allDay: !r.time,
        status: state.logs[today]?.[r.id] || null,
        streak: streaksByRoutine[r.id] || 0,
      }));

      return {
        state,
        timeZone,
        today,
        weekday: localWeekday(now, timeZone),
        nowMinutes: minutesOfDay(now, timeZone),
        routines: active,
        archived: state.routines.filter((r) => r.archivedAt),
        todayItems,
        doneItems: todayItems.filter((r) => r.status === 'done'),
        pendingItems: todayItems.filter((r) => r.status !== 'done'),
        streaksByRoutine,
        progress,
        streak: currentStreak(active, state.logs, today, timeZone),
        bestStreak: bestStreak(active, state.logs, timeZone),
        weekCompletion: weekCompletion(active, state.logs, today, timeZone),
        history: recentHistory(active, state.logs, today, timeZone, 7),
        evolution: completion.summary(active),
        settings: state.settings,
      };
    }

    // ---------- اللوحة الرئيسية ----------
    router.get(
      '/',
      wrap(async (req, res) => {
        const board = await buildBoard(req.auth.user.id);
        const includeArchived = req.query.archived === '1' || req.query.archived === 'true';
        const tag = typeof req.query.tag === 'string' ? req.query.tag.trim().slice(0, 24) : '';
        const energy = ['high', 'medium', 'low'].includes(req.query.energy) ? req.query.energy : '';
        const priority = ['core', 'support', 'bonus'].includes(req.query.priority) ? req.query.priority : '';
        const favorite = req.query.favorite === '1' || req.query.favorite === 'true';
        const routines = (includeArchived ? [...board.routines, ...board.archived] : board.routines)
          .filter((routine) => (!tag || (Array.isArray(routine.tags) && routine.tags.includes(tag)))
            && (!energy || routine.energy === energy)
            && (!priority || routine.priority === priority)
            && (!favorite || routine.favorite === true))
          .map((r) => ({
          ...r,
          streak: board.streaksByRoutine?.[r.id] || 0,
          week: perRoutineHistory(r, board.state.logs, board.today, board.timeZone, 7),
        }));
        res.json({
          ok: true,
          data: {
            today: board.today,
            weekday: board.weekday,
            // نحسب السلسلة لكل روتين من السجل (لا نحسب Streak داخلي في كل كارت مع كل طلب)
            routines,
            archivedCount: board.archived.length,
            todayItems: board.todayItems,
            progress: board.progress,
            streak: board.streak,
            bestStreak: board.bestStreak,
            weekCompletion: board.weekCompletion,
            history: board.history,
            evolution: board.evolution,
            doneItems: board.doneItems,
            pendingItems: board.pendingItems,
            settings: board.settings,
          },
        });
      })
    );

    // ---------- لوحة اليوم ----------
    router.get(
      '/today',
      wrap(async (req, res) => {
        const board = await buildBoard(req.auth.user.id);
        const ai = await ctx.services.routines.coach.review({
          routines: board.routines,
          logs: board.state.logs,
          settings: board.settings,
          now: Date.now(),
          today: board.today,
          timeZone: board.timeZone,
        });
        res.json({
          ok: true,
          data: {
            date: board.today,
            weekday: board.weekday,
            nowMinutes: board.nowMinutes,
            items: board.todayItems,
            progress: board.progress,
            streak: board.streak,
            bestStreak: board.bestStreak,
            weekCompletion: board.weekCompletion,
            totalRoutines: board.routines.length,
            doneItems: board.doneItems,
            pendingItems: board.pendingItems,
            evolution: board.evolution,
            plan: ai.plan,
            insights: {
              weakest: ai.insights.weakest,
              strongest: ai.insights.strongest,
              bestWindow: ai.insights.bestWindow,
              signals: ai.insights.signals,
            },
            tip: ai.advice[0] || null,
            settings: board.settings,
          },
        });
      })
    );

    // ---------- تحليل الذكاء الاصطناعي الكامل ----------
    router.get(
      '/coach',
      limiter,
      wrap(async (req, res) => {
        const board = await buildBoard(req.auth.user.id);
        const review = await ctx.services.routines.coach.review({
          routines: board.routines,
          logs: board.state.logs,
          settings: board.settings,
          now: Date.now(),
          today: board.today,
          timeZone: board.timeZone,
        });
        res.json({ ok: true, data: { ...review, today: board.today } });
      })
    );

    // ---------- اقتراحات جاهزة للإضافة (ميزة داخلية داخل الذكاء) ----------
    router.get(
      '/suggestions',
      wrap(async (req, res) => {
        const board = await buildBoard(req.auth.user.id);
        const templates = [
          { title: 'قراءة 10 صفحات', icon: 'book', color: 'rose', time: '21:30', duration: 15, days: [], why: 'قراءة صغيرة يوميًا أكثر أثرًا من قراءة كبيرة أسبوعيًا.' },
          { title: 'شرب كوب ماء بعد الاستيقاظ', icon: 'water', color: 'sky', time: '07:00', duration: 2, days: [], why: 'أسهل روتين لبدء اليوم وأقلّها مقاومة.' },
          { title: 'مشي 15 دقيقة', icon: 'walk', color: 'mint', time: '17:30', duration: 15, days: [], why: 'حركة قصيرة تعيد ضبط الطاقة قبل المساء.' },
          { title: 'تمدد وتنفس 5 دقائق', icon: 'heart', color: 'lilac', time: '23:00', duration: 5, days: [], why: 'ينهي اليوم بتنفّس هادئ ويحسّن النوم.' },
          { title: 'كتابة 3 أسطر في مجلتي', icon: 'pen', color: 'honey', time: null, duration: 5, days: [], why: 'تدوين قصير يثبت المشاعر ويقلل التشتت.' },
          { title: 'مراجعة خطة الغد', icon: 'brain', color: 'sand', time: '22:30', duration: 5, days: [], why: 'قرار واحد قبل النوم يوفّر عشرين قرارًا صباحًا.' },
        ];
        // مطابقة مرنة: لا نقترح شيئًا يشبه روتينًا موجودًا
        // (تتعامل مع التشكيل، الأرقام العربية ٠-٩ والفارسية ۰-۹ والمسافات وعلامات الترقيم).
        // المقارنة على مستوى «الكلمات المفتاحية»: نستخرج الكلمات المعنوية (حروف فقط، ≥3 أحرف)
        // ونتجاهل الأرقام والوحدات («دقائق»، «صفحات»...) لأنها تختلف شكلاً بين الاقتراح والمستخدم.
        const STOP = new Set([
          'دقيقة', 'دقايق', 'دقيقه', 'دقائق',
          'صفحة', 'صفحه', 'صفحات',
          'كوب', 'مرة', 'مره', 'مرات',
          'اليوم', 'يوم', 'كل', 'في', 'من', 'على', 'الى', 'إلى', 'او', 'أو', 'و', 'ثم', 'بعد', 'قبل',
        ]);
        // ملاحظة مهمة: نفصل الكلمات *قبل* أي حذف للمسافات، وإلا التصقت الكلمات («تمدد وتنفس»).
        const stripPrefix = (w) => w.replace(/^(?:وال|بال|كال|فال|ال)/, '');
        const stripSuffix = (w) => w.replace(/(?:ها|هم|هن|ات|ين|ون|ان|ة|ه)$/, '');
        const stem = (w) => {
          const base = stripSuffix(stripPrefix(w));
          return base.length >= 3 ? base : w;
        };
        const words = (s) =>
          String(s ?? '')
            .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '') // تشكيل
            .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660)) // ٠-٩
            .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // ۰-۹
            // كل ما ليس حرفًا عربيًا يصبح فاصلًا (أرقام/رموز/علامات)
            .split(/[^\u0621-\u064A]+/)
            .filter((w) => w.length >= 3 && !STOP.has(w));
        const keySet = (s) => new Set(words(s).map(stem).filter(Boolean));

        const existingKeys = board.routines.map((r) => keySet(r.title)).filter((s) => s.size > 0);
        const isDuplicate = (title) => {
          const mine = keySet(title);
          if (mine.size === 0) return true;
          return existingKeys.some((theirs) => {
            if (theirs.size === 0) return false;
            // تكفي كلمة مفتاحية مشتركة واحدة إن كانت الكلمتان الأساسيتان متطابقتين
            let shared = 0;
            for (const w of mine) if (theirs.has(w)) shared += 1;
            const ratio = shared / Math.min(mine.size, theirs.size);
            return ratio >= 0.5;
          });
        };
        res.json({
          ok: true,
          data: {
            basedOn: {
              streak: board.streak,
              weekCompletion: board.weekCompletion,
              routines: board.routines.length,
            },
            suggestions: templates.filter((t) => !isDuplicate(t.title)).slice(0, 4),
          },
        });
      })
    );

    // ---------- أنظمة الروتين الجاهزة (مجموعة ٥ أنظمة مستقلة) ----------
    router.get(
      '/systems',
      wrap(async (req, res) => {
        const board = await buildBoard(req.auth.user.id);
        const reviews = await evaluateAll({
          routines: board.routines,
          logs: board.state.logs,
          today: board.today,
          timeZone: board.timeZone,
          now: Date.now(),
        });
        const byId = new Map(reviews.map((review) => [review.id, review]));
        const systems = listSystems().map((system) => ({
          ...system,
          review: byId.get(system.id) || null,
        }));
        res.json({
          ok: true,
          data: {
            systems,
            recommended: reviews.slice(0, 2).map((review) => ({
              id: review.id,
              name: review.name,
              score: review.score,
              reason: review.headline,
            })),
          },
        });
      })
    );

    router.get(
      '/systems/:id',
      wrap(async (req, res) => {
        const system = getSystem(req.params.id);
        if (!system) throw notFound('نظام الروتين غير موجود');
        const board = await buildBoard(req.auth.user.id);
        const review = await evaluateSystem(system, {
          routines: board.routines,
          logs: board.state.logs,
          today: board.today,
          timeZone: board.timeZone,
          now: Date.now(),
        });
        res.json({ ok: true, data: { system, review } });
      })
    );

    router.post(
      '/systems/:id/apply',
      guards.requireCsrf,
      limiter,
      wrap(async (req, res) => {
        const system = getSystem(req.params.id);
        if (!system) throw notFound('نظام الروتين غير موجود');

        const mode = req.body?.mode === undefined ? 'merge' : req.body.mode;
        if (!['merge', 'replace'].includes(mode)) throw badRequest('invalid_mode', 'الوضع يجب أن يكون merge أو replace');
        const intensity = req.body?.intensity === undefined ? 'full' : req.body.intensity;
        if (!['full', 'core', 'light'].includes(intensity)) {
          throw badRequest('invalid_intensity', 'الشدة يجب أن تكون full أو core أو light');
        }

        const state = await store.read(req.auth.user.id);
        let archived = 0;
        let existing = state.routines;
        if (mode === 'replace') {
          archived = await store.archiveAll(req.auth.user.id);
          existing = [];
        }

        const plan = planSystemRoutines(system, { intensity, existing });
        const created = plan.routines.length ? await store.addMany(req.auth.user.id, plan.routines) : [];

        if (created.length) {
          await ctx.services.notifications
            ?.notify?.(req.auth.user.id, {
              type: 'achievement',
              title: `تم تفعيل «${system.name}» ✨`,
              body: `أضفنا ${created.length} روتينًا مناسبًا لك. ابدأ بأصغر خطوة اليوم — لا تحتاج إلى إنجازها كلها الآن.`,
              link: '/routines',
              priority: 'normal',
              data: { source: 'routines', event: 'system-applied', systemId: system.id },
            })
            .catch(() => {});
        }

        res.status(created.length ? 201 : 200).json({
          ok: true,
          data: {
            system: {
              id: system.id,
              name: system.name,
              icon: system.icon,
              color: system.color,
              routineCount: system.routineCount,
            },
            mode,
            intensity: plan.mode,
            archived,
            created: created.map((routine) => ({ id: routine.id, title: routine.title, time: routine.time, priority: routine.priority })),
            skipped: plan.skipped,
            message: created.length
              ? `أضفنا ${created.length} روتينًا من «${system.name}».`
              : 'كل روتينات هذا النظام موجودة عندك بالفعل.',
          },
        });
      })
    );

    // ---------- فحص صحة النظام والأنظمة والإشعارات ----------
    router.get(
      '/diagnostics',
      wrap(async (req, res) => {
        const state = await store.read(req.auth.user.id);
        const timeZone = state.settings.timeZone || 'Asia/Riyadh';
        const report = await runRoutineDiagnostics({
          ctx,
          state,
          user: req.auth.user,
          today: localDate(Date.now(), timeZone),
          client: req.query || {},
        });
        res.json({ ok: true, data: report });
      })
    );

    // ---------- مكتبة الروتينات الجاهزة (ملفات إضافة مستقلة) ----------
    router.get(
      '/library',
      wrap(async (req, res) => {
        res.json({
          ok: true,
          data: listLibrary({
            category: typeof req.query.category === 'string' ? req.query.category : '',
            q: typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '',
          }),
        });
      })
    );

    // ---------- سجل الإنجاز (آخر ٩٠ يومًا) ----------
    router.get(
      '/history',
      wrap(async (req, res) => {
        const requested = Number(req.query.days);
        const days = Number.isFinite(requested) ? Math.min(90, Math.max(7, Math.round(requested))) : 30;
        const state = await store.read(req.auth.user.id);
        const timeZone = state.settings.timeZone || 'Asia/Riyadh';
        const today = localDate(Date.now(), timeZone);
        const byId = new Map(state.routines.map((routine) => [routine.id, routine]));
        const entries = [];
        let totalDone = 0;
        let totalSkipped = 0;
        for (let i = days - 1; i >= 0; i -= 1) {
          const day = addDays(today, -i);
          const log = state.logs[day] || {};
          const done = [];
          const skipped = [];
          for (const [routineId, status] of Object.entries(log)) {
            const routine = byId.get(routineId);
            if (!routine || (status !== 'done' && status !== 'skipped')) continue;
            const item = { id: routineId, title: routine.title, icon: routine.icon, color: routine.color };
            if (status === 'done') done.push(item);
            else skipped.push(item);
          }
          if (!done.length && !skipped.length) continue;
          totalDone += done.length;
          totalSkipped += skipped.length;
          entries.push({ date: day, weekday: localWeekday(Date.parse(`${day}T12:00:00Z`), timeZone), done, skipped });
        }
        res.json({
          ok: true,
          data: {
            days,
            entries,
            totals: { done: totalDone, skipped: totalSkipped, activeDays: entries.length },
            evolution: completion.summary(state.routines.filter((r) => !r.archivedAt)),
          },
        });
      })
    );

    // ---------- CRUD ----------
    router.post(
      '/',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const { errors, value } = validateRoutineInput(req.body || {});
        if (Object.keys(errors).length) {
          return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: 'تحقق من الحقول', details: { fields: errors } } });
        }
        // توافق إضافة الأنظمة من العميل (وضع احتياطي عندما لا يتوفر مسار systems)
        if (typeof req.body?.systemId === 'string') {
          const system = getSystem(req.body.systemId);
          if (system) {
            value.systemId = system.id;
            value.systemName = system.name;
            value.systemKey = String(req.body?.systemKey || '').slice(0, 40) || null;
            value.source = 'system';
          }
        }
        const routine = await store.add(req.auth.user.id, value);
        await ctx.services.notifications
          ?.notify?.(req.auth.user.id, {
            type: 'achievement',
            title: 'أضفت روتينًا جديدًا ✨',
            body: `«${routine.title}» أصبح جزءًا من يومك. كل خطوة صغيرة تُحتسب.`,
            link: '/routines',
            priority: 'normal',
          })
          .catch(() => { });
        res.status(201).json({ ok: true, data: { routine } });
      })
    );

    router.patch(
      '/:id',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const { errors, value } = validateRoutineInput(req.body || {}, { partial: true });
        if (typeof req.body?.archived === 'boolean') value.archivedAt = req.body.archived ? new Date().toISOString() : null;
        if (Object.keys(errors).length) {
          return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: 'تحقق من الحقول', details: { fields: errors } } });
        }
        const routine = await store.update(req.auth.user.id, req.params.id, value);
        if (!routine) throw notFound('الروتين غير موجود');
        res.json({ ok: true, data: { routine } });
      })
    );

    router.delete(
      '/:id',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const removed = await store.remove(req.auth.user.id, req.params.id);
        if (!removed) throw notFound('الروتين غير موجود');
        res.json({ ok: true, data: { deleted: true } });
      })
    );

    // نسخ روتين موجود — أسرع من إعادة كتابته
    router.post(
      '/:id/duplicate',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const state = await store.read(req.auth.user.id);
        const source = state.routines.find((r) => r.id === req.params.id);
        if (!source) throw notFound('الروتين غير موجود');
        const routine = await store.add(req.auth.user.id, {
          ...source,
          title: `${source.title} (نسخة)`.slice(0, 80),
          source: 'user',
          systemId: null,
          systemName: null,
          systemKey: null,
        });
        res.status(201).json({ ok: true, data: { routine } });
      })
    );

    // ---------- تسجيل الحالة ----------
    router.put(
      '/:id/status',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const status = req.body?.status;
        if (!['done', 'skipped', null].includes(status)) throw badRequest('invalid_status', 'الحالة يجب أن تكون done أو skipped أو null');
        const state = await store.read(req.auth.user.id);
        const timeZone = state.settings.timeZone || 'Asia/Riyadh';
        const day = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : localDate(Date.now(), timeZone);
        const targetRoutine = state.routines.find((r) => r.id === req.params.id);
        if (!targetRoutine) throw notFound('الروتين غير موجود');
        if (status && isPausedOn(targetRoutine, day)) {
          return res.status(409).json({
            ok: false,
            error: { code: 'routine_paused', message: 'هذا الروتين موقوف مؤقتًا — استأنفه أولًا إن أردت إنجازه.' },
          });
        }
        if (status && !isScheduledOn({ days: targetRoutine.days }, Date.now(), timeZone)) {
          return res.status(409).json({
            ok: false,
            error: { code: 'not_scheduled', message: 'هذا الروتين غير مجدول اليوم — عدّل أيامه أولًا إن أردت إنجازه.' },
          });
        }
        // الإنجاز نهائي: لا يُسمح بإلغاء إنجاز سُجّل بالفعل (يُحفظ في السجل)
        if (state.logs?.[day]?.[req.params.id] === 'done' && status !== 'done') {
          return res.status(409).json({
            ok: false,
            error: {
              code: 'completion_locked',
              message: 'هذا الروتين مُنجز ومحفوظ في سجلك — لا يمكن إلغاء الإنجاز.',
            },
          });
        }
        const result = await completion.setStatus({
          userId: req.auth.user.id,
          routineId: req.params.id,
          day,
          status,
          now: Date.now(),
        });
        if (!result) throw notFound('الروتين غير موجود');

        const { state: updated, routine, evolution } = result;
        const active = updated.routines.filter((r) => !r.archivedAt);
        const progress = dayProgress(active, updated.logs, day, Date.now(), timeZone);
        const todayKey = localDate(Date.now(), timeZone);
        const streak = currentStreak(active, updated.logs, todayKey, timeZone);
        const bestStreakNow = bestStreak(active, updated.logs, timeZone);
        const weekNow = weekCompletion(active, updated.logs, todayKey, timeZone);

        // إنجاز سلسلة؟ إشعار تحفيزي عند مضاعفات السبعة (مرة واحدة لكل محطة)
        if (status === 'done' && streak >= 7 && streak % 7 === 0) {
          const milestone = await store.markMilestone(req.auth.user.id, `streak-${streak}`).catch(() => false);
          if (milestone) {
            await ctx.services.notifications
              ?.notify?.(req.auth.user.id, {
                type: 'achievement',
                title: `سلسلة ${streak} يومًا 🔥`,
                body: 'هذه ليست صدفة — إنها عادة تثبت نفسها. احتفظ بخطوة صغيرة اليوم أيضًا.',
                link: '/routines',
                priority: 'high',
                data: { source: 'routines', event: 'streak-milestone', streak },
              })
              .catch(() => {});
          }
        }

        // تطور الروتين: إشعار مرة واحدة عند كل مستوى جديد
        if (status === 'done' && evolution.leveledUp) {
          const stageLine = evolution.stageChanged ? ` وانتقل إلى مرحلة «${routine.progress.stageName}»` : '';
          await ctx.services.notifications
            ?.notify?.(req.auth.user.id, {
              type: 'achievement',
              title: `«${routine.title}» تطور إلى المستوى ${routine.progress.level} ${routine.progress.stageEmoji}`,
              body: `أنجزته ${routine.progress.doneCount} مرة${stageLine}. خطواتك الصغيرة أصبحت جزءًا منك.`,
              link: '/routines',
              priority: 'normal',
              data: {
                source: 'routines',
                event: 'routine-level-up',
                routineId: routine.id,
                systemId: routine.systemId || null,
                systemName: routine.systemName || null,
                level: routine.progress.level,
                stage: routine.progress.stage,
                xp: routine.progress.xp,
              },
            })
            .catch(() => {});
        }

        // إتمام كل روتينات نظام جاهز — حدث واحد يوميًا لكل نظام
        if (status === 'done' && routine.systemId) {
          const systemRoutines = active.filter((r) => r.systemId === routine.systemId);
          const systemDone = systemRoutines.filter((r) => updated.logs?.[day]?.[r.id] === 'done').length;
          if (systemRoutines.length >= 2 && systemDone === systemRoutines.length) {
            const milestone = await store.markMilestone(req.auth.user.id, `system-done-${routine.systemId}-${day}`).catch(() => false);
            if (milestone) {
              await ctx.services.notifications
                ?.notify?.(req.auth.user.id, {
                  type: 'achievement',
                  title: `أتممت «${routine.systemName || 'نظامك'}» اليوم ⚡`,
                  body: `${systemDone} ${systemDone === 1 ? 'روتين' : 'روتينات'} من النظام في يوم واحد — هذا أثر تراكمي حقيقي.`,
                  link: '/routines?filter=systems',
                  priority: 'high',
                  data: {
                    source: 'routines',
                    event: 'system-milestone',
                    systemId: routine.systemId,
                    systemName: routine.systemName || null,
                    count: systemDone,
                    date: day,
                  },
                })
                .catch(() => {});
            }
          }
        }

        // إتمام كل روتينات اليوم — مرة واحدة عند الانتقال إلى done
        if (status === 'done' && evolution.previousStatus !== 'done' && progress.total > 0 && progress.done === progress.total) {
          await ctx.services.notifications
            ?.notify?.(req.auth.user.id, {
              type: 'achievement',
              title: 'أتممت روتينات اليوم 🎉',
              body: `عدّادك الآن ${streak} ${streak === 1 ? 'يوم' : 'أيام'} — استمر، أنت تبني عادة.`,
              link: '/routines',
              priority: 'high',
              data: { source: 'routines', event: 'all-done', streak, date: todayKey },
            })
            .catch(() => {});
        }

        res.json({
          ok: true,
          data: {
            day,
            progress,
            streak,
            bestStreak: bestStreakNow,
            weekCompletion: weekNow,
            routine,
            evolution,
            evolutionSummary: completion.summary(active),
          },
        });
      })
    );

    // ---------- الإعدادات ----------
    router.put(
      '/settings',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const { errors, value } = validateSettings(req.body || {});
        if (Object.keys(errors).length) {
          return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: errors.timeZone || 'إعدادات غير صالحة', details: { fields: errors } } });
        }
        const settings = await store.updateSettings(req.auth.user.id, value);
        res.json({ ok: true, data: { settings } });
      })
    );

    // ---------- ترتيب مخصص ----------
    router.put(
      '/order',
      guards.requireCsrf,
      wrap(async (req, res) => {
        const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
        const state = await store.read(req.auth.user.id);
        const index = new Map(ids.map((id, i) => [id, i]));
        state.routines.sort((a, b) => (index.has(a.id) ? index.get(a.id) : 999) - (index.has(b.id) ? index.get(b.id) : 999));
        await store.write(req.auth.user.id, state);
        res.json({ ok: true, data: { routines: state.routines } });
      })
    );

    // ---------- مركز القيادة (تحليلات وأهداف وتحديات وتصدير) ----------
    registerMegaRoutes(router, { store, ctx, guards, limiter });

    // ---------- إشعارات الروتين الداخلية ----------
    registerReminderRoutes(router, { store, config, ctx, guards });

    // ملاحظة مهمة: nested routers في Express لا تُشغّل middleware عامًّا أُضيف على
    // الجذر بعد التمرير (مثل express.json) — لكن ترتيب التركيب هنا قبل static/404 صحيح.
    app.use('/api/routines', router);
    logger.debug('routines_mounted', { path: '/api/routines' });
  },
};
