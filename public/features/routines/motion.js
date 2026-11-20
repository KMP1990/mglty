/**
 * حركات نظام الروتين — بلا مكتبات وبلا صور.
 * كل الحركات تحترم prefers-reduced-motion: عند تعطيل الحركة لا نضيف طبقات.
 */
import { STAGES } from './evolution.js';

const reduced = () => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

function overlay(html, className, ttl = 2200) {
  if (reduced()) return;
  const layer = document.createElement('div');
  layer.className = `motion-layer ${className}`;
  layer.innerHTML = html;
  document.body.appendChild(layer);
  requestAnimationFrame(() => layer.classList.add('is-on'));
  setTimeout(() => {
    layer.classList.remove('is-on');
    setTimeout(() => layer.remove(), 500);
  }, ttl);
  return layer;
}

/** وميض صغير عند إنجاز عادي */
export function sparkle(target) {
  if (reduced() || !target) return;
  const rect = target.getBoundingClientRect();
  const burst = document.createElement('span');
  burst.className = 'sparkle-burst';
  burst.style.left = `${rect.left + rect.width / 2}px`;
  burst.style.top = `${rect.top + rect.height / 2}px`;
  burst.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i>';
  document.body.appendChild(burst);
  setTimeout(() => burst.remove(), 750);
}

/** احتفال مستوى جديد */
export function levelUp({ title = '', level = 1, stage = 'seed', stageName = '' } = {}) {
  const meta = STAGES.find((s) => s.id === stage) || STAGES[0];
  return overlay(
    `<div class="levelup-card" role="status" aria-live="polite">
      <span class="levelup-halo" aria-hidden="true"></span>
      <span class="levelup-emoji" aria-hidden="true">${meta.emoji}</span>
      <strong>تطور جديد!</strong>
      <h3>${escape(title)}</h3>
      <p>وصلت إلى المستوى ${ar(level)} — ${escape(stageName || meta.name)}</p>
    </div>
    <div class="confetti" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>`,
    'levelup'
  );
}

/** احتفال إتمام اليوم كله */
export function celebrateDay() {
  return overlay(
    `<div class="day-celebrate" role="status" aria-live="polite">
      <span class="day-celebrate-emoji" aria-hidden="true">🎉</span>
      <strong>أتممت روتينات اليوم</strong>
      <p>يوم كامل في رصيدك — غدًا نبدأ من مكان أعلى.</p>
    </div>
    <div class="confetti" aria-hidden="true">${Array.from({ length: 26 }, (_, i) => `<i style="--i:${i}"></i>`).join('')}</div>`,
    'daydone',
    2600
  );
}

/** دخول متدرج لبطاقات القائمة */
export function stagger(container, selector = '.routine-card-item') {
  if (reduced() || !container) return;
  [...container.querySelectorAll(selector)].forEach((node, index) => {
    node.style.setProperty('--enter-delay', `${Math.min(index * 45, 420)}ms`);
    node.classList.add('enter-anim');
  });
}

/** نبضة أيقونة عند تغيّر الحالة */
export function pulseIcon(node) {
  if (reduced() || !node) return;
  node.classList.remove('icon-pulse');
  void node.offsetWidth;
  node.classList.add('icon-pulse');
  setTimeout(() => node.classList.remove('icon-pulse'), 700);
}

const ar = (n) => String(Number(n) || 1).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

function escape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
