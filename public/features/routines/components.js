/**
 * مكوّنات الروتين المشتركة (ميزة فرعية) — أيقونات وألوان وحلقات تقدم.
 * تُستخدم من الشاشة الرئيسية وصفحة الروتينات والمدرب الذكي.
 */

export const ROUTINE_ICONS = {
  sunrise: '<path d="M12 3v3M4.2 10.2l2.1 2.1M19.8 10.2l-2.1 2.1M2 18h20M5.5 18a6.5 6.5 0 0 1 13 0"/><path d="M9 6.5 12 3l3 3.5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/>',
  dumbbell: '<path d="M6.5 6.5v11M3.5 9v5M17.5 6.5v11M20.5 9v5M6.5 12h11"/>',
  water: '<path d="M12 3s6 6.4 6 10.2A6 6 0 0 1 6 13.2C6 9.4 12 3 12 3z"/><path d="M9.5 14.5a2.5 2.5 0 0 0 2.5 2.5"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  heart: '<path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8a4 4 0 0 1 7 2.8C19 15.6 12 20 12 20z"/>',
  leaf: '<path d="M4 20c0-8 5-14 16-15 0 11-6 16-13 16"/><path d="M4 20c3-5 7-8 11-9"/>',
  coffee: '<path d="M4 8h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M16 9h2.5a2.5 2.5 0 0 1 0 5H16M6 3v2M10 3v2M14 3v2"/>',
  brain: '<path d="M12 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 9 18a3 3 0 0 0 3-2z"/><path d="M12 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2A3 3 0 0 1 15 18a3 3 0 0 1-3-2z"/>',
  sparkles: '<path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="m11 8-2.5 6.5L6 21M11 8l3.5 3 3 1M11 14l3.5 7"/>',
  pen: '<path d="M15.5 3.5a2.1 2.1 0 0 1 3 3L8 17l-4 1 1-4z"/><path d="M13.5 5.5l3 3"/>',
};

export const ROUTINE_COLORS = {
  rose: { label: 'توتي', hex: '#db2777', soft: 'rgba(219,39,119,.12)' },
  mint: { label: 'فستقي', hex: '#0d9488', soft: 'rgba(13,148,136,.12)' },
  honey: { label: 'عسلي', hex: '#d97706', soft: 'rgba(217,119,6,.14)' },
  sky: { label: 'سماوي', hex: '#2563eb', soft: 'rgba(37,99,235,.12)' },
  lilac: { label: 'بنفسجي', hex: '#7c3aed', soft: 'rgba(124,58,237,.12)' },
  sand: { label: 'رملي', hex: '#a16207', soft: 'rgba(161,98,7,.12)' },
};

export function iconSvg(name, size = 20, stroke = 1.8) {
  const path = ROUTINE_ICONS[name] || ROUTINE_ICONS.sparkles;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

export function colorOf(name) {
  return ROUTINE_COLORS[name] || ROUTINE_COLORS.rose;
}

/**
 * حلقة تقدّم SVG.
 * - عند 0% يُرسم إناء رمادي كامل مع نقطة بداية صغيرة لتبدو حيّة لا معطوبة.
 * - اللون واحد (sRGB صريح) بدل تدرّج: التدرّج على مسار دائري مغلق
 *   كان يترك هالة وردية غير مبررة في الزوايا.
 */
export function progressRing(percent, size = 132, stroke = 10) {
  const pct = Math.max(0, Math.min(100, Number(percent) || 0));
  const inset = stroke / 2 + 1; // نترك لمحرف النهاية مساحة داخل الـ viewBox
  const r = (size - inset * 2) / 2;
  const c = 2 * Math.PI * r;
  const shown = pct === 0 ? 0 : Math.max(pct, 3);
  const offset = c - (shown / 100) * c;
  const cx = size / 2;
  const cy = size / 2;

  if (pct === 0) {
    return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="لم تبدأ روتينات اليوم بعد">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-border)" stroke-width="${stroke}"/>
      <circle cx="${cx}" cy="${inset}" r="${stroke / 2 - 1}" fill="var(--brand-300)"/>
    </svg>`;
  }

  return `<svg class="ring" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="نسبة إنجاز اليوم ${pct} في المئة">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-border)" stroke-width="${stroke}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--brand-500)" stroke-width="${stroke}"
      stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${offset}"
      transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dashoffset .6s var(--ease)"/>
  </svg>`;
}

export function weekdayBadge(days, labels) {
  if (!days || days.length === 0 || days.length === 7) return 'كل يوم';
  if (days.length === 5 && ['sun', 'mon', 'tue', 'wed', 'thu'].every((d) => days.includes(d))) return 'أيام العمل';
  if (days.length === 2 && days.includes('fri') && days.includes('sat')) return 'نهاية الأسبوع';
  return days.map((d) => labels[d]?.slice(0, 3)).join(' · ');
}

export function formatTimeLabel(time) {
  if (!time) return '٢٤ ساعة';
  const [hRaw, m] = time.split(':').map(Number);
  const suffix = hRaw >= 12 ? 'م' : 'ص';
  const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
  const toAr = (n) => String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  // مهم: نضع الرقم كاملًا داخل عنصر معزول
  // وإلا فمحرف النقطتين في RTL يعكس ترتيب «٩:٣٠» إلى «٣٠:٩».
  return `<bdi>${toAr(h)}:${toAr(String(m).padStart(2, '0'))}</bdi> ${suffix}`;
}

/** نسخ نصية آمنة (بلا HTML) — للمواضع التي تُدرج داخل escapeHtml */
export function formatTimeText(time) {
  if (!time) return '٢٤ ساعة';
  const [hRaw, m] = time.split(':').map(Number);
  const suffix = hRaw >= 12 ? 'م' : 'ص';
  const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
  const toAr = (n) => String(n).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
  return `\u2066${toAr(h)}:${toAr(String(m).padStart(2, '0'))}\u2069 ${suffix}`;
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'سهرة موفقة';
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'نهارك سعيد';
  if (h < 21) return 'مساء الخير';
  return 'مساء هادئ';
}

export function arabicCount(n, one, two, few, many) {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}
