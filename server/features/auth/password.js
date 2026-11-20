/**
 * تجزئة كلمات المرور: scrypt (مقاومة للذاكرة) + ملح عشوائي لكل مستخدم.
 * الصيغة المخزّنة: scrypt$<N>$<r>$<p>$<salt>$<hash>  (base64url)
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(plain.normalize('NFKC'), salt, PARAMS.keylen, { N: PARAMS.N, r: PARAMS.r, p: PARAMS.p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(plain, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64url');
    const expected = Buffer.from(hashB64, 'base64url');
    const actual = await scrypt(plain.normalize('NFKC'), salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** تجزئة مستخدم وهمي — نقوم بها عند عدم وجود الحساب لموازنة زمن الاستجابة (منع كشف الإيميلات) */
const DUMMY_HASH_PROMISE = hashPassword(crypto.randomBytes(24).toString('hex'));
export async function burnPasswordTime(plain) {
  await verifyPassword(plain, await DUMMY_HASH_PROMISE);
}
