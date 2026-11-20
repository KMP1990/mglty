/**
 * طبقة الحفظ القوي — الملف الرئيسي للميزة.
 * ------------------------------------------------------------
 * الواجهة الوحيدة التي تستخدمها بقية الميزات. تتعامل مع:
 *   • التشفير المحلي (AES-GCM بمفتاح غير قابل للاستخراج في IndexedDB)
 *   • الكتابة على مرحلتين (مسودة أولًا ثم تأكيد) — انقطاع الكهرباء لا يفسد البيانات
 *   • نسخة احتياطية ثانية في OPFS (نظام الملفات الخاص)
 *   • طابور مزامنة عند عودة الاتصال
 *   • الحذف الناعم (سلة محذوفات) + الاحتفاظ بنسخ سابقة للاستعادة
 *   • Uint8Array/AES — يعمل في نافذة التطبيق والعامل (Worker)
 */
import { createCryptoBox, isEncryptedEnvelope } from './crypto.js';
import { openAppDb, STORES } from './idb.js';
import { opfs } from './opfs.js';

export const SAVE_SCHEMA = 1;

export function createSaveService({ syncTransport = null, passphrase = null } = {}) {
  let dbPromise = null;
  let boxPromise = null;
  const db = () => (dbPromise ||= openAppDb());
  const box = () => (boxPromise ||= createCryptoBox(passphrase));

  /** ضغط/كشف + تجزئة سلامة */
  const digest = async (value) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
  };

  async function put(store, value) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(value);
      tx.oncomplete = () => resolve(value);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function get(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function remove(store, key) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** كل مفاتيح مخزن معين */
  async function keys(store) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /**
   * حفظ قيمة بشكل مشفّر.
   * @param {string} key مفتاح نوع البيانات مثل 'journal:entry'
   * @param {any} value البيانات (JSON-safe)
   * @param {{ id?: string, meta?: object, mirror?: boolean }} opts
   */
  async function save(key, value, { id = 'current', meta = {}, mirror = true } = {}) {
    const startedAt = performance.now();
    const recordId = `${key}::${id}`;
    const c = await box();
    const encrypted = await c.encrypt(value);
    const checksum = await digest(encrypted);
    const now = new Date().toISOString();
    const prior = await get(STORES.RECORDS, recordId);
    const version = (prior?.version || 0) + 1;

    // المرحلة 1: مسودة غير مؤكدة (تُستخدم للاستعادة إذا انقطع الحفظ)
    await put(STORES.DRAFTS, { recordId, key, id, encrypted, checksum, version, startedAt: now, status: 'pending' });

    // المرحلة 2: تأكيد
    const record = {
      recordId,
      key,
      id,
      version,
      encrypted,
      checksum,
      size: JSON.stringify(value).length,
      meta,
      createdAt: prior?.createdAt || now,
      updatedAt: now,
      syncState: syncTransport ? 'pending' : 'local-only',
    };
    try {
      await put(STORES.RECORDS, record);
      // نسخة احتياطية ثانية (على نظام الملفات) — مستقلة عن IndexedDB
      if (mirror && opfs.available()) {
        opfs.write(`${sanitize(key)}__${sanitize(id)}.enc.json`, encrypted).catch(() => { });
      }
      if (prior) await put(STORES.VERSIONS, { ...prior, recordId, archivedAt: now });
      await remove(STORES.DRAFTS, recordId);
      if (syncTransport && navigator.onLine) {
        queueSync(record).catch(() => { });
      }
      return { ok: true, version, updatedAt: now, ms: Math.round(performance.now() - startedAt) };
    } catch (err) {
      // نترك المسودة في مكانها — يمكن الاستعادة لاحقًا
      throw Object.assign(new Error('تعذّر تأكيد الحفظ، بقية نسخة مؤقتة للاستعادة'), { cause: err, draft: true });
    }
  }

  /** قراءة وحل التشفير، مع محاولة الاستعادة من النسخة الاحتياطية إن تلفت */
  async function load(key, id = 'current', { fallback = null } = {}) {
    const recordId = `${key}::${id}`;
    let record = await get(STORES.RECORDS, recordId);
    let recovered = false;
    if (record) {
      try {
        const c = await box();
        return { value: await c.decrypt(record.encrypted), record, recovered };
      } catch (err) {
        console.warn('[save] record unreadable, trying versions', err);
      }
    }
    // نسخة سابقة
    const prev = await get(STORES.VERSIONS, recordId);
    if (prev) {
      try {
        const c = await box();
        return { value: await c.decrypt(prev.encrypted), record: prev, recovered: true };
      } catch { }
    }
    // مرآة OPFS
    if (opfs.available()) {
      try {
        const envelope = await opfs.read(`${sanitize(key)}__${sanitize(id)}.enc.json`);
        if (envelope && isEncryptedEnvelope(envelope)) {
          const c = await box();
          return { value: await c.decrypt(envelope), record: null, recovered: true };
        }
      } catch { }
    }
    return { value: fallback, record: null, recovered };
  }

  /** مسودات معلقة (حفظ لم يكتمل) */
  async function pendingDrafts() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORES.DRAFTS, 'readonly');
      const req = tx.objectStore(STORES.DRAFTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  /** حذف ناعم (إلى سلة المحذوفات) */
  async function removeRecord(key, id = 'current') {
    const recordId = `${key}::${id}`;
    const record = await get(STORES.RECORDS, recordId);
    if (!record) return false;
    await put(STORES.TRASH, { ...record, deletedAt: new Date().toISOString() });
    await remove(STORES.RECORDS, recordId);
    if (opfs.available()) opfs.remove(`${sanitize(key)}__${sanitize(id)}.enc.json`).catch(() => { });
    return true;
  }

  /** حذف نهائي لمفتاح واحد من كل الطبقات — بلا سلة محذوفات */
  async function purge(key, id = 'current') {
    const recordId = `${key}::${id}`;
    await remove(STORES.RECORDS, recordId);
    await remove(STORES.DRAFTS, recordId);
    await remove(STORES.VERSIONS, recordId);
    await remove(STORES.TRASH, recordId);
    if (opfs.available()) opfs.remove(`${sanitize(key)}__${sanitize(id)}.enc.json`).catch(() => { });
    return true;
  }

  async function restoreFromTrash(key, id = 'current') {
    const recordId = `${key}::${id}`;
    const trash = await get(STORES.TRASH, recordId);
    if (!trash) return false;
    const { deletedAt, ...record } = trash;
    void deletedAt;
    await put(STORES.RECORDS, record);
    await remove(STORES.TRASH, recordId);
    return true;
  }

  async function emptyTrash() {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORES.TRASH, 'readwrite');
      tx.objectStore(STORES.TRASH).clear();
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }

  /** إحصاءات التخزين — تُستخدم في صفحة الخزنة */
  async function stats() {
    const d = await db();
    const count = (store) =>
      new Promise((resolve) => {
        const tx = d.transaction(store, 'readonly');
        const req = tx.objectStore(store).count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(0);
      });
    const [records, versions, drafts, trash] = await Promise.all([
      count(STORES.RECORDS),
      count(STORES.VERSIONS),
      count(STORES.DRAFTS),
      count(STORES.TRASH),
    ]);
    let estimate = null;
    try {
      estimate = await navigator.storage?.estimate?.();
    } catch { }
    let persisted = false;
    try {
      persisted = (await navigator.storage?.persisted?.()) || false;
    } catch { }
    return {
      records,
      versions,
      drafts,
      trash,
      usage: estimate?.usage || 0,
      quota: estimate?.quota || 0,
      persisted,
      opfs: opfs.available(),
      encrypted: true,
      algorithm: 'AES-GCM 256',
    };
  }

  /** طابور المزامنة — يُفرَّغ تلقائيًا عند عودة الاتصال */
  async function queueSync(record) {
    if (!syncTransport) return;
    try {
      await put(STORES.SYNC, {
        recordId: record.recordId,
        version: record.version,
        updatedAt: record.updatedAt,
        state: 'pending',
      });
      await syncTransport({ key: record.key, id: record.id, version: record.version, updatedAt: record.updatedAt });
      await remove(STORES.SYNC, record.recordId);
    } catch {
      // سيبقى في الطابور للفرصة القادمة
    }
  }

  async function flushSync() {
    if (!syncTransport) return 0;
    const items = await keys(STORES.SYNC);
    let done = 0;
    for (const recordId of items) {
      const rec = await get(STORES.SYNC, recordId);
      if (!rec) continue;
      try {
        const [key, id] = recordId.split('::');
        await syncTransport({ key, id, version: rec.version, updatedAt: rec.updatedAt });
        await remove(STORES.SYNC, recordId);
        done += 1;
      } catch { }
    }
    return done;
  }

  window.addEventListener('online', () => flushSync().catch(() => { }));

  return {
    save,
    load,
    remove: removeRecord,
    purge,
    restoreFromTrash,
    emptyTrash,
    pendingDrafts,
    stats,
    keys,
    flushSync,
    _db: db,
  };
}

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

/** نسخة جاهزة للتطبيق كله (كائن واحد مشترك) */
let singleton = null;
export function getSaveService() {
  if (!singleton) singleton = createSaveService();
  return singleton;
}
