/**
 * فحص أنظمة الروتين والمكتبة وبيانات المستخدمين على القرص.
 * يقرأ data/routines/*.json ويتحقق من التطور والبنية دون تشغيل الخادم.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLibrary, checkRoutineData, checkSystems, checkCompletion, checkMega } from '../../server/features/routines/health/checks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = path.join(ROOT, 'data');

async function readRoutineStates() {
  try {
    const files = (await fs.readdir(path.join(DATA, 'routines'))).filter((f) => /^[a-f0-9]{24}\.json$/.test(f));
    const states = [];
    for (const file of files) {
      try {
        states.push(JSON.parse(await fs.readFile(path.join(DATA, 'routines', file), 'utf8')));
      } catch {
        /* ملف تالف يُبلغ عنه أدناه */
      }
    }
    return { files: files.length, states };
  } catch {
    return { files: 0, states: [] };
  }
}

export async function inspectRoutines() {
  const { files, states } = await readRoutineStates();
  const checks = [...checkSystems(), ...checkLibrary(), ...checkMega(null)];

  if (!states.length) {
    checks.push({
      id: 'routines-data',
      label: 'بيانات الروتين',
      status: files ? 'warn' : 'ok',
      detail: files ? `${files} ملفًا موجودًا لكن تعذّرت قراءته.` : 'لا مستخدمين محليين بعد — هذا طبيعي في بيئة جديدة.',
      fix: null,
    });
    return checks;
  }

  for (const [index, state] of states.entries()) {
    const today = state?.logs ? Object.keys(state.logs).sort().at(-1) : null;
    const prefix = states.length > 1 ? ` [${index + 1}]` : '';
    for (const item of [...checkRoutineData(state), ...checkCompletion(state.routines, state.logs, today), ...checkMega(state)]) {
      checks.push({ ...item, id: `${item.id}${prefix}`, label: `${item.label}${prefix}` });
    }
  }
  return checks;
}
