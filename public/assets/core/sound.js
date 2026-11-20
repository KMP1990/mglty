/**
 * أصوات التطبيق — مزامنة خفيفة عبر Web Audio بلا ملفات صوتية.
 * ------------------------------------------------------------
 * • تعمل فور أول لمس/ضغطة (سياسة المتصفحات تمنع الصوت قبل تفاعل).
 * • التفضيل مرتبط بالحساب ويُزامَن مع الخادم عند تسجيل الدخول.
 * • كل الأصوات مُولّدة داخل المتصفح: لا تحميل ملفات ولا طلبات شبكة.
 */

const GUEST_KEY = 'mr:sound:guest';
const USER_PREFIX = 'mr:sound:';
const DEFAULTS = { enabled: true, volume: 0.55 };

let userId = null;
let settings = { ...DEFAULTS };
let context = null;
let master = null;
let unlocked = false;
let noiseBuffer = null;

const clampVolume = (value) => Math.max(0, Math.min(1, Number(value)));

function keyFor(id) {
  return id ? `${USER_PREFIX}${id}` : GUEST_KEY;
}

function read(id) {
  try {
    const raw = JSON.parse(localStorage.getItem(keyFor(id)) || 'null');
    return {
      enabled: raw?.enabled !== false,
      volume: raw?.volume == null ? DEFAULTS.volume : clampVolume(raw.volume),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function write() {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(settings));
  } catch {
    /* التخزين محجوب — يبقى الصوت فعالًا في هذه الجلسة */
  }
  document.dispatchEvent(new CustomEvent('mr:sound-changed', { detail: { ...settings } }));
  updateHeader();
}

function ensureContext() {
  if (typeof window === 'undefined') return null;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!context) {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = settings.volume;
    master.connect(context.destination);
  }
  return context;
}

function resume() {
  // لا ننشئ AudioContext قبل تفاعل حقيقي. إنشاءه مبكرًا يسبب تحذير
  // «The AudioContext was not allowed to start» في Chrome.
  if (!unlocked || !context) return null;
  if (context.state === 'suspended') context.resume().catch(() => { });
  return context;
}

function applyVolume() {
  if (!master || !context) return;
  master.gain.setTargetAtTime(settings.volume, context.currentTime, 0.02);
}

function tone(freq, { at = 0, duration = 0.14, type = 'sine', gain = 0.08, slideTo = null } = {}) {
  const ctx = ensureContext();
  if (!ctx || !master) return;
  const start = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), start + duration);
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(env);
  env.connect(master);
  osc.start(start);
  osc.stop(start + duration + 0.03);
}

function noise({ at = 0, duration = 0.16, gain = 0.025, frequency = 1200, q = 0.9 } = {}) {
  const ctx = ensureContext();
  if (!ctx || !master) return;
  if (!noiseBuffer) {
    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.25));
    noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2;
  }
  const start = ctx.currentTime + at;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.015);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter);
  filter.connect(env);
  env.connect(master);
  source.start(start);
  source.stop(start + duration + 0.02);
}

const EFFECTS = {
  tap() {
    tone(540, { duration: 0.055, type: 'sine', gain: 0.035 });
  },
  pop() {
    tone(660, { duration: 0.07, type: 'triangle', gain: 0.06, slideTo: 880 });
  },
  page() {
    noise({ duration: 0.13, gain: 0.018, frequency: 1800, q: 0.6 });
    tone(240, { at: 0.02, duration: 0.09, type: 'sine', gain: 0.022, slideTo: 180 });
  },
  bookmark() {
    tone(784, { duration: 0.1, type: 'triangle', gain: 0.06 });
    tone(1046, { at: 0.07, duration: 0.12, type: 'sine', gain: 0.045 });
  },
  success() {
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((freq, index) => tone(freq, { at: index * 0.065, duration: 0.22, type: 'triangle', gain: 0.065 }));
  },
  fanfare() {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, index) => tone(freq, { at: index * 0.09, duration: 0.34, type: 'triangle', gain: 0.07 }));
    tone(130.81, { at: 0.02, duration: 0.5, type: 'sine', gain: 0.04 });
  },
  notify() {
    tone(880, { duration: 0.2, type: 'sine', gain: 0.07 });
    tone(1174.66, { at: 0.11, duration: 0.28, type: 'sine', gain: 0.055 });
    tone(880, { at: 0.24, duration: 0.16, type: 'sine', gain: 0.035 });
  },
  error() {
    tone(220, { duration: 0.2, type: 'square', gain: 0.045, slideTo: 150 });
    tone(164, { at: 0.12, duration: 0.22, type: 'sine', gain: 0.04, slideTo: 120 });
  },
  warning() {
    tone(392, { duration: 0.13, type: 'triangle', gain: 0.055 });
    tone(311, { at: 0.11, duration: 0.18, type: 'triangle', gain: 0.05 });
  },
  ai() {
    [880, 1174.66, 1567.98, 2093].forEach((freq, index) =>
      tone(freq, { at: index * 0.055, duration: 0.26, type: 'sine', gain: 0.03 })
    );
  },
  notifyBell() {
    [1046.5, 1318.5, 1568].forEach((freq, index) =>
      tone(freq, { at: index * 0.1, duration: 0.34, type: 'triangle', gain: 0.055 })
    );
    tone(523.25, { at: 0.02, duration: 0.5, type: 'sine', gain: 0.03 });
  },
  notifySoft() {
    tone(587.33, { duration: 0.24, type: 'sine', gain: 0.05 });
    tone(783.99, { at: 0.12, duration: 0.3, type: 'sine', gain: 0.035 });
  },
  notifyAlert() {
    tone(880, { duration: 0.14, type: 'square', gain: 0.035 });
    tone(660, { at: 0.13, duration: 0.16, type: 'square', gain: 0.03 });
    tone(880, { at: 0.27, duration: 0.22, type: 'triangle', gain: 0.04 });
  },
  notifySuccess() {
    [659.25, 830.61, 987.77, 1318.5].forEach((freq, index) =>
      tone(freq, { at: index * 0.075, duration: 0.26, type: 'triangle', gain: 0.05 })
    );
  },
  open() {
    noise({ duration: 0.12, gain: 0.014, frequency: 1400, q: 0.5 });
    tone(392, { at: 0.01, duration: 0.2, type: 'triangle', gain: 0.045 });
    tone(587.33, { at: 0.1, duration: 0.22, type: 'sine', gain: 0.04 });
  },
};

function updateHeader() {
  document.querySelectorAll('[data-sound-toggle]').forEach((button) => {
    button.dataset.sound = settings.enabled ? 'on' : 'off';
    button.setAttribute('aria-pressed', String(settings.enabled));
    button.setAttribute('aria-label', settings.enabled ? 'إيقاف أصوات التطبيق' : 'تشغيل أصوات التطبيق');
    button.title = button.getAttribute('aria-label');
    button.querySelector('[data-sound-on]')?.toggleAttribute('hidden', !settings.enabled);
    button.querySelector('[data-sound-off]')?.toggleAttribute('hidden', settings.enabled);
  });
}

export const NOTIFICATION_TONES = [
  { id: 'auto', label: 'تلقائي حسب النوع' },
  { id: 'chime', label: 'جرس هادئ' },
  { id: 'bell', label: 'أجراس' },
  { id: 'soft', label: 'همسة' },
  { id: 'alert', label: 'تنبيه قوي' },
  { id: 'success', label: 'نجاح' },
];

const TONE_KEY = 'mr:notif-tone';

const TYPE_TONES = {
  security: 'alert',
  reminder: 'bell',
  achievement: 'success',
  digest: 'chime',
  insight: 'soft',
  welcome: 'soft',
  system: 'chime',
};

export function notificationTone(type = '') {
  let value = '';
  try {
    value = localStorage.getItem(TONE_KEY) || '';
  } catch {
    value = '';
  }
  if (value === 'auto' || !NOTIFICATION_TONES.some((tone) => tone.id === value)) {
    return TYPE_TONES[type] || (value === 'auto' ? 'chime' : value || 'chime');
  }
  return value;
}

export function setNotificationTone(id) {
  const value = NOTIFICATION_TONES.some((tone) => tone.id === id) ? id : 'chime';
  try {
    localStorage.setItem(TONE_KEY, value);
  } catch {
    /* التخزين محجوب */
  }
  document.dispatchEvent(new CustomEvent('mr:notif-tone-changed', { detail: { tone: value } }));
  return value;
}

export const sound = {
  get enabled() {
    return settings.enabled;
  },
  get volume() {
    return settings.volume;
  },
  get currentUserId() {
    return userId;
  },

  /** ربط تفضيل الحساب — يُستدعى بعد كل تحديث للجلسة */
  setUser(id, pref) {
    const nextId = id || null;
    if (nextId === userId) {
      if (pref && typeof pref === 'object') {
        settings = {
          enabled: pref.enabled !== false,
          volume: pref.volume == null ? settings.volume : clampVolume(pref.volume),
        };
        write();
      }
      return;
    }
    userId = nextId;
    if (pref && typeof pref === 'object' && pref.tone) setNotificationTone(pref.tone);
    settings = pref && typeof pref === 'object'
      ? { enabled: pref.enabled !== false, volume: pref.volume == null ? DEFAULTS.volume : clampVolume(pref.volume) }
      : read(userId);
    write();
    applyVolume();
  },

  setEnabled(value) {
    settings = { ...settings, enabled: Boolean(value) };
    write();
    if (settings.enabled) this.play('pop');
    return settings.enabled;
  },

  toggle() {
    return this.setEnabled(!settings.enabled);
  },

  setVolume(value) {
    settings = { ...settings, volume: clampVolume(value) };
    write();
    applyVolume();
    if (settings.enabled) this.play('tap');
    return settings.volume;
  },

  play(name) {
    if (!settings.enabled) return false;
    const effect = EFFECTS[name];
    if (!effect) return false;
    if (!resume()) return false;
    try {
      effect();
      return true;
    } catch {
      return false;
    }
  },

  /** نغمة إشعار مختارة (chime/bell/soft/alert/success) */
  playNotification(tone = notificationTone()) {
    const names = { chime: 'notify', bell: 'notifyBell', soft: 'notifySoft', alert: 'notifyAlert', success: 'notifySuccess' };
    return this.play(names[tone] || 'notify');
  },

  /** يُستدعى من أول تفاعل لفتح قناة الصوت */
  unlock,
};

/** فتح الصوت عند أول لمس/ضغطة/مفتاح — هنا فقط يُنشأ AudioContext */
function unlock() {
  if (unlocked) return;
  const ctx = ensureContext();
  if (!ctx) return;
  unlocked = true;
  applyVolume();
  if (ctx.state === 'suspended') ctx.resume().catch(() => { });
}
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', unlock, { passive: true });
  document.addEventListener('keydown', unlock);
  document.addEventListener('mr:sound-changed', updateHeader);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', updateHeader, { once: true });
  else updateHeader();
}

export default sound;
