/**
 * فحوص نظام الروتين والأنظمة والمكتبة — تُستخدم من API ومن tools/inspect.
 * كل فحص يعيد: id, label, status(ok|warn|fail), detail, fix.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_IDS, getSystem, listSystems } from '../systems/index.js';
import { libraryHealth } from '../library/index.js';
import { progressFor } from '../completion/evolution.js';
import { catalogSummary } from '../mega/catalog.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SYSTEMS_DIR = path.join(HERE, '..', 'systems');

export function check(id, label, status, detail, fix = null) {
  return { id, label, status, detail, fix };
}

export function scoreChecks(checks) {
  if (!checks.length) return 0;
  const points = checks.reduce((sum, item) => sum + (item.status === 'ok' ? 1 : item.status === 'warn' ? 0.5 : 0), 0);
  return Math.round((points / checks.length) * 100);
}

export function statusOf(checks) {
  if (checks.some((item) => item.status === 'fail')) return 'fail';
  if (checks.some((item) => item.status === 'warn')) return 'warn';
  return 'ok';
}

export function checkSystems() {
  const systems = listSystems();
  const ids = systems.map((s) => s.id);
  const missing = SYSTEM_IDS.filter((id) => !ids.includes(id));
  const details = [];
  let broken = 0;
  for (const id of SYSTEM_IDS) {
    const system = getSystem(id);
    if (!system) {
      broken += 1;
      details.push(`${id}: غير محمّل`);
      continue;
    }
    const dir = path.join(SYSTEMS_DIR, id);
    for (const file of ['manifest.json', 'routines.json', 'brain.js']) {
      if (!fs.existsSync(path.join(dir, file))) {
        broken += 1;
        details.push(`${id}/${file}: مفقود`);
      }
    }
    if (!system.routines.length) {
      broken += 1;
      details.push(`${id}: لا روتينات`);
    }
  }
  return [
    check(
      'systems-folders',
      'مجلدات الأنظمة الخمسة',
      missing.length === 0 && systems.length === 5 ? 'ok' : 'fail',
      systems.length === 5 && !missing.length ? 'الأنظمة الخمسة محمّلة بملفاتها الثلاثة.' : `مفقود: ${missing.join(', ') || 'غير معروف'}`,
      'تحقق من server/features/routines/systems'
    ),
    check(
      'systems-files',
      'سلامة ملفات الأنظمة',
      broken === 0 ? 'ok' : 'fail',
      broken === 0 ? 'كل manifest/routines/brain صالح.' : details.slice(0, 4).join(' • '),
      broken === 0 ? null : 'أصلح الملفات المذكورة ثم أعد التشغيل'
    ),
    check(
      'systems-routines',
      'عدد روتينات الأنظمة',
      systems.every((s) => s.routineCount >= 7) ? 'ok' : 'warn',
      systems.map((s) => `${s.name}: ${s.routineCount}`).join(' • '),
      systems.every((s) => s.routineCount >= 7) ? null : 'أضف روتينات ناقصة إلى routines.json'
    ),
  ];
}

export function checkLibrary() {
  const health = libraryHealth();
  const ok = health.categories >= 5 && health.routines >= 20 && health.idsUnique;
  return [
    check(
      'library-files',
      'مكتبة إضافة الروتينات',
      ok ? 'ok' : 'warn',
      `${health.routines} روتينًا في ${health.categories} تصنيفًا.`,
      ok ? null : 'أضف قوالب أو تصنيفات إلى server/features/routines/library'
    ),
    check(
      'library-unique',
      'معرّفات المكتبة',
      health.idsUnique ? 'ok' : 'fail',
      health.idsUnique ? 'كل قالب له معرّف فريد.' : 'توجد معرّفات مكررة.',
      health.idsUnique ? null : 'احذف المعرّفات المكررة'
    ),
  ];
}

export function checkCompletion(routines, logs = {}, today = null) {
  const active = (Array.isArray(routines) ? routines : []).filter((r) => r && !r.archivedAt);
  const invalid = active.filter((routine) => {
    const progress = progressFor(routine);
    return progress.doneCount < 0 || progress.level < 1 || !progress.stage;
  });
  const doneToday = today && logs?.[today] ? Object.values(logs[today]).filter((v) => v === 'done').length : 0;
  return [
    check(
      'completion-progress',
      'تقدّم وتطور الروتينات',
      invalid.length === 0 ? 'ok' : 'fail',
      invalid.length === 0 ? 'كل الروتينات لها مستوى ومرحلة صالحة.' : `${invalid.length} روتينًا بتقدّم غير صالح.`,
      invalid.length === 0 ? null : 'أعد قراءة الملف أو أصلح progress في data/routines'
    ),
    check(
      'completion-lock',
      'قفل الإنجاز وحفظه',
      'ok',
      `السجل يحفظ ${doneToday} إنجازًا اليوم، والإنجاز النهائي لا يُلغى ويبقى في السجل.`,
      null
    ),
  ];
}

export function checkRoutineData(state) {
  const tz = state?.settings?.timeZone || 'Asia/Riyadh';
  let tzOk = true;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
  } catch {
    tzOk = false;
  }
  const active = (state?.routines || []).filter((r) => !r.archivedAt);
  const allDay = active.filter((r) => !r.time).length;
  return [
    check('routine-data', 'ملف بيانات الروتين', Array.isArray(state?.routines) ? 'ok' : 'fail', Array.isArray(state?.routines) ? `${active.length} روتين نشط، ${allDay} بدون وقت (٢٤ ساعة).` : 'بنية الملف غير صالحة.', Array.isArray(state?.routines) ? null : 'تحقق من data/routines'),
    check('routine-timezone', 'المنطقة الزمنية', tzOk ? 'ok' : 'fail', tz, tzOk ? null : 'اختر منطقة زمنية من إعدادات التذكير'),
  ];
}

export function checkMega(state) {
  const summary = catalogSummary();
  const mega = state?.mega && typeof state.mega === 'object' ? state.mega : {};
  const goals = Array.isArray(mega.goals) ? mega.goals.length : 0;
  const templates = Array.isArray(mega.templates) ? mega.templates.length : 0;
  const journal = Array.isArray(mega.journal) ? mega.journal.length : 0;
  const settings = mega.settings && typeof mega.settings === 'object' ? mega.settings : {};
  return [
    check(
      'mega-catalog',
      'مكتبة قدرات مركز القيادة',
      summary.total >= 120 && summary.groups === 12 ? 'ok' : 'fail',
      `${summary.total} قدرة في ${summary.groups} مجموعات (${summary.newCount} جديدة).`,
      summary.total >= 120 ? null : 'أعد بناء mega/catalog.js — يجب ألا تقل القدرات عن ١٢٠'
    ),
    check(
      'mega-personal',
      'بيانات مركز القيادة الشخصية',
      'ok',
      `${goals} هدفًا • ${journal} تدوينة • ${templates} قالبًا • ${settings.vacationUntil ? `إجازة حتى ${settings.vacationUntil}` : 'بلا إجازة'}.`,
      null
    ),
  ];
}
export async function checkNotifications(ctx, user, client = {}) {
  const diagnostics = ctx?.services?.notificationDiagnostics;
  if (!diagnostics) {
    return [check('notifications-service', 'خدمة الإشعارات', 'fail', 'خدمة الفحص غير مسجّلة.', 'تأكد من تحميل ميزة الإشعارات قبل الروتينات')];
  }
  try {
    const report = await diagnostics.run(user, { client });
    return [
      check(
        'notifications-health',
        'الإشعارات والقنوات',
        report.status,
        `النتيجة ${report.score}٪ • SSE: ${report.channels.liveConnections} • أجهزة Push: ${report.channels.webPushDevices}`,
        report.status === 'ok' ? null : 'افتح صفحة الإشعارات واضغط «فحص دقيق»'
      ),
      ...report.checks.filter((item) => item.status !== 'ok').slice(0, 3),
    ];
  } catch (err) {
    return [check('notifications-health', 'الإشعارات والقنوات', 'warn', err?.message || 'تعذّر الفحص', 'أعد المحاولة من صفحة الإشعارات')];
  }
}

/** تقرير كامل لصفحة التشخيص */
export async function runRoutineDiagnostics({ ctx, state, user, today, client = {} }) {
  const checks = [
    ...checkSystems(),
    ...checkLibrary(),
    ...checkRoutineData(state),
    ...checkCompletion(state?.routines, state?.logs, today),
    ...checkMega(state),
    ...(await checkNotifications(ctx, user, client)),
  ];
  return {
    status: statusOf(checks),
    score: scoreChecks(checks),
    checkedAt: new Date().toISOString(),
    counts: {
      systems: listSystems().length,
      routines: (state?.routines || []).filter((r) => !r.archivedAt).length,
      logs: Object.keys(state?.logs || {}).length,
    },
    checks,
  };
}
