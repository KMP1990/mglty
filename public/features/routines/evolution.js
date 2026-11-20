/**
 * عرض تطور الروتين في الواجهة — مراحل ومستويات وشريط XP.
 * كل القيم تأتي من الخادم؛ هنا الشكل والحركة فقط.
 */
export const STAGES = [
  { id: 'seed', name: 'بذرة', emoji: '🌱', minLevel: 1 },
  { id: 'sprout', name: 'برعم', emoji: '🌿', minLevel: 3 },
  { id: 'grow', name: 'نمو', emoji: '🌳', minLevel: 5 },
  { id: 'bloom', name: 'إزهار', emoji: '🌸', minLevel: 7 },
  { id: 'master', name: 'إتقان', emoji: '🏆', minLevel: 9 },
  { id: 'legend', name: 'أسطورة', emoji: '✨', minLevel: 12 },
];

const ar = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

export function stageOf(progress = {}) {
  const level = Math.max(1, Number(progress.level) || 1);
  return [...STAGES].reverse().find((stage) => level >= stage.minLevel) || STAGES[0];
}

/** شارة المستوى — تُستخدم على البطاقات */
export function levelBadge(progress = null) {
  if (!progress) return '';
  const stage = stageOf(progress);
  return `<span class="evolution-badge" data-stage="${stage.id}" title="المستوى ${ar(progress.level)} — ${stage.name}">
    <span class="evo-emoji" aria-hidden="true">${stage.emoji}</span>
    <b>${ar(progress.level)}</b>
    <small>${stage.name}</small>
  </span>`;
}

/** شريط XP صغير */
export function evolutionBar(progress = null, { compact = false } = {}) {
  if (!progress) return '';
  const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
  return `<div class="evolution-bar" data-compact="${Boolean(compact)}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${percent}" aria-label="تقدم المستوى ${ar(progress.level)}">
    <i style="width:${percent}%"></i>
    ${compact ? '' : `<small>${ar(progress.xpIntoLevel)} / ${ar(progress.xpForNext)} XP</small>`}
  </div>`;
}

/** كتلة تطور كاملة للبطاقة */
export function evolutionBlock(progress = null) {
  if (!progress) return '';
  const stage = stageOf(progress);
  return `<div class="evolution-block" data-stage="${stage.id}">
    ${levelBadge(progress)}
    ${evolutionBar(progress)}
    <span class="evolution-line">${stage.emoji} ${stage.name} • أنجزته ${ar(progress.doneCount)} مرة</span>
  </div>`;
}

/** نص وصف التطور القادم */
export function nextEvolutionText(progress = null) {
  if (!progress) return '';
  const next = STAGES.find((stage) => stage.minLevel > (progress.level || 1));
  return next ? `المستوى القادم: ${next.name} ${next.emoji} عند المستوى ${ar(next.minLevel)}` : 'وصلت إلى أعلى مرحلة — حافظ على الإيقاع ✨';
}

export { ar };
