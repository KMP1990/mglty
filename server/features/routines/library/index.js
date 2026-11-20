/**
 * مكتبة الروتينات الجاهزة — ملفات مستقلة تُغذي شاشة الإضافة.
 * manifest.json = التصنيفات، routines.json = القوالب.
 * كل قالب يُتحقق ويُطبّع هنا، فلا تصل بيانات مشوّهة إلى الواجهة.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COLORS, ENERGY_LEVELS, ICONS, PRIORITIES, sanitizeDays, sanitizeSteps } from '../validate.js';
import { normalizeTitle } from '../systems/engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn('[routines/library] تعذّر قراءة الملف', file, err?.message || err);
    return null;
  }
}

const clean = (value, max = 300) => String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);

function normalizeCategory(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id, 30);
  const name = clean(raw.name, 40);
  if (!id || !name) return null;
  return {
    id,
    name,
    emoji: clean(raw.emoji, 4),
    color: COLORS.includes(raw.color) ? raw.color : 'rose',
    description: clean(raw.description, 120),
  };
}

function normalizeTemplate(raw, categories) {
  if (!raw || typeof raw !== 'object') return null;
  const id = clean(raw.id, 50);
  const title = clean(raw.title, 80);
  const category = clean(raw.category, 30);
  if (!id || title.length < 2 || !categories.has(category)) return null;
  const time = /^([01]\d|2[0-3]):([0-5]\d)$/.test(String(raw.time || '')) ? String(raw.time) : null;
  const duration = Number(raw.duration);
  return {
    id,
    category,
    title,
    note: clean(raw.note, 300),
    icon: ICONS.includes(raw.icon) ? raw.icon : 'sparkles',
    color: COLORS.includes(raw.color) ? raw.color : 'rose',
    time,
    duration: Number.isFinite(duration) ? Math.min(480, Math.max(1, Math.round(duration))) : 15,
    days: sanitizeDays(raw.days),
    priority: PRIORITIES.includes(raw.priority) ? raw.priority : 'support',
    energy: ENERGY_LEVELS.includes(raw.energy) ? raw.energy : 'medium',
    anchor: clean(raw.anchor, 80),
    steps: sanitizeSteps(raw.steps) || [],
    why: clean(raw.why, 200),
  };
}

const manifest = readJson(path.join(HERE, 'manifest.json')) || { categories: [] };
const categories = (Array.isArray(manifest.categories) ? manifest.categories : [])
  .map(normalizeCategory)
  .filter(Boolean);
const categoryIds = new Set(categories.map((c) => c.id));
const rawRoutines = readJson(path.join(HERE, 'routines.json')) || {};
const templates = (Array.isArray(rawRoutines.routines) ? rawRoutines.routines : [])
  .map((item) => normalizeTemplate(item, categoryIds))
  .filter(Boolean);

export const LIBRARY_CATEGORIES = categories;
export const LIBRARY_TEMPLATES = templates;

/**
 * بحث وفلترة المكتبة.
 * @param {{category?: string, q?: string}} opts
 */
export function listLibrary({ category = '', q = '' } = {}) {
  const cat = clean(category, 30);
  const query = normalizeTitle(q);
  const filtered = templates.filter((template) => {
    if (cat && template.category !== cat) return false;
    if (!query) return true;
    const haystack = normalizeTitle(`${template.title} ${template.note} ${template.why} ${template.anchor}`);
    return haystack.includes(query);
  });
  return {
    name: clean(manifest.name, 80) || 'مكتبة الروتينات',
    categories,
    routines: filtered,
    total: templates.length,
    count: filtered.length,
  };
}

export function getTemplate(id) {
  const key = clean(id, 50);
  return templates.find((template) => template.id === key) || null;
}

/** للمدقّق: حالة المكتبة كما يراها الخادم */
export function libraryHealth() {
  const byCategory = {};
  for (const category of categories) byCategory[category.id] = 0;
  for (const template of templates) byCategory[template.category] = (byCategory[template.category] || 0) + 1;
  return {
    categories: categories.length,
    routines: templates.length,
    byCategory,
    idsUnique: new Set(templates.map((t) => t.id)).size === templates.length,
  };
}
