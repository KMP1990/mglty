/**
 * سجل أنظمة الروتين — ٥ أنظمة متكاملة، كل نظام في مجلد مستقل:
 *   systems/<id>/manifest.json   ← هوية النظام وأهدافه ومراحله
 *   systems/<id>/routines.json   ← ملفات الروتينات (بخطوات صغيرة ومحفّز)
 *   systems/<id>/brain.js        ← عقل النظام: تحليل مخصص يقرأ سجل المستخدم
 *
 * كل شيء يُتحقق عند التحميل، وأي ملف تالف لا يُسقط بقية الأنظمة.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { COLORS, ICONS, sanitizeDays } from '../validate.js';
import { buildMetrics, clamp, ENERGY_LEVELS, normalizeTitle, PRIORITIES } from './engine.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.join(process.cwd(), 'server', 'features', 'routines', 'systems');
const HERE = fs.existsSync(PROJECT_DIR) ? PROJECT_DIR : MODULE_DIR;
export const SYSTEM_IDS = Object.freeze(['deep-focus', 'energy', 'calm', 'builder', 'balance']);
const INTENSITIES = ['full', 'core', 'light'];

const systemCache = new Map();
const brainCache = new Map();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[routines/systems] تعذّر قراءة الملف', file, err?.message || err);
    return null;
  }
}

const cleanText = (value, max = 300) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function normalizeManifest(id, raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.id !== id) {
    console.warn('[routines/systems] معرّف غير مطابق للمجلد', { id, manifestId: raw.id });
    return null;
  }
  const name = cleanText(raw.name, 80);
  if (name.length < 2) return null;

  return {
    id,
    name,
    tagline: cleanText(raw.tagline, 160),
    description: cleanText(raw.description, 600),
    icon: ICONS.includes(raw.icon) ? raw.icon : 'sparkles',
    color: COLORS.includes(raw.color) ? raw.color : 'rose',
    level: cleanText(raw.level, 30) || 'متوسط',
    durationDays: Math.min(365, Math.max(1, Number(raw.durationDays) || 21)),
    tags: Array.isArray(raw.tags) ? raw.tags.map((t) => cleanText(t, 30)).filter(Boolean).slice(0, 6) : [],
    bestFor: cleanText(raw.bestFor, 220),
    principles: Array.isArray(raw.principles) ? raw.principles.map((p) => cleanText(p, 220)).filter(Boolean).slice(0, 5) : [],
    stages: Array.isArray(raw.stages)
      ? raw.stages
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({
            id: cleanText(s.id, 30),
            name: cleanText(s.name, 60),
            days: cleanText(s.days, 20),
            focus: cleanText(s.focus, 200),
          }))
          .filter((s) => s.name)
          .slice(0, 5)
      : [],
  };
}

function normalizeRoutine(system, item, index) {
  if (!item || typeof item !== 'object') return null;
  const title = cleanText(item.title, 80);
  if (title.length < 2 || title.length > 80) return null;
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(item.time || '')) ? String(item.time) : null;
  const duration = Number.isFinite(Number(item.duration)) ? clamp(Number(item.duration), 1, 480) : null;
  if (duration == null) return null;

  const key = cleanText(item.key, 40).replace(/[^a-zA-Z0-9-]/g, '') || `routine-${index + 1}`;
  return {
    key,
    title,
    note: cleanText(item.note, 300),
    icon: ICONS.includes(item.icon) ? item.icon : 'sparkles',
    color: COLORS.includes(item.color) ? item.color : 'rose',
    time,
    duration,
    days: sanitizeDays(item.days),
    priority: PRIORITIES.includes(item.priority) ? item.priority : 'support',
    energy: ENERGY_LEVELS.includes(item.energy) ? item.energy : 'medium',
    anchor: cleanText(item.anchor, 80),
    steps: Array.isArray(item.steps) ? item.steps.map((s) => cleanText(s, 120)).filter(Boolean).slice(0, 6) : [],
    why: cleanText(item.why, 200),
    systemId: system.id,
    systemName: system.name,
    systemKey: key,
    source: 'system',
  };
}

/** يقرأ نظامًا واحدًا (مع تخزين مؤقت) — null إن كان المجلد أو الملف تالفًا */
export function getSystem(id) {
  if (!SYSTEM_IDS.includes(id)) return null;
  if (systemCache.has(id)) return systemCache.get(id);

  const dir = path.join(HERE, id);
  const manifest = normalizeManifest(id, readJson(path.join(dir, 'manifest.json')));
  if (!manifest) return null;

  const routinesRaw = readJson(path.join(dir, 'routines.json'));
  const list = Array.isArray(routinesRaw?.routines) ? routinesRaw.routines : Array.isArray(routinesRaw) ? routinesRaw : [];
  const routines = list.map((item, index) => normalizeRoutine(manifest, item, index)).filter(Boolean);

  if (routines.length === 0) {
    console.warn('[routines/systems] لا روتينات صالحة في النظام', id);
    return null;
  }

  const system = {
    ...manifest,
    estimatedMinutes: routines.reduce((sum, r) => sum + r.duration, 0),
    routines,
    routineCount: routines.length,
    coreCount: routines.filter((r) => r.priority === 'core').length,
  };
  systemCache.set(id, system);
  return system;
}

/** ملخص كل الأنظمة — بلا تفاصيل الروتينات (خفيف للقائمة) */
export function listSystems() {
  return SYSTEM_IDS.map((id) => getSystem(id))
    .filter(Boolean)
    .map((system) => ({
      id: system.id,
      name: system.name,
      tagline: system.tagline,
      description: system.description,
      icon: system.icon,
      color: system.color,
      level: system.level,
      durationDays: system.durationDays,
      estimatedMinutes: system.estimatedMinutes,
      routineCount: system.routineCount,
      coreCount: system.coreCount,
      tags: system.tags,
      bestFor: system.bestFor,
      principles: system.principles,
      stages: system.stages,
      preview: system.routines.map((routine) => ({
        title: routine.title,
        time: routine.time,
        duration: routine.duration,
        priority: routine.priority,
      })),
    }));
}

async function getBrain(id) {
  if (brainCache.has(id)) return brainCache.get(id);
  const file = path.join(HERE, id, 'brain.js');
  try {
    const mod = await import(pathToFileURL(file).href);
    const brain = mod?.default && typeof mod.default.evaluate === 'function' ? mod.default : null;
    brainCache.set(id, brain);
    return brain;
  } catch (err) {
    console.warn('[routines/systems] تعذّر تحميل عقل النظام', id, err?.message || err);
    brainCache.set(id, null);
    return null;
  }
}

function appliedSnapshot(system, { routines, logs, today }) {
  const active = (Array.isArray(routines) ? routines : []).filter((r) => r && !r.archivedAt);
  const applied = active.filter((r) => r.systemId === system.id);
  const dayLog = logs?.[today] || {};
  const doneToday = applied.filter((r) => dayLog[r.id] === 'done').length;
  return {
    count: applied.length,
    total: system.routineCount,
    doneToday,
    percent: applied.length ? Math.round((doneToday / applied.length) * 100) : 0,
    active: applied.map((r) => ({
      id: r.id,
      title: r.title,
      time: r.time || null,
      duration: r.duration || null,
      status: dayLog[r.id] || null,
    })),
  };
}

/**
 * تقييم نظام واحد مقابل بيانات المستخدم.
 * @returns {Promise<object>} تقرير موحّد جاهز للواجهة أو للتوصية.
 */
export async function evaluateSystem(system, ctx) {
  if (!system) return null;
  const brain = await getBrain(system.id);
  const metrics = buildMetrics(ctx);
  let review = null;
  if (brain) {
    try {
      review = brain.evaluate({ ...ctx, system, metrics });
    } catch (err) {
      console.warn('[routines/systems] عقل النظام فشل', system.id, err?.message || err);
    }
  }

  const score = clamp(review?.score ?? 48, 18, 98);
  const verdict = review?.verdict || (score >= 74 ? 'strong' : score >= 46 ? 'partial' : 'empty');
  return {
    id: system.id,
    name: system.name,
    tagline: system.tagline,
    icon: system.icon,
    color: system.color,
    level: system.level,
    durationDays: system.durationDays,
    routineCount: system.routineCount,
    coreCount: system.coreCount,
    score,
    verdict,
    headline: cleanText(review?.headline, 400) || system.tagline,
    signals: Array.isArray(review?.signals) ? review.signals.slice(0, 4) : [],
    nextSteps: Array.isArray(review?.nextSteps) ? review.nextSteps.filter(Boolean).slice(0, 2) : [],
    applied: appliedSnapshot(system, ctx),
    metrics: {
      activeCount: metrics.activeCount,
      completion: metrics.completion,
      overdue: metrics.overdue,
      todayDone: metrics.today.done,
      todayTotal: metrics.today.total,
    },
  };
}

/** تقييم كل الأنظمة مرتّبة بالأولوية */
export async function evaluateAll(ctx) {
  const systems = SYSTEM_IDS.map((id) => getSystem(id)).filter(Boolean);
  const reviews = await Promise.all(systems.map((system) => evaluateSystem(system, ctx)));
  return reviews.filter(Boolean).sort((a, b) => b.score - a.score);
}

/** أفضل نظامين مع سبب التوصية */
export async function recommendSystems(ctx, limit = 2) {
  const reviews = await evaluateAll(ctx);
  return reviews.slice(0, Math.max(1, limit));
}

/** هل هذا النظام مفعّل عند المستخدم؟ */
export function isSystemApplied(systemId, routines) {
  return (Array.isArray(routines) ? routines : []).some((r) => r && !r.archivedAt && r.systemId === systemId);
}

/**
 * يجهّز روتينات النظام للإضافة: يمنع التكرار داخل النظام وخارجه.
 * intensity: full (كل النظام) | core (الأساسيات) | light (أول ٤ أساسيات)
 */
export function planSystemRoutines(system, { intensity = 'full', existing = [] } = {}) {
  const mode = INTENSITIES.includes(intensity) ? intensity : 'full';
  let pool = system.routines;
  if (mode === 'core') pool = pool.filter((r) => r.priority === 'core');
  else if (mode === 'light') pool = pool.filter((r) => r.priority === 'core').slice(0, 4);

  const taken = new Set(
    (Array.isArray(existing) ? existing : [])
      .filter((r) => r && !r.archivedAt)
      .map((r) => normalizeTitle(r.title))
  );

  const routines = [];
  const skipped = [];
  for (const routine of pool) {
    const key = normalizeTitle(routine.title);
    if (!key || taken.has(key)) {
      skipped.push({ title: routine.title, reason: key ? 'already_exists' : 'invalid_title' });
      continue;
    }
    taken.add(key);
    routines.push(routine);
  }
  return { mode, routines, skipped };
}

export { normalizeTitle };
