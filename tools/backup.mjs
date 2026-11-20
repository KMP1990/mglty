/**
 * نسخ احتياطي دوري لبيانات الخادم (مستخدمون/جلسات/إشعارات).
 * مستقل عن خادم Express فيمكن تشغيله من cron أو Task Scheduler.
 *
 *   node tools/backup.mjs                 # نسخة في ./backups
 *   node tools/backup.mjs --keep 14       # احتفظ بآخر 14 نسخة فقط
 *   BACKUP_DIR=D:\\backups node tools/backup.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const gzip = promisify(zlib.gzip);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const backupDir = process.env.BACKUP_DIR || path.join(root, 'backups');

const args = process.argv.slice(2);
const keepArg = args.indexOf('--keep');
const keep = keepArg !== -1 ? Number(args[keepArg + 1]) || 14 : 14;

/** يقرأ شجرة مجلد ويُعيد خريطة: مسار نسبي → محتوى (نص) */
async function snapshot(dir, base = dir, out = {}) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (entry.isDirectory()) await snapshot(full, base, out);
    else if (entry.name.endsWith('.json')) out[rel] = await fs.readFile(full, 'utf8');
  }
  return out;
}

const payload = {
  app: 'majalati-routinee',
  createdAt: new Date().toISOString(),
  dataDir,
  files: await snapshot(dataDir),
};

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await fs.mkdir(backupDir, { recursive: true });
const target = path.join(backupDir, `backup-${stamp}.json.gz`);
const compressed = await gzip(Buffer.from(JSON.stringify(payload, null, 2)), { level: 9 });
await fs.writeFile(target, compressed);

const fileCount = Object.keys(payload.files).length;
console.log(`✔ نسخة احتياطية: ${path.relative(process.cwd(), target)} (${fileCount} ملف، ${(compressed.length / 1024).toFixed(1)} ك.ب)`);

// تقليم النسخ القديمة
const existing = (await fs.readdir(backupDir)).filter((f) => f.startsWith('backup-') && f.endsWith('.json.gz')).sort();
const excess = existing.slice(0, Math.max(0, existing.length - keep));
for (const f of excess) await fs.rm(path.join(backupDir, f), { force: true });
if (excess.length) console.log(`✔ حُذفت ${excess.length} نسخة قديمة (الاحتفاظ بـ ${keep}).`);
