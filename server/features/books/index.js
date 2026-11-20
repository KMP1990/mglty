/**
 * ميزة كتبي — مساعد القراءة فقط على الخادم.
 * ------------------------------------------------------------
 * ملفات الكتب لا تُرفع إلى الخادم ولا تُخزَّن عليه: تُقرأ وتُشفَّر في جهاز
 * المستخدم عبر features/save. هنا فقط تحليل الصفحة الحالية عند طلب المستخدم:
 * GET  /api/books/ai/status   هل يوجد مزوّد LLM؟ هل يدعم الصور؟
 * POST /api/books/ai/help     ملخص/شرح/تبسيط/سؤال/شرح رسمة
 */
import express from 'express';
import { wrap, badRequest } from '../../shared/http.js';
import { createRateLimiter } from '../../shared/rate-limit.js';
import { askLlmDetailed, AI_MODELS, AI_PROVIDERS, FREE_PROVIDERS } from '../../shared/llm.js';
import { createBookAssistant } from './assistant/index.js';
import { correctOcrText } from './assistant/ocr-fix.js';
import { sanitizeAssistantPayload } from './assistant/text.js';
import { createAiCredentials } from './assistant/credentials.js';

const TASKS = new Set(['summary', 'explain', 'simple', 'ask', 'image']);

export default {
  register(app, ctx) {
    const { config, logger } = ctx;
    const auth = ctx.services?.auth;
    if (!auth) throw new Error('books feature requires auth feature registered first');

    const assistant = createBookAssistant({ logger });
    const credentials = createAiCredentials({ config, logger });
    ctx.services = { ...(ctx.services || {}), books: { assistant, credentials } };

    // النموذج النشط: اختيار المستخدم، ثم مفتاح البيئة، ثم السحابة المجانية
    // (Pollinations) حتى لا يبقى المساعد محليًا فقط. يمكن إيقاف السحابة من الإعدادات.
    const CLOUD_PROVIDERS = new Set([
      'openai',
      'anthropic',
      'google',
      'groq',
      'openrouter',
      'deepseek',
      'mistral',
      'xai',
      'together',
      'fireworks',
      'cerebras',
      'pollinations',
    ]);

    /**
     * كل النماذج المجانية المتاحة دفعة واحدة — لا اختيار من المستخدم.
     * Pollinations يعمل دائمًا، وأي مفتاح مجاني (Gemini/Groq/OpenRouter…)
     * يُضاف تلقائيًا إلى نفس القائمة، مع OCR في الواجهة كخطة مجانية للصور.
     */
    async function configsFor(user) {
      // النماذج مجانية فقط؛ إعداد «cloudAi» القديم لا يمنعها. الإيقاف الإداري يبقى عبر AI_CLOUD=off.
      const cloudAllowed = process.env.NODE_ENV !== 'test' && process.env.AI_CLOUD !== 'off';
      return credentials.freeConfigs(user.id, { vision: true, includeCloud: cloudAllowed });
    }

    async function activeFor(user) {
      const configs = await configsFor(user);
      return configs[0] || null;
    }

    const router = express.Router();
    const { guards } = auth;
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: Number(process.env.RL_AI || (config.isProd ? 40 : 1000)),
    });
    // مزامنة تقدّم القراءة خفيفة ومتكررة — حد أعلى لكنه يحمي من الطلبات الشاذة
    const syncLimiter = createRateLimiter({ windowMs: 60_000, max: Number(process.env.RL_SYNC || 180) });

    router.use(guards.loadSession, guards.requireAuth);
    router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    router.get(
      '/ai/status',
      wrap(async (req, res) => {
        const configs = await configsFor(req.auth.user);
        const active = configs[0] || null;
        const state = await credentials.publicState(req.auth.user.id);
        res.json({
          ok: true,
          data: {
            ...assistant.status(active, configs),
            engine: configs.length > 1 ? 'ensemble' : configs.length ? 'hybrid' : 'local',
            free: true,
            auto: true,
            ocr: true,
            cloud: configs.some((config) => CLOUD_PROVIDERS.has(config.provider)),
            activeProvider: active?.provider || null,
            activeModel: active?.model || null,
            vision: configs.some((config) => config.vision),
            providers: Object.fromEntries(
              Object.entries(state.providers).filter(([id]) => FREE_PROVIDERS.includes(id))
            ),
            available: configs.map((config) => ({
              provider: config.provider,
              model: config.model,
              vision: Boolean(config.vision),
              source: config.source,
            })),
            hasKey: Object.values(state.providers).some((p) => p.configured && p.needsKey),
          },
        });
      })
    );

    // ---------- إعدادات النماذج (المفاتيح تُخزَّن مشفّرة على الخادم) ----------
    router.get(
      '/ai/models',
      wrap(async (req, res) => {
        const state = await credentials.publicState(req.auth.user.id);
        res.json({
          ok: true,
          data: {
            models: AI_MODELS.map((model) => ({ ...model, free: FREE_PROVIDERS.includes(model.provider) })),
            providers: Object.values(AI_PROVIDERS).map((provider) => ({
              ...provider,
              free: FREE_PROVIDERS.includes(provider.id),
              configured: Boolean(state.providers[provider.id]?.configured),
              fromEnv: Boolean(state.providers[provider.id]?.fromEnv),
            })),
            active: state.active,
          },
        });
      })
    );

    router.put(
      '/ai/settings',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const body = req.body || {};
        try {
          await credentials.save(req.auth.user.id, {
            provider: body.provider,
            model: body.model,
            apiKey: body.apiKey,
            baseUrl: body.baseUrl,
          });
        } catch (err) {
          throw badRequest('invalid_provider_settings', err?.message || 'إعدادات المزوّد غير صالحة');
        }
        res.json({ ok: true, data: await credentials.publicState(req.auth.user.id) });
      })
    );

    router.post(
      '/ai/settings/active',
      guards.requireCsrf,
      wrap(async (req, res) => {
        try {
          await credentials.setActive(req.auth.user.id, { provider: req.body?.provider, model: req.body?.model });
        } catch (err) {
          throw badRequest('invalid_provider', err?.message || 'تعذّر اختيار المزوّد');
        }
        res.json({ ok: true, data: await credentials.publicState(req.auth.user.id) });
      })
    );

    router.delete(
      '/ai/settings/:provider',
      guards.requireCsrf,
      wrap(async (req, res) => {
        await credentials.remove(req.auth.user.id, req.params.provider);
        res.json({ ok: true, data: await credentials.publicState(req.auth.user.id) });
      })
    );

    // اختبار اتصال سريع بالنموذج المختار (رسالة قصيرة جدًا)
    router.post(
      '/ai/test',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const configs = await configsFor(req.auth.user);
        if (!configs.length) throw badRequest('no_provider', 'لا يوجد نموذج مجاني متاح الآن');
        let last = null;
        for (const config of configs) {
          const result = await askLlmDetailed(config, {
            messages: [{ role: 'user', content: 'اكتب كلمة واحدة فقط: جاهز' }],
            maxTokens: 24,
            json: false,
            timeoutMs: 20_000,
            logger,
          });
          last = { config, result };
          if (result.text) break;
        }
        const { config, result } = last;
        res.json({
          ok: true,
          data: {
            ok: Boolean(result.text),
            provider: config.provider,
            model: result.model || config.model,
            sample: result.text ? String(result.text).slice(0, 120) : null,
            error: result.error?.code || null,
            message: result.error ? 'تعذّر الاتصال بكل النماذج المجانية' : 'الاتصال يعمل',
          },
        });
      })
    );

    // تصحيح نص OCR قبل التلخيص: عربي + قراءة إنجليزية تقريبية، بلا تحذير للقارئ.
    router.post(
      '/ai/ocr-fix',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const arabicText = String(req.body?.text ?? '').slice(0, 12_000);
        const englishText = String(req.body?.englishText ?? '').slice(0, 6_000);
        if (!arabicText.trim()) throw badRequest('empty_ocr', 'لا يوجد نص لتصحيحه');
        const configs = await configsFor(req.auth.user);
        const result = await correctOcrText({ configs, arabicText, englishText, logger });
        res.json({ ok: true, data: result });
      })
    );

    router.post(
      '/ai/help',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const body = req.body || {};
        const task = TASKS.has(body.task) ? body.task : 'explain';
        const cleanImages = (value) =>
          Array.isArray(value)
            ? value.slice(0, 8).map((image) => ({
                alt: String(image?.alt ?? '').slice(0, 300),
                caption: String(image?.caption ?? '').slice(0, 300),
                kind: String(image?.kind ?? '').slice(0, 80),
              }))
            : [];

        const pages = Array.isArray(body.pages)
          ? body.pages
              .slice(0, 8)
              .map((page) => ({
                number: Math.round(Number(page?.number)) || 0,
                text: String(page?.text ?? '').slice(0, 10_000),
                images: cleanImages(page?.images),
                textReliability: page?.textReliability === 'low' ? 'low' : 'high',
                approximate: page?.approximate === true,
              }))
              .filter((page) => page.number > 0)
          : [];

        const pageText = pages.length ? '' : String(body.pageText ?? '').slice(0, 18_000);
        const images = pages.length ? [] : cleanImages(body.images);
        const bookContext = String(body.bookContext ?? '').slice(0, 5_000);
        const hasContent =
          pages.some((page) => page.text.trim() || page.images.length) ||
          pageText.trim() ||
          images.length ||
          bookContext.trim() ||
          (Array.isArray(body.visionImages) && body.visionImages.length) ||
          (typeof body.visionImage === 'string' && body.visionImage.length);
        if (!hasContent) throw badRequest('empty_page', 'لا يوجد نص أو صورة لتحليلها');
        if (task === 'ask' && !String(body.question || '').trim()) {
          throw badRequest('question_required', 'اكتب سؤالك أولًا');
        }

        // صور اختيارية للتحليل البصري؛ تُمرّر فقط إذا كان المزوّد يدعم الرؤية.
        const rawVision = Array.isArray(body.visionImages)
          ? body.visionImages
          : typeof body.visionImage === 'string'
            ? [body.visionImage]
            : [];
        const visionImages = [];
        let visionBytes = 0;
        for (const image of rawVision.slice(0, 4)) {
          if (typeof image !== 'string' || !image.startsWith('data:image/')) continue;
          visionBytes += image.length;
          if (image.length > 2_800_000 || visionBytes > 6_000_000) {
            throw badRequest('image_too_large', 'الصور المرسلة للتحليل كبيرة جدًا — جرّب صفحات أقل');
          }
          visionImages.push(image);
        }

        const history = Array.isArray(body.history)
          ? body.history.slice(-6).map((item) => ({
              role: item?.role === 'assistant' ? 'assistant' : 'user',
              content: String(item?.content ?? '').slice(0, 1200),
            }))
          : [];

        const configs = await configsFor(req.auth.user);
        let data;
        try {
          data = await assistant.help(
            {
              task,
              pages: pages.length ? pages : undefined,
              pageText,
              question: String(body.question ?? '').slice(0, 600),
              images,
              history,
              userId: req.auth.user.id,
              title: String(body.title ?? '').slice(0, 160),
              chapterTitle: String(body.chapterTitle ?? '').slice(0, 160),
              pageNumber: Number(body.pageNumber) || pages[0]?.number || 1,
              visionImages,
              bookContext,
              textReliability:
                body.textReliability === 'low' || pages.some((page) => page.textReliability === 'low')
                  ? 'low'
                  : 'high',
              ocr: body.ocr === true,
              approximatePage: body.approximatePage === true || pages.some((page) => page.approximate),
            },
            configs
          );
        } catch (error) {
          // لا نعرض 500 للقارئ أبدًا: نرجع شرحًا محليًا ونسجّل السبب.
          logger.error?.('books_ai_help_failed', { message: error?.message, stack: error?.stack });
          data = assistant.runLocal({
            task,
            pageText: pageText || pages.map((page) => page.text).join(String.fromCharCode(10)),
            question: String(body.question ?? '').slice(0, 600),
            images,
            title: String(body.title ?? '').slice(0, 160),
            chapterTitle: String(body.chapterTitle ?? '').slice(0, 160),
            pageNumbers: pages.map((page) => page.number),
          });
          data.engine = 'local';
          data.degraded = true;
          data.cloudError = 'صار خطأ غير متوقع، فعرضت ملخصًا محليًا. جرّب مرة ثانية.';
        }

        res.json({ ok: true, data: sanitizeAssistantPayload(data) });
      })
    );

    // ---------- مزامنة القراءة (الكتاب نفسه يبقى على الجهاز) ----------
    // الخادم لا يعرف محتوى الكتاب، فقط: العنوان، الفصل، النسبة، دقائق/صفحات القراءة.
    // الفائدة: تذكير القراءة والملخص اليومي يصلان حتى لو كان التطبيق مغلقًا لأيام.
    router.get(
      '/reading',
      wrap(async (req, res) => {
        const presence = ctx.services?.presence;
        const state = presence ? await presence.read(req.auth.user.id) : null;
        const reminders = req.auth.user.preferences?.readingReminder || { enabled: false, time: '20:30' };
        res.json({ ok: true, data: { reading: state?.reading || null, reminder: reminders } });
      })
    );

    router.put(
      '/reading',
      syncLimiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const presence = ctx.services?.presence;
        if (!presence) return res.json({ ok: true, data: { saved: false } });
        const reading = await presence.saveReading(req.auth.user.id, req.body || {});
        const reminders = req.auth.user.preferences?.readingReminder || { enabled: false, time: '20:30' };
        res.json({
          ok: true,
          data: {
            saved: true,
            reading: {
              bookTitle: reading?.bookTitle || null,
              chapterTitle: reading?.chapterTitle || null,
              percent: reading?.percent || 0,
              lastReadDate: reading?.lastReadDate || null,
              streakDays: reading?.streakDays || 0,
            },
            reminder: reminders,
          },
        });
      })
    );

    app.use('/api/books', router);
    logger.debug('books_mounted', { path: '/api/books' });
  },
};
