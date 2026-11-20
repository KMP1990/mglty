/**
 * سكربت البناء — يقوم بثلاثة أشياء فقط بلا أي أدوات ثقيلة:
 *  1) بذرة build.json (الإصدار)
 *  2) استبدال __BUILD_VERSION__ داخل public/sw.js فيُحدَّث كاش المتصفح تلقائيًا
 *  3) توليد صفحة offline.html من القالب
 * التشغيل: node tools/build.mjs  (أو عبر npm run build)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SYSTEM_IDS, getSystem } from '../server/features/routines/systems/index.js';
import { listLibrary } from '../server/features/routines/library/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const buildId = `${Date.now().toString(36)}-${pkg.version}`;

const buildPayload = JSON.stringify({ version: pkg.version, id: buildId, builtAt: new Date().toISOString() }, null, 2);
// الخادم يقرأ public/build.json (لحقن الإصدار في الصفحة)، ونُبقي نسخة في الجذر للأدوات
await Promise.all([
  fs.writeFile(path.join(publicDir, 'build.json'), buildPayload),
  fs.writeFile(path.join(root, 'build.json'), buildPayload),
]);
console.log('✔ build.json', buildId);

// استبدال النسخة في Service Worker
const swPath = path.join(publicDir, 'sw.js');
let sw = await fs.readFile(swPath, 'utf8');
sw = sw.replace(/const VERSION = '[^']*';/, `const VERSION = '${buildId}';`);
await fs.writeFile(swPath, sw);
console.log('✔ sw.js version stamped');

// التحقق من وجود الأصول الأساسية في كاش القشرة
const shellMatch = sw.match(/const SHELL = \[([\s\S]*?)\];/);
if (shellMatch) {
  const files = [...shellMatch[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((f) => f !== '/');
  for (const file of files) {
    try {
      await fs.access(path.join(publicDir, file));
    } catch {
      console.warn('⚠️  ملف في كاش القشرة غير موجود:', file);
    }
  }
}

/* ---------- نسخ محرك PDF المحلي (يُستخدم في قسم كتبي) ---------- */
await copyPdfEngine();

async function copyFileIfChanged(from, to) {
  try {
    const [src, dst] = await Promise.all([fs.stat(from), fs.stat(to).catch(() => null)]);
    if (dst && dst.size === src.size && dst.mtimeMs >= src.mtimeMs) return;
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
  } catch {
    /* الحزمة غير مثبتة — يبقى PDF معطّلًا بهدوء وبقية الأنواع تعمل */
  }
}

async function copyDir(from, to) {
  const entries = await fs.readdir(from, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await copyDir(source, target);
    else await copyFileIfChanged(source, target);
  }
}

async function copyPdfEngine() {
  const pkgDir = path.join(root, 'node_modules', 'pdfjs-dist');
  try {
    await fs.access(path.join(pkgDir, 'build', 'pdf.mjs'));
  } catch {
    console.warn('⚠️  pdfjs-dist غير مثبت — سيعمل قسم كتبي لكل الأنواع عدا PDF حتى تشغيل npm install');
    return;
  }
  const target = path.join(publicDir, 'vendor', 'pdfjs');
  await copyFileIfChanged(path.join(pkgDir, 'build', 'pdf.mjs'), path.join(target, 'pdf.mjs'));
  await copyFileIfChanged(path.join(pkgDir, 'build', 'pdf.worker.mjs'), path.join(target, 'pdf.worker.mjs'));
  await copyFileIfChanged(path.join(pkgDir, 'LICENSE'), path.join(target, 'LICENSE'));
  await copyDir(path.join(pkgDir, 'cmaps'), path.join(target, 'cmaps'));
  await copyDir(path.join(pkgDir, 'standard_fonts'), path.join(target, 'standard_fonts'));
  console.log('✔ pdfjs local engine ready');
}

/* ---------- كتالوجات ثابتة للواجهة (تعمل حتى لو تأخر الخادم أو انقطعت الشبكة) ---------- */
async function writeClientCatalogs() {
  const systems = SYSTEM_IDS.map((id) => getSystem(id)).filter(Boolean);
  const library = listLibrary();
  const payload = JSON.stringify({ version: pkg.version, generatedAt: new Date().toISOString(), systems }, null, 2);
  const libPayload = JSON.stringify({ version: pkg.version, generatedAt: new Date().toISOString(), ...library }, null, 2);
  await Promise.all([
    fs.writeFile(path.join(publicDir, 'features', 'routines', 'systems.json'), payload),
    fs.writeFile(path.join(publicDir, 'features', 'routines', 'library.json'), libPayload),
  ]);
  console.log(`✔ client catalogs: ${systems.length} systems · ${library.routines.length} routines`);
}
await writeClientCatalogs();

/* ---------- نسخة dist للاستضافات التي تتوقع dist (مثل إعداد Netlify القديم) ---------- */
// المصدر الحقيقي يبقى public/، وهذه نسخة متوافقة حتى لا يفشل النشر بسبب dist.
const distDir = path.join(root, 'dist');
await fs.rm(distDir, { recursive: true, force: true });
await fs.cp(publicDir, distDir, { recursive: true });
console.log('✔ dist copy ready');

console.log('✔ build finished');
