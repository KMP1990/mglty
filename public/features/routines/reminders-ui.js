/**
 * إعدادات التذكير (ميزة فرعية داخل routines).
 * تُركَّب في: الشاشة الرئيسية (نسخة مختصرة) وصفحة الروتينات (كاملة).
 * تتعامل مع: تفعيل التذكيرات، دفعة المساء، خطة الصباح، المنطقة الزمنية، وإذن إشعارات النظام.
 */
import { toast, escapeHtml } from '../../assets/core/core.js';
import { routinesApi, deviceTimeZone } from './api.js';
import { capabilities, requestPermission } from '../device/device.js';
import { iconSvg } from './components.js';

const ZONES = [
  'Asia/Riyadh',
  'Asia/Dubai',
  'Asia/Kuwait',
  'Asia/Qatar',
  'Asia/Baghdad',
  'Asia/Amman',
  'Asia/Beirut',
  'Asia/Damascus',
  'Asia/Karachi',
  'Africa/Cairo',
  'Africa/Casablanca',
  'Africa/Algiers',
  'Europe/London',
  'Europe/Paris',
  'Europe/Istanbul',
  'America/New_York',
  'America/Los_Angeles',
  'UTC',
];

export async function bindReminderSettings(host, { compact = false } = {}) {
  if (!host) return;
  let data;
  try {
    data = (await routinesApi.reminders()).data;
  } catch (err) {
    host.innerHTML = `<p style="margin:0;font-size:.84rem;color:var(--text-muted)">تعذّر تحميل إعدادات التذكير.</p>`;
    return;
  }

  const caps = capabilities();
  const s = data.settings || {};
  const tz = data.timeZone || deviceTimeZone();
  const permState =
    caps.permission === 'granted'
      ? '<span class="chip chip-mint">مفعّلة</span>'
      : caps.permission === 'denied'
        ? '<span class="chip" style="color:var(--danger)">محجوبة</span>'
        : '<span class="chip">غير مفعّلة</span>';

  host.innerHTML = `
    <div class="setting-row">
      <div><div class="label">تذكيرات الروتين</div><p class="desc">تنبيه عند وصول وقت كل روتين.</p></div>
      <label class="switch"><input type="checkbox" data-set="enabled" ${s.enabled !== false ? 'checked' : ''} aria-label="تشغيل التذكيرات"/><span></span></label>
    </div>
    ${compact ? '' : `<div class="setting-row">
      <div><div class="label">دفعة مسائية</div><p class="desc">تذكير بالأشياء المتبقية بعد 8:30 مساءً.</p></div>
      <label class="switch"><input type="checkbox" data-set="eveningNudge" ${s.eveningNudge !== false ? 'checked' : ''} aria-label="دفعة مسائية"/><span></span></label>
    </div>
    <div class="setting-row">
      <div><div class="label">خطة الصباح</div><p class="desc">ملخّص روتينات اليوم صباحًا.</p></div>
      <label class="switch"><input type="checkbox" data-set="morningPlan" ${s.morningPlan !== false ? 'checked' : ''} aria-label="خطة الصباح"/><span></span></label>
    </div>
    <div class="setting-row">
      <div><div class="label">المنطقة الزمنية</div><p class="desc">تُحسب منها الأيام والمواعيد.</p></div>
      <select class="input" data-tz style="max-width:190px;min-height:40px;font-size:.85rem" aria-label="المنطقة الزمنية">
        ${[...new Set([tz, ...ZONES])].map((z) => `<option value="${z}" ${z === tz ? 'selected' : ''}>${z}</option>`).join('')}
      </select>
    </div>`}
    <div class="setting-row">
      <div><div class="label">إشعارات النظام</div><p class="desc">تُظهر التذكير حتى والتطبيق في الخلفية.</p></div>
      <div class="row" style="gap:8px">
        ${permState}
        <button class="btn btn-sm btn-soft" data-perm>${caps.permission === 'granted' ? 'اختبار' : 'تفعيل'}</button>
      </div>
    </div>
    ${compact ? '' : `<div class="row" style="justify-content:space-between;margin-top:6px">
      <small style="color:var(--text-muted)">${iconSvg('moon', 14)} اجعل الجهاز يسمح بالإشعارات لتصلك التذكيرات خارج التطبيق.</small>
      <button class="btn btn-sm btn-ghost" data-send-now>أرسل تذكيرًا الآن</button>
    </div>`}`;

  const setPref = async (key, value) => {
    try {
      await routinesApi.saveSettings({ reminders: { [key]: value } });
      toast.success('تم تحديث إعداد التذكير');
    } catch {
      toast.error('تعذّر حفظ الإعداد');
    }
  };

  host.querySelectorAll('[data-set]').forEach((input) =>
    input.addEventListener('change', () => setPref(input.dataset.set, input.checked))
  );

  host.querySelector('[data-tz]')?.addEventListener('change', async (e) => {
    try {
      await routinesApi.saveSettings({ timeZone: e.target.value });
      toast.success('تم حفظ المنطقة الزمنية');
    } catch {
      toast.error('المنطقة الزمنية غير صالحة');
    }
  });

  host.querySelector('[data-perm]')?.addEventListener('click', async () => {
    if (capabilities().permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      try {
        await reg?.showNotification('تذكير تجريبي 🌸', {
          body: 'هكذا سيصلك تنبيه روتينك خارج التطبيق.',
          icon: '/icons/icon-192.png',
          dir: 'rtl',
          lang: 'ar',
          data: { url: '/routines' },
        });
        toast.success('أرسلنا إشعارًا تجريبيًا');
      } catch {
        toast.warning('لم يظهر الإشعار — قد تكون محجوبة من إعدادات النظام');
      }
      return;
    }
    const result = await requestPermission();
    if (result === 'granted') toast.success('تم تفعيل إشعارات النظام');
    else if (result === 'denied') toast.error('الإذن محجوب — فعّله من إعدادات المتصفح');
  });

  host.querySelector('[data-send-now]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await routinesApi.nudge();
      toast[res.data.sent ? 'success' : 'info'](res.data.sent ? `أُرسل ${res.data.sent} تذكير` : 'لا روتينات متبقية اليوم');
    } catch {
      toast.error('تعذّر إرسال التذكير');
    } finally {
      btn.disabled = false;
    }
  });

  void escapeHtml;
}
