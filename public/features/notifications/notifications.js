/**
 * الملف الرئيسي لميزة الإشعارات.
 * export mount(root)   — صفحة /notifications
 * export startLive()   — تشغيل البث اللحظي من أي مكان في التطبيق
 * export notify(payload)— إنشاء إشعار من الواجهة (يستعملها أي ميزة لاحقًا)
 *
 * تطويرات هذه النسخة:
 *  • قناة Web Push حقيقية (تصل والتطبيق مغلق) + إدارة أجهزة الاشتراك.
 *  • ملخص يومي ورسالة عودة بعد الغياب يعملان من الخادم.
 *  • تصفية بالنوع، بحث، وتجميع حسب اليوم، وبانر «ما فاتك أثناء الغياب».
 */
import { api, auth, appStore, toast, setUnread, escapeHtml, sound } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import { NOTIFICATION_TONES, notificationTone, setNotificationTone } from '../../assets/core/sound.js';
import { startLive, stopLive, refreshUnread, visitApp } from './live.js';
import {
  requestPermission,
  permission,
  prefEnabled,
  setPref,
  capabilities,
  pushStatus,
  pushConfig,
  pushWanted,
  subscribePush,
  unsubscribePush,
  pushDiagnostics,
  resetPush,
} from '../device/device.js';
import { fetchPreciseDiagnostics, formatPreciseReport } from './inspect/diagnostics.js';

export { startLive, stopLive };

const ICONS = {
  general: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
  welcome: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 4.6L18.5 9l-4.6 1.9L12 15.5l-1.9-4.6L5.5 9l4.6-1.4z"/><path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
  security: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.6-3 8.3-7 9.5-4-1.2-7-4.9-7-9.5V6z"/><path d="M12 8v4"/><circle cx="12" cy="15" r=".6" fill="currentColor"/></svg>',
  system: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/></svg>',
  reminder: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M8 3v4M16 3v4M3.5 10h17"/></svg>',
  achievement: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M16 5h3v2a3 3 0 0 1-3 3M8 5H5v2a3 3 0 0 0 3 3"/><path d="M12 13v4M9 21h6l-1-4h-4z"/></svg>',
  digest: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  insight: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V5M4 19h16"/><path d="M8 16v-5M12 16V7M16 16v-8"/></svg>',
};

const TYPE_FILTERS = [
  { id: 'all', label: 'الكل' },
  { id: 'reminder', label: 'تذكيرات' },
  { id: 'digest', label: 'ملخصات' },
  { id: 'achievement', label: 'إنجازات' },
  { id: 'system', label: 'النظام' },
  { id: 'welcome', label: 'ترحيب' },
  { id: 'security', label: 'أمان' },
];

const state = {
  items: [],
  filter: 'all',
  typeFilter: 'all',
  search: '',
  summary: { unread: 0, total: 0, missed: 0, daysAway: 0 },
  channels: { pushDevices: [] },
  prefs: {},
  push: { supported: false, subscribed: false, permission: 'default', enabled: false },
  pushRetried: false,
  pushHealing: false,
  welcome: null,
  loading: true,
  live: null,
};

export async function mount(root) {
  const version = Date.now();

  // 1) أعرض الهيكل دون انتظار أي طلب شبكة — الصفحة تظهر فورًا
  root.innerHTML = viewHtml();
  bindUi(root);
  startLive();

  // 2) أجلب الأنماط وتاريخ الإشعارات وحالة Push بالتوازي
  const styles = loadStyles([`/features/notifications/notifications.css?v=${version}`]);
  const data = load(root);
  refreshPushState(root);
  subscribeEvents(root);
  await Promise.allSettled([styles, data]);
}

/** إنشاء إشعار برمجيًا (متاح لبقية الميزات) */
export async function notify(payload) {
  const res = await api.post('/api/notifications/', payload);
  return res.data.notification;
}

/* -------------------------------- العرض -------------------------------- */
function viewHtml() {
  const caps = capabilities();
  const permText =
    caps.permission === 'granted'
      ? '<span class="chip chip-mint">مفعّلة</span>'
      : caps.permission === 'denied'
        ? '<span class="chip" style="color:var(--danger)">محجوبة من المتصفح</span>'
        : '<span class="chip">غير مفعّلة</span>';

  return `<div class="container notif-layout">
    <aside class="notif-side">
      <div class="card side-card">
        <h3>حالة البث اللحظي</h3>
        <div class="row" style="gap:8px">
          <span class="status-dot" data-live-dot data-state="connecting"></span>
          <strong data-live-state style="font-size:.9rem">جارٍ الاتصال…</strong>
        </div>
        <p style="margin:0;font-size:.82rem;color:var(--text-muted)">${globalThis.__MR_SERVERLESS__ ? 'تحديث تلقائي كل ٢٠ ثانية على النشر السحابي، والإشعارات الخارجية تصل عبر Push.' : 'يصل الإشعار فورًا دون تحديث الصفحة، ويعود تلقائيًا عند انقطاع الشبكة.'}</p>
      </div>

      <div class="card side-card" data-mobile="true">
        <h3>إشعارات خارج التطبيق</h3>
        <div class="push-state">
          <span data-push-line>جارٍ فحص الجهاز…</span>
          <span class="status-dot" data-push-dot data-state="connecting"></span>
        </div>
        <p class="push-note" data-push-note>إشعارات Web Push تصل على هذا الجهاز حتى لو أغلقت التطبيق لأيام — دون الحاجة لفتحه.</p>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm btn-primary" data-push-toggle>تفعيل</button>
          <button class="btn btn-sm btn-soft" data-push-test hidden>إشعار تجريبي</button>
          <button class="btn btn-sm btn-ghost" type="button" data-push-diag>تشخيص</button>
          <button class="btn btn-sm btn-ghost" type="button" data-push-reset>إصلاح</button>
        </div>
        <pre class="push-diag" data-push-diag-report hidden></pre>
        <ul class="push-devices" data-push-devices></ul>
      </div>

      <div class="card side-card" data-mobile="true">
        <h3>الملخص اليومي</h3>
        <div class="digest-row">
          <label class="check"><input type="checkbox" data-digest-toggle /> ملخص صباحي</label>
          <input class="input" type="time" data-digest-time value="08:30" aria-label="وقت الملخص اليومي" />
        </div>
        <label class="check"><input type="checkbox" data-reengage-toggle /> رسالة ودّ بعد الغياب</label>
        <label class="check"><input type="checkbox" data-away-toggle /> تذكير يومي أثناء الغياب</label>
        <p class="push-note">يُرسل من الخادم حتى لو لم تفتح التطبيق. يمكنك إيقافه في أي وقت.</p>
      </div>

      <div class="card side-card" data-mobile="true">
        <h3>أنواع الإشعارات</h3>
        <label class="check"><input type="checkbox" data-pref-routine /> تذكيرات الروتين اليومية</label>
        <label class="check"><input type="checkbox" data-pref-achievements /> الإنجازات وتطور الروتين</label>
        <label class="check"><input type="checkbox" data-pref-system /> أحداث الأنظمة والتنبيهات العامة</label>
        <p class="push-note">توقف الإشعارات خارج التطبيق فقط — يبقى كل حدث محفوظًا في صندوقك داخل التطبيق.</p>
      </div>

      <div class="card side-card" data-mobile="true">
        <h3>ساعات الهدوء</h3>
        <label class="check"><input type="checkbox" data-quiet-toggle /> لا ترسل إشعارات في هذه الساعات</label>
        <div class="digest-row quiet-row">
          <input class="input" type="time" data-quiet-from value="23:00" aria-label="بداية ساعات الهدوء" />
          <span class="quiet-sep">إلى</span>
          <input class="input" type="time" data-quiet-to value="07:00" aria-label="نهاية ساعات الهدوء" />
        </div>
        <p class="push-note">تُؤجَّل التذكيرات والملخصات أثناء نومك، وتصل التنبيهات الأمنية دائمًا.</p>
      </div>

      <div class="card side-card">
        <h3>إشعارات النظام المحلية</h3>
        <div class="row" style="justify-content:space-between">${permText}</div>
        <label class="check"><input type="checkbox" data-pref-toggle ${prefEnabled() ? 'checked' : ''} ${caps.permission !== 'granted' ? 'disabled' : ''}/> تنبيهني خارج التطبيق</label>
        <button class="btn btn-sm btn-soft" data-request-perm>${caps.permission === 'granted' ? 'تجربة إشعار' : 'السماح بالإشعارات'}</button>
        <p style="margin:0;font-size:.78rem;color:var(--text-muted)">تنبيهات محلية سريعة من التطبيق المفتوح. للإشعارات والتطبيق مغلق استخدم القناة أعلاه.</p>
      </div>

      <div class="card side-card" data-mobile="true">
        <h3>صوت الإشعار</h3>
        <label class="field"><span>نغمة التنبيه</span>
          <select class="input" data-notif-tone>
            ${NOTIFICATION_TONES.map((tone) => `<option value="${tone.id}" ${tone.id === notificationTone() ? 'selected' : ''}>${tone.label}</option>`).join('')}
          </select>
        </label>
        <div class="row" style="gap:8px;align-items:center">
          <input type="range" min="0" max="1" step="0.05" value="${sound.volume}" data-notif-volume aria-label="مستوى صوت الإشعار" style="flex:1" />
          <button class="btn btn-sm btn-soft" data-test-tone>تجربة</button>
        </div>
        <p class="push-note">النغمة تُسمع والتطبيق مفتوح. والتطبيق مغلق يستخدم النظام صوته الافتراضي (المتصفح لا يسمح بنغمة مخصصة لـ Push).</p>
      </div>

      <div class="card side-card" data-mobile="true">
        <h3>أدوات</h3>
        <button class="btn btn-sm btn-soft" data-mark-all>تعليم الكل كمقروء</button>
        <button class="btn btn-sm btn-soft" data-test-notif>إرسال إشعار تجريبي</button>
        <button class="btn btn-sm btn-ghost" data-test-sound>تجربة صوت الإشعار</button>
        <button class="btn btn-sm btn-ghost" data-clear-all style="color:var(--danger)">مسح كل الإشعارات</button>
      </div>
    </aside>

    <section>
      <div class="notif-head">
        <div>
          <h1>الإشعارات</h1>
          <p style="margin:0" data-summary-text>جارٍ التحميل…</p>
        </div>
        <div class="tabs" role="tablist" aria-label="تصفية الإشعارات">
          <button class="tab" role="tab" data-filter="all" aria-selected="true">الكل <span data-count-all></span></button>
          <button class="tab" role="tab" data-filter="unread" aria-selected="false">غير المقروء <span data-count-unread></span></button>
        </div>
      </div>

      <div class="notif-welcome" data-welcome hidden>
        <div>
          <strong data-welcome-title>ما فاتك أثناء الغياب</strong>
          <small data-welcome-text></small>
        </div>
        <div class="notif-welcome-actions">
          <button class="btn btn-sm btn-primary" data-welcome-push>فعّل الإشعارات خارج التطبيق</button>
          <button class="btn btn-sm btn-ghost" data-welcome-dismiss>تم</button>
        </div>
      </div>

      <div class="notif-toolbar">
        <div class="notif-toolbar-row">
          <label class="notif-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
            <input class="input" data-search placeholder="ابحث في الإشعارات…" maxlength="80" />
          </label>
        </div>
        <div class="chip-row" role="group" aria-label="تصفية حسب النوع">
          ${TYPE_FILTERS.map((f) => `<button class="chip-filter" type="button" data-type="${f.id}" aria-pressed="${f.id === 'all'}">${f.label}</button>`).join('')}
        </div>
      </div>

      <div class="notif-list" data-list aria-live="polite">
        ${Array.from({ length: 3 }, () => '<div class="skeleton"></div>').join('')}
      </div>
    </section>
  </div>`;
}

/* -------------------------------- البيانات -------------------------------- */
async function load(root) {
  state.loading = true;
  render(root);
  try {
    if (!appStore.state.sessionChecked) await auth.refresh();
    if (!appStore.state.authenticated) {
      location.replace('/login?next=' + encodeURIComponent('/notifications'));
      return;
    }
    const res = await api.get('/api/notifications/', { silent: true });
    state.items = res.data.items;
    state.summary = { ...state.summary, ...res.data.summary };
    state.channels = res.data.channels || {};
    state.prefs = res.data.notificationPrefs || {};
    syncDigestControls(root);
    const savedTone = appStore.state.user?.preferences?.sound?.tone;
    if (savedTone) setNotificationTone(savedTone);
    const toneSelect = root.querySelector('[data-notif-tone]');
    if (toneSelect) toneSelect.value = notificationTone();
    setUnread(state.summary.unread);
    if (state.summary.missed > 0 || state.summary.daysAway >= 2) {
      state.welcome = { missed: state.summary.missed, daysAway: state.summary.daysAway };
    }
  } catch (err) {
    if (err.status === 401) {
      location.replace('/login?next=' + encodeURIComponent('/notifications'));
      return;
    }
    state.error = err.message;
    root.querySelector('[data-list]').innerHTML = `<div class="empty-state">
      <span class="emoji">📡</span><strong>تعذّر تحميل الإشعارات</strong>
      <span style="font-size:.88rem">السبب: ${escapeHtml(err.message || 'خطأ غير معروف')}</span>
      <button class="btn btn-sm" data-retry>إعادة المحاولة</button></div>`;
    root.querySelector('[data-retry]')?.addEventListener('click', () => load(root));
    return;
  } finally {
    state.loading = false;
  }
  render(root);
  renderPushState(root);
}

function filtered() {
  const term = state.search.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.filter === 'unread' && item.read) return false;
    if (state.typeFilter === 'digest' && !['digest', 'insight'].includes(item.type)) return false;
    if (state.typeFilter !== 'all' && state.typeFilter !== 'digest' && item.type !== state.typeFilter) return false;
    if (term && !`${item.title} ${item.body}`.toLowerCase().includes(term)) return false;
    return true;
  });
}

function dayKey(iso) {
  const date = new Date(iso);
  const today = new Date();
  const offset = today.getTimezoneOffset() * 60_000;
  const local = new Date(date.getTime() - offset).toISOString().slice(0, 10);
  const todayKey = new Date(today.getTime() - offset).toISOString().slice(0, 10);
  if (local === todayKey) return 'اليوم';
  const yesterday = new Date(today.getTime() - offset - 86_400_000).toISOString().slice(0, 10);
  if (local === yesterday) return 'أمس';
  return date.toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' });
}

function setNodeText(node, value) {
  if (node && node.textContent !== value) node.textContent = value;
}

/** تحديث بانر «ما فاتك» وحده — بلا إعادة رسم قائمة الإشعارات كلها */
function renderWelcome(root) {
  const welcome = root.querySelector('[data-welcome]');
  if (!welcome) return;
  const show = Boolean(state.welcome && (state.welcome.missed > 0 || state.welcome.daysAway >= 2));
  if (!show) {
    if (!welcome.hidden) welcome.hidden = true;
    return;
  }
  const away = Math.round(state.welcome.daysAway);
  const awayText = away >= 3 && away <= 10 ? `${away} أيام` : away >= 11 ? `${away} يومًا` : away === 2 ? 'يومين' : 'يومًا';
  const days = away >= 2 ? `غبت ${awayText}` : 'مرحبًا بعودتك';
  setNodeText(root.querySelector('[data-welcome-title]'), away >= 2 ? `${days} — ما فاتك هنا` : 'ما فاتك أثناء انشغالك');
  setNodeText(
    root.querySelector('[data-welcome-text]'),
    state.welcome.missed
      ? `${unreadPhrase(state.welcome.missed)} بانتظارك. ملخصك اليومي وتذكيراتك ستصلك حتى والتطبيق مغلق.`
      : 'فعّل الإشعارات خارج التطبيق حتى يصلك الملخص اليومي دون فتحه.'
  );
  const push = root.querySelector('[data-welcome-push]');
  if (push && push.hidden !== Boolean(state.push.subscribed)) push.hidden = Boolean(state.push.subscribed);
  if (welcome.hidden) welcome.hidden = false;
}

function render(root) {
  const list = root.querySelector('[data-list]');
  if (!list) return;
  const items = filtered();

  root.querySelector('[data-summary-text]').textContent = state.summary.unread > 0
    ? `لديك ${unreadPhrase(state.summary.unread)} غير مقروءة من أصل ${state.summary.total}.`
    : state.summary.total
      ? 'قرأت كل شيء — أنت منظم جدًا ✨'
      : 'لا إشعارات بعد.';
  root.querySelector('[data-count-all]').textContent = state.summary.total ? `(${state.summary.total})` : '';
  root.querySelector('[data-count-unread]').textContent = state.summary.unread ? `(${state.summary.unread})` : '';

  root.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.filter === state.filter)));
  root.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.type === state.typeFilter)));

  renderWelcome(root);

  if (state.loading) return;

  if (!items.length) {
    const noItemsAtAll = !state.items.length;
    if (noItemsAtAll) {
      list.innerHTML = `<div class="empty-state">
        <span class="emoji">🔔</span>
        <strong>صندوقك فارغ</strong>
        <span style="font-size:.88rem">سيصلك هنا تنبيه الترحيب وأي تحديث مهم.</span>
        <button class="btn btn-sm btn-soft" data-test-notif>جرّب إشعارًا تجريبيًا</button>
      </div>`;
    } else {
      list.innerHTML = `<div class="notif-empty-filter">لا إشعار يطابق هذا الاختيار. <button class="btn btn-sm btn-ghost" data-reset-filter>إعادة التصفية</button></div>`;
    }
    bindTestButtons(root);
    root.querySelector('[data-reset-filter]')?.addEventListener('click', () => {
      state.filter = 'all';
      state.typeFilter = 'all';
      state.search = '';
      root.querySelector('[data-search]').value = '';
      render(root);
    });
    return;
  }

  let lastDay = '';
  const html = [];
  for (const item of items) {
    const day = dayKey(item.createdAt);
    if (day !== lastDay) {
      html.push(`<h2 class="notif-day">${escapeHtml(day)}</h2>`);
      lastDay = day;
    }
    html.push(itemHtml(item));
  }
  list.innerHTML = html.join('');
  bindLinkRead(root);
}

function itemHtml(n) {
  const when = relativeTime(n.createdAt);
  return `<article class="notif-item" data-id="${escapeHtml(n.id)}" data-unread="${!n.read}">
    <span class="notif-ico" data-type="${escapeHtml(n.type)}" aria-hidden="true">${ICONS[n.type] || ICONS.general}</span>
    <div class="notif-body">
      <h3>${escapeHtml(n.title)}</h3>
      ${n.body ? `<p>${escapeHtml(n.body)}</p>` : ''}
      ${n.link ? `<a class="notif-link" href="${escapeHtml(n.link)}" data-link>فتح ←</a>` : ''}
      <time datetime="${escapeHtml(n.createdAt)}" title="${new Date(n.createdAt).toLocaleString('ar')}">${when}</time>
    </div>
    <div class="notif-actions">
      <button class="icon-btn" data-act="read" data-active="${n.read}" title="${n.read ? 'تعليم كغير مقروء' : 'تعليم كمقروء'}" aria-label="تبديل حالة القراءة">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13.5 8 17.5 20 6"/></svg>
      </button>
      <button class="icon-btn" data-act="delete" data-danger title="حذف" aria-label="حذف الإشعار">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>
      </button>
    </div>
  </article>`;
}

function unreadPhrase(n) {
  if (n === 1) return 'إشعار واحد';
  if (n === 2) return 'إشعاران';
  if (n >= 3 && n <= 10) return `${n} إشعارات`;
  return `${n} إشعارًا`;
}

function relativeTime(iso) {
  const diff = (Date.now() - Date.parse(iso)) / 1000;
  if (diff < 60) return 'الآن';
  if (diff < 3600) return `قبل ${Math.floor(diff / 60)} دقيقة`;
  if (diff < 86400) return `قبل ${Math.floor(diff / 3600)} ساعة`;
  if (diff < 604800) return `قبل ${Math.floor(diff / 86400)} يوم`;
  return new Date(iso).toLocaleDateString('ar', { day: 'numeric', month: 'long', year: 'numeric' });
}

/* -------------------------------- التفاعلات -------------------------------- */
function bindUi(root) {
  root.addEventListener('click', async (e) => {
    const tab = e.target.closest('[data-filter]');
    if (tab) {
      state.filter = tab.dataset.filter;
      render(root);
      return;
    }
    const typeChip = e.target.closest('[data-type]');
    if (typeChip) {
      state.typeFilter = typeChip.dataset.type;
      render(root);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act) {
      const card = act.closest('[data-id]');
      const id = card.dataset.id;
      const item = state.items.find((i) => i.id === id);
      if (!item) return;
      if (act.dataset.act === 'read') await toggleRead(item, root);
      else await removeOne(item, root, card);
      return;
    }
    if (e.target.closest('[data-mark-all]')) return markAll(root);
    if (e.target.closest('[data-clear-all]')) return clearAll(root);
    if (e.target.closest('[data-test-notif]')) return sendTest(root);
    if (e.target.closest('[data-test-tone]')) {
      sound.playNotification?.(notificationTone());
      toast.info('هكذا ستسمع نغمة الإشعار', { sound: false, duration: 1800 });
      return;
    }
    if (e.target.closest('[data-test-sound]')) {
      sound.playNotification?.(notificationTone());
      toast.info('هكذا يبدو تنبيه الإشعارات', { sound: false, duration: 1800 });
      return;
    }
    if (e.target.closest('[data-request-perm]')) return handlePermission(root);
    if (e.target.closest('[data-push-toggle]')) return togglePush(root);
    const removeDevice = e.target.closest('[data-remove-device]');
    if (removeDevice) return removePushDevice(root, removeDevice.dataset.removeDevice);
    if (e.target.closest('[data-push-test]')) return testPush(root);
    if (e.target.closest('[data-push-diag]')) return showPushDiagnostics(root);
    if (e.target.closest('[data-push-reset]')) return repairPush(root);
    if (e.target.closest('[data-welcome-push]')) return togglePush(root);
    if (e.target.closest('[data-welcome-dismiss]')) {
      state.welcome = null;
      render(root);
      return;
    }
  });

  root.querySelector('[data-search]')?.addEventListener('input', (e) => {
    state.search = e.target.value;
    render(root);
  });

  // تفضيل إشعارات النظام المحلية
  root.querySelector('[data-pref-toggle]')?.addEventListener('change', (e) => {
    setPref(e.target.checked);
    toast.info(e.target.checked ? 'سننبّهك خارج التطبيق' : 'أوقفنا التنبيهات خارج التطبيق');
  });

  root.querySelector('[data-notif-tone]')?.addEventListener('change', (e) => saveTone(root, e.target.value));
  root.querySelector('[data-notif-volume]')?.addEventListener('input', (e) => sound.setVolume(Number(e.target.value)));
  root.querySelector('[data-notif-volume]')?.addEventListener('change', (e) => {
    const volume = sound.setVolume(Number(e.target.value));
    api.patch('/api/me', { preferences: { sound: { volume } } }, { silent: true }).catch(() => {});
  });

  root.querySelector('[data-digest-toggle]')?.addEventListener('change', (e) => saveDigestPrefs(root, { digest: e.target.checked }));
  root.querySelector('[data-digest-time]')?.addEventListener('change', (e) => saveDigestPrefs(root, { digestTime: e.target.value || '08:30' }));
  root.querySelector('[data-reengage-toggle]')?.addEventListener('change', (e) => saveDigestPrefs(root, { reengage: e.target.checked }));
  root.querySelector('[data-away-toggle]')?.addEventListener('change', (e) => saveDigestPrefs(root, { awayReminders: e.target.checked }));
  root.querySelector('[data-pref-routine]')?.addEventListener('change', (e) => saveDigestPrefs(root, { routineReminders: e.target.checked }));
  root.querySelector('[data-pref-achievements]')?.addEventListener('change', (e) => saveDigestPrefs(root, { achievements: e.target.checked }));
  root.querySelector('[data-pref-system]')?.addEventListener('change', (e) => saveDigestPrefs(root, { systemEvents: e.target.checked }));
  root.querySelector('[data-quiet-toggle]')?.addEventListener('change', (e) => {
    toggleQuietInputs(root, e.target.checked);
    saveDigestPrefs(root, { quietHours: { enabled: e.target.checked } });
  });
  root.querySelector('[data-quiet-from]')?.addEventListener('change', (e) => saveDigestPrefs(root, { quietHours: { from: e.target.value || '23:00' } }));
  root.querySelector('[data-quiet-to]')?.addEventListener('change', (e) => saveDigestPrefs(root, { quietHours: { to: e.target.value || '07:00' } }));
}

function bindLinkRead(root) {
  root.querySelectorAll('[data-link]').forEach((link) => {
    link.addEventListener('click', () => {
      const card = link.closest('[data-id]');
      const item = state.items.find((i) => i.id === card?.dataset.id);
      if (!item || item.read) return;
      // فتح الإشعار يعلّمه كمقروء — دون انتظار الاستجابة
      item.read = true;
      state.summary.unread = Math.max(0, state.summary.unread - 1);
      setUnread(state.summary.unread);
      api.post(`/api/notifications/${encodeURIComponent(item.id)}/read`, { read: true }, { silent: true }).catch(() => {});
    });
  });
}

function bindTestButtons(scope) {
  scope.querySelectorAll('[data-test-notif]').forEach((b) =>
    b.addEventListener('click', () => {
      const root = scope.closest('.notif-layout') || scope;
      sendTest(root);
    })
  );
}

async function saveDigestPrefs(root, patch) {
  try {
    const res = await api.patch('/api/me', { preferences: { notifications: patch } }, { silent: true });
    appStore.set({ user: res.data.user });
    state.prefs = res.data.user?.preferences?.notifications || state.prefs;
    syncDigestControls(root);
    toast.success(patch.digest !== undefined ? (patch.digest ? 'الملخص اليومي مفعّل' : 'أوقفنا الملخص اليومي') : 'حُفظ إعداد الإشعارات');
  } catch (err) {
    toast.error(err?.message || 'تعذّر حفظ الإعداد');
    syncDigestControls(root);
  }
}

async function saveTone(root, tone) {
  const value = setNotificationTone(tone);
  sound.playNotification?.(value);
  try {
    await api.patch('/api/me', { preferences: { sound: { tone: value } } }, { silent: true });
    toast.success('حُفظت نغمة الإشعار');
  } catch {
    toast.info('حُفظت على هذا الجهاز فقط');
  }
  void root;
}

function syncDigestControls(root) {
  const prefs = state.prefs || {};
  const toggle = root.querySelector('[data-digest-toggle]');
  const time = root.querySelector('[data-digest-time]');
  const reengage = root.querySelector('[data-reengage-toggle]');
  const away = root.querySelector('[data-away-toggle]');
  const routine = root.querySelector('[data-pref-routine]');
  const achievements = root.querySelector('[data-pref-achievements]');
  const systemEvents = root.querySelector('[data-pref-system]');
  const quietToggle = root.querySelector('[data-quiet-toggle]');
  const quietFrom = root.querySelector('[data-quiet-from]');
  const quietTo = root.querySelector('[data-quiet-to]');
  const quiet = prefs.quietHours || {};
  if (toggle) toggle.checked = prefs.digest !== false;
  if (time) time.value = prefs.digestTime || '08:30';
  if (reengage) reengage.checked = prefs.reengage !== false;
  if (away) away.checked = prefs.awayReminders !== false;
  if (routine) routine.checked = prefs.routineReminders !== false;
  if (achievements) achievements.checked = prefs.achievements !== false;
  if (systemEvents) systemEvents.checked = prefs.systemEvents !== false;
  if (quietToggle) quietToggle.checked = quiet.enabled !== false;
  if (quietFrom) quietFrom.value = quiet.from || '23:00';
  if (quietTo) quietTo.value = quiet.to || '07:00';
  toggleQuietInputs(root, quiet.enabled !== false);
}

function toggleQuietInputs(root, enabled) {
  root.querySelectorAll('[data-quiet-from], [data-quiet-to]').forEach((input) => {
    input.disabled = !enabled;
  });
}

async function toggleRead(item, root) {
  const next = !item.read;
  try {
    const res = await api.post(`/api/notifications/${encodeURIComponent(item.id)}/read`, { read: next });
    item.read = next;
    state.summary.unread = res.data.unread;
    setUnread(res.data.unread);
    render(root);
  } catch {
    /* التوست يعرض الخطأ تلقائيًا */
  }
}

async function removeOne(item, root) {
  const el = root.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if (el) {
    el.style.transition = 'opacity .18s ease, transform .18s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(-12px)';
  }
  try {
    const res = await api.del(`/api/notifications/${encodeURIComponent(item.id)}`);
    state.items = state.items.filter((i) => i.id !== item.id);
    state.summary.total = state.items.length;
    state.summary.unread = res.data.unread;
    setUnread(res.data.unread);
    render(root);
    toast.info('تم حذف الإشعار');
  } catch {
    if (el) {
      el.style.opacity = '';
      el.style.transform = '';
    }
  }
}

async function markAll(root) {
  try {
    const res = await api.post('/api/notifications/read-all');
    state.items = state.items.map((i) => ({ ...i, read: true }));
    state.summary.unread = res.data.unread;
    setUnread(res.data.unread);
    render(root);
    toast.success('تم تعليم كل الإشعارات كمقروءة');
  } catch {}
}

async function clearAll(root) {
  if (!state.items.length) return toast.info('لا يوجد ما يُمسح');
  if (!confirm('سيُمسح كل سجل الإشعارات على الخادم. متابعة؟')) return;
  try {
    const res = await api.del('/api/notifications/');
    state.items = [];
    state.summary = { ...state.summary, total: 0, unread: res.data.unread, missed: 0 };
    state.welcome = null;
    setUnread(res.data.unread);
    render(root);
    toast.success('تم مسح الإشعارات');
  } catch {}
}

async function sendTest(root) {
  try {
    await notify({
      type: 'general',
      title: 'إشعار تجريبي 🔔',
      body: 'إن كنت ترى هذا في القائمة، فالبث اللحظي يعمل — والإشعارات جاهزة لأي ميزة قادمة.',
      priority: 'normal',
    });
    if (permission() === 'granted') toast.info('أُرسل — لاحظ وصوله أعلاه');
    void root;
  } catch {
    /* التوست يعرض الخطأ */
  }
}

async function handlePermission(root) {
  const before = permission();
  if (before === 'granted') {
    const ok = await showTestWindow();
    if (!ok) toast.warning('لم يظهر إشعار النظام — قد تكون الميزة محجوبة');
    return;
  }
  toast.info('سيطلب المتصفح إذنك الآن…');
  const result = await requestPermission();
  if (result === 'granted') {
    toast.success('تم تفعيل إشعارات النظام');
    const btn = root.querySelector('[data-request-perm]');
    if (btn) btn.textContent = 'تجربة إشعار';
    const toggle = root.querySelector('[data-pref-toggle]');
    if (toggle) toggle.disabled = false;
    await refreshPushState(root);
  } else if (result === 'denied') {
    toast.error('الإذن محجوب — فعّله من إعدادات الموقع في المتصفح.');
  }
}

async function showTestWindow() {
  const { showSystemNotification } = await import('../device/device.js');
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return false;
  try {
    await reg.showNotification('مجلتي وروتيني 🌸', {
      body: 'هذا إشعار تجريبي من التطبيق. كل شيء يعمل!',
      icon: '/icons/icon-192.png',
      dir: 'rtl',
      lang: 'ar',
      data: { url: '/notifications' },
    });
    return true;
  } catch {
    const ok = await showSystemNotification('مجلتي وروتيني 🌸', 'إشعار تجريبي', { url: '/notifications' });
    return ok;
  }
}

/* -------------------------------- قناة Push -------------------------------- */
async function refreshPushState(root) {
  if (!root?.isConnected) return;
  const [status, config] = await Promise.all([pushStatus(), pushConfig()]);
  state.push = { ...status, enabled: Boolean(config?.enabled) };

  // إصلاح ذاتي: المستخدم فعّل الإشعارات سابقًا لكن المتصفح فقد الاشتراك
  // (تحديث، مسح بيانات، انتهاء اشتراك). نعيد الربط بهدوء بلا طلب إذن جديد.
  if (
    !state.pushHealing &&
    state.push.enabled &&
    state.push.supported &&
    !state.push.subscribed &&
    state.push.permission === 'granted' &&
    !state.push.iosNeedsInstall &&
    pushWanted()
  ) {
    state.pushHealing = true;
    const healed = await subscribePush({ skipPermission: true }).catch(() => null);
    if (healed?.ok) {
      await refreshPushState(root);
      return;
    }
  }

  renderPushState(root);
  if (!config?.enabled && !state.pushRetried) {
    state.pushRetried = true;
    setTimeout(() => refreshPushState(root), 2500);
  }
}

function renderPushState(root) {
  const line = root.querySelector('[data-push-line]');
  const dot = root.querySelector('[data-push-dot]');
  const note = root.querySelector('[data-push-note]');
  const toggle = root.querySelector('[data-push-toggle]');
  const test = root.querySelector('[data-push-test]');
  const devices = root.querySelector('[data-push-devices]');
  if (!line || !toggle) return;
  const { supported, subscribed, permission: perm, enabled } = state.push;

  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    line.textContent = 'تحتاج HTTPS أو localhost';
    if (dot) dot.dataset.state = 'offline';
    if (note) note.textContent = 'إشعارات المتصفح وWeb Push لا تعمل على HTTP عادي (إلا localhost). افتح التطبيق عبر HTTPS أو من localhost، أو استخدم تطبيقًا مثبّتًا.';
    toggle.hidden = true;
    if (test) test.hidden = true;
  } else if (state.push.iosNeedsInstall) {
    line.textContent = 'آيفون: أضف التطبيق للشاشة الرئيسية';
    if (dot) dot.dataset.state = 'connecting';
    if (note) {
      note.textContent =
        'إشعارات الويب على آيفون/آيباد تعمل فقط بعد «مشاركة ← إضافة إلى الشاشة الرئيسية»، ثم افتحه من الأيقونة وفعّل الإشعارات من هنا.';
    }
    toggle.hidden = true;
    if (test) test.hidden = true;
  } else if (!supported) {
    line.textContent = 'غير مدعومة في هذا المتصفح';
    if (dot) dot.dataset.state = 'offline';
    if (note) note.textContent = 'على آيفون: أضف التطبيق إلى الشاشة الرئيسية أولًا. على الحاسوب جرّب Chrome أو Edge أو Firefox.';
    toggle.hidden = true;
    if (test) test.hidden = true;
  } else if (!enabled) {
    line.textContent = 'الخادم يجهّز المفاتيح…';
    if (dot) dot.dataset.state = 'connecting';
    toggle.disabled = true;
  } else if (perm === 'denied') {
    line.textContent = 'محجوبة من إعدادات المتصفح';
    if (dot) dot.dataset.state = 'offline';
    if (note) note.textContent = 'افتح إعدادات الموقع (أيقونة القفل) واسمح بالإشعارات، ثم أعد المحاولة.';
    toggle.textContent = 'إعادة المحاولة';
    toggle.disabled = false;
  } else if (subscribed) {
    line.textContent = 'مفعّلة على هذا الجهاز ✓';
    if (dot) dot.dataset.state = 'live';
    if (note) note.textContent = 'ستصلك التذكيرات والملخص اليومي حتى لو أغلقت التطبيق لأيام.';
    toggle.textContent = 'إيقاف على هذا الجهاز';
    toggle.classList.remove('btn-primary');
    toggle.classList.add('btn-ghost');
    toggle.disabled = false;
    if (test) test.hidden = false;
  } else {
    line.textContent = 'غير مفعّلة على هذا الجهاز';
    if (dot) dot.dataset.state = 'connecting';
    if (note) note.textContent = 'فعّلها ليصلك تذكير القراءة والملخص اليومي والتذكيرات والتطبيق مغلق.';
    toggle.textContent = 'تفعيل الإشعارات خارج التطبيق';
    toggle.classList.add('btn-primary');
    toggle.classList.remove('btn-ghost');
    toggle.disabled = false;
    if (test) test.hidden = true;
  }

  if (devices) {
    const list = state.channels?.pushDevices || [];
    devices.innerHTML = list
      .map(
        (device) => `<li${device.lastError ? ' class="push-device-error"' : ''}>
          <span>${escapeHtml(device.platform || 'جهاز')}</span>
          <span>${
            device.lastError
              ? 'يحتاج إعادة تفعيل'
              : device.lastUsedAt
                ? 'آخر إرسال ✓'
                : 'مشترك'
          }</span>
          <button class="icon-btn" type="button" data-remove-device="${escapeHtml(device.id)}" title="إزالة هذا الجهاز" aria-label="إزالة هذا الجهاز">✕</button>
        </li>`
      )
      .join('');
  }
  const welcomePush = root.querySelector('[data-welcome-push]');
  if (welcomePush) welcomePush.hidden = Boolean(subscribed);
}

async function togglePush(root) {
  const button = root.querySelector('[data-push-toggle]');
  if (button) button.disabled = true;
  try {
    if (state.push.subscribed) {
      const result = await unsubscribePush();
      if (!result.ok) throw new Error(result.reason || 'تعذّر الإيقاف');
      toast.info('أوقفنا الإشعارات خارج التطبيق على هذا الجهاز');
    } else {
      const result = await subscribePush();
      if (!result.ok) {
        const reasons = {
          unsupported: 'هذا المتصفح لا يدعم الإشعارات السحابية',
          denied: 'الإذن محجوب — اسمح بالإشعارات من إعدادات الموقع',
          'not-granted': 'لم تُمنح إذن الإشعارات',
          disabled: 'الخادم لم يجهّز مفاتيح الإشعارات بعد',
          'push-unavailable':
            'خدمة الإشعارات غير متاحة. تأكد أن إشعارات النظام مفعّلة، وأن المتصفح Chrome/Edge حديث، وأن fcm.googleapis.com غير محجوب (جرّب شبكة أخرى/VPN)، أو ثبّت التطبيق على الشاشة الرئيسية في الآيفون.',
          'key-invalid': 'مفتاح الإشعارات تغيّر — اضغط «إصلاح» لإعادة إنشاء الاشتراك.',
          insecure: 'الإشعارات تحتاج HTTPS أو localhost — افتح التطبيق عبر HTTPS.',
          'sw-not-active': 'عامل الخدمة لم يجهز بعد. أعد تحميل الصفحة ثم حاول، أو اضغط «إصلاح».',
          session: 'انتهت صلاحية الجلسة أو رمز الحماية. أعد تحميل الصفحة وسجّل الدخول.',
          'subscribe-failed': 'فشل إنشاء الاشتراك. اضغط «تشخيص» لمعرفة السبب التقني.',
        };
        throw new Error(
          `${reasons[result.reason] || result.reason || 'تعذّر التفعيل'}${result.message && result.reason === 'subscribe-failed' ? ` — ${result.message}` : ''}`
        );
      }
      toast.success('تم التفعيل — ستصلك الإشعارات والتطبيق مغلق 🎉');
    }
    await refreshPushState(root);
    await load(root).catch(() => {});
  } catch (err) {
    toast.error(err?.message || 'تعذّر تغيير حالة الإشعارات');
  } finally {
    if (button) button.disabled = false;
  }
}

async function showPushDiagnostics(root) {
  const report = root.querySelector('[data-push-diag-report]');
  const diag = await pushDiagnostics().catch(() => null);
  if (!diag) return toast.error('تعذّر جمع التشخيص');
  const precise = await fetchPreciseDiagnostics().catch(() => null);
  const text = [
    `HTTPS/localhost: ${diag.secureContext ? 'نعم' : 'لا'}`,
    `دعم المتصفح: ${diag.supported ? 'نعم' : 'لا'}`,
    `Service Worker: ${diag.registration ? (diag.active ? 'نشط' : 'مسجل وغير نشط') : 'غير مسجل'}`,
    `الإذن: ${diag.permission}`,
    `الاشتراك: ${diag.subscribed ? 'نعم' : 'لا'}`,
    diag.endpointHost ? `خدمة الدفع: ${diag.endpointHost}` : '',
    `مفتاح VAPID: ${diag.keyConfigured ? 'جاهز' : 'غير جاهز'}`,
    diag.error ? `خطأ: ${diag.error}` : '',
    precise ? formatPreciseReport(precise) : '— فحص الخادم غير متاح الآن —',
  ]
    .filter(Boolean)
    .join(String.fromCharCode(10));
  if (report) {
    report.hidden = false;
    report.textContent = text;
  }
  toast.info(
    precise?.report?.status === 'fail'
      ? 'الفحص وجد مشكلة — راجع التفاصيل'
      : diag.supported
        ? 'التشخيص الدقيق جاهز — راجع التفاصيل'
        : 'المتصفح/الاتصال لا يدعم الإشعارات',
    { duration: 3000 }
  );
}

async function repairPush(root) {
  toast.info('أعيد إنشاء الاشتراك…');
  const result = await resetPush().catch((err) => ({ ok: false, reason: err?.message }));
  if (result.ok) {
    toast.success('تم إصلاح الإشعارات ✓');
    await refreshPushState(root);
    await load(root).catch(() => {});
  } else {
    toast.error(`تعذّر الإصلاح: ${result.reason || 'خطأ'}`);
    await showPushDiagnostics(root);
  }
}

async function removePushDevice(root, id) {
  if (!id) return;
  try {
    await api.del(`/api/notifications/push/subscribe/${encodeURIComponent(id)}`);
    toast.info('أُزيل الجهاز من قائمة الإشعارات');
    await load(root).catch(() => {});
  } catch (err) {
    toast.error(err?.message || 'تعذّر إزالة الجهاز');
  }
}

async function testPush(root) {
  try {
    const res = await api.post('/api/notifications/push/test');
    if (res?.data?.sent) {
      toast.success('أُرسل إشعار تجريبي إلى أجهزتك — قد يظهر بعد ثوانٍ');
    } else if (res?.data?.failed) {
      toast.warning('الاشتراك قديم — أعيد إنشاءه تلقائيًا…');
      const fixed = await resetPush().catch(() => null);
      if (fixed?.ok) {
        const retry = await api.post('/api/notifications/push/test').catch(() => null);
        if (retry?.data?.sent) {
          toast.success('أُصلح الاشتراك وأُرسل الإشعار ✓');
          await refreshPushState(root);
          return;
        }
      }
      toast.warning('تعذّر الإرسال. اضغط «تشخيص» لمعرفة السبب، أو أوقف الإشعارات ثم فعّلها.');
    } else {
      toast.warning('لا يوجد جهاز مشترك. فعّل الإشعارات أولًا من الزر أعلاه.');
    }
    void root;
  } catch (err) {
    toast.error(err?.message || 'تعذّر إرسال الإشعار التجريبي');
  }
}

/* -------------------------------- أحداث حيّة -------------------------------- */
function subscribeEvents(root) {
  const onNew = (e) => {
    const item = e.detail;
    if (!item || state.items.some((i) => i.id === item.id)) return;
    state.items.unshift(item);
    state.summary.total = state.items.length;
    state.summary.unread = state.items.filter((i) => !i.read).length;
    render(root);
    const el = root.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
    el?.classList.add('is-new');
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  document.addEventListener('mr:notification', onNew);

  const onState = (e) => {
    const dot = root.querySelector('[data-live-dot]');
    if (dot) dot.dataset.state = e.detail.state;
  };
  document.addEventListener('mr:live-state', onState);

  const onWelcome = (e) => {
    const missed = Number(e.detail.missed) || 0;
    const daysAway = Number(e.detail.daysAway) || 0;
    if (state.welcome?.missed === missed && state.welcome?.daysAway === daysAway) return;
    state.welcome = { missed, daysAway };
    renderWelcome(root);
    if (missed) {
      const away = Math.round(daysAway);
      toast.info(`${away >= 1 ? `غبت ${away} يوم — ` : ''}لديك ${unreadPhrase(missed)} بانتظارك`, { duration: 5200 });
    }
  };
  document.addEventListener('mr:welcome-back', onWelcome);

  const onPushState = () => refreshPushState(root);
  document.addEventListener('mr:push-state', onPushState);

  // استئناف البث ودمج ما فُقد أثناء الانقطاع
  window.addEventListener('online', () => {
    refreshUnread();
    visitApp();
    load(root);
  });

  // تنظيف عند مغادرة الصفحة
  const observer = new MutationObserver(() => {
    if (!document.contains(root)) {
      document.removeEventListener('mr:notification', onNew);
      document.removeEventListener('mr:live-state', onState);
      document.removeEventListener('mr:welcome-back', onWelcome);
      document.removeEventListener('mr:push-state', onPushState);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}
