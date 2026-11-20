/**
 * صورة الحساب (ميزة فرعية داخل account).
 * تصغير الصورة في المتصفح ثم رفعها كـ data URL صغير؛ الخادم يتحقق من النوع
 * والحجم والأبعاد، والهيدر يعرض الصورة بدل الحروف الأولى تلقائيًا.
 */
import { api, appStore, toast } from '../../assets/core/core.js';

const MAX_FILE_BYTES = 12 * 1024 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('تعذّر قراءة الصورة'));
    };
    image.src = url;
  });
}

/** قص مربّع من المركز ثم تصغير إلى 384px — ينتج صورة صغيرة وواضحة */
export async function prepareAvatar(file) {
  if (!file) throw new Error('لم تُختر صورة');
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error('اختر صورة PNG أو JPG أو WebP');
  if (file.size > MAX_FILE_BYTES) throw new Error('الصورة كبيرة جدًا (الحد 12 م.ب)');
  const image = await loadImage(file);
  const side = Math.min(image.naturalWidth || image.width, image.naturalHeight || image.height);
  if (!side) throw new Error('أبعاد الصورة غير صالحة');
  const size = Math.min(384, side);
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 384;
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 384, 384);
  const sx = ((image.naturalWidth || image.width) - side) / 2;
  const sy = ((image.naturalHeight || image.height) - side) / 2;
  ctx.drawImage(image, sx, sy, side, side, 0, 0, 384, 384);
  let dataUrl = canvas.toDataURL('image/jpeg', 0.86);
  if (dataUrl.length > 1_200_000) dataUrl = canvas.toDataURL('image/jpeg', 0.7);
  return dataUrl;
}

function renderAvatarTargets(root, user) {
  const name = user?.name || '؟';
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('');
  const safe = user?.avatar || '';
  root.querySelectorAll('[data-avatar-target]').forEach((target) => {
    target.replaceChildren();
    if (safe) {
      const image = document.createElement('img');
      image.src = safe;
      image.alt = `صورة ${name}`;
      target.appendChild(image);
    } else {
      const fallback = document.createElement('span');
      fallback.setAttribute('aria-hidden', 'true');
      fallback.textContent = initials;
      target.appendChild(fallback);
    }
  });
  const actions = root.querySelector('[data-avatar-actions]');
  if (actions) {
    actions.querySelector('[data-avatar-remove]')?.toggleAttribute('hidden', !safe);
    actions.querySelector('[data-avatar-label]').textContent = safe ? 'تغيير الصورة' : 'أضف صورة';
  }
}

export function bindAvatar(panel, { root }) {
  const user = appStore.state.user;
  panel.innerHTML = `
    <header>
      <span class="panel-ico" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 4.5-4.5a2 2 0 0 1 2.8 0L19 20"/></svg></span>
      <div><h3>صورة الحساب</h3><p>تظهر في الهيدر وصفحة حسابك. تُقصّ مربّعة وتُصغّر تلقائيًا.</p></div>
    </header>
    <div class="avatar-editor">
      <span class="avatar-lg avatar-target" data-avatar-target aria-hidden="true"></span>
      <div class="avatar-actions" data-avatar-actions>
        <button class="btn btn-primary btn-sm" type="button" data-avatar-pick><span data-avatar-label>أضف صورة</span></button>
        <button class="btn btn-ghost btn-sm" type="button" data-avatar-remove style="color:var(--danger)">إزالة</button>
        <small>PNG · JPG · WebP — حتى 12 م.ب، ونقصّها لك تلقائيًا.</small>
      </div>
      <input type="file" accept="image/png,image/jpeg,image/webp" data-avatar-file hidden />
    </div>`;

  const fileInput = panel.querySelector('[data-avatar-file]');
  const pick = panel.querySelector('[data-avatar-pick]');
  const remove = panel.querySelector('[data-avatar-remove]');
  const target = panel.querySelector('[data-avatar-target]');
  renderAvatarTargets(root, user);

  const setBusy = (busy) => {
    pick.disabled = busy;
    remove.disabled = busy;
    target.dataset.busy = busy ? 'true' : 'false';
    pick.querySelector('[data-avatar-label]').textContent = busy ? 'جارٍ الحفظ…' : appStore.state.user?.avatar ? 'تغيير الصورة' : 'أضف صورة';
  };

  pick.addEventListener('click', () => fileInput.click());
  target.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const dataUrl = await prepareAvatar(file);
      const res = await api.put('/api/me/avatar', { avatar: dataUrl });
      appStore.set({ user: res.data.user });
      renderAvatarTargets(root, res.data.user);
      toast.success('تم تحديث صورة حسابك ✨');
    } catch (err) {
      toast.error(err?.message || 'تعذّر حفظ الصورة');
    } finally {
      setBusy(false);
    }
  });

  remove.addEventListener('click', async () => {
    if (!appStore.state.user?.avatar) return;
    setBusy(true);
    try {
      const res = await api.del('/api/me/avatar', {});
      appStore.set({ user: res.data.user });
      renderAvatarTargets(root, res.data.user);
      toast.info('أُزيلت صورة الحساب');
    } catch (err) {
      toast.error(err?.message || 'تعذّر إزالة الصورة');
    } finally {
      setBusy(false);
    }
  });

  appStore.subscribe((state) => renderAvatarTargets(root, state.user));
}
