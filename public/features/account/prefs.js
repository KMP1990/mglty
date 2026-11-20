/**
 * لوحة التفضيلات (ميزة فرعية داخل account): الثيم + إشعارات النظام + الخروج.
 */
import { api, appStore, auth, theme, toast, sound } from '../../assets/core/core.js';
import { pushStatus, subscribePush, unsubscribePush } from '../device/device.js';
import { sendReadingReminderNow } from '../books/reminder.js';

export function bindPrefsPanel(panel, { root }) {
  void root;
  const mode = theme.stored;
  const reading = appStore.state.user?.preferences?.readingReminder || { enabled: false, time: '20:30' };
  panel.innerHTML = `
    <header>
      <span class="panel-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg></span>
      <div><h3>التفضيلات</h3><p>المظهر والإشعارات والجلسة.</p></div>
    </header>

    <div class="row-between">
      <div><div class="label">المظهر</div><p class="desc">يُطبَّق فورًا ويُحفظ على جهازك.</p></div>
      <div class="theme-options" role="group" aria-label="المظهر">
        <button class="theme-option" data-mode="light" aria-pressed="${mode === 'light'}">☀️ فاتح</button>
        <button class="theme-option" data-mode="dark" aria-pressed="${mode === 'dark'}">🌙 داكن</button>
        <button class="theme-option" data-mode="system" aria-pressed="${mode === 'system'}">🖥️ حسب النظام</button>
      </div>
    </div>

    <div class="row-between">
      <div><div class="label">أصوات التطبيق</div><p class="desc">نغمات قصيرة للإنجاز والقراءة والإشعارات. تُولّد داخل المتصفح بلا تنزيل.</p></div>
      <div class="sound-pref">
        <label class="check"><input type="checkbox" data-sound-enabled ${sound.enabled ? 'checked' : ''}/> مفعّلة</label>
        <input type="range" data-sound-volume min="0" max="100" step="5" value="${Math.round(sound.volume * 100)}" aria-label="مستوى الصوت" />
        <button class="btn btn-sm btn-ghost" type="button" data-sound-test>تجربة</button>
      </div>
    </div>

    <div class="row-between">
      <div><div class="label">تذكير القراءة</div><p class="desc">إشعار يومي إن لم تقرأ، مرتبط بمكتبتك على هذا الجهاز.</p></div>
      <div class="reading-pref">
        <label class="check"><input type="checkbox" data-reading-enabled ${reading.enabled ? 'checked' : ''}/> مفعّل</label>
        <input class="input" type="time" data-reading-time value="${escapeAttr(reading.time || '20:30')}" aria-label="وقت تذكير القراءة" />
        <button class="btn btn-sm btn-ghost" type="button" data-reading-test>جرّب الآن</button>
      </div>
    </div>

    <div class="row-between">
      <div><div class="label">الإشعارات خارج التطبيق</div><p class="desc">تذكيرات وملخص يومي يصلان عبر Web Push حتى لو أغلقت التطبيق لأيام.</p></div>
      <button class="btn btn-sm btn-soft" data-sys-perm>جارٍ الفحص…</button>
    </div>

    <div class="row-between">
      <div><div class="label">تسجيل الخروج</div><p class="desc">إنهاء الجلسة على هذا الجهاز فقط.</p></div>
      <button class="btn btn-sm btn-soft" data-logout>خروج</button>
    </div>`;

  async function savePreferences(patch, message) {
    const res = await api.patch('/api/me', { preferences: patch }, { silent: true });
    appStore.set({ user: res.data.user });
    if (patch.sound) sound.setUser(res.data.user.id, res.data.user.preferences?.sound);
    if (message) toast.success(message);
    return res.data.user;
  }

  function escapeAttr(value) {
    return String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  panel.querySelectorAll('[data-mode]').forEach((b) =>
    b.addEventListener('click', async () => {
      const value = b.dataset.mode;
      theme.set(value);
      panel.querySelectorAll('[data-mode]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      try {
        const res = await api.patch('/api/me', { preferences: { theme: value } }, { silent: true });
        appStore.set({ user: res.data.user });
      } catch { }
      toast.success('تم تغيير المظهر');
    })
  );

  panel.querySelector('[data-sound-enabled]')?.addEventListener('change', async (e) => {
    const enabled = e.currentTarget.checked;
    sound.setEnabled(enabled);
    try {
      await savePreferences({ sound: { enabled, volume: sound.volume } }, enabled ? 'أصوات التطبيق مفعّلة' : 'أصوات التطبيق متوقفة');
    } catch (err) {
      toast.error(err?.message || 'تعذّر حفظ إعداد الصوت');
    }
  });

  panel.querySelector('[data-sound-volume]')?.addEventListener('change', async (e) => {
    const volume = Number(e.currentTarget.value) / 100;
    sound.setVolume(volume);
    try {
      await savePreferences({ sound: { enabled: sound.enabled, volume } }, null);
    } catch (err) {
      toast.error(err?.message || 'تعذّر حفظ مستوى الصوت');
    }
  });

  panel.querySelector('[data-sound-test]')?.addEventListener('click', () => {
    sound.play('success');
  });

  const syncSoundControls = () => {
    const enabled = panel.querySelector('[data-sound-enabled]');
    const volume = panel.querySelector('[data-sound-volume]');
    if (enabled) enabled.checked = sound.enabled;
    if (volume) volume.value = String(Math.round(sound.volume * 100));
  };
  document.addEventListener('mr:sound-changed', syncSoundControls);

  panel.querySelector('[data-reading-enabled]')?.addEventListener('change', async (e) => {
    const enabled = e.currentTarget.checked;
    const time = panel.querySelector('[data-reading-time]').value || '20:30';
    try {
      await savePreferences({ readingReminder: { enabled, time } }, enabled ? `سنذكّرك بالقراءة عند ${time}` : 'أوقفنا تذكير القراءة');
    } catch (err) {
      e.currentTarget.checked = !enabled;
      toast.error(err?.message || 'تعذّر حفظ التذكير');
    }
  });

  panel.querySelector('[data-reading-time]')?.addEventListener('change', async (e) => {
    const time = e.currentTarget.value || '20:30';
    const enabled = panel.querySelector('[data-reading-enabled]').checked;
    try {
      await savePreferences({ readingReminder: { enabled, time } }, `وقت التذكير: ${time}`);
    } catch (err) {
      toast.error(err?.message || 'تعذّر حفظ الوقت');
    }
  });

  panel.querySelector('[data-reading-test]')?.addEventListener('click', async (e) => {
    const button = e.currentTarget;
    button.disabled = true;
    button.textContent = 'جارٍ الإرسال…';
    try {
      await sendReadingReminderNow();
      toast.success('أرسلنا تذكير القراءة إلى إشعاراتك 🔔', { sound: false });
    } catch (err) {
      toast.error(err?.message || 'تعذّر إرسال التذكير');
    } finally {
      button.disabled = false;
      button.textContent = 'جرّب الآن';
    }
  });

  async function syncPushButton() {
    const button = panel.querySelector('[data-sys-perm]');
    if (!button) return;
    const status = await pushStatus();
    if (!status.supported) {
      button.textContent = 'غير مدعومة في هذا المتصفح';
      button.disabled = true;
      return;
    }
    if (status.permission === 'denied') {
      button.textContent = 'محجوبة من المتصفح';
      button.disabled = false;
      return;
    }
    button.disabled = false;
    button.dataset.subscribed = String(status.subscribed);
    button.textContent = status.subscribed ? 'مفعّلة ✓' : 'تفعيل';
  }
  void syncPushButton();

  panel.querySelector('[data-sys-perm]').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const status = await pushStatus();
      if (status.permission === 'denied') {
        return toast.error('الإذن محجوب — فعّله من إعدادات الموقع في المتصفح (أيقونة القفل).');
      }
      if (status.subscribed) {
        const result = await unsubscribePush();
        if (!result.ok) throw new Error(result.reason || 'تعذّر الإيقاف');
        toast.info('أوقفنا الإشعارات خارج التطبيق على هذا الجهاز');
      } else {
        const result = await subscribePush();
        if (!result.ok) {
          const reasons = { unsupported: 'المتصفح لا يدعم الإشعارات السحابية', denied: 'الإذن محجوب من المتصفح', disabled: 'الخادم لم يجهّز الإشعارات بعد' };
          throw new Error(reasons[result.reason] || result.reason || 'تعذّر التفعيل');
        }
        toast.success('تم التفعيل — ستصلك الإشعارات والتطبيق مغلق');
      }
      await syncPushButton();
    } catch (err) {
      toast.error(err?.message || 'تعذّر تغيير حالة الإشعارات');
    } finally {
      b.disabled = false;
    }
  });

  panel.querySelector('[data-logout]').addEventListener('click', async () => {
    try {
      await auth.logout();
      toast.success('تم تسجيل الخروج');
      location.assign('/');
    } catch {
      toast.error('تعذّر تسجيل الخروج');
    }
  });
}
