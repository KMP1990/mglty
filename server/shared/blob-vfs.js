/**
 * تخزين Netlify Blobs — يحوّل ملفات data/ إلى مفاتيح دائمة بلا قرص.
 * ------------------------------------------------------------
 * التطبيق كُتب على أساس ملفات JSON ذرّية. عند النشر على Netlify Functions
 * لا يوجد قرص دائم، لذلك نركّب طبقة توافق خفيفة فوق fs/promises تجعل
 * كل عمليات data/ تذهب إلى Netlify Blobs بدل القرص.
 *
 * لا يعمل هذا الملف إلا عند استدعاء installBlobFs() من دالة Netlify.
 * التطوير والاختبار المحليان يبقيان على القرص كما هما.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

let backend = null;
let rootDir = '';
let installed = false;
const original = {};

const BACKUP_PREFIX = /^(bak\.|bakold\.|tmp\.)/;

function relativeKey(filePath) {
  if (!installed) return null;
  const abs = path.resolve(String(filePath));
  const rel = path.relative(rootDir, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join('/');
}

function missing(filePath) {
  const err = new Error(`ENOENT: no such file or directory, open '${filePath}'`);
  err.code = 'ENOENT';
  err.errno = -2;
  err.path = String(filePath);
  return err;
}

function inRoot(filePath) {
  return relativeKey(filePath) !== null;
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(String(data ?? ''), 'utf8');
}

async function readBlob(filePath) {
  const key = relativeKey(filePath);
  if (!key) return original.readFile(filePath);
  const value = await backend.get(key);
  if (value == null) throw missing(filePath);
  return toBuffer(value);
}

async function writeBlob(filePath, data) {
  const key = relativeKey(filePath);
  if (!key) return original.writeFile(filePath, data);
  await backend.set(key, toBuffer(data));
}

export function blobEnabled() {
  return installed;
}

/** كتابة مباشرة آمنة: Blob واحد = عملية ذرّية واحدة. */
export async function blobWrite(filePath, contents) {
  await writeBlob(filePath, contents);
}

export function createNetlifyBackend({ storeName = 'majalati-data' } = {}) {
  // وضع اختبار/تطوير محلي فقط — ليس تخزينًا دائمًا.
  if (process.env.BLOB_BACKEND === 'memory') {
    const map = (globalThis.__mrMemoryBlobs ||= new Map());
    return Promise.resolve({
      async get(key) {
        return map.get(key) ?? null;
      },
      async set(key, value) {
        map.set(key, Buffer.from(value));
      },
      async setIfAbsent(key, value) {
        if (map.has(key)) return false;
        map.set(key, Buffer.from(value));
        return true;
      },
      async delete(key) {
        map.delete(key);
      },
      async list(prefix) {
        return [...map.keys()].filter((key) => key.startsWith(prefix));
      },
    });
  }
  // الاستيراد هنا حتى لا تُحمَّل حزمة Netlify في التشغيل المحلي العادي.
  return import('@netlify/blobs').then(({ getStore }) => {
    const store = getStore({ name: storeName, consistency: 'strong' });
    return {
      async get(key) {
        const value = await store.get(key, { type: 'arrayBuffer' });
        return value == null ? null : value;
      },
      async set(key, value) {
        await store.set(key, value);
      },
      async setIfAbsent(key, value) {
        const result = await store.set(key, value, { onlyIfNew: true });
        return result?.modified !== false;
      },
      async delete(key) {
        await store.delete(key);
      },
      async list(prefix) {
        const result = await store.list({ prefix });
        return (result?.blobs || []).map((item) => item.key);
      },
    };
  });
}

/**
 * تركيب طبقة التوافق. تُستدعى مرة واحدة في أول طلب/دالة.
 * @param {{backend: object, dataRoot: string}} options
 */
export function installBlobFs({ backend: nextBackend, dataRoot }) {
  if (installed) return;
  if (!nextBackend) throw new Error('blob backend required');
  backend = nextBackend;
  rootDir = path.resolve(dataRoot);
  installed = true;

  original.readFile = fs.readFile;
  original.writeFile = fs.writeFile;
  original.appendFile = fs.appendFile;
  original.readdir = fs.readdir;
  original.mkdir = fs.mkdir;
  original.rm = fs.rm;
  original.rename = fs.rename;
  original.copyFile = fs.copyFile;
  original.open = fs.open;
  original.stat = fs.stat;
  original.access = fs.access;

  fs.readFile = async (filePath, options) => {
    if (!inRoot(filePath)) return original.readFile(filePath, options);
    const buffer = await readBlob(filePath);
    const encoding = typeof options === 'string' ? options : options?.encoding;
    return encoding ? buffer.toString(encoding) : buffer;
  };

  fs.writeFile = async (filePath, data, options) => {
    if (!inRoot(filePath)) return original.writeFile(filePath, data, options);
    await writeBlob(filePath, data);
    return undefined;
  };

  fs.appendFile = async (filePath, data, options) => {
    if (!inRoot(filePath)) return original.appendFile(filePath, data, options);
    let previous = Buffer.alloc(0);
    try {
      previous = await readBlob(filePath);
    } catch { }
    await writeBlob(filePath, Buffer.concat([previous, toBuffer(data)]));
    return undefined;
  };

  fs.mkdir = async (dir, options) => {
    if (inRoot(dir)) return undefined;
    return original.mkdir(dir, options);
  };

  fs.readdir = async (dir, options) => {
    if (!inRoot(dir)) return original.readdir(dir, options);
    const prefix = `${relativeKey(dir).replace(/\/$/, '')}/`;
    const keys = await backend.list(prefix);
    const names = keys
      .map((key) => key.slice(prefix.length))
      .filter((name) => name && !name.includes('/') && !BACKUP_PREFIX.test(name));
    return [...new Set(names)].sort();
  };

  fs.rm = async (filePath, options) => {
    if (!inRoot(filePath)) return original.rm(filePath, options);
    const key = relativeKey(filePath);
    if (options?.recursive) {
      const keys = await backend.list(`${key.replace(/\/$/, '')}/`);
      await Promise.all(keys.map((item) => backend.delete(item)));
      return undefined;
    }
    await backend.delete(key);
    return undefined;
  };

  fs.copyFile = async (from, to) => {
    if (!inRoot(from) || !inRoot(to)) return original.copyFile(from, to);
    await writeBlob(to, await readBlob(from));
    return undefined;
  };

  fs.rename = async (from, to) => {
    if (!inRoot(from) || !inRoot(to)) return original.rename(from, to);
    const buffer = await readBlob(from);
    await writeBlob(to, buffer);
    await backend.delete(relativeKey(from));
    return undefined;
  };

  fs.stat = async (filePath, options) => {
    if (!inRoot(filePath)) return original.stat(filePath, options);
    const buffer = await readBlob(filePath);
    const stat = {
      size: buffer.length,
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
      mtimeMs: Date.now(),
      mtime: new Date(),
      atimeMs: Date.now(),
      atime: new Date(),
      ctimeMs: Date.now(),
      ctime: new Date(),
    };
    return stat;
  };

  fs.access = async (filePath, mode) => {
    if (!inRoot(filePath)) return original.access(filePath, mode);
    await readBlob(filePath);
    return undefined;
  };

  fs.open = async (filePath, flags = 'r', mode) => {
    if (!inRoot(filePath)) return original.open(filePath, flags, mode);
    const writable = String(flags).includes('w') || String(flags).includes('a') || String(flags).includes('+');
    let buffer = Buffer.alloc(0);
    if (String(flags).includes('a')) {
      try {
        buffer = await readBlob(filePath);
      } catch { }
    }
    return {
      async writeFile(data) {
        buffer = Buffer.concat([buffer, toBuffer(data)]);
        return undefined;
      },
      async write(data) {
        buffer = Buffer.concat([buffer, toBuffer(data)]);
        return toBuffer(data).length;
      },
      async read() {
        return { bytesRead: 0, buffer: Buffer.alloc(0) };
      },
      async sync() {
        return undefined;
      },
      async close() {
        if (writable) await writeBlob(filePath, buffer);
      },
    };
  };
}

/** يقرأ/ينشئ سر الجلسات داخل Blobs حتى يبقى ثابتًا بين كل الدوال. */
export async function ensureBlobSecret({ key = '_meta/session-secret', crypto } = {}) {
  if (!installed) return null;
  const previous = await backend.get(key);
  if (previous) return toBuffer(previous).toString('utf8');
  const gc = crypto || (await import('node:crypto')).default;
  const secret = gc.randomBytes(48).toString('base64url');
  const created = await backend.setIfAbsent(key, secret);
  if (created) return secret;
  const winner = await backend.get(key);
  return winner ? toBuffer(winner).toString('utf8') : secret;
}
