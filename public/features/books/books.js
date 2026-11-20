/**
 * صفحة كتبي — المكتبة + الاستيراد + فتح القارئ.
 * الكتب تُقرأ وتُشفَّر على جهاز المستخدم فقط، عبر features/save.
 */
import { auth, escapeHtml, toast, sound, api, appStore } from '../../assets/core/core.js';
import { loadStyles } from '../../assets/core/styles.js';
import {
  importBookFile,
  listBooks,
  loadIndex,
  loadPrefs,
  savePrefs,
  openBook,
  updateProgress,
  updateBookMeta,
  removeBook,
  renameBook,
  lastRead,
  readingReminderState,
  updateReadingReminderState,
  readingStats,
  readingStreak,
  recordReading,
  setBookCover,
} from './store.js';
import { prepareImage } from './parse.js';
import { notifyFirstBook, notifyBookFinished } from './events.js';
import { createReader } from './reader.js';
import { syncReadingSnapshot, resetReadingSyncClock } from './sync.js';

const arNum = (n) => String(n ?? 0).replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
const state = { books: [], search: '', sort: 'recent', loading: true };

export async function mount(root) {
  if (!(await auth.require({ redirectTo: '/books' }))) return;
  await loadStyles(['/features/books/books.css', '/features/books/reader2.css', '/features/assistant/assistant.css']);

  root.innerHTML = `
  <div class="container books-page">
    <section class="books-hero card">
      <div class="books-hero-copy">
        <span class="chip chip-brand">📚 كتبي</span>
        <h1>مكتبتك الخاصة</h1>
        <p>أضف أي كتاب — PDF أو EPUB أو Word أو أرشيف صور CBZ أو نص أو صورة — واقرأه بطريقة جديدة: فصل واحد يتدفق أمامك بلا تقطيع، مع غلاف تلقائي من الملف نفسه، ومساعد يشرح لك ما لم تفهمه.</p>
        <div class="books-hero-stats" data-stats></div>
      </div>
      <div class="books-hero-actions">
        <button class="btn btn-primary" data-import type="button">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>
          أضف كتابًا
        </button>
        <button class="btn btn-soft btn-sm" data-reading-reminder type="button">🔔 تذكير القراءة</button>
        <small>التنسيقات: PDF · EPUB · DOCX · CBZ · TXT · MD · HTML · RTF · CSV · JSON · صور</small>
      </div>
    </section>

    <section class="books-continue card" data-continue hidden></section>

    <div class="books-toolbar">
      <label class="books-search">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input class="input" data-search placeholder="ابحث عن كتاب أو مؤلف…" maxlength="80" />
      </label>
      <div class="books-toolbar-actions">
        <select class="input books-sort" data-sort aria-label="ترتيب الكتب">
          <option value="recent">الأحدث قراءة</option>
          <option value="added">الأحدث إضافة</option>
          <option value="title">أبجديًا</option>
          <option value="progress">الأكثر تقدمًا</option>
        </select>
        <button class="btn btn-soft" data-import-secondary type="button">+ استيراد</button>
      </div>
    </div>

    <div class="books-drop" data-drop hidden>
      <div class="books-drop-inner"><strong>أفلت الملفات هنا</strong><span>وسأضيفها إلى مكتبتك</span></div>
    </div>

    <div class="books-grid" data-grid>
      ${Array.from({ length: 6 }, () => '<div class="book-card-skeleton"><div></div><span></span><span></span></div>').join('')}
    </div>

    <p class="books-storage-note">
      🔒 مكتبتك مرتبطة بحسابك ومحفوظة مشفّرة على هذا الجهاز (AES-GCM)، ولا تُرفع إلى الخادم. إشعارات القراءة تصل عبر حسابك.
    </p>
  </div>

  <input type="file" data-file hidden multiple />
  <input type="file" data-cover-file hidden accept="image/*" />
  <div class="books-reader-host" data-reader-host hidden></div>

  <div class="books-overlay" data-overlay hidden>
    <div class="books-overlay-card">
      <span class="books-orb" aria-hidden="true"></span>
      <strong data-overlay-title>أجهّز الكتاب…</strong>
      <p data-overlay-message>قراءة الملف وتجهيزه للقراءة</p>
      <div class="meter"><i data-overlay-bar style="width:4%"></i></div>
      <small data-overlay-file></small>
    </div>
  </div>`;

  const el = {
    grid: root.querySelector('[data-grid]'),
    stats: root.querySelector('[data-stats]'),
    continue: root.querySelector('[data-continue]'),
    search: root.querySelector('[data-search]'),
    sort: root.querySelector('[data-sort]'),
    file: root.querySelector('[data-file]'),
    coverFile: root.querySelector('[data-cover-file]'),
    drop: root.querySelector('[data-drop]'),
    overlay: root.querySelector('[data-overlay]'),
    overlayTitle: root.querySelector('[data-overlay-title]'),
    overlayMessage: root.querySelector('[data-overlay-message]'),
    overlayBar: root.querySelector('[data-overlay-bar]'),
    overlayFile: root.querySelector('[data-overlay-file]'),
    readerHost: root.querySelector('[data-reader-host]'),
    reminder: root.querySelector('[data-reading-reminder]'),
  };

  let reader = null;
  let currentBookId = null;
  let coverBookId = null;
  let dragDepth = 0;

  /* ---------- تحميل المكتبة ---------- */
  async function refresh() {
    try {
      await loadIndex({ force: true });
      state.books = await listBooks();
      state.loading = false;
      renderStats();
      renderReminder();
      renderContinue();
      renderGrid();
    } catch (err) {
      state.loading = false;
      el.grid.innerHTML = `<div class="books-empty"><span>⚠️</span><strong>تعذّر فتح المكتبة</strong><p>${escapeHtml(err.message)}</p><button class="btn btn-soft btn-sm" data-retry>إعادة المحاولة</button></div>`;
      el.grid.querySelector('[data-retry]')?.addEventListener('click', refresh);
    }
  }

  function renderStats() {
    const total = state.books.length;
    const reading = state.books.filter((b) => (b.progress?.percent || 0) > 0 && (b.progress?.percent || 0) < 100).length;
    const done = state.books.filter((b) => (b.progress?.percent || 0) >= 100).length;
    const stats = readingStats();
    const streak = readingStreak(stats);
    const minutes = Math.round(Number(stats.minutesTotal) || 0);
    el.stats.innerHTML = `
      <span><strong>${arNum(total)}</strong> كتاب</span>
      <span><strong>${arNum(reading)}</strong> قيد القراءة</span>
      <span><strong>${arNum(done)}</strong> مكتمل</span>
      <span title="أيام فيها قراءة"><strong>${arNum(stats.days || 0)}</strong> يوم قراءة</span>
      ${streak > 1 ? `<span title="أيام متتالية"><strong>${arNum(streak)}</strong> سلسلة</span>` : ''}
      ${minutes > 0 ? `<span title="إجمالي دقائق القراءة"><strong>${arNum(minutes)}</strong> دقيقة</span>` : ''}`;
  }

  function renderReminder() {
    if (!el.reminder) return;
    const reminder = readingReminderState();
    el.reminder.dataset.enabled = String(reminder.enabled);
    el.reminder.setAttribute('aria-pressed', String(reminder.enabled));
    el.reminder.innerHTML = reminder.enabled
      ? `🔔 تذكير القراءة · ${arNum(reminder.time)}`
      : '🔕 فعّل تذكير القراءة';
    el.reminder.title = reminder.enabled
      ? 'تذكير يومي عند هذا الوقت إن لم تقرأ'
      : 'فعّل تذكيرًا يوميًا للقراءة';
  }

  function renderContinue() {
    const last = lastRead();
    const book = last?.id ? state.books.find((b) => b.id === last.id) : null;
    if (!book) {
      el.continue.hidden = true;
      return;
    }
    el.continue.hidden = false;
    const percent = Math.max(1, Math.min(100, Number(book.progress?.percent) || 0));
    el.continue.innerHTML = `
      <button class="continue-cover ${book.cover ? 'has-art' : ''}" data-open="${escapeHtml(book.id)}" style="--cover-hue:${book.coverHue ?? 320}" aria-label="متابعة قراءة ${escapeHtml(book.title)}">
        ${book.cover ? `<img src="${escapeHtml(book.cover)}" alt="" loading="lazy" decoding="async" />` : ''}
        <span class="continue-format">${escapeHtml(book.format)}</span>
      </button>
      <div class="continue-body">
        <small>متابعة القراءة</small>
        <h3>${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(book.lastChapterTitle || 'من حيث توقفت')} • ${arNum(percent)}٪</p>
        <div class="book-progress"><i style="width:${percent}%"></i></div>
      </div>
      <button class="btn btn-primary btn-sm" data-open="${escapeHtml(book.id)}">تابع القراءة</button>`;
  }

  function visibleBooks() {
    const term = state.search.trim().toLowerCase();
    const list = state.books.filter((book) => {
      if (!term) return true;
      return `${book.title} ${book.author} ${book.format} ${book.sourceName}`.toLowerCase().includes(term);
    });
    const sorted = [...list];
    if (state.sort === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title, 'ar'));
    else if (state.sort === 'added') sorted.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    else if (state.sort === 'progress') sorted.sort((a, b) => (b.progress?.percent || 0) - (a.progress?.percent || 0));
    else sorted.sort((a, b) => String(b.lastOpenedAt || b.createdAt).localeCompare(String(a.lastOpenedAt || a.createdAt)));
    return sorted;
  }

  function bookCard(book) {
    const percent = Math.max(0, Math.min(100, Number(book.progress?.percent) || 0));
    const finished = percent >= 100;
    const reading = percent > 0 && !finished;
    return `<article class="book-card" data-id="${escapeHtml(book.id)}" style="--cover-hue:${book.coverHue ?? 320}">
      <div class="book-cover-wrap">
        <button class="book-cover ${book.cover ? 'has-art' : ''}" data-open="${escapeHtml(book.id)}" aria-label="افتح ${escapeHtml(book.title)}">
          ${book.cover ? `<img class="book-cover-img" src="${escapeHtml(book.cover)}" alt="" loading="lazy" decoding="async" />` : ''}
          <span class="cover-fallback"><b>${escapeHtml(book.title)}</b><small>${escapeHtml(book.author || '')}</small></span>
          <span class="cover-shade" aria-hidden="true"></span>
          <span class="cover-top"><b>${escapeHtml(book.format)}</b>${finished ? '<i>✓</i>' : reading ? `<i>${arNum(percent)}٪</i>` : ''}</span>
          ${finished ? '<span class="cover-done">مكتمل</span>' : ''}
        </button>
        <button class="book-cover-edit" data-cover-edit="${escapeHtml(book.id)}" title="تغيير صورة الغلاف" aria-label="تغيير غلاف ${escapeHtml(book.title)}">🖼</button>
      </div>
      <div class="book-info">
        <h3 title="${escapeHtml(book.title)}">${escapeHtml(book.title)}</h3>
        <p>${escapeHtml(book.author || 'بدون مؤلف')} • ${arNum(book.chapterCount || 0)} فصل</p>
        ${book.warnings?.length ? `<p class="book-warning" title="${escapeHtml(book.warnings.join(' '))}">⚠️ ${escapeHtml(book.warnings[0])}</p>` : ''}
        <div class="book-progress" aria-label="تقدم القراءة ${arNum(percent)}٪">
          <i style="width:${Math.max(0, percent)}%"></i>
          <span>${arNum(percent)}٪</span>
        </div>
        <div class="book-actions">
          <button class="btn btn-sm btn-soft" data-open="${escapeHtml(book.id)}">${finished ? 'أعد القراءة' : reading ? 'تابع' : 'اقرأ'}</button>
          <button class="icon-btn" data-rename="${escapeHtml(book.id)}" title="تغيير العنوان" aria-label="تغيير العنوان">✎</button>
          <button class="icon-btn" data-delete="${escapeHtml(book.id)}" title="حذف الكتاب" aria-label="حذف الكتاب">🗑</button>
        </div>
      </div>
    </article>`;
  }

  function renderGrid() {
    const list = visibleBooks();
    if (!state.books.length && !state.loading) {
      el.grid.innerHTML = `<div class="books-empty">
        <span aria-hidden="true">📖</span>
        <strong>مكتبتك فارغة… ابدأ بكتاب واحد</strong>
        <p>اسحب أي ملف كتاب إلى هذه الصفحة، أو اضغط «أضف كتابًا». سأجهّزه لك بفصول متصلة وغلاف من الملف نفسه.</p>
        <button class="btn btn-primary" data-empty-import>أضف أول كتاب</button>
        <small>PDF · EPUB · DOCX · CBZ · TXT · MD · HTML · RTF · CSV · JSON · صور</small>
      </div>`;
      el.grid.querySelector('[data-empty-import]')?.addEventListener('click', () => el.file.click());
      return;
    }
    if (!list.length) {
      el.grid.innerHTML = `<div class="books-empty"><span>🔎</span><strong>لا كتاب يطابق بحثك</strong><p>جرّب كلمة أخرى.</p></div>`;
      return;
    }
    el.grid.innerHTML = list.map(bookCard).join('');
  }

  /* ---------- الاستيراد ---------- */
  function showOverlay({ title, message = '', file = '', progress = 0.04 }) {
    el.overlay.hidden = false;
    el.overlayTitle.textContent = title;
    el.overlayMessage.textContent = message;
    el.overlayFile.textContent = file;
    el.overlayBar.style.width = `${Math.max(3, Math.min(100, progress * 100))}%`;
  }
  function hideOverlay() {
    el.overlay.hidden = true;
  }

  async function importFiles(files) {
    const list = [...files].filter((file) => file && file.size);
    if (!list.length) return;
    const cameFromEmpty = state.books.length === 0;
    const existing = new Set(state.books.map((b) => `${b.sourceName}::${b.size}`));
    let added = 0;
    let firstAdded = null;
    for (const file of list) {
      if (existing.has(`${file.name}::${file.size}`)) {
        toast.info(`«${file.name}» موجود في مكتبتك`);
        continue;
      }
      showOverlay({ title: 'أجهّز الكتاب…', message: 'قراءة الملف وتجهيزه للقراءة', file: file.name, progress: 0.05 });
      try {
        const meta = await importBookFile(file, (message, progress) => {
          showOverlay({ title: 'أجهّز الكتاب…', message, file: file.name, progress: progress ?? 0.1 });
        });
        added += 1;
        firstAdded = firstAdded || meta;
        toast.success(`أُضيف «${meta.title}» إلى مكتبتك 📚`);
        if (meta.warnings?.length) {
          toast.warning(meta.warnings[0], { duration: 9000 });
        }
      } catch (err) {
        console.error('[books] import failed', err);
        toast.error(`«${file.name}»: ${err?.message || 'تعذّرت القراءة'}`);
      }
    }
    hideOverlay();
    if (added) {
      await refresh();
      if (cameFromEmpty && firstAdded) notifyFirstBook(firstAdded);
    }
  }

  root.querySelectorAll('[data-import], [data-import-secondary]').forEach((btn) => btn.addEventListener('click', () => el.file.click()));
  el.file.addEventListener('change', async () => {
    const files = [...(el.file.files || [])];
    el.file.value = '';
    await importFiles(files);
  });

  function openCoverPicker(id) {
    coverBookId = id;
    el.coverFile.value = '';
    el.coverFile.click();
  }

  el.coverFile.addEventListener('change', async () => {
    const file = el.coverFile.files?.[0];
    const id = coverBookId;
    el.coverFile.value = '';
    coverBookId = null;
    if (!file || !id) return;
    if (!reader) showOverlay({ title: 'أجهّز الغلاف…', message: 'قص وتصغير الصورة', file: file.name, progress: 0.2 });
    try {
      const prepared = await prepareImage(file, { maxSide: 560, quality: 0.8, budget: { left: 3_000_000 } });
      if (!prepared?.src) throw new Error('تعذّر قراءة هذه الصورة');
      await setBookCover(id, prepared.src);
      if (reader && currentBookId === id) reader.setCover?.(prepared.src);
      toast.success('تم تحديث غلاف الكتاب');
      await refresh();
    } catch (err) {
      toast.error(err?.message || 'تعذّر تحديث الغلاف');
    } finally {
      hideOverlay();
    }
  });

  // السحب والإفلات على كامل الصفحة
  root.addEventListener('dragenter', (e) => {
    if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
    dragDepth += 1;
    el.drop.hidden = false;
  });
  root.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) el.drop.hidden = true;
  });
  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragDepth = 0;
    el.drop.hidden = true;
    if (e.dataTransfer?.files?.length) await importFiles(e.dataTransfer.files);
  });

  /* ---------- أحداث المكتبة ---------- */
  el.search.addEventListener('input', () => {
    state.search = el.search.value;
    renderGrid();
  });
  el.sort.addEventListener('change', () => {
    state.sort = el.sort.value;
    renderGrid();
  });

  el.grid.addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) return openReader(openBtn.dataset.open);
    const renameBtn = e.target.closest('[data-rename]');
    if (renameBtn) {
      const book = state.books.find((b) => b.id === renameBtn.dataset.rename);
      if (!book) return;
      const title = await askDialog({ title: 'تغيير عنوان الكتاب', label: 'العنوان الجديد', value: book.title, okText: 'حفظ' });
      if (!title) return;
      try {
        await renameBook(book.id, title);
        toast.success('تم تغيير العنوان');
        await refresh();
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    const deleteBtn = e.target.closest('[data-delete]');
    if (deleteBtn) {
      const book = state.books.find((b) => b.id === deleteBtn.dataset.delete);
      if (!book) return;
      const ok = await confirmDialog({
        title: 'حذف الكتاب',
        message: `سيُحذف «${book.title}» من مكتبتك. يمكنك إضافته مرة أخرى لاحقًا.`,
        okText: 'حذف',
        danger: true,
      });
      if (!ok) return;
      await removeBook(book.id);
      toast.info('حُذف الكتاب');
      await refresh();
    }
  });

  el.grid.addEventListener('click', (e) => {
    const coverBtn = e.target.closest('[data-cover-edit]');
    if (coverBtn) openCoverPicker(coverBtn.dataset.coverEdit);
  });

  // إن تعذّر فك صورة غلاف تالف، يظهر الغلاف الاحتياطي بدل أيقونة الصورة المكسورة
  el.grid.addEventListener(
    'error',
    (e) => {
      if (e.target instanceof HTMLImageElement && e.target.matches('.book-cover-img')) e.target.hidden = true;
    },
    true
  );

  el.continue.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-open]');
    if (btn) openReader(btn.dataset.open);
  });

  el.reminder?.addEventListener('click', async () => {
    const current = readingReminderState();
    const next = { enabled: !current.enabled, time: current.time };
    el.reminder.disabled = true;
    try {
      const res = await api.patch('/api/me', { preferences: { readingReminder: next } }, { silent: true });
      appStore.set({ user: res.data.user });
      updateReadingReminderState(next);
      renderReminder();
      toast.success(next.enabled ? `سنذكّرك بالقراءة يوميًا عند ${arNum(next.time)}` : 'أوقفنا تذكير القراءة', {
        sound: next.enabled ? 'pop' : false,
      });
    } catch (err) {
      toast.error(err?.message || 'تعذّر حفظ إعداد التذكير');
    } finally {
      el.reminder.disabled = false;
    }
  });

  /* ---------- القارئ ---------- */
  async function openReader(id) {
    if (reader) return;
    showOverlay({ title: 'أفتح الكتاب…', message: 'فك التشفير وتجهيز الموضع الأخير' });
    try {
      const { book, meta, recovered } = await openBook(id);
      currentBookId = id;
      resetReadingSyncClock();
      // نُبلغ الخادم ببدء القراءة (عنوان فقط — الكتاب يبقى على الجهاز)
      syncReadingSnapshot({ book: meta, force: true, location: { percent: meta?.progress?.percent || 0, chapterTitle: meta?.lastChapterTitle || '' } });
      el.readerHost.hidden = false;
      el.readerHost.innerHTML = '';
      document.body.classList.add('is-reading');
      hideOverlay();
      sound.play('open');
      let lastKnownPercent = Number(meta?.progress?.percent) || 0;
      reader = await createReader({
        root: el.readerHost,
        book,
        meta,
        prefs: loadPrefs(),
        onProgress: (progress) => {
          const target = state.books.find((b) => b.id === id);
          const before = lastKnownPercent;
          lastKnownPercent = Number(progress.percent) || 0;
          if (target) target.progress = progress;
          updateProgress(id, progress).catch(() => { });
          syncReadingSnapshot({
            book: target,
            location: {
              chapterIndex: progress.chapterIndex,
              chapterTitle: progress.chapterTitle,
              pageIndex: progress.pageInChapter,
              pageCount: progress.pageCount,
              percent: progress.percent,
            },
          });
          if (target && before < 100 && Number(progress.percent) >= 100 && !target.finishedNotifiedAt) {
            target.finishedNotifiedAt = new Date().toISOString();
            updateBookMeta(id, { finishedNotifiedAt: target.finishedNotifiedAt }).catch(() => { });
            notifyBookFinished(target);
            sound.play('fanfare');
            toast.success(`أنهيت «${target.title}» 🎉`, { sound: false, duration: 5000 });
          }
        },
        onBookmark: async (value, list) => {
          try {
            await updateBookMeta(id, { bookmark: value, bookmarks: list || [] });
            const target = state.books.find((b) => b.id === id);
            if (target) {
              target.bookmark = value;
              target.bookmarks = list || [];
            }
          } catch {
            /* لا نعطّل القراءة بسبب فشل الحفظ */
          }
        },
        onReading: ({ seconds, pages }) => {
          recordReading({ seconds, pages });
          const target = state.books.find((b) => b.id === id);
          syncReadingSnapshot({ book: target, location: reader?.getLocation() || null });
        },
        onPrefs: (prefs) => savePrefs(prefs),
        onCoverRequest: () => openCoverPicker(id),
        onExit: closeReader,
      });
      if (recovered) toast.warning('استُعيد الكتاب من نسخة احتياطية');
    } catch (err) {
      hideOverlay();
      el.readerHost.hidden = true;
      document.body.classList.remove('is-reading');
      toast.error(err?.message || 'تعذّر فتح الكتاب');
    }
  }

  async function closeReader() {
    if (!reader) return;
    try {
      syncReadingSnapshot({ book: state.books.find((b) => b.id === currentBookId), location: reader.getLocation?.() || null, force: true });
      reader.destroy();
    } catch {
      /* لا شيء */
    }
    reader = null;
    currentBookId = null;
    el.readerHost.hidden = true;
    el.readerHost.innerHTML = '';
    document.body.classList.remove('is-reading');
    await refresh();
  }

  /* ---------- نافذة نص صغيرة ---------- */
  function askDialog({ title, label, value = '', okText = 'حفظ' }) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'mini-dialog';
      dialog.innerHTML = `
        <form method="dialog">
          <h3>${escapeHtml(title)}</h3>
          <label class="field"><span>${escapeHtml(label)}</span>
            <input class="input" name="value" value="${escapeHtml(value)}" maxlength="180" required />
          </label>
          <div class="mini-dialog-actions">
            <button class="btn btn-ghost btn-sm" value="cancel" formnovalidate>إلغاء</button>
            <button class="btn btn-primary btn-sm" value="ok">${escapeHtml(okText)}</button>
          </div>
        </form>`;
      document.body.appendChild(dialog);
      dialog.showModal();
      const input = dialog.querySelector('input');
      input.focus();
      input.select();
      dialog.addEventListener('close', () => {
        const result = dialog.returnValue === 'ok' ? input.value.trim() : null;
        dialog.remove();
        resolve(result || null);
      });
    });
  }

  function confirmDialog({ title, message, okText = 'تأكيد', danger = false }) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      dialog.className = 'mini-dialog';
      dialog.innerHTML = `
        <form method="dialog">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(message)}</p>
          <div class="mini-dialog-actions">
            <button class="btn btn-ghost btn-sm" value="cancel" formnovalidate>إلغاء</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm" value="ok">${escapeHtml(okText)}</button>
          </div>
        </form>`;
      document.body.appendChild(dialog);
      dialog.showModal();
      dialog.addEventListener('close', () => {
        const ok = dialog.returnValue === 'ok';
        dialog.remove();
        resolve(ok);
      });
    });
  }

  await refresh();

  return () => {
    if (reader) reader.destroy();
    document.body.classList.remove('is-reading');
  };
}
