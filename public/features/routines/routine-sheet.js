/**
 * نافذة إنشاء/تعديل روتين — تصميم جديد بالكامل.
 * ------------------------------------------------------------
 * • معاينة حيّة تتغير مع كل اختيار.
 * • مكتبة قوالب جاهزة من الخادم (أو من كتالوج ثابت عند تعذّر الاتصال).
 * • وقت أو «٢٤ ساعة» بضغطة، أيام بتوليفات سريعة.
 * • خطوات صغيرة ومحفّز بدء ومستوى أهمية وطاقة.
 */
import { escapeHtml, toast } from '../../assets/core/core.js';
import { routinesApi } from './api.js';
import { ROUTINE_ICONS, ROUTINE_COLORS, colorOf, iconSvg } from './components.js';

const DAYS = [
  ['sun', 'أحد'],
  ['mon', 'اثن'],
  ['tue', 'ثلا'],
  ['wed', 'أرب'],
  ['thu', 'خمي'],
  ['fri', 'جمع'],
  ['sat', 'سبت'],
];
const WORKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu'];
const WEEKEND = ['fri', 'sat'];
const ar = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);

function dayBadge(days) {
  if (!days.length) return 'كل يوم';
  if (days.length === 5 && WORKDAYS.every((d) => days.includes(d))) return 'أيام العمل';
  if (days.length === 2 && WEEKEND.every((d) => days.includes(d))) return 'نهاية الأسبوع';
  return days.map((d) => DAYS.find(([key]) => key === d)?.[1]).filter(Boolean).join(' · ');
}

function timeText(time) {
  if (!time) return '٢٤ ساعة';
  const [hRaw, m] = time.split(':').map(Number);
  const suffix = hRaw >= 12 ? 'م' : 'ص';
  const h = hRaw % 12 === 0 ? 12 : hRaw % 12;
  return `${ar(h)}:${ar(String(m).padStart(2, '0'))} ${suffix}`;
}

export function openRoutineSheet({ routine = null, onSaved } = {}) {
  const editing = Boolean(routine);
  const value = {
    title: routine?.title || '',
    note: routine?.note || '',
    icon: routine?.icon || 'sparkles',
    color: routine?.color || 'rose',
    time: routine?.time || '',
    duration: routine?.duration ?? '',
    days: Array.isArray(routine?.days) ? [...routine.days] : [],
    anchor: routine?.anchor || '',
    steps: Array.isArray(routine?.steps) && routine.steps.length ? [...routine.steps] : [],
    priority: routine?.priority || 'core',
    energy: routine?.energy || 'medium',
    allDay: editing ? !routine?.time : false,
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'sheet-backdrop';
  backdrop.innerHTML = `
    <div class="sheet sheet-v2" role="dialog" aria-modal="true" aria-labelledby="sheet-title">
      <div class="sheet-head">
        <div>
          <h2 id="sheet-title">${editing ? 'تعديل الروتين' : 'روتين جديد'}</h2>
          <p class="sheet-sub">خطوة صغيرة واضحة تُنجَز اليوم — لا خطة مثالية تُؤجَّل.</p>
        </div>
        <button class="icon-btn" data-close aria-label="إغلاق">✕</button>
      </div>

      <div class="form-alert" data-alert data-kind="error" role="alert"></div>

      <div class="sheet-preview" data-preview aria-live="polite"></div>

      <div class="field">
        <label for="rt-title">ما هو الروتين؟</label>
        <input class="input" id="rt-title" maxlength="80" placeholder="مثال: قراءة ١٠ صفحات" value="${escapeHtml(value.title)}" autocomplete="off" />
        <span class="error-text" data-err="title"></span>
      </div>

      <div class="template-panel">
        <div class="template-head">
          <strong>ابدأ من مكتبة جاهزة</strong>
          <small data-library-count>…</small>
        </div>
        <div class="template-cats" data-cats role="tablist" aria-label="تصنيفات المكتبة"></div>
        <div class="template-strip" data-templates><span class="skeleton" style="height:64px;min-width:180px"></span></div>
      </div>

      <div class="field">
        <span class="field-label">الأيقونة</span>
        <div class="pick-grid" data-icons role="group" aria-label="اختر أيقونة">
          ${Object.keys(ROUTINE_ICONS)
            .map(
              (key) =>
                `<button type="button" class="pick ${
                  key === value.icon ? 'is-on' : ''
                }" data-icon="${key}" aria-pressed="${key === value.icon}" style="--pick:${colorOf(value.color).hex};--pick-soft:${colorOf(value.color).soft}">${iconSvg(
                  key,
                  20
                )}</button>`
            )
            .join('')}
        </div>
      </div>

      <div class="field">
        <span class="field-label">اللون</span>
        <div class="pick-grid" data-colors role="group" aria-label="اختر لونًا">
          ${Object.entries(ROUTINE_COLORS)
            .map(
              ([key, c]) =>
                `<button type="button" class="pick color ${key === value.color ? 'is-on' : ''}" data-color="${key}" aria-pressed="${
                  key === value.color
                }" title="${c.label}" aria-label="${c.label}" style="--pick:${c.hex}"></button>`
            )
            .join('')}
        </div>
      </div>

      <div class="form-2col">
        <div class="field">
          <label for="rt-time">الوقت</label>
          <div class="time-switch">
            <label class="check"><input type="checkbox" data-allday ${value.allDay ? 'checked' : ''} /> طوال اليوم (٢٤ ساعة)</label>
            <input class="input" id="rt-time" type="time" value="${escapeHtml(value.time)}" ${value.allDay ? 'disabled' : ''} />
          </div>
          <span class="hint">بدون وقت يبقى الروتين متاحًا ٢٤ ساعة، ويُحفظ في سجلك عند إنجازه.</span>
          <span class="error-text" data-err="time"></span>
        </div>
        <div class="field">
          <label for="rt-duration">المدة بالدقائق</label>
          <input class="input" id="rt-duration" type="number" min="1" max="480" inputmode="numeric" placeholder="15" value="${value.duration ?? ''}" />
          <span class="hint">قدّرها أقل ممّا تتوقع — البداية أهم من الكمال.</span>
          <span class="error-text" data-err="duration"></span>
        </div>
      </div>

      <div class="field">
        <span class="field-label">أيام التكرار</span>
        <div class="day-presets" data-presets>
          <button type="button" data-preset="all">كل يوم</button>
          <button type="button" data-preset="work">أيام العمل</button>
          <button type="button" data-preset="weekend">نهاية الأسبوع</button>
          <button type="button" data-preset="clear">تفريغ</button>
        </div>
        <div class="day-row" data-days role="group" aria-label="أيام التكرار">
          ${DAYS.map(([key, label]) => `<button type="button" class="day-chip" data-day="${key}" aria-pressed="${value.days.includes(key)}">${label}</button>`).join('')}
        </div>
        <span class="hint">اتركها فارغة ليكون كل يوم.</span>
      </div>

      <details class="advanced" ${editing || value.steps.length ? 'open' : ''}>
        <summary>خيارات متقدمة <small>محفّز • خطوات • أهمية</small></summary>

        <div class="field">
          <label for="rt-anchor">محفّز البدء (اختياري)</label>
          <input class="input" id="rt-anchor" maxlength="80" placeholder="مثال: بعد القهوة / قبل النوم" value="${escapeHtml(value.anchor)}" />
          <span class="hint">ربط الروتين بعادة موجودة يرفع الالتزام أكثر من الوقت وحده.</span>
        </div>

        <div class="field">
          <span class="field-label">خطوات صغيرة</span>
          <div class="steps-editor" data-steps></div>
          <button type="button" class="btn btn-sm btn-ghost" data-add-step>+ خطوة</button>
        </div>

        <div class="form-2col">
          <div class="field">
            <label for="rt-priority">الأهمية</label>
            <select class="input" id="rt-priority">
              <option value="core" ${value.priority === 'core' ? 'selected' : ''}>أساسي — لا أتخلى عنه</option>
              <option value="support" ${value.priority === 'support' ? 'selected' : ''}>مساند</option>
              <option value="bonus" ${value.priority === 'bonus' ? 'selected' : ''}>إضافي</option>
            </select>
          </div>
          <div class="field">
            <label for="rt-energy">الطاقة المطلوبة</label>
            <select class="input" id="rt-energy">
              <option value="low" ${value.energy === 'low' ? 'selected' : ''}>خفيفة</option>
              <option value="medium" ${value.energy === 'medium' ? 'selected' : ''}>متوسطة</option>
              <option value="high" ${value.energy === 'high' ? 'selected' : ''}>عالية</option>
            </select>
          </div>
        </div>
      </details>

      <div class="field">
        <label for="rt-note">ملاحظة (اختياري)</label>
        <textarea class="input" id="rt-note" maxlength="300" rows="2" placeholder="لماذا هذا الروتين مهم لك؟">${escapeHtml(value.note)}</textarea>
      </div>

      <div class="sheet-actions">
        <button class="btn btn-ghost" data-close>إلغاء</button>
        <button class="btn btn-primary" data-save>${editing ? 'حفظ التعديلات' : 'أضف الروتين'}</button>
      </div>
    </div>`;

  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';

  const sheet = backdrop.querySelector('.sheet');
  const titleInput = sheet.querySelector('#rt-title');
  const timeInput = sheet.querySelector('#rt-time');
  const durationInput = sheet.querySelector('#rt-duration');
  const allDayInput = sheet.querySelector('[data-allday]');
  const anchorInput = sheet.querySelector('#rt-anchor');
  const noteInput = sheet.querySelector('#rt-note');
  const stepsBox = sheet.querySelector('[data-steps]');
  const preview = sheet.querySelector('[data-preview]');
  const alertBox = sheet.querySelector('[data-alert]');

  setTimeout(() => titleInput.focus(), 80);

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
  sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));

  function paintPicker(scope) {
    const c = colorOf(value.color);
    sheet.querySelectorAll(`${scope} .pick`).forEach((b) => {
      b.style.setProperty('--pick', c.hex);
      b.style.setProperty('--pick-soft', c.soft);
    });
  }

  function updatePreview() {
    const c = colorOf(value.color);
    const title = titleInput.value.trim() || 'روتينك الجديد';
    preview.style.setProperty('--accent', c.hex);
    preview.style.setProperty('--accent-soft', c.soft);
    const days = dayBadge(value.days);
    const time = value.allDay ? '٢٤ ساعة' : timeText(timeInput.value);
    const duration = durationInput.value ? `${ar(durationInput.value)} دقيقة` : 'بلا مدة';
    preview.innerHTML = `<span class="preview-ico">${iconSvg(value.icon, 22)}</span>
      <div class="preview-body">
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(time)} • ${escapeHtml(days)} • ${escapeHtml(duration)}</small>
        ${anchorInput.value.trim() ? `<em>⚓ ${escapeHtml(anchorInput.value.trim())}</em>` : ''}
      </div>
      <span class="preview-level">🌱</span>`;
    paintPicker('[data-icons]');
  }

  function renderSteps() {
    stepsBox.innerHTML = value.steps
      .map(
        (step, index) => `<div class="step-row">
          <span class="step-num">${ar(index + 1)}</span>
          <input class="input" maxlength="120" data-step placeholder="خطوة صغيرة جدًا" value="${escapeHtml(step)}" />
          <button type="button" class="icon-btn" data-remove-step="${index}" aria-label="حذف الخطوة">✕</button>
        </div>`
      )
      .join('');
    if (!value.steps.length) stepsBox.innerHTML = '<p class="steps-empty">أضف خطوة واحدة صغيرة — تكفي للبدء.</p>';
  }

  function syncDays() {
    sheet.querySelectorAll('[data-day]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(value.days.includes(btn.dataset.day)));
    });
  }

  function applyTemplate(template) {
    value.title = template.title;
    value.note = template.note || '';
    value.icon = template.icon || 'sparkles';
    value.color = template.color || 'rose';
    value.days = Array.isArray(template.days) ? [...template.days] : [];
    value.allDay = !template.time;
    value.steps = Array.isArray(template.steps) ? [...template.steps] : [];
    value.anchor = template.anchor || '';
    value.priority = template.priority || 'core';
    value.energy = template.energy || 'medium';
    value.duration = template.duration ?? '';
    titleInput.value = value.title;
    noteInput.value = value.note;
    durationInput.value = value.duration;
    anchorInput.value = value.anchor;
    timeInput.value = template.time || '';
    allDayInput.checked = value.allDay;
    timeInput.disabled = value.allDay;
    sheet.querySelector('#rt-priority').value = value.priority;
    sheet.querySelector('#rt-energy').value = value.energy;
    sheet.querySelectorAll('[data-icons] .pick').forEach((b) => b.classList.toggle('is-on', b.dataset.icon === value.icon));
    sheet.querySelectorAll('[data-icons] .pick').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.icon === value.icon)));
    sheet.querySelectorAll('[data-colors] .pick').forEach((b) => b.classList.toggle('is-on', b.dataset.color === value.color));
    sheet.querySelectorAll('[data-colors] .pick').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === value.color)));
    renderSteps();
    syncDays();
    updatePreview();
    toast.success(`طُبّق قالب «${template.title}» — عدّل ما تحتاجه`);
  }

  // أيقونة ولون
  sheet.querySelectorAll('[data-icons] .pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      value.icon = btn.dataset.icon;
      sheet.querySelectorAll('[data-icons] .pick').forEach((b) => {
        b.classList.toggle('is-on', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      updatePreview();
    });
  });
  sheet.querySelectorAll('[data-colors] .pick').forEach((btn) => {
    btn.addEventListener('click', () => {
      value.color = btn.dataset.color;
      sheet.querySelectorAll('[data-colors] .pick').forEach((b) => {
        b.classList.toggle('is-on', b === btn);
        b.setAttribute('aria-pressed', String(b === btn));
      });
      updatePreview();
    });
  });

  // الوقت
  allDayInput.addEventListener('change', () => {
    value.allDay = allDayInput.checked;
    timeInput.disabled = value.allDay;
    if (value.allDay) timeInput.value = '';
    updatePreview();
  });
  timeInput.addEventListener('input', () => {
    if (timeInput.value) {
      value.allDay = false;
      allDayInput.checked = false;
      timeInput.disabled = false;
    }
    updatePreview();
  });

  // الأيام
  sheet.querySelectorAll('[data-day]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.day;
      value.days = value.days.includes(key) ? value.days.filter((d) => d !== key) : [...value.days, key];
      syncDays();
      updatePreview();
    });
  });
  sheet.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = btn.dataset.preset;
      value.days = preset === 'all' ? [] : preset === 'work' ? [...WORKDAYS] : preset === 'weekend' ? [...WEEKEND] : [];
      syncDays();
      updatePreview();
    });
  });

  // الخطوات
  stepsBox.addEventListener('input', (e) => {
    const row = e.target.closest('[data-step]');
    if (!row) return;
    const index = [...stepsBox.querySelectorAll('[data-step]')].indexOf(row);
    if (index >= 0) value.steps[index] = row.value;
  });
  stepsBox.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove-step]');
    if (!remove) return;
    value.steps.splice(Number(remove.dataset.removeStep), 1);
    renderSteps();
  });
  sheet.querySelector('[data-add-step]').addEventListener('click', () => {
    if (value.steps.length >= 6) return toast.info('٦ خطوات كافية — البساطة أفضل');
    value.steps.push('');
    renderSteps();
    [...stepsBox.querySelectorAll('[data-step]')].at(-1)?.focus();
  });

  // معاينة حيّة
  ['input', 'change'].forEach((eventName) => {
    titleInput.addEventListener(eventName, updatePreview);
    durationInput.addEventListener(eventName, updatePreview);
    anchorInput.addEventListener(eventName, updatePreview);
  });

  const setErr = (key, msg) => {
    const el = sheet.querySelector(`[data-err="${key}"]`);
    if (!el) return;
    el.textContent = msg || '';
    el.dataset.show = msg ? 'true' : 'false';
  };
  titleInput.addEventListener('input', () => setErr('title', ''));

  renderSteps();
  updatePreview();
  loadLibrary();

  async function loadLibrary() {
    const catsBox = sheet.querySelector('[data-cats]');
    const listBox = sheet.querySelector('[data-templates]');
    const countEl = sheet.querySelector('[data-library-count]');
    let data = null;
    try {
      data = (await routinesApi.library()).data;
    } catch {
      try {
        const res = await fetch(`/features/routines/library.json?v=${window.__MR_VERSION__ || ''}`);
        if (res.ok) data = await res.json();
      } catch {
        data = null;
      }
    }
    if (!data?.categories?.length) {
      countEl.textContent = 'المكتبة غير متاحة الآن';
      listBox.innerHTML = '<p class="template-empty">أضف روتينك يدويًا — كل الحقول تعمل.</p>';
      catsBox.innerHTML = '';
      return;
    }
    countEl.textContent = `${ar(data.routines.length)} قالبًا`;
    catsBox.innerHTML = [
      `<button type="button" data-cat="" aria-pressed="true">الكل</button>`,
      ...data.categories.map((c) => `<button type="button" data-cat="${escapeHtml(c.id)}" aria-pressed="false">${c.emoji || ''} ${escapeHtml(c.name)}</button>`),
    ].join('');
    const renderTemplates = (category = '') => {
      const list = category ? data.routines.filter((r) => r.category === category) : data.routines;
      listBox.innerHTML = list
        .slice(0, 24)
        .map(
          (t) => `<button type="button" class="template-card" data-template="${escapeHtml(t.id)}" style="--accent:${colorOf(t.color).hex};--accent-soft:${colorOf(t.color).soft}">
            <span class="template-ico">${iconSvg(t.icon, 16)}</span>
            <span class="template-body"><strong>${escapeHtml(t.title)}</strong><small>${t.time ? timeText(t.time) : '٢٤ ساعة'} • ${ar(t.duration)} د</small></span>
            <span class="template-plus">+</span>
          </button>`
        )
        .join('') || '<p class="template-empty">لا قوالب في هذا التصنيف.</p>';
    };
    renderTemplates();
    catsBox.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      catsBox.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderTemplates(btn.dataset.cat);
    });
    listBox.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-template]');
      if (!btn) return;
      const template = data.routines.find((t) => t.id === btn.dataset.template);
      if (template) applyTemplate(template);
    });
  }

  const saveBtn = sheet.querySelector('[data-save]');
  saveBtn.addEventListener('click', async () => {
    const payload = {
      title: titleInput.value.trim(),
      note: noteInput.value.trim(),
      icon: value.icon,
      color: value.color,
      time: allDayInput.checked ? null : timeInput.value || null,
      duration: durationInput.value ? Number(durationInput.value) : null,
      days: value.days,
      anchor: anchorInput.value.trim(),
      steps: value.steps.map((s) => s.trim()).filter(Boolean),
      priority: sheet.querySelector('#rt-priority').value,
      energy: sheet.querySelector('#rt-energy').value,
    };
    if (payload.title.length < 2) {
      setErr('title', 'اكتب اسمًا واضحًا للروتين');
      titleInput.focus();
      return;
    }
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="spinner" aria-hidden="true"></span>جارٍ الحفظ…';
    try {
      const res = editing ? await routinesApi.update(routine.id, payload) : await routinesApi.create(payload);
      toast.success(editing ? 'تم تحديث الروتين' : 'أُضيف الروتين — خطوة صغيرة بدأت الآن');
      close();
      onSaved?.(res.data.routine);
    } catch (err) {
      const fields = err.details?.fields || {};
      Object.entries(fields).forEach(([k, v]) => setErr(k, v));
      alertBox.dataset.kind = 'error';
      alertBox.dataset.show = 'true';
      alertBox.textContent = err.message || 'تعذّر الحفظ';
      saveBtn.disabled = false;
      saveBtn.textContent = editing ? 'حفظ التعديلات' : 'أضف الروتين';
    }
  });
}
