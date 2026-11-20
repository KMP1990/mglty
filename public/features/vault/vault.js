/**
 * ميزة الخزنة — واجهة "الحفظ القوي": تجربة الحفظ المشفّر + إحصاءات + أزرار إدارة.
 * تعتمد فقط على واجهة getSaveService() العامة من features/save/save.js.
 */
import { auth, toast, escapeHtml, $ } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { getSaveService } from '../save/save.js';
import { requestPersistentStorage } from '../save/idb.js';

const SAMPLE_KEY = 'vault:note';
let save;

export async function mount(root) {
  if (!(await auth.require({ redirectTo: '/vault' }))) return;
  await loadStyles(['/features/vault/vault.css']);
  save = getSaveService();

  root.innerHTML = `
  <div class="container vault-layout">
    <div class="vault-hero">
      <div>
        <span class="chip chip-mint">🔐 الحفظ القوي</span>
        <h1 style="margin-top:10px">خزنتك المحلية</h1>
        <p style="margin:0">كل ما تكتبه هنا يُشفَّر على جهازك قبل أن يُحفظ — نسخة رئيسية، نسخة احتياطية، ونسخ سابقة.</p>
      </div>
      <button class="btn btn-primary" data-persist>تثبيت التخزين</button>
    </div>

    <div class="stat-grid">
      <div class="card stat"><strong data-stat="records">—</strong><span>سجلات محفوظة</span></div>
      <div class="card stat"><strong data-stat="versions">—</strong><span>نسخ سابقة</span></div>
      <div class="card stat"><strong data-stat="drafts">—</strong><span>مسودات معلقة</span></div>
      <div class="card stat"><strong data-stat="usage">—</strong><span>المستخدم من التخزين</span></div>
    </div>

    <div class="card vault-card">
      <div class="row" style="justify-content:space-between">
        <h2>جرّب الحفظ الآن</h2>
        <span class="chip" data-last-save>لم يُحفظ بعد في هذه الجلسة</span>
      </div>
      <div class="meter" aria-hidden="true"><i data-meter></i></div>
      <p style="margin:0;font-size:.84rem;color:var(--text-muted)" data-quota-text>—</p>
      <label class="field-label" for="vault-note">ملاحظة تجريبية</label>
      <textarea class="input editor-area" id="vault-note" placeholder="اكتب شيئًا… ثم احفظ، أعد تحميل الصفحة، وستجده كما تركته (مشفّرًا)."></textarea>
      <div class="row">
        <button class="btn btn-primary" data-vault-save>حفظ مشفّر</button>
        <button class="btn btn-soft" data-vault-load>استرجاع</button>
        <button class="btn btn-ghost" data-vault-delete style="color:var(--danger)">حذف</button>
        <button class="btn btn-ghost" data-vault-restore>استعادة من السلة</button>
      </div>
    </div>

    <div class="vault-panels">
      <div class="card vault-card">
        <h2>ماذا يجعل هذا الحفظ "قويًا"؟</h2>
        <ul class="check-list">
          <li><span><strong>تشفير AES-GCM 256</strong> بمفتاح يُولَّد في جهازك وغير قابل للاستخراج عبر JS.</span></li>
          <li><span><strong>كتابة على مرحلتين</strong>: مسودة أولًا ثم تأكيد — انقطاع الكهرباء لا يفسد البيانات.</span></li>
          <li><span><strong>نسخة احتياطية ثانية</strong> على نظام ملفات المتصفح (OPFS) مستقل عن القاعدة.</span></li>
          <li><span><strong>نسخ سابقة واسترجاع</strong> عند اكتشاف تلف، وسلة محذوفات للحذف الناعم.</span></li>
          <li><span><strong>مزامنة عند العودة</strong>: طابور يعيد الإرسال تلقائيًا بعد استعادة الشبكة.</span></li>
        </ul>
      </div>
      <div class="card vault-card">
        <h2>سجل النسخ والسلة</h2>
        <ul class="list-flat" data-inventory><li><small>جارٍ القراءة…</small></li></ul>
        <div class="row">
          <button class="btn btn-sm btn-soft" data-empty-trash>تفريغ السلة</button>
          <button class="btn btn-sm btn-ghost" data-refresh>تحديث</button>
        </div>
      </div>
    </div>
  </div>`;

  try {
    const existing = await save.load(SAMPLE_KEY, 'current', { fallback: null });
    if (existing.value?.text) {
      $('#vault-note', root).value = existing.value.text;
      $('[data-last-save]', root).textContent = existing.recovered
        ? 'تم الاسترجاع من نسخة احتياطية'
        : `آخر حفظ: ${new Date(existing.record?.updatedAt || Date.now()).toLocaleTimeString('ar')}`;
    }
  } catch { }

  root.querySelector('[data-vault-save]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'جارٍ التشفير…';
    try {
      const text = $('#vault-note', root).value;
      const res = await save.save(SAMPLE_KEY, { text, at: Date.now() }, { meta: { kind: 'note' } });
      $('[data-last-save]', root).textContent = `حُفظ في ${new Date(res.updatedAt).toLocaleTimeString('ar')} (النسخة ${res.version})`;
      toast.success('تم الحفظ المشفّر بنجاح');
      await refreshStats(root);
    } catch {
      toast.error('تعذّر تأكيد الحفظ — النسخة المؤقتة محفوظة للاستعادة');
    } finally {
      btn.disabled = false;
      btn.textContent = 'حفظ مشفّر';
      await refreshStats(root);
    }
  });

  root.querySelector('[data-vault-load]').addEventListener('click', async () => {
    const res = await save.load(SAMPLE_KEY, 'current', { fallback: null });
    if (!res.value) return toast.info('لا يوجد شيء محفوظ بعد');
    $('#vault-note', root).value = res.value.text || '';
    toast.success(res.recovered ? 'استُعيدت نسخة احتياطية' : 'تم الاسترجاع وفك التشفير');
  });

  root.querySelector('[data-vault-delete]').addEventListener('click', async () => {
    const ok = await save.remove(SAMPLE_KEY, 'current');
    toast[ok ? 'info' : 'warning'](ok ? 'نُقل إلى سلة المحذوفات' : 'لا يوجد سجل لحذفه');
    await refreshStats(root);
  });

  root.querySelector('[data-vault-restore]').addEventListener('click', async () => {
    const ok = await save.restoreFromTrash(SAMPLE_KEY, 'current');
    toast[ok ? 'success' : 'warning'](ok ? 'أُعيد من السلة' : 'السلة فارغة لهذا السجل');
    await refreshStats(root);
    const res = await save.load(SAMPLE_KEY, 'current', { fallback: null });
    if (res.value?.text) $('#vault-note', root).value = res.value.text;
  });

  root.querySelector('[data-empty-trash]').addEventListener('click', async () => {
    if (!confirm('سيُمسح كل ما في سلة المحذوفات نهائيًا. متابعة؟')) return;
    await save.emptyTrash();
    toast.success('تم تفريغ السلة');
    await refreshStats(root);
  });

  root.querySelector('[data-refresh]').addEventListener('click', () => refreshStats(root));

  root.querySelector('[data-persist]').addEventListener('click', async () => {
    const ok = await requestPersistentStorage();
    toast[ok ? 'success' : 'info'](ok ? 'تم تثبيت التخزين — لن يحذفه المتصفح تلقائيًا' : 'المتصفح لم يمنح التخزين الدائم الآن؛ عادة يُمنح بعد استخدام الموقع أكثر.');
    await refreshStats(root);
  });

  await refreshStats(root);
}

async function refreshStats(root) {
  const s = await save.stats();
  const set = (k, v) => {
    const el = root.querySelector(`[data-stat="${k}"]`);
    if (el) el.textContent = v;
  };
  set('records', s.records);
  set('versions', s.versions);
  set('drafts', s.drafts);
  set('usage', formatBytes(s.usage));
  const pct = s.quota ? Math.min(100, (s.usage / s.quota) * 100) : 0;
  const meter = root.querySelector('[data-meter]');
  if (meter) meter.style.width = `${Math.max(2, pct)}%`;
  const quotaText = root.querySelector('[data-quota-text]');
  if (quotaText) {
    quotaText.textContent = s.quota
      ? `الاستخدام: ${formatBytes(s.usage)} من ${formatBytes(s.quota)} • تشفير ${s.algorithm} • مرآة OPFS: ${s.opfs ? 'متاحة' : 'غير مدعومة'}`
      : `التخزين المحلي جاهز • تشفير ${s.algorithm}`;
  }
  const inv = root.querySelector('[data-inventory]');
  if (inv) {
    const rows = [];
    for (const key of await save.keys('records')) rows.push(`<li><span>${escapeHtml(key)}</span><small>سجل</small></li>`);
    for (const key of await save.keys('versions')) rows.push(`<li><span>${escapeHtml(key)}</span><small>نسخة سابقة</small></li>`);
    for (const key of await save.keys('trash')) rows.push(`<li><span>${escapeHtml(key)}</span><small>في السلة</small></li>`);
    inv.innerHTML = rows.length ? rows.join('') : '<li><small>لا سجلات بعد — احفظ ملاحظة لتظهر هنا.</small></li>';
  }
}

function formatBytes(n) {
  if (!n) return '0 بايت';
  const units = ['بايت', 'ك.ب', 'م.ب', 'غ.ب'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}
