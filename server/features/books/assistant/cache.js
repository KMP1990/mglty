/**
 * ذاكرة مؤقتة قصيرة لنتائج النماذج — خلية توفير الحصة.
 * ------------------------------------------------------------
 * نفس الصفحة + نفس السؤال خلال دقائق = نفس الإجابة، بلا استهلاك جديد.
 * المفتاح تجزئة (hash) لا تحتوي نص الصفحة نفسه، والقيمة في الذاكرة فقط.
 */
import crypto from 'node:crypto';

const TTL_ENV = Number(process.env.AI_CACHE_TTL_MS);
const TTL_MS = Number.isFinite(TTL_ENV) && TTL_ENV > 0 ? TTL_ENV : 4 * 60_000;
const MAX_ENTRIES = 120;
const store = new Map();

export function makeCacheKey(parts) {
  const raw = JSON.stringify(parts || {});
  return crypto.createHash('sha1').update(raw).digest('hex');
}

export function getCached(key) {
  if (!key) return null;
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  // ترتيب LRU بسيط
  store.delete(key);
  store.set(key, hit);
  return hit.value;
}

export function setCached(key, value) {
  if (!key || !value) return;
  store.set(key, { at: Date.now(), value });
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    store.delete(oldest);
  }
}

export function clearCache() {
  store.clear();
}
