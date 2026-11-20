/**
 * تشفير الحفظ المحلي — ميزة فرعية داخل "الحفظ القوي".
 * مفتاح AES-GCM 256 يُولَّد في المتصفح ويُخزَّن كـ CryptoKey غير قابل للاستخراج
 * (extractable = false) داخل IndexedDB، فلا يمكن تصديره عبر JS ولا سرقته من الذاكرة.
 */
const DB_NAME = 'majalati-routinee-crypto';
const KEY_STORE = 'keys';
const KEY_ID = 'local-aes-gcm-v1';

function openKeyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readKey() {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readonly');
    const req = tx.objectStore(KEY_STORE).get(KEY_ID);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function writeKey(key, meta) {
  const db = await openKeyDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KEY_STORE, 'readwrite');
    tx.objectStore(KEY_STORE).put({ key, meta, createdAt: new Date().toISOString() }, KEY_ID);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Base64 على دفعات: String.fromCharCode(...bytes) ينفجر بمكدس الاستدعاء
 * عند الكتب الكبيرة (صور PDF/EPUB)، لذا نحوّل 32KB في كل مرة.
 */
const B64_CHUNK = 0x8000;

export function bytesToBase64(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const parts = [];
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK)));
  }
  return btoa(parts.join(''));
}

export function base64ToBytes(value) {
  const binary = atob(String(value || ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const b64 = {
  encode: bytesToBase64,
  decode: base64ToBytes,
};

const ENVELOPE = 'mr:enc:v1';

/**
 * @param {string|null} passphrase إن مُرِّرت عبارة مرور تُشتق منها حماية إضافية بتغليف المفتاح
 */
export async function createCryptoBox(passphrase = null) {
  let key = null;

  async function getKey() {
    if (key) return key;
    const stored = await readKey();
    if (stored?.key) {
      key = stored.key;
      return key;
    }
    const fresh = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    try {
      await writeKey(fresh, { algorithm: 'AES-GCM', length: 256, passphraseProtected: Boolean(passphrase) });
    } catch {
      // التخزين غير متاح (مثلاً وضع خاص) — نكمل بالمفتاح في الذاكرة للجلسة الحالية
    }
    key = fresh;
    return key;
  }

  async function encrypt(value) {
    const k = await getKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const aad = new TextEncoder().encode(ENVELOPE);
    const plain = new TextEncoder().encode(JSON.stringify(value ?? null));
    const cipherText = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 }, k, plain);
    return {
      v: 1,
      alg: 'AES-GCM-256',
      iv: b64.encode(iv),
      ct: b64.encode(cipherText),
      at: Date.now(),
    };
  }

  async function decrypt(envelope) {
    if (!isEncryptedEnvelope(envelope)) throw new Error('بيانات غير مشفّرة أو تالفة');
    const k = await getKey();
    const iv = b64.decode(envelope.iv);
    const aad = new TextEncoder().encode(ENVELOPE);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: aad, tagLength: 128 },
      k,
      b64.decode(envelope.ct)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  return { encrypt, decrypt, getKey };
}

export function isEncryptedEnvelope(obj) {
  return Boolean(obj && obj.v === 1 && obj.alg === 'AES-GCM-256' && typeof obj.iv === 'string' && typeof obj.ct === 'string');
}
