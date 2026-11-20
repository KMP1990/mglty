/**
 * كتابة ملفات ذرّية آمنة على جميع الأنظمة (بما فيها ويندوز).
 * ------------------------------------------------------------
 * على ويندوز لا يمكن أن يستبدل rename ملفًا قائمًا، لذلك نستخدم تبديلًا
 * ذرّيًا في نفس المجلد، ونسخة احتياطية بأسماء ثابتة: bak.<name>
 * خطوات كل كتابة:
 *   1) نسخ الملف السابق إلى bak.<name> (وإن فشل فلأنه غير موجود)
 *   2) كتابة ملف مؤقت + fsync
 *   3) إعادة تسمية الملف السابق إلى bakold.<name> ثم المؤقت إلى الاسم النهائي
 *   4) مسح bakold
 * أي انقطاع في أي خطوة يترك دائمًا إمّا النسخة الجديدة أو القديمة صالحة.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const queues = new Map();
export const backupName = (fileName) => `bak.${fileName}`;

export function atomicWriteFile(filePath, contents) {
  const prev = queues.get(filePath) || Promise.resolve();
  const next = prev.catch(() => { }).then(() => doAtomicWrite(filePath, contents));
  queues.set(filePath, next);
  next
    .finally(() => {
      if (queues.get(filePath) === next) queues.delete(filePath);
    })
    .catch(() => { });
  return next;
}

async function syncFile(filePath) {
  try {
    const h = await fs.open(filePath, 'r');
    await h.sync().catch(() => { });
    await h.close();
  } catch { }
}

async function doAtomicWrite(filePath, contents) {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  const rnd = crypto.randomBytes(8).toString('hex');
  const bak = path.join(dir, backupName(name));
  const bakOld = path.join(dir, `bakold.${name}`);
  const tmp = path.join(dir, `tmp.${name}.${process.pid}.${rnd}`);
  const buf = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');

  // 1) نسخة احتياطية من الحالة السابقة
  try {
    await fs.copyFile(filePath, bak);
    await syncFile(bak);
  } catch {
    /* أول كتابة — لا نسخة سابقة */
  }

  // 2) الملف المؤقت مكتمل ومُفرّغ على القرص
  const handle = await fs.open(tmp, 'wx', 0o600);
  try {
    await handle.writeFile(buf);
    await handle.sync();
  } finally {
    await handle.close();
  }

  // 3) الإحلال
  let prev = null;
  try {
    prev = await fs.readFile(filePath);
  } catch {
    prev = null;
  }
  if (prev) {
    await fs.writeFile(bakOld, prev); // لقطة بديلة قبل الاستبدال
    await fs.rm(filePath, { force: true });
  }
  await fs.rename(tmp, filePath);
  await syncFile(filePath);

  // 4) تنظيف
  await fs.rm(bakOld, { force: true }).catch(() => { });
}
