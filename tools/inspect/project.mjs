/**
 * فحص بنية المشروع — ملفات أساسية، مجلدات الميزات، وتكامل الوحدات.
 * لا يحتاج خادمًا ولا شبكة. يُستخدم من tools/inspect/index.mjs.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const REQUIRED = [
  'server/index.js',
  'server/app.js',
  'server/features/auth/index.js',
  'server/features/notifications/index.js',
  'server/features/notifications/diagnostics.js',
  'server/features/routines/index.js',
  'server/features/routines/completion/index.js',
  'server/features/routines/completion/evolution.js',
  'server/features/routines/library/index.js',
  'server/features/routines/systems/index.js',
  'server/features/routines/health/checks.js',
  'public/features/routines/routines.js',
  'public/features/routines/routine-sheet.js',
  'public/features/routines/systems-sheet.js',
  'public/features/routines/evolution.js',
  'public/features/notifications/inspect/diagnostics.js',
  'public/features/notifications/notifications.js',
];

const ROUTINE_DIRS = [
  'server/features/routines/completion',
  'server/features/routines/library',
  'server/features/routines/systems',
  'server/features/routines/health',
  'tools/inspect',
  'public/features/notifications/inspect',
];

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

export async function inspectProject() {
  const missing = [];
  for (const file of REQUIRED) {
    if (!(await exists(path.join(ROOT, file)))) missing.push(file);
  }
  const missingDirs = [];
  for (const dir of ROUTINE_DIRS) {
    if (!(await exists(path.join(ROOT, dir)))) missingDirs.push(dir);
  }
  const checks = [
    {
      id: 'project-required',
      label: 'الملفات الأساسية',
      status: missing.length ? 'fail' : 'ok',
      detail: missing.length ? `مفقود: ${missing.join(', ')}` : `${REQUIRED.length} ملفًا أساسيًا موجود.`,
      fix: missing.length ? 'أعد الملفات المفقودة أو تحقق من المسارات' : null,
    },
    {
      id: 'project-folders',
      label: 'مجلدات الأنظمة والفحص',
      status: missingDirs.length ? 'fail' : 'ok',
      detail: missingDirs.length ? `مفقود: ${missingDirs.join(', ')}` : `${ROUTINE_DIRS.length} مجلدًا متخصصًا موجود.`,
      fix: missingDirs.length ? 'أنشئ المجلد الناقص' : null,
    },
    {
      id: 'project-style',
      label: 'واجهة الروتين',
      status: (await exists(path.join(ROOT, 'public/features/routines/routines.css'))) ? 'ok' : 'warn',
      detail: 'ورقة الأنماط والحركات موجودة.',
      fix: null,
    },
  ];
  return checks;
}
