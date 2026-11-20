/**
 * فتح قاعدة الحفظ — ميزة فرعية داخل "الحفظ القوي".
 * مخطط مضبوط بإصدارات (migrations) بدل التخريب وإعادة الإنشاء.
 */
export const DB_NAME = 'majalati-routinee';
export const DB_VERSION = 1;

export const STORES = {
  RECORDS: 'records',
  DRAFTS: 'drafts',
  VERSIONS: 'versions',
  TRASH: 'trash',
  SYNC: 'sync',
};

let dbPromise = null;

export function openAppDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const from = event.oldVersion;
      if (from < 1) {
        const records = db.createObjectStore(STORES.RECORDS, { keyPath: 'recordId' });
        records.createIndex('byKey', 'key', { unique: false });
        records.createIndex('byUpdatedAt', 'updatedAt', { unique: false });
        const versions = db.createObjectStore(STORES.VERSIONS, { keyPath: 'recordId' });
        versions.createIndex('byKey', 'key', { unique: false });
        const trash = db.createObjectStore(STORES.TRASH, { keyPath: 'recordId' });
        trash.createIndex('byDeletedAt', 'deletedAt', { unique: false });
        db.createObjectStore(STORES.DRAFTS, { keyPath: 'recordId' });
        db.createObjectStore(STORES.SYNC, { keyPath: 'recordId' });
      }
      // إصدارات مستقبلية: أضف هنا if (from < 2) { ... }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('قاعدة البيانات مفتوحة في تبويب آخر — أغلق التبويبات القديمة'));
  });
  return dbPromise;
}

/** طلب تخزين دائم من المتصفح (يمنع الحذف التلقائي في ضغط المساحة) */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
