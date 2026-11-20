/**
 * طبقة تخزين "الحفظ القوي" على القرص.
 * ------------------------------------------------------------
 * مبدأ التصميم: لا يُكتب ملف مباشرة أبدًا. كل كتابة تمر عبر atomicWriteFile
 * (نسخة احتياطية bak.<name> + ملف مؤقت مُفرّغ على القرص + إحلال ذرّي)،
 * وقراءة الملف تتحقق من JSON وترجع للنسخة الاحتياطية تلقائيًا عند التلف.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteFile, backupName } from './atomic.js';

export { atomicWriteFile, backupName };

/** قراءة JSON بأمان مع الرجوع للنسخة الاحتياطية */
export async function readJsonSafe(filePath, fallback) {
  for (const candidate of [filePath, path.join(path.dirname(filePath), backupName(path.basename(filePath)))]) {
    try {
      const raw = await fs.readFile(candidate, 'utf8');
      if (!raw.trim()) continue;
      return JSON.parse(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') logger.warn('store_read_failed', { file: candidate, message: err.message });
    }
  }
  return typeof fallback === 'function' ? fallback() : fallback;
}

export async function writeJsonSafe(filePath, value) {
  await atomicWriteFile(filePath, JSON.stringify(value, null, 2));
}

export async function initDataDirs(config) {
  const dirs = [
    config.dataDir,
    path.join(config.dataDir, 'users'),
    path.join(config.dataDir, 'sessions'),
    path.join(config.dataDir, 'notifications'),
    path.join(config.dataDir, 'routines'),
    path.join(config.dataDir, 'presence'),
  ];
  for (const dir of dirs) await fs.mkdir(dir, { recursive: true });
}

// ---------- سجل بسيط منظّم ----------
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] || (process.env.NODE_ENV === 'production' ? LEVELS.info : LEVELS.debug);

function emit(level, event, meta = {}) {
  if (LEVELS[level] < minLevel) return;
  const line = { t: new Date().toISOString(), level, event, ...meta };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else console.log(text);
}

export const logger = {
  debug: (event, meta) => emit('debug', event, meta),
  info: (event, meta) => emit('info', event, meta),
  warn: (event, meta) => emit('warn', event, meta),
  error: (event, meta) => emit('error', event, meta),
};
