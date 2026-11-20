/**
 * الجلسات: ملف جلستها خاص. لا يُخزَّن معرف الجلسة نفسه في الملف،
 * بل SHA-256 له (بحيث لا تصلح الملفات على القرص للانتحال).
 * cookie: sid.token   و مقارنة بـ timingSafeEqual.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { readJsonSafe, atomicWriteFile, backupName } from '../../shared/store.js';

/** يحذف ملف الجلسة ونسخته الاحتياطية معًا */
async function removeSessionFiles(dir, fileName) {
  await fs.rm(path.join(dir, fileName), { force: true });
  await fs.rm(path.join(dir, backupName(fileName)), { force: true });
  await fs.rm(path.join(dir, `bakold.${fileName}`), { force: true });
}

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

export function createSessionStore(config) {
  const dir = path.join(config.dataDir, 'sessions');
  const filePath = (sidHash) => path.join(dir, `${sidHash}.json`);
  const memory = new Map(); // sidHash -> session (كاش قراءة)
  let queue = Promise.resolve();

  function enqueue(fn) {
    const p = queue.then(fn, fn);
    queue = p.catch(() => { });
    return p;
  }

  async function readSession(sidHash) {
    if (memory.has(sidHash)) return memory.get(sidHash);
    const s = await readJsonSafe(filePath(sidHash), null);
    if (s && s.expiresAt > Date.now()) memory.set(sidHash, s);
    return s;
  }

  return {
    /** إنشاء جلسة جديدة وإرجاع توكن التوقيع (يُرسل في الكوكي فقط) */
    async create({ userId, ip, userAgent, device }, now = Date.now()) {
      const sid = crypto.randomBytes(32).toString('base64url');
      const csrfToken = crypto.randomBytes(32).toString('base64url');
      const sidHash = sha256(sid);
      const session = {
        sidHash,
        userId,
        csrfToken,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + config.sessionTtlMs,
        ipHash: ip ? sha256(String(ip)).slice(0, 16) : null,
        uaHash: userAgent ? sha256(String(userAgent)).slice(0, 16) : null,
        device: device ? String(device).slice(0, 60) : null,
      };
      memory.set(sidHash, session);
      await atomicWriteFile(filePath(sidHash), JSON.stringify(session, null, 2));
      return { sid, csrfToken, session };
    },

    /** التوكن الكامل بصيغة  <sid>.<signature> مع توقيع HMAC سرّي */
    sign(sid) {
      const sig = crypto.createHmac('sha256', config.sessionSecret || 'dev-secret').update(sid).digest('base64url');
      return `${sid}.${sig}`;
    },

    unsign(token) {
      if (typeof token !== 'string' || !token.includes('.')) return null;
      const i = token.lastIndexOf('.');
      const sid = token.slice(0, i);
      const sig = token.slice(i + 1);
      const expected = crypto.createHmac('sha256', config.sessionSecret || 'dev-secret').update(sid).digest('base64url');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
      return sid;
    },

    async get(sid) {
      if (!sid) return null;
      const sidHash = sha256(sid);
      return readSession(sidHash);
    },

    /** تحديث آخر نشاط بشكل مخفف (كل 5 دقائق) لتقليل الكتابة على القرص */
    async touch(sid, now = Date.now()) {
      const sidHash = sha256(sid);
      const s = await readSession(sidHash);
      if (!s) return null;
      if (now - s.lastSeenAt < 5 * 60 * 1000) return s;
      const next = { ...s, lastSeenAt: now, expiresAt: Math.max(s.expiresAt, now + config.sessionTtlMs) };
      memory.set(sidHash, next);
      enqueue(() => atomicWriteFile(filePath(sidHash), JSON.stringify(next, null, 2)));
      return next;
    },

    async destroy(sid) {
      const sidHash = sha256(sid);
      memory.delete(sidHash);
      await enqueue(() => removeSessionFiles(dir, `${sidHash}.json`));
    },

    async destroyAllForUser(userId) {
      let removed = 0;
      for (const [sidHash, s] of memory) {
        if (s.userId === userId) {
          memory.delete(sidHash);
          removed += 1;
        }
      }
      try {
        for (const f of await fs.readdir(dir)) {
          if (!f.endsWith('.json')) continue;
          const s = await readJsonSafe(path.join(dir, f), null);
          if (s?.userId === userId) {
            await removeSessionFiles(dir, f);
            removed += 1;
          }
        }
      } catch { }
      return removed;
    },

    /** تنظيف الجلسات المنتهية (يُستدعى عند بدء التشغيل ودوريًا) */
    async sweep(now = Date.now()) {
      let removed = 0;
      try {
        for (const f of await fs.readdir(dir)) {
          if (!f.endsWith('.json')) continue;
          const p = path.join(dir, f);
          const s = await readJsonSafe(p, null);
          if (!s || s.expiresAt <= now) {
            await removeSessionFiles(dir, f);
            memory.delete(f.replace('.json', ''));
            removed += 1;
          }
        }
      } catch { }
      return removed;
    },

    csrfEquals(session, token) {
      if (!session?.csrfToken || !token) return false;
      const a = Buffer.from(String(token));
      const b = Buffer.from(session.csrfToken);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    },
  };
}
