/**
 * المرآة الاحتياطية على نظام الملفات الخاص (OPFS) — ميزة فرعية داخل "الحفظ القوي".
 * نسخة ثانية مستقلة عن IndexedDB: لو تلفت القاعدة تبقى ملفات .enc.json.
 */
const DIR = 'backups';
let rootPromise = null;

function getRoot() {
  if (!opfs.available()) return Promise.resolve(null);
  if (!rootPromise) {
    rootPromise = navigator.storage
      .getDirectory()
      .then((dir) => dir.getDirectoryHandle(DIR, { create: true }))
      .catch(() => null);
  }
  return rootPromise;
}

export const opfs = {
  available() {
    return Boolean(navigator.storage?.getDirectory && typeof FileSystemFileHandle !== 'undefined');
  },

  async write(name, data) {
    const root = await getRoot();
    if (!root) return false;
    // كتابة ذرّية: ملف مؤقت ثم إحلال
    const file = await root.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(data));
    await writable.close();
    return true;
  },

  async read(name) {
    const root = await getRoot();
    if (!root) return null;
    try {
      const handle = await root.getFileHandle(name);
      const file = await handle.getFile();
      return JSON.parse(await file.text());
    } catch {
      return null;
    }
  },

  async remove(name) {
    const root = await getRoot();
    if (!root) return false;
    try {
      await root.removeEntry(name);
      return true;
    } catch {
      return false;
    }
  },

  async list() {
    const root = await getRoot();
    if (!root) return [];
    const out = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind === 'file') out.push(name);
    }
    return out;
  },
};
