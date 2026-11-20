/**
 * محمّل .env بسيط (يسدّ فراغ dotenv) — لا تبعيات.
 * يُستدعى أول شيء من server/index.js قبل قراءة الإعدادات.
 * القاعدة: متغيرات البيئة الحقيقية أقوى من محتوى الملف.
 */
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv(rootDir) {
  const file = path.join(rootDir, '.env');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { loaded: false };
  }
  let count = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      count += 1;
    }
  }
  return { loaded: true, count };
}
