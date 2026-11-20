/**
 * أداة اختبارات شاملة: node tools/check.mjs
 * تتحقق من:
 *  1) سلامة صياغة كل ملفات JS (server + public + tools)
 *  2) اكتمال الملفات المرجعية (لا استيراد لملف غير موجود، لا أصل مفقود)
 *  3) نجاح اختبارات الخادم (node --test)
 * تعمل بلا شبكة وبلا متصفح — مناسبة قبل كل نشر.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'data', 'dist', '.git', '.agent-cache', '.netlify'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = await walk(root);

/* ---------- 1) صياغة JS ---------- */
const jsFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
for (const file of jsFiles) {
  try {
    await run(process.execPath, ['--check', file]);
  } catch (err) {
    problems.push(`صياغة خاطئة: ${path.relative(root, file)}\n${String(err.stderr).split('\n').slice(0, 4).join('\n')}`);
  }
}

/* ---------- 2) اكتمال الاستيرادات داخل public ---------- */
const publicFiles = files.filter((f) => f.includes(`${path.sep}public${path.sep}`));
const importRe = /(?:from|import)\s+['"]([./][^'"]+)['"]/g;
const exists = async (p) => fs.stat(p).then(() => true).catch(() => false);

for (const file of publicFiles.filter((f) => f.endsWith('.js'))) {
  const src = await fs.readFile(file, 'utf8');
  for (const [, spec] of src.matchAll(importRe)) {
    const clean = spec.split('?')[0];
    const target = path.resolve(path.dirname(file), clean);
    const cands = [target, `${target}.js`, path.join(target, 'index.js')];
    let ok = false;
    for (const c of cands) if (await exists(c)) ok = true;
    if (!ok) problems.push(`استيراد مفقود: ${path.relative(root, file)} → ${spec}`);
  }
}

/* ---------- أصول ثابتة مشار إليها في CSS/HTML ---------- */
const assetRe = /(?:src|href)="(\/[^"]+\.(?:css|js|png|svg|webmanifest))"/g;
const cssUrlRe = /url\(['"]?(\/[^'")]+)['"]?\)/g;
for (const file of files.filter((f) => f.endsWith('.html') || f.endsWith('.css'))) {
  const src = await fs.readFile(file, 'utf8');
  for (const re of [assetRe, cssUrlRe]) {
    for (const [, url] of src.matchAll(re)) {
      const target = path.join(root, 'public', url.split('?')[0]);
      if (!(await exists(target))) problems.push(`أصل مفقود: ${path.relative(root, file)} → ${url}`);
    }
  }
}

/* ---------- 3) سويتة الاختبارات ---------- */
let testsSummary = '';
try {
  const { stdout } = await run(process.execPath, ['--test', 'tests/*.test.js'], { cwd: root });
  testsSummary = stdout.trim().split('\n').filter((l) => /^# (pass|fail|tests)/.test(l)).join('\n');
  if (/# fail [1-9]/.test(stdout)) problems.push('اختبارات الخادم بها فشل:\n' + testsSummary);
} catch (err) {
  problems.push('فشل تشغيل اختبارات الخادم:\n' + String(err.stdout || err.message).slice(-1500));
}

/* ---------- النتيجة ---------- */
console.log(`\n📁 ملفات JS مختبرة: ${jsFiles.length}`);
if (testsSummary) console.log(testsSummary);
if (problems.length) {
  console.log(`\n❌ مشاكل مكتشفة (${problems.length}):`);
  for (const p of problems) console.log(' -', p);
  process.exitCode = 1;
} else {
  console.log('\n✅ كل شيء متكامل: الصياغة سليمة، الاستيرادات مكتملة، واختبارات الخادم ناجحة.\n');
}
