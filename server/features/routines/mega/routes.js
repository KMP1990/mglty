/**
 * مسارات مركز القيادة — تُركّب داخل /api/routines.
 * كل المسارات هنا محمية بجلسة المستخدم وCSRF عند الكتابة.
 */
import crypto from 'node:crypto';
import { wrap, badRequest, notFound } from '../../../shared/http.js';
import { validateRoutineInput } from '../validate.js';
import { addDays, isScheduledOn, parseTimeToMinutes } from '../schedule.js';
import { FEATURE_CATALOG, FEATURE_GROUPS, catalogSummary } from './catalog.js';
import { loadMega, normalizeMega } from './service.js';

const GOAL_TYPES = new Set(['done', 'streak', 'perfect', 'active', 'minutes', 'level', 'journal', 'focus', 'review', 'manual']);
const REVIEW_PERIODS = new Set(['daily', 'weekly', 'monthly', 'quarterly']);
const BATCH_ACTIONS = new Set(['archive', 'restore', 'favorite', 'unfavorite', 'pause', 'resume', 'priority', 'energy', 'addTag', 'removeTag']);
const PRIORITIES = new Set(['core', 'support', 'bonus']);
const ENERGIES = new Set(['high', 'medium', 'low']);
const WEEK_KEYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

const text = (value, max = 300) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));
const uid = () => crypto.randomUUID();
const nowIso = () => new Date().toISOString();

function parseBoolean(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function goalPayload(body, { partial = false } = {}) {
  const value = {};
  if (!partial || body.title !== undefined) {
    const title = text(body.title, 80);
    if (title.length < 2) throw badRequest('invalid_goal', 'اسم الهدف قصير جدًا');
    value.title = title;
  }
  if (body.type !== undefined) {
    if (!GOAL_TYPES.has(body.type)) throw badRequest('invalid_goal_type', 'نوع الهدف غير معروف');
    value.type = body.type;
  } else if (!partial) value.type = 'done';
  if (body.target !== undefined) {
    const target = Number(body.target);
    if (!Number.isFinite(target) || target < 1 || target > 100000) throw badRequest('invalid_goal_target', 'هدف الهدف يجب أن يكون بين ١ و١٠٠٠٠٠');
    value.target = Math.round(target);
  } else if (!partial) value.target = 10;
  if (body.manualValue !== undefined) value.manualValue = Math.max(0, Number(body.manualValue) || 0);
  if (body.deadline !== undefined) {
    if (!body.deadline) value.deadline = null;
    else if (!validDate(body.deadline)) throw badRequest('invalid_deadline', 'موعد الهدف غير صالح');
    else value.deadline = body.deadline;
  }
  if (body.reward !== undefined) value.reward = text(body.reward, 120);
  if (body.notes !== undefined) value.notes = text(body.notes, 300);
  return value;
}

function saveMega(store, userId, state, mega) {
  state.mega = normalizeMega({ mega });
  return store.write(userId, state);
}

function escapeCsv(value) {
  const raw = String(value ?? '');
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function icsDate(date, time = null) {
  const compact = String(date).replace(/-/g, '');
  if (!time) return { key: 'DTSTART;VALUE=DATE', value: compact };
  return { key: 'DTSTART', value: `${compact}T${String(time).replace(':', '')}00` };
}

function buildIcs(state, timeZone, today) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Majalati Routinee//Routine Center//AR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:مجلتي وروتيني',
    `X-WR-TIMEZONE:${timeZone}`,
  ];
  const active = (state.routines || []).filter((routine) => !routine.archivedAt);
  for (let i = 0; i < 21; i += 1) {
    const date = addDays(today, i);
    const ms = Date.parse(`${date}T12:00:00Z`);
    for (const routine of active) {
      if (!isScheduledOn({ days: routine.days }, ms, timeZone)) continue;
      if (routine.pausedUntil && routine.pausedUntil >= date) continue;
      const start = icsDate(date, routine.time || null);
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${routine.id}-${date}@majalati.routine`);
      lines.push(`DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').split('.')[0]}Z`);
      lines.push(`${start.key}:${start.value}`);
      if (routine.time) {
        const minutes = parseTimeToMinutes(routine.time, 7 * 60);
        const end = icsDate(date, `${String(Math.floor((minutes + (routine.duration || 20)) / 60) % 24).padStart(2, '0')}:${String((minutes + (routine.duration || 20)) % 60).padStart(2, '0')}`);
        lines.push(`${end.key}:${end.value}`);
      }
      lines.push(`SUMMARY:${String(routine.title || 'روتين').replace(/[\\;,]/g, ' ')}`);
      if (routine.note) lines.push(`DESCRIPTION:${String(routine.note).replace(/[\\\n\r;,]/g, ' ').slice(0, 300)}`);
      lines.push('END:VEVENT');
    }
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function buildMarkdown(board, state) {
  const lines = [
    '# تقرير مجلتي وروتيني',
    '',
    `> ${board.today}`,
    '',
    '## الملخص',
    `- المستوى: ${board.summary.level} (${board.summary.stage})`,
    `- الخبرة: ${board.summary.xp} XP`,
    `- السلسلة الحالية: ${board.summary.streak} يوم`,
    `- أفضل سلسلة: ${board.summary.bestStreak} يوم`,
    `- الالتزام هذا الأسبوع: ${board.summary.weekRate}٪`,
    `- إجمالي الإنجاز: ${board.summary.totalDone}`,
    `- الأيام المثالية: ${board.summary.perfectDays}`,
    `- الزخم: ${board.summary.momentum.label} (${board.summary.momentum.delta > 0 ? '+' : ''}${board.summary.momentum.delta}٪)`,
    '',
    '## الروتينات',
    '| الروتين | الوقت | الإنجاز | الالتزام | القوة |',
    '|---|---|---:|---:|---|',
    ...board.health.map((item) => `| ${item.title.replace(/\|/g, ' ')} | ${item.time || '٢٤ ساعة'} | ${item.done}/${item.total} | ${item.rate}٪ | ${item.strength}٪ |`),
    '',
    '## التنبيهات',
    board.burnout.level === 'low' ? '- الإيقاع صحي.' : `- ${board.burnout.label}: ${board.burnout.advice}`,
    ...board.smartPlan.map((item) => `- ${item.title}: ${item.detail}`),
    '',
    '## الأهداف',
    ...(board.goals.length ? board.goals.map((goal) => `- ${goal.complete ? '✓' : '○'} ${goal.title} — ${goal.percent}٪${goal.reward ? ` — مكافأة: ${goal.reward}` : ''}`) : ['- لا أهداف بعد.']),
    '',
    '## آخر التدوينات',
    ...(board.journal.length ? board.journal.slice(0, 6).map((entry) => `- ${entry.date}: ${entry.wins || entry.note || 'تدوينة'}`) : ['- لا تدوينات بعد.']),
    '',
    `> ${FEATURE_CATALOG.length} قدرة في نظام الروتين.`,
  ];
  return lines.join('\n');
}

function buildCsv(board) {
  const rows = [['id', 'title', 'time', 'duration', 'priority', 'energy', 'system', 'done', 'total', 'rate', 'streak', 'strength', 'risk']];
  for (const item of board.health) {
    rows.push([item.id, item.title, item.time || '', item.duration || '', item.priority, item.energy, item.systemName || '', item.done, item.total, item.rate, item.streak, item.strength, item.risk]);
  }
  return rows.map((row) => row.map(escapeCsv).join(',')).join('\n');
}

export function registerMegaRoutes(router, { store, ctx = null, guards, limiter = null }) {
  const writeLimit = limiter || ((req, res, next) => next());

  // ---------- الحزمة الكاملة ----------
  router.get(
    '/mega',
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const board = loaded.board;
      res.json({
        ok: true,
        data: {
          ...board,
          timeZone: loaded.timeZone,
          catalog: catalogSummary(),
          featureGroups: FEATURE_GROUPS,
          templates: loaded.mega.templates,
          settings: loaded.mega.settings,
        },
      });
    })
  );

  router.get(
    '/mega/catalog',
    wrap(async (req, res) => {
      res.json({
        ok: true,
        data: {
          ...catalogSummary(),
          features: FEATURE_CATALOG,
          groups: FEATURE_GROUPS,
        },
      });
    })
  );

  // ---------- إعدادات مركز القيادة ----------
  router.put(
    '/mega/settings',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const body = req.body || {};
      const next = { ...mega.settings };
      const allowed = {
        weekStart: (value) => (WEEK_KEYS.has(value) ? value : null),
        dayStart: (value) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null),
        dayEnd: (value) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null),
      };
      for (const [key, parse] of Object.entries(allowed)) {
        if (body[key] === undefined) continue;
        const value = parse(String(body[key]));
        if (value == null) throw badRequest('invalid_mega_setting', `قيمة ${key} غير صالحة`);
        next[key] = value;
      }
      if (body.dailyBudget !== undefined) next.dailyBudget = Math.max(15, Math.min(720, Number(body.dailyBudget) || 120));
      if (body.focusMinutes !== undefined) next.focusMinutes = Math.max(5, Math.min(120, Number(body.focusMinutes) || 25));
      if (body.reviewDay !== undefined) {
        if (!WEEK_KEYS.has(body.reviewDay)) throw badRequest('invalid_review_day', 'يوم المراجعة غير صالح');
        next.reviewDay = body.reviewDay;
      }
      for (const key of ['autoBalance', 'gentleMode']) if (body[key] !== undefined) next[key] = parseBoolean(body[key]);
      for (const [key, max] of [['identity', 160], ['celebration', 160], ['environment', 200]]) {
        if (body[key] !== undefined) next[key] = text(body[key], max);
      }
      if (body.vacationUntil !== undefined) {
        if (body.vacationUntil === null || body.vacationUntil === '') next.vacationUntil = null;
        else if (!validDate(body.vacationUntil)) throw badRequest('invalid_vacation', 'تاريخ الإجازة غير صالح');
        else next.vacationUntil = body.vacationUntil;
        const previous = mega.settings.vacationUntil;
        for (const routine of state.routines || []) {
          if (routine.archivedAt) continue;
          if (next.vacationUntil) routine.pausedUntil = next.vacationUntil;
          else if (routine.pausedUntil && routine.pausedUntil === previous) routine.pausedUntil = null;
          routine.updatedAt = nowIso();
        }
      }
      mega.settings = next;
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { settings: next } });
    })
  );

  // ---------- الأهداف ----------
  router.post(
    '/mega/goals',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      if (mega.goals.length >= 30) throw badRequest('too_many_goals', '٣٠ هدفًا كحد أقصى');
      const value = goalPayload(req.body || {});
      const goal = {
        id: uid(),
        ...value,
        completedAt: null,
        claimedAt: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      mega.goals.push(goal);
      await saveMega(store, req.auth.user.id, state, mega);
      res.status(201).json({ ok: true, data: { goal } });
    })
  );

  router.patch(
    '/mega/goals/:id',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const goal = mega.goals.find((item) => item.id === req.params.id);
      if (!goal) throw notFound('الهدف غير موجود');
      Object.assign(goal, goalPayload(req.body || {}, { partial: true }), { updatedAt: nowIso() });
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { goal } });
    })
  );

  router.delete(
    '/mega/goals/:id',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const before = mega.goals.length;
      mega.goals = mega.goals.filter((goal) => goal.id !== req.params.id);
      if (mega.goals.length === before) throw notFound('الهدف غير موجود');
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { deleted: true } });
    })
  );

  router.post(
    '/mega/goals/:id/claim',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, goals } = loaded;
      const computed = goals.find((goal) => goal.id === req.params.id);
      if (!computed) throw notFound('الهدف غير موجود');
      if (!computed.complete) throw badRequest('goal_not_complete', 'أكمل الهدف أولًا');
      const goal = mega.goals.find((item) => item.id === req.params.id);
      if (!goal) throw notFound('الهدف غير موجود');
      if (goal.claimedAt) return res.json({ ok: true, data: { claimed: false, alreadyClaimed: true, reward: goal.reward || null } });
      goal.claimedAt = nowIso();
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { claimed: true, reward: goal.reward || null } });
    })
  );

  // ---------- المفكرة والمزاج ----------
  router.post(
    '/mega/journal',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, today } = loaded;
      const body = req.body || {};
      const date = validDate(body.date) ? body.date : today;
      const note = text(body.note, 800);
      const wins = text(body.wins, 300);
      const lesson = text(body.lesson, 300);
      const mood = Number(body.mood);
      const energy = Number(body.energy);
      if (!note && !wins && !lesson && !(mood >= 1 && mood <= 5)) throw badRequest('empty_journal', 'اكتب سطرًا واحدًا على الأقل');
      const entry = {
        id: uid(),
        date,
        note,
        wins,
        lesson,
        mood: mood >= 1 && mood <= 5 ? Math.round(mood) : null,
        energy: energy >= 1 && energy <= 5 ? Math.round(energy) : null,
        createdAt: nowIso(),
      };
      mega.journal.push(entry);
      mega.journal = mega.journal.slice(-200);
      if (entry.mood || entry.energy) {
        mega.moods[date] = { mood: entry.mood || mega.moods[date]?.mood || null, energy: entry.energy || mega.moods[date]?.energy || null, at: nowIso() };
      }
      await saveMega(store, req.auth.user.id, state, mega);
      res.status(201).json({ ok: true, data: { entry } });
    })
  );

  router.delete(
    '/mega/journal/:id',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const before = mega.journal.length;
      mega.journal = mega.journal.filter((entry) => entry.id !== req.params.id);
      if (mega.journal.length === before) throw notFound('التدوينة غير موجودة');
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { deleted: true } });
    })
  );

  router.post(
    '/mega/mood',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, today } = loaded;
      const body = req.body || {};
      const date = validDate(body.date) ? body.date : today;
      const mood = Math.round(Number(body.mood));
      const energy = Math.round(Number(body.energy));
      if (!(mood >= 1 && mood <= 5) && !(energy >= 1 && energy <= 5)) throw badRequest('invalid_mood', 'اختر مزاجًا أو طاقة بين ١ و٥');
      mega.moods[date] = {
        mood: mood >= 1 && mood <= 5 ? mood : mega.moods[date]?.mood || null,
        energy: energy >= 1 && energy <= 5 ? energy : mega.moods[date]?.energy || null,
        at: nowIso(),
      };
      const keys = Object.keys(mega.moods).sort();
      if (keys.length > 365) for (const key of keys.slice(0, keys.length - 365)) delete mega.moods[key];
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { mood: mega.moods[date] } });
    })
  );

  router.post(
    '/mega/focus',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, today } = loaded;
      const body = req.body || {};
      const minutes = Math.max(1, Math.min(240, Math.round(Number(body.minutes) || mega.settings.focusMinutes || 25)));
      const routine = body.routineId ? state.routines.find((item) => item.id === body.routineId) : null;
      if (body.routineId && !routine) throw notFound('الروتين غير موجود');
      const session = {
        id: uid(),
        routineId: routine?.id || null,
        title: routine?.title || text(body.title, 80) || 'جلسة تركيز',
        minutes,
        date: today,
        createdAt: nowIso(),
      };
      mega.focus.push(session);
      mega.focus = mega.focus.slice(-200);
      await saveMega(store, req.auth.user.id, state, mega);
      res.status(201).json({ ok: true, data: { session } });
    })
  );

  router.post(
    '/mega/reviews',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, today } = loaded;
      const body = req.body || {};
      const period = REVIEW_PERIODS.has(body.period) ? body.period : 'weekly';
      const review = {
        id: uid(),
        period,
        date: validDate(body.date) ? body.date : today,
        wins: text(body.wins, 500),
        lessons: text(body.lessons, 500),
        next: text(body.next, 500),
        mood: Math.max(1, Math.min(5, Math.round(Number(body.mood) || 3))),
        createdAt: nowIso(),
      };
      if (!review.wins && !review.lessons && !review.next) throw badRequest('empty_review', 'اكتب انتصارًا أو درسًا أو خطوة تالية');
      mega.reviews.push(review);
      mega.reviews = mega.reviews.slice(-100);
      await saveMega(store, req.auth.user.id, state, mega);
      res.status(201).json({ ok: true, data: { review } });
    })
  );

  // ---------- المطالبة بالتحديات ----------
  router.post(
    '/mega/challenges/:id/claim',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, board } = loaded;
      const challenge = board.challenges.find((item) => item.id === req.params.id);
      if (!challenge) throw notFound('التحدي غير موجود');
      if (!challenge.claimable) throw badRequest('challenge_not_ready', 'لم يكتمل التحدي بعد أو تم استلامه');
      mega.challenges[challenge.id] = { claimedAt: nowIso() };
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { claimed: true, challenge: { ...challenge, claimedAt: mega.challenges[challenge.id].claimedAt } } });
    })
  );

  // ---------- القوالب ----------
  router.post(
    '/mega/templates',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const routine = state.routines.find((item) => item.id === req.body?.routineId);
      if (!routine) throw notFound('الروتين غير موجود');
      if (mega.templates.length >= 30) throw badRequest('too_many_templates', '٣٠ قالبًا كحد أقصى');
      const template = {
        id: uid(),
        name: text(req.body?.name, 80) || routine.title,
        routine: {
          title: routine.title,
          note: routine.note,
          icon: routine.icon,
          color: routine.color,
          time: routine.time,
          duration: routine.duration,
          days: routine.days,
          steps: routine.steps,
          anchor: routine.anchor,
          priority: routine.priority,
          energy: routine.energy,
          tags: routine.tags,
          ifThen: routine.ifThen,
          baseline: routine.baseline,
          environment: routine.environment,
          identity: routine.identity,
          reward: routine.reward,
        },
        createdAt: nowIso(),
      };
      mega.templates.push(template);
      await saveMega(store, req.auth.user.id, state, mega);
      res.status(201).json({ ok: true, data: { template } });
    })
  );

  router.delete(
    '/mega/templates/:id',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const before = mega.templates.length;
      mega.templates = mega.templates.filter((item) => item.id !== req.params.id);
      if (mega.templates.length === before) throw notFound('القالب غير موجود');
      await saveMega(store, req.auth.user.id, state, mega);
      res.json({ ok: true, data: { deleted: true } });
    })
  );

  router.post(
    '/mega/templates/:id/apply',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega } = loaded;
      const template = mega.templates.find((item) => item.id === req.params.id);
      if (!template) throw notFound('القالب غير موجود');
      const routine = await store.add(req.auth.user.id, { ...template.routine, title: template.routine.title, source: 'user' });
      res.status(201).json({ ok: true, data: { routine } });
    })
  );

  // ---------- المخطط التلقائي ----------
  router.post(
    '/mega/auto-plan',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, mega, today } = loaded;
      const mode = req.body?.mode || 'schedule';
      if (!['schedule', 'balance', 'focus', 'pause-low'].includes(mode)) throw badRequest('invalid_plan_mode', 'وضع المخطط غير معروف');
      const active = state.routines.filter((routine) => !routine.archivedAt);
      const changes = [];
      if (mode === 'pause-low') {
        const target = loaded.board.health
          .filter((item) => !item.pausedUntil && item.risk !== 'low')
          .sort((a, b) => (a.risk === 'high' ? -1 : 0) - (b.risk === 'high' ? -1 : 0) || a.rate - b.rate)[0];
        const routine = target ? active.find((item) => item.id === target.id) : null;
        if (routine) {
          routine.pausedUntil = addDays(today, 3);
          routine.updatedAt = nowIso();
          await store.write(req.auth.user.id, state);
        }
        return res.json({
          ok: true,
          data: {
            mode,
            changes: routine ? [{ id: routine.id, title: routine.title, pausedUntil: routine.pausedUntil, reason: 'استراحة تعافٍ' }] : [],
            message: routine ? `أخذ «${routine.title}» استراحة ٣ أيام — العودة أقوى.` : 'لا روتين متعثر يحتاج استراحة الآن.',
          },
        });
      }
      if (mode === 'focus') {
        return res.json({
          ok: true,
          data: {
            mode,
            changes: [],
            focus: loaded.board.health.filter((item) => item.risk !== 'low').slice(0, 3),
            message: 'اختر روتينًا واحدًا فقط وأعطه ٢٥ دقيقة اليوم.',
          },
        });
      }
      const used = new Set(active.filter((routine) => routine.time).map((routine) => routine.time));
      const start = parseTimeToMinutes(mega.settings.dayStart, 7 * 60);
      const end = parseTimeToMinutes(mega.settings.dayEnd, 23 * 60);
      let cursor = start;
      const nextSlot = () => {
        while (cursor < end) {
          const time = `${String(Math.floor(cursor / 60)).padStart(2, '0')}:${String(cursor % 60).padStart(2, '0')}`;
          cursor += 30;
          if (!used.has(time)) return time;
        }
        return null;
      };
      const candidates = active
        .filter((routine) => !routine.time && !(routine.pausedUntil && routine.pausedUntil >= today))
        .sort((a, b) => (a.priority === 'core' ? -1 : 0) - (b.priority === 'core' ? -1 : 0) || (a.energy === 'high' ? -1 : 0) - (b.energy === 'high' ? -1 : 0));
      if (mode === 'balance') {
        // حل التعارضات أولًا: إزاحة الروتين الثاني إلى أول فراغ لاحق.
        for (const conflict of loaded.board.conflicts) {
          const routine = active.find((item) => item.id === conflict.b.id);
          if (!routine) continue;
          const slot = nextSlot();
          if (!slot) break;
          routine.time = slot;
          routine.updatedAt = nowIso();
          changes.push({ id: routine.id, title: routine.title, from: conflict.b.time, to: slot, reason: 'حل تعارض' });
        }
      }
      for (const routine of candidates) {
        const slot = nextSlot();
        if (!slot) break;
        routine.time = slot;
        routine.updatedAt = nowIso();
        changes.push({ id: routine.id, title: routine.title, to: slot, reason: mode === 'balance' ? 'توزيع متوازن' : 'جدولة ذكية' });
      }
      if (changes.length) await store.write(req.auth.user.id, state);
      res.json({
        ok: true,
        data: {
          mode,
          changes,
          message: changes.length ? `جدولنا ${changes.length} روتينًا تلقائيًا.` : 'لا توجد روتينات تحتاج جدولة الآن.',
        },
      });
    })
  );

  // ---------- إجراءات جماعية ----------
  router.post(
    '/mega/batch',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, today } = loaded;
      const action = String(req.body?.action || '');
      if (!BATCH_ACTIONS.has(action)) throw badRequest('invalid_batch_action', 'إجراء جماعي غير معروف');
      const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : []).map(String).slice(0, 200));
      if (!ids.size) throw badRequest('empty_batch', 'اختر روتينًا واحدًا على الأقل');
      const value = req.body?.value;
      let changed = 0;
      for (const routine of state.routines) {
        if (!ids.has(routine.id)) continue;
        if (action === 'archive') routine.archivedAt = nowIso();
        else if (action === 'restore') routine.archivedAt = null;
        else if (action === 'favorite') routine.favorite = true;
        else if (action === 'unfavorite') routine.favorite = false;
        else if (action === 'pause') {
          const days = Math.max(1, Math.min(365, Math.round(Number(value) || 7)));
          routine.pausedUntil = addDays(today, days);
        } else if (action === 'resume') routine.pausedUntil = null;
        else if (action === 'priority') {
          if (!PRIORITIES.has(value)) throw badRequest('invalid_priority', 'الأولوية غير صالحة');
          routine.priority = value;
        } else if (action === 'energy') {
          if (!ENERGIES.has(value)) throw badRequest('invalid_energy', 'الطاقة غير صالحة');
          routine.energy = value;
        } else if (action === 'addTag' || action === 'removeTag') {
          const tag = text(value, 24);
          if (!tag) throw badRequest('invalid_tag', 'الوسم مطلوب');
          const tags = new Set(Array.isArray(routine.tags) ? routine.tags : []);
          if (action === 'addTag') tags.add(tag);
          else tags.delete(tag);
          routine.tags = [...tags].slice(0, 8);
        }
        routine.updatedAt = nowIso();
        changed += 1;
      }
      if (!changed) throw notFound('لا يوجد روتين مطابق');
      await store.write(req.auth.user.id, state);
      res.json({ ok: true, data: { action, changed } });
    })
  );

  // ---------- التصدير ----------
  router.get(
    '/mega/export',
    wrap(async (req, res) => {
      const loaded = await loadMega(store, req.auth.user.id);
      const { state, board, timeZone, today } = loaded;
      const format = ['json', 'ics', 'csv', 'md'].includes(req.query.format) ? req.query.format : 'json';
      const stamp = today.replace(/-/g, '');
      if (format === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="routines-${stamp}.json"`);
        return res.send(JSON.stringify({ version: 1, exportedAt: nowIso(), routines: state.routines, logs: state.logs, settings: state.settings, mega: state.mega }, null, 2));
      }
      if (format === 'ics') {
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="routines-${stamp}.ics"`);
        return res.send(buildIcs(state, timeZone, today));
      }
      if (format === 'csv') {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="routines-${stamp}.csv"`);
        return res.send(`\uFEFF${buildCsv(board)}`);
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="routines-${stamp}.md"`);
      return res.send(buildMarkdown(board, state));
    })
  );

  // ---------- الاستيراد ----------
  router.post(
    '/mega/import',
    guards.requireCsrf,
    writeLimit,
    wrap(async (req, res) => {
      const source = req.body?.data?.routines || req.body?.routines;
      if (!Array.isArray(source)) throw badRequest('invalid_import', 'ملف الاستيراد يجب أن يحتوي قائمة routines');
      if (source.length > 100) throw badRequest('too_many_routines', '١٠٠ روتين كحد أقصى في المرة');
      const state = await store.read(req.auth.user.id);
      const key = (value) => String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
      const existing = new Set(state.routines.map((routine) => key(routine.title)));
      const accepted = [];
      let skipped = 0;
      for (const raw of source) {
        const validated = validateRoutineInput(raw || {});
        if (Object.keys(validated.errors).length || !validated.value.title) {
          skipped += 1;
          continue;
        }
        if (existing.has(key(validated.value.title))) {
          skipped += 1;
          continue;
        }
        existing.add(key(validated.value.title));
        accepted.push({
          ...validated.value,
          source: 'user',
          tags: validated.value.tags || [],
          favorite: validated.value.favorite || false,
          pausedUntil: validated.value.pausedUntil || null,
          ifThen: validated.value.ifThen || '',
          baseline: validated.value.baseline || '',
          environment: validated.value.environment || '',
          identity: validated.value.identity || '',
          reward: validated.value.reward || '',
        });
      }
      const created = accepted.length ? await store.addMany(req.auth.user.id, accepted) : [];
      res.status(created.length ? 201 : 200).json({ ok: true, data: { created: created.length, skipped, routines: created.map((routine) => ({ id: routine.id, title: routine.title })) } });
    })
  );
}
