/**
 * خدمة إكمال الروتين — مصدر الحقيقة الوحيد لتغيير حالة اليوم.
 * ------------------------------------------------------------
 * تفصل منطق الإنجاز/التراجع/التخطي عن المسارات:
 *   • تكتب الحالة في سجل الأيام.
 *   • تحدّث تطور الروتين (XP/المستوى/المرحلة) في نفس الكتابة الذرّية.
 *   • تمنع ازدواج الإنجاز أو التراجع الخاطئ (idempotent).
 *   • تُرجع التطور قبل/بعد حتى تُطلق الواجهة والإشعارات الحدث الصحيح.
 */
import { applyDone, applyUndo, evolutionSummary, progressFor } from './evolution.js';

export { STAGES, XP_RULES, evolutionSummary, progressFor, stageForLevel } from './evolution.js';

export function createCompletionService({ store, logger = console } = {}) {
  if (!store) throw new Error('completion service requires routine store');

  /**
   * @param {object} input
   * @param {string} input.userId
   * @param {string} input.routineId
   * @param {string} input.day  YYYY-MM-DD
   * @param {'done'|'skipped'|null} input.status
   * @param {number} [input.now]
   * @returns {Promise<null|object>} null إذا لم يوجد الروتين
   */
  async function setStatus({ userId, routineId, day, status, now = Date.now() }) {
    const state = await store.read(userId);
    const routine = state.routines.find((r) => r.id === routineId);
    if (!routine) return null;

    const previousStatus = state.logs?.[day]?.[routineId] || null;
    const nowIso = new Date(now).toISOString();

    if (!state.logs[day]) state.logs[day] = {};
    if (status === null) delete state.logs[day][routineId];
    else state.logs[day][routineId] = status;
    if (Object.keys(state.logs[day]).length === 0) delete state.logs[day];

    let change = null;
    if (previousStatus !== 'done' && status === 'done') {
      change = applyDone(routine, { day, nowIso });
    } else if (previousStatus === 'done' && status !== 'done') {
      change = applyUndo(routine, { nowIso });
    } else {
      // لا تغيير في الإنجاز: نضمن أن التقدّم متسق مع السجل
      routine.progress = { ...progressFor(routine), doneCount: routine.progress?.doneCount || 0 };
    }

    routine.updatedAt = nowIso;
    await store.write(userId, state);

    const before = change?.before || progressFor(routine);
    const after = change?.after || progressFor(routine);
    const evolution = {
      changed: previousStatus !== status,
      previousStatus,
      status,
      before,
      after,
      leveledUp: Boolean(change?.evolved),
      devolved: Boolean(change?.devolved),
      stageChanged: before.stage !== after.stage,
    };

    logger.debug?.('routine_status_changed', {
      userId,
      routineId,
      day,
      from: previousStatus,
      to: status,
      level: after.level,
    });

    return { state, routine, evolution };
  }

  /** ملخص تطور المستخدم */
  function summary(routines) {
    return evolutionSummary(routines);
  }

  return { setStatus, summary, progressFor };
}
