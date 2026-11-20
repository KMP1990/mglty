/**
 * مستودع المستخدمين: ملف لكل مستخدم داخل data/users/<id>.json
 * + فهرس بريد → معرف (data/users/index.json) لسرعة البحث.
 * كل الكتابات ذرّية مع نسخة احتياطية (انظر shared/store.js).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonSafe, writeJsonSafe } from '../../shared/store.js';

const escapeEmail = (email) => crypto.createHash('sha256').update(email).digest('hex');

export function createUserStore(config) {
  const dir = path.join(config.dataDir, 'users');
  const indexPath = path.join(dir, 'index.json');
  const userPath = (id) => path.join(dir, `${id}.json`);
  let indexPromise = null;

  async function loadIndex() {
    const index = await readJsonSafe(indexPath, () => ({ byEmail: {} }));
    if (!index.byEmail) index.byEmail = {};
    return index;
  }
  function index() {
    if (!indexPromise) indexPromise = loadIndex();
    return indexPromise;
  }
  const saveIndex = (data) => writeJsonSafe(indexPath, data).catch(() => { });

  return {
    async findByEmail(email) {
      const idx = await index();
      const id = idx.byEmail[escapeEmail(email)];
      if (!id) return null;
      return this.findById(id);
    },

    async findById(id) {
      if (!/^[a-f0-9]{24}$/.test(String(id))) return null;
      const user = await readJsonSafe(userPath(id), null);
      return user && user.id === id ? user : null;
    },

    /** إنشاء مستخدم جديد — يرفض التكرار ذرّيًا عبر الفهرس */
    async create({ name, email, passwordHash }) {
      const idx = await index();
      const key = escapeEmail(email);
      if (idx.byEmail[key]) return { conflict: true };
      const now = new Date().toISOString();
      const user = {
        id: crypto.randomBytes(12).toString('hex'),
        name,
        email,
        passwordHash,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
        avatar: null,
        preferences: {
          theme: 'system',
          notifications: {
            email: false,
            push: true,
            digest: true,
            digestTime: '08:30',
            reengage: true,
            awayReminders: true,
            routineReminders: true,
            achievements: true,
            systemEvents: true,
            quietHours: { enabled: true, from: '23:00', to: '07:00' },
          },
          sound: { enabled: true, volume: 0.55 },
          readingReminder: { enabled: false, time: '20:30' },
        },
        security: { failedLogins: 0, lockedUntil: null },
      };
      idx.byEmail[key] = user.id;
      await saveIndex(idx);
      await writeJsonSafe(userPath(user.id), user);
      return { user };
    },

    async update(id, patch) {
      const current = await this.findById(id);
      if (!current) return null;
      const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
      await writeJsonSafe(userPath(id), next);
      return next;
    },

    async count() {
      const idx = await index();
      return Object.keys(idx.byEmail).length;
    },

    async list() {
      try {
        return (await fs.readdir(dir)).filter((f) => /^[a-f0-9]{24}\.json$/.test(f));
      } catch {
        return [];
      }
    },
  };
}

/** الشكل العام للمستخدم المرسل للعميل (بدون أي أسرار) */
export function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    preferences: user.preferences,
  };
}
