/**
 * التحقق من صورة الحساب (Avatar) — ميزة فرعية داخل "حسابي".
 * الصورة تُرسل كـ data URL من المتصفح بعد تصغيرها، ويُتحقق هنا من النوع
 * والحجم والأبعاد قبل حفظها كنص داخل ملف المستخدم. لا تُقبل SVG لأسباب أمنية.
 */

const MAX_BYTES = 1_300_000; // ~1.3MB بعد التصغير في العميل
const MAX_SIDE = 1600;
const MIN_SIDE = 16;

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/;

function pngSize(buf) {
  if (buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buf[offset + 1];
    const length = buf.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null;
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    const width = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const height = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return { width, height };
  }
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    const b = buf.readUInt32LE(21);
    return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * @returns {{ok: true, avatar: string, mime: string, bytes: number, width: number|null, height: number|null}
 *          | {ok: false, code: string, message: string}}
 */
export function validateAvatar(value) {
  if (value === null || value === '') return { ok: true, avatar: null, mime: null, bytes: 0, width: null, height: null };
  if (typeof value !== 'string') return { ok: false, code: 'invalid_avatar', message: 'صيغة الصورة غير صحيحة' };
  const match = DATA_URL_RE.exec(value.trim());
  if (!match) {
    return { ok: false, code: 'invalid_avatar', message: 'اختر صورة PNG أو JPG أو WebP فقط' };
  }
  const mime = `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`;
  const base64 = match[2];
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_BYTES) {
    return { ok: false, code: 'avatar_too_large', message: 'الصورة كبيرة جدًا بعد الضغط — جرّب صورة أصغر' };
  }
  let buf;
  try {
    buf = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, code: 'invalid_avatar', message: 'تعذّر قراءة الصورة' };
  }
  const detected = pngSize(buf) ? 'png' : jpegSize(buf) ? 'jpeg' : webpSize(buf) ? 'webp' : null;
  const size = detected === 'png' ? pngSize(buf) : detected === 'jpeg' ? jpegSize(buf) : detected === 'webp' ? webpSize(buf) : null;
  if (!detected || mime !== `image/${detected}` || !size) {
    return { ok: false, code: 'invalid_avatar', message: 'ملف الصورة غير صالح أو لا يطابق نوعه' };
  }
  if (size.width < MIN_SIDE || size.height < MIN_SIDE || size.width > MAX_SIDE || size.height > MAX_SIDE) {
    return { ok: false, code: 'avatar_dimensions', message: `أبعاد الصورة يجب أن تكون بين ${MIN_SIDE} و${MAX_SIDE} بكسل` };
  }
  return {
    ok: true,
    avatar: `data:${mime};base64,${base64}`,
    mime,
    bytes: buf.length,
    width: size?.width || null,
    height: size?.height || null,
  };
}
