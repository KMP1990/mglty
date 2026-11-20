/**
 * أغلفة الكتب — مولّد أغلفة جميل يعمل دون أي شبكة.
 * ------------------------------------------------------------
 * إن لم يكن في الملف صورة غلاف (TXT/MD/DOCX)، نولّد غلافًا SVG
 * من عنوان الكتاب والمؤلف واللون، ويُحفظ مع فهرس المكتبة.
 */

const escapeXml = (value = '') =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function hueFromTitle(title = '') {
  return Math.abs([...String(title)].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 7)) % 360;
}

function wrapTitle(title, maxChars = 17, maxLines = 4) {
  const words = String(title || 'كتاب').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines - 1) break;
    } else {
      current = next;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) lines.push('كتاب');
  return lines;
}

/**
 * غلاف SVG احتياطي: تدرّج لوني من العنوان + نقش خفيف + العنوان والمؤلف.
 * يعيد data URL صالحًا لـ <img> مباشرة.
 */
export function generatedCover({ title = 'كتاب', author = '', format = '', hue = null } = {}) {
  const baseHue = Number.isFinite(Number(hue)) ? Number(hue) : hueFromTitle(title);
  const hue2 = (baseHue + 38) % 360;
  const lines = wrapTitle(title, 17, 4);
  const titleSize = lines.length >= 4 ? 40 : lines.length === 3 ? 44 : 50;
  const startY = 320 - (lines.length - 1) * (titleSize * 0.62);
  const titleText = lines
    .map(
      (line, index) =>
        `<text x="260" y="${startY + index * titleSize * 1.22}" text-anchor="middle" direction="rtl" font-family="'Cairo','Noto Sans Arabic','Tajawal','Segoe UI',Tahoma,sans-serif" font-size="${titleSize}" font-weight="800" fill="#ffffff">${escapeXml(line)}</text>`
    )
    .join('');
  const authorText = author
    ? `<text x="260" y="${startY + lines.length * titleSize * 1.22 + 34}" text-anchor="middle" direction="rtl" font-family="'Cairo','Noto Sans Arabic','Tajawal','Segoe UI',Tahoma,sans-serif" font-size="22" fill="rgba(255,255,255,.82)">${escapeXml(String(author).slice(0, 42))}</text>`
    : '';
  const formatText = format
    ? `<text x="260" y="676" text-anchor="middle" font-family="'Cairo','Noto Sans Arabic','Segoe UI',Tahoma,sans-serif" font-size="18" letter-spacing="4" fill="rgba(255,255,255,.72)">${escapeXml(String(format).toUpperCase())}</text>`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 520 740" width="520" height="740">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${baseHue} 58% 42%)"/>
      <stop offset="0.55" stop-color="hsl(${baseHue} 52% 30%)"/>
      <stop offset="1" stop-color="hsl(${hue2} 48% 22%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.12" r="0.8">
      <stop offset="0" stop-color="rgba(255,255,255,.35)"/>
      <stop offset="1" stop-color="rgba(255,255,255,0)"/>
    </radialGradient>
    <pattern id="grain" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
      <line x1="0" y1="0" x2="0" y2="26" stroke="rgba(255,255,255,.06)" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="520" height="740" fill="url(#bg)"/>
  <rect width="520" height="740" fill="url(#grain)"/>
  <rect width="520" height="740" fill="url(#glow)"/>
  <circle cx="438" cy="92" r="150" fill="rgba(255,255,255,.07)"/>
  <circle cx="70" cy="640" r="190" fill="rgba(0,0,0,.12)"/>
  <rect x="34" y="34" width="452" height="672" rx="18" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="2"/>
  <rect x="64" y="246" width="70" height="3" rx="2" fill="rgba(255,255,255,.55)"/>
  ${titleText}
  ${authorText}
  ${formatText}
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function generatedCoverHue(title) {
  return hueFromTitle(title);
}
