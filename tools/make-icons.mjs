/**
 * مولّد أيقونات التطبيق (PNG) بلا مكتبات خارجية.
 * يرسم شعار "دفتر + قلب" على خلفية متدرجة، ويصدر ملفات PWA + أيقونة التفضيل.
 * التشغيل: node tools/make-icons.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { createCanvas } from './canvas.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDir = path.join(root, 'public', 'icons');

/* ---------- PNG encoder ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function drawIcon(size, { maskable = false } = {}) {
  const c = createCanvas(size);
  const c1 = hex('#db2777'); // توتي
  const c2 = hex('#f472b6'); // وردي
  const c3 = hex('#2dd4bf'); // فستقي

  // خلفية متدرجة قطرية (توتي → فستقي) بحساب بسيط مرتين
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = Math.min(1, (x / size) * 0.62 + (y / size) * 0.38);
      const a = t < 0.55 ? c1 : c2;
      const b = t < 0.55 ? c2 : c3;
      const k = t < 0.55 ? t / 0.55 : (t - 0.55) / 0.45;
      c.blend(x, y, [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)], 1);
    }
  }
  // هالة ضوء أعلى اليمين
  for (let r = size * 0.42; r > 0; r -= 1) c.circle(size * 0.78, size * 0.18, r, [255, 255, 255]);

  const inner = maskable ? 0.4 : 0.56; // نسبة الدفتر من حجم الأيقونة
  const s = size * inner;
  const ox = (size - s) / 2;
  const oy = (size - s) / 2;

  c.shadow(ox, oy + s * 0.06, s, s, s * 0.18, size * 0.06, [60, 10, 35], 0.45);
  c.roundRect(ox, oy, s, s, s * 0.18, [255, 252, 254]);
  // كعب الدفتر على اليمين (RTL)
  c.roundRect(ox + s * 0.87, oy + s * 0.06, s * 0.13, s * 0.88, s * 0.06, hex('#fbcfe8'));
  // سطور الكتابة
  const lineColor = hex('#e7cfdc');
  c.roundRect(ox + s * 0.16, oy + s * 0.28, s * 0.56, s * 0.075, s * 0.0375, lineColor);
  c.roundRect(ox + s * 0.16, oy + s * 0.43, s * 0.44, s * 0.075, s * 0.0375, lineColor);
  c.roundRect(ox + s * 0.16, oy + s * 0.58, s * 0.5, s * 0.075, s * 0.0375, lineColor);
  // قلب الروتين
  c.heart(ox + s * 0.29, oy + s * 0.79, s * 0.1, hex('#db2777'));
  // لمسة فستقية = علامة إنجاز
  c.circle(ox + s * 0.7, oy + s * 0.8, s * 0.075, hex('#14b8a6'));

  return encodePng(size, size, c.data);
}

const files = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, {}],
];

await fs.mkdir(iconDir, { recursive: true });
for (const [name, size, opts] of files) {
  await fs.writeFile(path.join(iconDir, name), drawIcon(size, opts));
  console.log('✔', name);
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#db2777"/><stop offset=".55" stop-color="#f472b6"/><stop offset="1" stop-color="#2dd4bf"/></linearGradient></defs>
  <rect width="32" height="32" rx="9" fill="url(#g)"/>
  <rect x="6" y="6" width="20" height="20" rx="5" fill="#fffafc"/>
  <rect x="24" y="8" width="2.4" height="16" rx="1.2" fill="#fbcfe8"/>
  <rect x="10" y="11" width="11" height="1.8" rx=".9" fill="#e7cfdc"/>
  <rect x="10" y="15" width="8.5" height="1.8" rx=".9" fill="#e7cfdc"/>
  <rect x="10" y="19" width="9.5" height="1.8" rx=".9" fill="#e7cfdc"/>
</svg>`;
await fs.writeFile(path.join(iconDir, 'favicon.svg'), favicon);
console.log('✔ favicon.svg');
