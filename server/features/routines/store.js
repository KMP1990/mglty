/**
 * مخزن الروتينات — ملف لكل مستخدم: data/routines/<userId>.json
 * الشكل:
 * {
 *   version: 1,
 *   settings: { timeZone, reminders: { enabled, eveningNudge, morningPlan } },
 *   routines: [{ id, title, note, icon, color, time, duration, days[],\n *               steps[], anchor, priority, energy, systemId, systemName, createdAt, archivedAt }],
 *   logs: { "YYYY-MM-DD": { [routineId]: "done" | "skipped" } },
 *   planned: "YYYY-MM-DD"   // آخر يوم وُلّدت فيه خطة الذكاء الاصطناعي
 * }
 * كل كتابة ذرّية مع نسخة احتياطية (shared/atomic.js).
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonSafe, writeJsonSafe } from '../../shared/store.js';
import { ENERGY_LEVELS, PRIORITIES } from './validate.js';
import { hydrateProgress, progressFor } from './completion/evolution.js';

const LOG_RETENTION_DAYS = 400;
const clampText = (value, max) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

/** يبني روتينًا كاملًا من أي مصدر (مستخدم / مدرب / نظام جاهز) */
function makeRoutine(input = {}, nowIso = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    title: input.title,
    note: input.note || '',
    icon: input.icon || 'sparkles',
    color: input.color || 'rose',
    time: input.time || null,
    duration: input.duration || null,
    days: Array.isArray(input.days) ? input.days : [],
    steps: Array.isArray(input.steps) ? input.steps.map((s) => clampText(s, 120)).filter(Boolean).slice(0, 6) : [],
    anchor: clampText(input.anchor, 80),
    priority: PRIORITIES.includes(input.priority) ? input.priority : 'support',
    energy: ENERGY_LEVELS.includes(input.energy) ? input.energy : 'medium',
    tags: Array.isArray(input.tags) ? input.tags.map((tag) => clampText(tag, 24)).filter(Boolean).slice(0, 8) : [],
    favorite: input.favorite === true,
    pausedUntil: /^\d{4}-\d{2}-\d{2}$/.test(String(input.pausedUntil || '')) ? input.pausedUntil : null,
    ifThen: clampText(input.ifThen, 160),
    identity: clampText(input.identity, 120),
    reward: clampText(input.reward, 120),
    baseline: clampText(input.baseline, 160),
    environment: clampText(input.environment, 160),
    systemId: typeof input.systemId === 'string' ? input.systemId : null,
    systemName: typeof input.systemName === 'string' ? clampText(input.systemName, 80) : null,
    systemKey: typeof input.systemKey === 'string' ? clampText(input.systemKey, 40) : null,
    source: input.source === 'coach' ? 'coach' : input.source === 'system' ? 'system' : 'user',
    progress: progressFor({ priority: input.priority }),
    createdAt: nowIso,
    updatedAt: nowIso,
    archivedAt: null,
  };
}

export const emptyState = () => ({
  version: 1,
  settings: {
    timeZone: 'Asia/Riyadh',
    reminders: { enabled: true, eveningNudge: true, morningPlan: true },
  },
  routines: [],
  logs: {},
  milestones: {},
  mega: {},
  planned: null,
});

export function createRoutineStore(config) {
  const dir = path.join(config.dataDir, 'routines');
  const filePath = (userId) => path.join(dir, `${userId}.json`);

  async function read(userId) {
    const raw = await readJsonSafe(filePath(userId), null);
    if (!raw || !Array.isArray(raw.routines)) return emptyState();
    const state = { ...emptyState(), ...raw, settings: { ...emptyState().settings, ...(raw.settings || {}) } };
    // ترحيل شفاف: روتينات قديمة بلا تطور تُحسب من سجل الإنجاز الحقيقي
    state.routines = raw.routines.map((routine) => {
      const migrated = hydrateProgress({ ...routine }, state.logs);
      if (!Array.isArray(migrated.tags)) migrated.tags = [];
      if (typeof migrated.favorite !== 'boolean') migrated.favorite = false;
      if (!migrated.pausedUntil) migrated.pausedUntil = null;
      return migrated;
    });
    return state;
  }

  async function write(userId, state) {
    // تقليم سجل الأيام القديم كي لا ينمو الملف بلا حدود
    const cutoff = new Date(Date.now() - LOG_RETENTION_DAYS * 86400000).toISOString().slice(0, 10);
    const logs = {};
    for (const [day, value] of Object.entries(state.logs || {})) if (day >= cutoff) logs[day] = value;
    await writeJsonSafe(filePath(userId), { ...state, logs });
  }

  return {
    read,
    write,
    filePath,

    /** حالة اليوم وما يسبقه — تُستخدم للخطة والعرض */
    async snapshot(userId) {
      return read(userId);
    },

    async list(userId, { includeArchived = false } = {}) {
      const state = await read(userId);
      return includeArchived ? state.routines : state.routines.filter((r) => !r.archivedAt);
    },

    async add(userId, input) {
      const state = await read(userId);
      const routine = makeRoutine(input);
      state.routines.push(routine);
      await write(userId, state);
      return routine;
    },

    /** إضافة دفعة أنظمة كاملة بكتابة واحدة — أسرع وأقل عرضة للانقطاع */
    async addMany(userId, inputs) {
      const list = Array.isArray(inputs) ? inputs : [];
      if (!list.length) return [];
      const state = await read(userId);
      const nowIso = new Date().toISOString();
      const created = list.map((input) => makeRoutine(input, nowIso));
      state.routines.push(...created);
      await write(userId, state);
      return created;
    },

    /** أرشفة كل الروتينات النشطة (يُستخدم عند استبدالها بنظام جديد) */
    async archiveAll(userId) {
      const state = await read(userId);
      const nowIso = new Date().toISOString();
      let count = 0;
      for (const routine of state.routines) {
        if (routine.archivedAt) continue;
        routine.archivedAt = nowIso;
        routine.updatedAt = nowIso;
        count += 1;
      }
      if (count) await write(userId, state);
      return count;
    },

    async update(userId, id, patch) {
      const state = await read(userId);
      const routine = state.routines.find((r) => r.id === id);
      if (!routine) return null;
      const allowed = ['title', 'note', 'icon', 'color', 'time', 'duration', 'days', 'steps', 'anchor', 'priority', 'energy', 'tags', 'favorite', 'pausedUntil', 'ifThen', 'identity', 'reward', 'baseline', 'environment', 'order', 'archivedAt'];
      for (const key of allowed) if (patch[key] !== undefined) routine[key] = patch[key];
      routine.updatedAt = new Date().toISOString();
      await write(userId, state);
      return routine;
    },

    async remove(userId, id) {
      const state = await read(userId);
      const before = state.routines.length;
      state.routines = state.routines.filter((r) => r.id !== id);
      if (before === state.routines.length) return false;
      // نحذف آثار الروتين من سجل الأيام
      for (const day of Object.keys(state.logs)) {
        delete state.logs[day]?.[id];
        if (Object.keys(state.logs[day] || {}).length === 0) delete state.logs[day];
      }
      await write(userId, state);
      return true;
    },

    /** يعيد true مرة واحدة فقط لكل إنجاز (سلسلة 7/14/30...) حتى لا يتكرر الإشعار */
    async markMilestone(userId, key) {
      const state = await read(userId);
      state.milestones = state.milestones && typeof state.milestones === 'object' ? state.milestones : {};
      if (state.milestones[key]) return false;
      state.milestones[key] = new Date().toISOString();
      await write(userId, state);
      return true;
    },

    /** تسجيل حالة يوم: done | skipped | null (إلغاء) */
    async setLog(userId, id, day, status) {
      const state = await read(userId);
      const routine = state.routines.find((r) => r.id === id);
      if (!routine) return null;
      if (!state.logs[day]) state.logs[day] = {};
      if (status === null) delete state.logs[day][id];
      else state.logs[day][id] = status;
      if (Object.keys(state.logs[day]).length === 0) delete state.logs[day];
      await write(userId, state);
      return state;
    },

    async updateSettings(userId, patch) {
      const state = await read(userId);
      state.settings = {
        ...state.settings,
        ...patch,
        reminders: { ...state.settings.reminders, ...(patch.reminders || {}) },
      };
      await write(userId, state);
      return state.settings;
    },

    async replaceRoutines(userId, routines) {
      const state = await read(userId);
      state.routines = routines;
      await write(userId, state);
      return state;
    },

    async markPlanned(userId, day) {
      const state = await read(userId);
      state.planned = day;
      await write(userId, state);
      return state;
    },

    /** للخادم: هل لدى المستخدم روتينات أصلًا؟ */
    async hasAny(userId) {
      const state = await read(userId);
      return state.routines.some((r) => !r.archivedAt);
    },
  };
}
