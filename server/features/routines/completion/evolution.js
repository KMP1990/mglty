/**
 * تطور الروتين — قلب نظام الإكمال.
 * ------------------------------------------------------------
 * كل إنجاز يمنح الروتين خبرة (XP)، وكل مستوى يفتح مرحلة جديدة:
 *   بذرة → برعم → نمو → إزهار → إتقان → أسطورة
 * الخبرة تُحسب من عدد الإنجازات (لا أرقام عشوائية). الإنجاز نهائي عبر
 * الواجهة والـAPI؛ applyUndo محفوظ فقط لأدوات الإصلاح الإدارية.
 */

export const XP_RULES = {
  core: 14,
  support: 11,
  bonus: 8,
};

export const STAGES = [
  { id: 'seed', name: 'بذرة', emoji: '🌱', icon: 'leaf', color: 'sand', minLevel: 1 },
  { id: 'sprout', name: 'برعم', emoji: '🌿', icon: 'leaf', color: 'mint', minLevel: 3 },
  { id: 'grow', name: 'نمو', emoji: '🌳', icon: 'leaf', color: 'mint', minLevel: 5 },
  { id: 'bloom', name: 'إزهار', emoji: '🌸', icon: 'sparkles', color: 'rose', minLevel: 7 },
  { id: 'master', name: 'إتقان', emoji: '🏆', icon: 'heart', color: 'honey', minLevel: 9 },
  { id: 'legend', name: 'أسطورة', emoji: '✨', icon: 'sparkles', color: 'lilac', minLevel: 12 },
];

const MAX_LEVEL = 99;

export function stageForLevel(level) {
  const safe = Math.max(1, Math.floor(Number(level) || 1));
  return [...STAGES].reverse().find((stage) => safe >= stage.minLevel) || STAGES[0];
}

export function xpForCount(doneCount, priority = 'support') {
  const per = XP_RULES[priority] || XP_RULES.support;
  return Math.max(0, Math.floor(Number(doneCount) || 0)) * per;
}

/** عتبة المستوى تنمو تدريجيًا حتى يبقى التطور ممكنًا بلا تضخّم */
export function levelCurve(xp) {
  let level = 1;
  let need = 30;
  let remaining = Math.max(0, Math.floor(Number(xp) || 0));
  while (remaining >= need && level < MAX_LEVEL) {
    remaining -= need;
    level += 1;
    need = Math.round(need * 1.35);
  }
  return { level, into: remaining, need };
}

/** يحوّل تقدّمًا مخزّنًا أو عدد إنجازات إلى بنية تطور كاملة */
export function progressFor(routine = {}) {
  const stored = routine.progress && typeof routine.progress === 'object' ? routine.progress : {};
  const doneCount = Math.max(0, Math.floor(Number(stored.doneCount) || 0));
  const xp = xpForCount(doneCount, routine.priority);
  const curve = levelCurve(xp);
  const stage = stageForLevel(curve.level);
  return {
    doneCount,
    xp,
    level: curve.level,
    xpIntoLevel: curve.into,
    xpForNext: curve.need,
    percent: curve.need ? Math.min(100, Math.round((curve.into / curve.need) * 100)) : 100,
    stage: stage.id,
    stageName: stage.name,
    stageEmoji: stage.emoji,
    stageColor: stage.color,
    nextStage: STAGES.find((s) => s.minLevel > curve.level) || null,
    firstDoneAt: stored.firstDoneAt || null,
    lastDoneAt: stored.lastDoneAt || null,
    lastDoneDay: stored.lastDoneDay || null,
  };
}

/** ترحيل آمن لبيانات قديمة: يحسب عدد الإنجازات من السجل إن لم يكن محفوظًا */
export function hydrateProgress(routine, logs = {}) {
  if (routine.progress && Number.isFinite(Number(routine.progress.doneCount))) {
    const stored = routine.progress;
    const doneCount = Math.max(0, Math.floor(Number(stored.doneCount) || 0));
    routine.progress = {
      ...progressFor({ ...routine, progress: { doneCount } }),
      firstDoneAt: stored.firstDoneAt || null,
      lastDoneAt: stored.lastDoneAt || null,
      lastDoneDay: stored.lastDoneDay || null,
      lastUndoneAt: stored.lastUndoneAt || null,
    };
    return routine;
  }
  let doneCount = 0;
  let firstDoneAt = null;
  let lastDoneAt = null;
  let lastDoneDay = null;
  for (const [day, entry] of Object.entries(logs || {})) {
    if (entry?.[routine.id] !== 'done') continue;
    doneCount += 1;
    if (!lastDoneDay || day > lastDoneDay) lastDoneDay = day;
  }
  routine.progress = { ...progressFor({ ...routine, progress: { doneCount } }), firstDoneAt, lastDoneAt, lastDoneDay };
  return routine;
}

/** إنجاز جديد: يزيد العدّاد ويعيد التطور قبل/بعد */
export function applyDone(routine, { day, nowIso = new Date().toISOString() } = {}) {
  const before = progressFor(routine);
  const count = before.doneCount + 1;
  routine.progress = {
    ...progressFor({ ...routine, progress: { doneCount: count } }),
    doneCount: count,
    firstDoneAt: routine.progress?.firstDoneAt || nowIso,
    lastDoneAt: nowIso,
    lastDoneDay: day || null,
  };
  return { before, after: progressFor(routine), evolved: progressFor(routine).level > before.level };
}

/** تراجع عن إنجاز: ينقص العدّاد ويعيد الحالة السابقة بدقة */
export function applyUndo(routine, { nowIso = new Date().toISOString() } = {}) {
  const before = progressFor(routine);
  const count = Math.max(0, before.doneCount - 1);
  routine.progress = {
    ...progressFor({ ...routine, progress: { doneCount: count } }),
    doneCount: count,
    firstDoneAt: count === 0 ? null : routine.progress?.firstDoneAt || null,
    lastDoneAt: count === 0 ? null : routine.progress?.lastDoneAt || null,
    lastDoneDay: count === 0 ? null : routine.progress?.lastDoneDay || null,
    lastUndoneAt: nowIso,
  };
  return { before, after: progressFor(routine), devolved: progressFor(routine).level < before.level };
}

/** ملخص تطور لكل الروتينات — يظهر في اللوحة والمدرب */
export function evolutionSummary(routines) {
  const active = (Array.isArray(routines) ? routines : []).filter((r) => r && !r.archivedAt);
  const totalXp = active.reduce((sum, r) => sum + progressFor(r).xp, 0);
  const totalDone = active.reduce((sum, r) => sum + progressFor(r).doneCount, 0);
  const top = [...active]
    .map((r) => ({ id: r.id, title: r.title, icon: r.icon, color: r.color, ...progressFor(r) }))
    .sort((a, b) => b.level - a.level || b.xp - a.xp)
    .slice(0, 3);
  const overall = levelCurve(totalXp);
  const stage = stageForLevel(overall.level);
  return {
    totalXp,
    totalDone,
    level: overall.level,
    xpIntoLevel: overall.into,
    xpForNext: overall.need,
    percent: overall.need ? Math.min(100, Math.round((overall.into / overall.need) * 100)) : 100,
    stage: stage.id,
    stageName: stage.name,
    stageEmoji: stage.emoji,
    top,
  };
}
