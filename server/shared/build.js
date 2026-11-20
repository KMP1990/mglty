// build.json — يُنتجه tools/build.mjs داخل public/ (ملف عام ضروري لأنه يُستخدم لحقن الإصدار في الصفحة)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let build = { version: '0.1.0', id: 'dev', builtAt: new Date().toISOString() };
try {
  build = JSON.parse(fs.readFileSync(path.join(root, 'public', 'build.json'), 'utf8'));
} catch { }

export const BUILD = build;
