/**
 * مكتبة أنظمة الروتين الجاهزة — نافذة واحدة تعرض الأنظمة الخمسة:
 * توافق النظام مع سجل المستخدم، معاينة روتيناته، ثم تفعيله بدفعة واحدة.
 */
import { escapeHtml, toast } from '../../assets/core/core.js';
import { routinesApi } from './api.js';
import { colorOf, iconSvg } from './components.js';

const ar = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

const timeLabel = (time) => {
  if (!time) return '٢٤ ساعة';
  const [h, m] = time.split(':').map(Number);
  const suffix = h >= 12 ? 'م' : 'ص';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `<bdi>${ar(hour)}:${ar(String(m).padStart(2, '0'))}</bdi> ${suffix}`;
};

const priorityLabel = { core: 'أساسي', support: 'مساند', bonus: 'إضافي' };

function systemCard(system, recommendedIds) {
  const c = colorOf(system.color);
  const review = system.review || {};
  const applied = review.applied || { count: 0, total: system.routineCount, doneToday: 0 };
  const active = applied.count > 0;
  const recommended = recommendedIds.includes(system.id);

  return `<article class="system-card" data-system="${escapeHtml(system.id)}"
      style="--accent:${c.hex};--accent-soft:${c.soft}">
    <header class="system-card-head">
      <span class="system-ico">${iconSvg(system.icon, 22)}</span>
      <div class="system-card-title">
        <h3>${escapeHtml(system.name)}</h3>
        <p>${escapeHtml(system.tagline)}</p>
      </div>
      <span class="system-score" data-verdict="${escapeHtml(review.verdict || 'partial')}" title="توافق النظام مع سجلك">
        ${ar(review.score ?? 50)}٪
      </span>
    </header>

    <div class="system-tags">
      <span class="mini-chip accent">${escapeHtml(system.level)}</span>
      <span class="mini-chip"><bdi>${ar(system.routineCount)}</bdi> روتين</span>
      <span class="mini-chip"><bdi>${ar(system.durationDays)}</bdi> يوم</span>
      ${recommended ? '<span class="mini-chip recommended">★ مقترح لك</span>' : ''}
    </div>

    <p class="system-desc">${escapeHtml(system.description)}</p>
    ${review.headline ? `<p class="system-headline">${escapeHtml(review.headline)}</p>` : ''}
    ${active ? `<p class="system-applied">مفعّل: ${ar(applied.count)} من ${ar(system.routineCount)} • أنجزت اليوم ${ar(applied.doneToday)}</p>` : ''}

    <details class="system-preview">
      <summary>معاينة الروتينات</summary>
      <ul>
        ${system.preview
          .map(
            (r) => `<li><span>${escapeHtml(r.title)}</span>
              <small>${timeLabel(r.time)} • ${escapeHtml(priorityLabel[r.priority] || '')}</small></li>`
          )
          .join('')}
      </ul>
    </details>

    <div class="system-actions">
      <select class="input" data-intensity aria-label="مقدار النظام">
        <option value="full">النظام كامل</option>
        <option value="core">الأساسيات فقط</option>
        <option value="light">بداية خفيفة</option>
      </select>
      <button class="btn btn-primary btn-sm" data-apply="${escapeHtml(system.id)}">
        ${active ? 'أكمل الناقص' : 'أضف النظام'}
      </button>
    </div>
  </article>`;
}

export function openSystemsSheet({ onApplied } = {}) {
  let localMode = false;
  let localSystems = [];
  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet systems-sheet" role="dialog" aria-modal="true" aria-labelledby="systems-title">
      <div class="sheet-head">
        <div>
          <h2 id="systems-title">أنظمة روتين جاهزة</h2>
          <p class="hint" style="margin:4px 0 0">خمسة أنظمة مبنية على سلوك حقيقي. اختر ما يناسب مرحلتك — الإضافة لا تمس روتيناتك الحالية.</p>
        </div>
        <button class="icon-btn" data-close aria-label="إغلاق">✕</button>
      </div>
      <div class="systems-grid" data-list>
        <div class="skeleton" style="height:220px"></div>
        <div class="skeleton" style="height:220px"></div>
      </div>
    </div>`;

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const sheet = backdrop.querySelector('.sheet');
  const list = sheet.querySelector('[data-list]');

  const close = () => {
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
    document.body.style.overflow = '';
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  sheet.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));

  async function load() {
    try {
      const res = await routinesApi.systems();
      const systems = res.data.systems || [];
      const recommendedIds = (res.data.recommended || []).map((r) => r.id);
      if (!systems.length) {
        list.innerHTML = '<p class="hint-line">لا توجد أنظمة متاحة الآن.</p>';
        return;
      }
      localMode = false;
      list.innerHTML = systems.map((system) => systemCard(system, recommendedIds)).join('');
    } catch (err) {
      // توافق مع خادم قديم أو نشر لم يُحدَّث: نقرأ الكتالوج الثابت المولّد مع البناء
      await loadFallback(err);
    }
  }

  async function loadFallback(error) {
    try {
      const res = await fetch(`/features/routines/systems.json?v=${window.__MR_VERSION__ || ''}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      localSystems = data.systems || [];
      if (!localSystems.length) throw new Error('empty catalog');
      localMode = true;
      const recommendedIds = localSystems.slice(0, 2).map((s) => s.id);
      const cards = localSystems.map((system) => {
        const routines = system.routines || [];
        const core = routines.filter((r) => r.priority === 'core').length;
        return systemCard(
          {
            ...system,
            routineCount: routines.length,
            coreCount: core,
            preview: routines.map((r) => ({ title: r.title, time: r.time, duration: r.duration, priority: r.priority })),
            review: {
              score: 55,
              verdict: 'partial',
              headline: 'وضع محلي: الخادم الحالي لا يعرف مسار الأنظمة. يمكنك الإضافة الآن، وسيعمل التقييم بعد تحديث الخادم وإعادة تشغيله.',
              applied: { count: 0, total: routines.length, doneToday: 0 },
            },
          },
          recommendedIds
        );
      });
      list.innerHTML = `<div class="systems-offline">⚠️ وضع محلي — تعذّر قراءة الأنظمة من الخادم (${escapeHtml(
        error?.message || '404'
      )}). أعد تشغيل الخادم لتظهر نسب التوافق. <button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>${cards.join('')}`;
      list.querySelector('[data-retry]')?.addEventListener('click', load);
    } catch (fallbackError) {
      list.innerHTML = `<div class="starter"><span class="emoji">📡</span><strong>تعذّر تحميل الأنظمة</strong><p>${escapeHtml(
        error?.message || fallbackError.message
      )}</p><button class="btn btn-sm btn-soft" data-retry>إعادة المحاولة</button></div>`;
      list.querySelector('[data-retry]')?.addEventListener('click', load);
    }
  }

  /** إضافة محلية عند غياب مسار الأنظمة في الخادم */
  async function applyLocally(system, intensity) {
    let pool = system.routines || [];
    if (intensity === 'core') pool = pool.filter((r) => r.priority === 'core');
    else if (intensity === 'light') pool = pool.filter((r) => r.priority === 'core').slice(0, 4);
    let created = 0;
    let skipped = 0;
    for (const routine of pool) {
      try {
        await routinesApi.create({
          title: routine.title,
          note: routine.note,
          icon: routine.icon,
          color: routine.color,
          time: routine.time,
          duration: routine.duration,
          days: routine.days,
          anchor: routine.anchor,
          steps: routine.steps,
          priority: routine.priority,
          energy: routine.energy,
          systemId: system.id,
          systemName: system.name,
          systemKey: routine.key,
        });
        created += 1;
      } catch {
        skipped += 1;
      }
    }
    return { created, skipped, system: { name: system.name }, local: true };
  }

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-apply]');
    if (!btn) return;
    const card = btn.closest('[data-system]');
    const id = btn.dataset.apply;
    const intensity = card?.querySelector('[data-intensity]')?.value || 'full';

    const original = btn.textContent;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" aria-hidden="true"></span>جارٍ الإضافة…';
    try {
      let result = null;
      if (!localMode) {
        try {
          const res = await routinesApi.applySystem(id, { intensity, mode: 'merge' });
          result = { created: res.data.created?.length || 0, skipped: res.data.skipped?.length || 0, system: res.data.system };
        } catch (err) {
          if (err?.status === 404) await loadFallback(err);
          else throw err;
        }
      }
      if (!result) {
        const system = localSystems.find((s) => s.id === id);
        if (!system) throw new Error('النظام غير موجود محليًا');
        result = await applyLocally(system, intensity);
      }
      if (result.created) {
        toast.success(`أُضيف ${ar(result.created)} روتينًا من «${result.system.name}»`);
        onApplied?.(result);
      } else if (result.skipped) {
        toast.info('كل روتينات هذا النظام موجودة عندك بالفعل');
      } else {
        toast.info('لا جديد لإضافته');
      }
      await load();
    } catch (err) {
      toast.error(err.message || 'تعذّر تفعيل النظام');
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  load();
  return { close, reload: load };
}
