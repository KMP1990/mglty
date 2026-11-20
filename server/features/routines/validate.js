/**
 * التحقق من مدخلات الروتين (ميزة فرعية داخل routines).
 */
export const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export const ICONS = ['sunrise', 'book', 'dumbbell', 'water', 'moon', 'heart', 'leaf', 'coffee', 'brain', 'sparkles', 'walk', 'pen'];
export const COLORS = ['rose', 'mint', 'honey', 'sky', 'lilac', 'sand'];
export const PRIORITIES = ['core', 'support', 'bonus'];
export const ENERGY_LEVELS = ['high', 'medium', 'low'];

const MAX_STEPS = 6;
const MAX_STEP_LENGTH = 120;

export function sanitizeDays(days) {
  if (!Array.isArray(days)) return [];
  const set = new Set(days.filter((d) => WEEKDAY_KEYS.includes(d)));
  return WEEKDAY_KEYS.filter((d) => set.has(d));
}

/** خطوات صغيرة — نطبّعها ونحدّدها بست خطوات كي تبقى قابلة للتنفيذ */
export function sanitizeSteps(steps) {
  if (!Array.isArray(steps)) return null;
  return steps
    .map((step) => String(step ?? '').trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

export function validateRoutineInput(body, { partial = false } = {}) {
  const errors = {};
  const value = {};

  if (!partial || body.title !== undefined) {
    const title = String(body.title ?? '').trim().replace(/\s+/g, ' ');
    if (!title) errors.title = 'اسم الروتين مطلوب';
    else if (title.length < 2) errors.title = 'الاسم قصير جدًا';
    else if (title.length > 80) errors.title = 'الاسم طويل جدًا (80 حرفًا كحد أقصى)';
    else value.title = title;
  }

  if (body.note !== undefined) {
    const note = String(body.note ?? '').trim();
    if (note.length > 300) errors.note = 'الملاحظة طويلة جدًا (300 حرف كحد أقصى)';
    else value.note = note;
  }

  if (body.time !== undefined && body.time !== null && body.time !== '') {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(String(body.time))) errors.time = 'الوقت بصيغة HH:MM';
    else value.time = String(body.time);
  } else if (body.time === null || body.time === '') {
    value.time = null;
  }

  if (body.duration !== undefined && body.duration !== null && body.duration !== '') {
    const minutes = Number(body.duration);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) errors.duration = 'المدة بين 1 و480 دقيقة';
    else value.duration = Math.round(minutes);
  } else if (body.duration === null || body.duration === '') {
    value.duration = null;
  }

  if (body.days !== undefined) value.days = sanitizeDays(body.days);
  if (body.icon !== undefined) value.icon = ICONS.includes(body.icon) ? body.icon : 'sparkles';
  if (body.color !== undefined) value.color = COLORS.includes(body.color) ? body.color : 'rose';

  if (body.steps !== undefined) {
    const steps = sanitizeSteps(body.steps);
    if (!steps) errors.steps = 'الخطوات يجب أن تكون قائمة';
    else if (steps.some((step) => step.length > MAX_STEP_LENGTH)) errors.steps = 'كل خطوة ١٢٠ حرفًا كحد أقصى';
    else value.steps = steps;
  }

  if (body.anchor !== undefined) {
    const anchor = String(body.anchor ?? '').trim().replace(/\s+/g, ' ');
    if (anchor.length > 80) errors.anchor = 'المحفّز طويل جدًا (80 حرفًا كحد أقصى)';
    else value.anchor = anchor;
  }

  if (body.priority !== undefined) value.priority = PRIORITIES.includes(body.priority) ? body.priority : 'support';
  if (body.energy !== undefined) value.energy = ENERGY_LEVELS.includes(body.energy) ? body.energy : 'medium';

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) errors.tags = 'الوسوم يجب أن تكون قائمة';
    else {
      const tags = [];
      for (const raw of body.tags) {
        const tag = String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 24);
        if (tag && !tags.includes(tag)) tags.push(tag);
      }
      if (tags.length > 8) errors.tags = '٨ وسوم كحد أقصى';
      else value.tags = tags;
    }
  }
  if (body.favorite !== undefined) value.favorite = body.favorite === true;
  if (body.pausedUntil !== undefined) {
    if (body.pausedUntil === null || body.pausedUntil === '') value.pausedUntil = null;
    else {
      const date = String(body.pausedUntil);
      const parsed = Date.parse(`${date}T12:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsed)) errors.pausedUntil = 'تاريخ الإيقاف غير صالح';
      else value.pausedUntil = date;
    }
  }

  const textFields = {
    ifThen: [160, 'خطة إذا/فسوف طويلة جدًا'],
    identity: [120, 'عبارة الهوية طويلة جدًا'],
    reward: [120, 'المكافأة طويلة جدًا'],
    baseline: [160, 'النسخة الدنيا طويلة جدًا'],
    environment: [160, 'تهيئة البيئة طويلة جدًا'],
  };
  for (const [key, [max, message]] of Object.entries(textFields)) {
    if (body[key] === undefined) continue;
    const text = String(body[key] ?? '').trim().replace(/\s+/g, ' ');
    if (text.length > max) errors[key] = message;
    else value[key] = text;
  }

  return { errors, value };
}

export function validateSettings(body = {}) {
  const errors = {};
  const value = {};
  if (body.timeZone !== undefined) {
    const tz = String(body.timeZone);
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      value.timeZone = tz;
    } catch {
      errors.timeZone = 'المنطقة الزمنية غير معروفة';
    }
  }
  if (body.reminders && typeof body.reminders === 'object') {
    value.reminders = {};
    for (const key of ['enabled', 'eveningNudge', 'morningPlan']) {
      if (typeof body.reminders[key] === 'boolean') value.reminders[key] = body.reminders[key];
    }
  }
  return { errors, value };
}
