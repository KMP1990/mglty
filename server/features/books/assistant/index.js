/**
 * مساعد القراءة — عقل واحد فوق عدّة نماذج.
 * ------------------------------------------------------------
 * • محرك محلي فوري (local.js) يعمل دائمًا كشبكة أمان.
 * • أي مزوّد سحابي/محلي يختاره المستخدم (OpenAI، Anthropic، Gemini،
 *   Groq، OpenRouter، DeepSeek، Mistral، xAI، Together، Fireworks،
 *   Cerebras، Ollama، LM Studio، Pollinations).
 * • يدعم صفحات متعددة، صورًا متعددة، بحثًا في الكتاب، ومخططات أفكار.
 * • أي فشل في السحابة يُرجع سببًا عربيًا واضحًا + شرحًا محليًا بدل شاشة خطأ.
 */
import { AI_MODELS } from '../../../shared/llm.js';
import { runLocal, explainImages, splitSentences, topSentences, topKeywords, buildDiagram } from './local.js';
import { SYSTEM, SHAPE, instructionFor } from './prompt.js';
import { looksCorrupted } from './text.js';
import { runCloudPipeline } from './pipeline.js';
import { makeCacheKey } from './cache.js';
import { failureSummary, publicNotice } from './errors.js';
import {
  clampText,
  clampRaw,
  normalizeList,
  normalizeExplanation,
  normalizeTerms,
  normalizeImages,
  normalizeDiagram,
  normalizeKeywords,
  normalizePageBriefs,
  normalizeFacts,
} from './shape.js';

const TASKS = new Set(['summary', 'explain', 'simple', 'ask', 'image']);

/** صفحات متعددة: تنظيف + دمج */
function normalizePages(input) {
  const raw = Array.isArray(input.pages) ? input.pages.slice(0, 8) : [];
  const pages = [];
  for (const item of raw) {
    const number = Math.round(Number(item?.number));
    const text = clampRaw(item?.text, 9000).trim();
    if (!Number.isFinite(number) || number < 1) continue;
    if (!text && !(Array.isArray(item?.images) && item.images.length)) continue;
    pages.push({
      number,
      text,
      reliability: item?.textReliability === 'low' ? 'low' : 'high',
      images: Array.isArray(item.images) ? item.images.slice(0, 2) : [],
      approximate: item?.approximate === true,
    });
  }
  if (pages.length) return pages;
  const number = Math.round(Number(input.pageNumber)) || 1;
  const text = clampRaw(input.pageText, 16_000).trim();
  return text || (Array.isArray(input.images) && input.images.length)
    ? [{ number, text, reliability: input.textReliability === 'low' ? 'low' : 'high', images: input.images || [], approximate: input.approximatePage === true }]
    : [];
}

function buildPrompt({ task, pages, question, history, title, chapterTitle, visionNote = '', reliabilityNote = '', bookContext = '', hasDiagram }) {
  const pageBlocks = pages
    .map((page) => {
      const imageLines = (page.images || [])
        .map((image, index) => `  صورة ${index + 1}: ${clampText(image.caption || image.alt || image.kind || 'بدون وصف', 160)}`)
        .join('\n');
      return [
        `=== صفحة ${page.number}${page.approximate ? ' (تقريبي)' : ''} ===`,
        imageLines ? `صور الصفحة:\n${imageLines}` : '',
        page.text ? clampRaw(page.text, 8000) : '(لا يوجد نص مستخرج — اعتمد على صورة الصفحة)',
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n');
  const historyLines = (history || [])
    .map((item) => `${item.role === 'assistant' ? 'المساعد' : 'القارئ'}: ${clampText(item.content, 700)}`)
    .join('\n');
  return [
    `الكتاب: ${clampText(title, 160) || 'غير معروف'}`,
    `الفصل: ${clampText(chapterTitle, 160) || 'غير معروف'} | الصفحات: ${pages.map((p) => p.number).join('، ') || 'غير محددة'}`,
    visionNote || '',
    reliabilityNote || '',
    hasDiagram ? 'أضف diagram يلخّص الأفكار الرئيسية كفروع قصيرة (2-5 فروع).' : '',
    historyLines ? `سياق المحادثة السابقة:\n${historyLines}` : '',
    bookContext ? `مقتطفات من بحث القارئ في الكتاب (استعن بها):\n"""\n${clampText(bookContext, 4000)}\n"""` : '',
    `المطلوب: ${instructionFor(task, question, pages)}`,
    'اعتمد على النص التالي:',
    '"""',
    pageBlocks || '(لا يوجد نص)',
    '"""',
    `أعد JSON بهذا الشكل فقط:\n${SHAPE}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function visionRequired(base, task, pages) {
  const label = pages.length > 1 ? `الصفحات ${pages.map((p) => p.number).join('، ')}` : `صفحة ${pages[0]?.number || 1}`;
  const message = `${label} ما وصلني نصها، وما عندي نموذج رؤية يقرأ الصورة مباشرة. جرّبت قراءتها بالـOCR تلقائيًا؛ إذا فشلت جرّب صورة أوضح أو صفحة فيها نص.`;
  return {
    ...base,
    engine: 'local',
    needsVision: true,
    headline: `${label} صورة`,
    summary: message,
    points: [],
    explanation: [],
    simple: [],
    terms: [],
    images: [],
    diagram: null,
    answer: task === 'ask' ? message : base.answer,
    notice: null,
    needsModel: false,
  };
}

export function createBookAssistant({ logger = console, llm = null } = {}) {
  return {
    status(active = llm, configs = []) {
      return {
        engine: active ? 'hybrid' : 'local',
        provider: active?.provider || null,
        model: active?.model || null,
        vision: Boolean(active?.vision && active?.visionModel),
        visionModel: active?.visionModel || null,
        models: AI_MODELS.length,
        ensemble: true,
        modelCount: configs?.length || 0,
      };
    },

    /**
     * @param {object} input
     * @param {object|null} overrideLlm إعداد المزوّد المختار لهذا المستخدم
     */
    async help(input = {}, overrideLlm = null) {
      const configs = (Array.isArray(overrideLlm) ? overrideLlm : overrideLlm ? [overrideLlm] : llm ? [llm] : []).filter(
        (config) => config && config.provider
      );
      const active = configs.find((config) => config.vision) || configs[0] || null;
      const visionConfigs = configs.filter((config) => config.vision);
      const task = TASKS.has(input.task) ? input.task : 'explain';
      const pages = normalizePages(input);
      const pageNumbers = pages.map((page) => page.number);
      const combinedText =
        pages.length === 1
          ? String(pages[0].text || '').slice(0, 22_000)
          : pages.length > 1
            ? pages.map((page) => `=== صفحة ${page.number} ===\n${page.text || ''}`).join('\n\n').slice(0, 22_000)
            : '';
      const lowReliability = pages.some((page) => page.reliability === 'low') || input.textReliability === 'low';
      const approximatePage = pages.some((page) => page.approximate) || input.approximatePage === true;
      const bookContext = clampText(input.bookContext, 4200);
      const noText = !pages.some((page) => page.text.trim()) && !bookContext;
      // نص OCR يُصحح قبل التلخيص؛ لا نعرض تحذيرًا للقارئ.
      const notice = input.ocr === true
        ? null
        : lowReliability
          ? 'النص مستخرج من خطوط PDF تالفة، فممكن تلگى أخطاء بالكلمات. الواجهة تقرأ الصورة بالـOCR المجاني تلقائيًا.'
          : approximatePage
          ? 'رقم الصفحة تقريبي لأن هذا الكتاب ما يخزّن نطاقات صفحات؛ الشرح مبني على نص الفصل.'
          : null;

      const base = runLocal({
        task,
        pageText: combinedText || bookContext,
        question: clampText(input.question, 500),
        images: pages.flatMap((page) => page.images || []),
        title: clampText(input.title, 160),
        chapterTitle: clampText(input.chapterTitle, 160),
        pageNumbers,
        bookContext,
      });

      const visionImages = (Array.isArray(input.visionImages) ? input.visionImages : [])
        .filter((image) => typeof image === 'string' && image.startsWith('data:image/'))
        .slice(0, 4);
      const hasVisionImage = Boolean(visionConfigs.length && visionImages.length);

      // صور فقط بلا نص ولا نموذج رؤية: نوضّح الخيار بدل شرح فارغ.
      if (noText && !hasVisionImage) {
        return visionRequired(base, task, pages);
      }
      if (!combinedText.trim() && !hasVisionImage && bookContext) {
        // سؤال شامل اعتمد على مقتطفات البحث؛ المحرك المحلي يعرف يجيب.
        return { ...base, needsVision: false, notice, provider: active?.provider || null, model: active?.model || null };
      }
      if (!configs.length) {
        return {
          ...base,
          needsVision: Boolean(pages.some((page) => page.images.length)) && noText,
          notice,
          provider: null,
          model: null,
          engine: 'local',
        };
      }

      const wantsDiagram = /مخطط|خريطة|خارطه|شجرة|diagram|mind\s*map/i.test(String(input.question || ''));
      const prompt = buildPrompt({
        task,
        pages,
        question: clampText(input.question, 500),
        history: Array.isArray(input.history) ? input.history.slice(-6) : [],
        title: input.title,
        chapterTitle: input.chapterTitle,
        bookContext,
        hasDiagram: wantsDiagram,
        visionNote: hasVisionImage
          ? `الصور المرفقة هي صور الصفحات ${pageNumbers.join('، ')}. اقرأ النص الظاهر فيها واعتمد عليها${combinedText ? '، واستخدم النص المستخرج للمساعدة فقط.' : '؛ لا يوجد نص مستخرج.'}`
          : '',
        reliabilityNote: lowReliability
          ? 'ملاحظة: النص من خطوط PDF تالفة، وقد تكون كلمات مشوّهة. اعتمد على صورة الصفحة إن وُجدت، وتجنّب الاقتباس الحرفي.'
          : approximatePage
            ? 'ملاحظة: رقم الصفحة تقريبي؛ اعتمد على نص الفصل.'
            : '',
      });

      const message = { role: 'user', content: prompt };
      if (hasVisionImage) message.images = visionImages;

      // مجلس النماذج: عدة نماذج مجانية بالتوازي، ثم اختيار الأفضل ودمج الآراء.
      const cacheKey = hasVisionImage
        ? ''
        : makeCacheKey({
            userId: input.userId || '',
            task,
            question: input.question || '',
            title: input.title || '',
            chapterTitle: input.chapterTitle || '',
            pageNumbers,
            bookContext,
            history: input.history || [],
            text: combinedText,
          });
      const ensemble = await runCloudPipeline({
        cacheKey,
        configs: hasVisionImage ? [...visionConfigs, ...configs.filter((config) => !config.vision)] : configs,
        messages: [message],
        task,
        keywords: base.keywords,
        pageText: combinedText,
        multi: pages.length > 1,
        logger,
      });

      if (!ensemble.ok) {
        logger.warn?.('books_ensemble_failed', { task, attempts: ensemble.attempts, failures: failureSummary(ensemble.failures) });
        if (noText && hasVisionImage) return { ...visionRequired(base, task, pages), notice: publicNotice() };
        return {
          ...base,
          engine: 'local',
          degraded: true,
          notice,
          cloudError: publicNotice(),
          provider: null,
          model: null,
          attempts: ensemble.attempts,
        };
      }

      const used = ensemble.best?.config || active;
      const result = ensemble.best?.result || {};
      const modelsUsed = Math.max(1, ensemble.candidates?.length || 1);
      let parsed = ensemble.best?.parsed || null;
      if (!parsed) {
        // بعض النماذج ترجع نصًا عاديًا رغم طلب JSON: نستخدمه كإجابة مباشرة.
        const plain = clampText(result.text, 4000);
        if (task === 'ask' && plain.length > 20) {
          return { ...base, engine: 'hybrid', provider: used.provider, model: result.model, vision: Boolean(result.vision), answer: plain, summary: plain.slice(0, 500), notice };
        }
        return { ...base, engine: 'local', degraded: true, notice, cloudError: null, provider: used.provider, model: result.model };
      }

      const cloudSummary = clampText(parsed.summary, 760);
      const hasPageBriefs = Array.isArray(parsed.pageBriefs) && parsed.pageBriefs.length > 1;
      // خلاصة قصيرة جدًا (أقل من ٧٠ حرفًا) غالبًا تلميح لا تلخيص؛ نرجع للمحلي الأوضح.
      const summaryTooThin = !cloudSummary || (!hasPageBriefs && cloudSummary.length < 70);
      const baseFacts = Array.isArray(base.facts) ? base.facts : [];
      const hasNumberFact = baseFacts.some((fact) => /[0-9٠-٩۰-۹]/u.test(String(fact.value || fact.text || '')));
      const missesNumberFact = hasNumberFact && !/[0-9٠-٩۰-۹]/u.test(cloudSummary || '');
      const summary =
        cloudSummary && !looksCorrupted(cloudSummary) && !summaryTooThin && !missesNumberFact
          ? cloudSummary
          : base.summary;
      const points = normalizeList(parsed.points, 4, 240).filter((point) => !looksCorrupted(point));
      const explanation = normalizeExplanation(parsed.explanation);
      const terms = normalizeTerms(parsed.terms);
      const simple = normalizeList(parsed.simple, 4, 300);
      const keywords = normalizeKeywords(parsed.keywords, base.keywords);
      const facts = normalizeFacts(parsed.facts, base.facts);
      const pageBriefs = normalizePageBriefs(parsed.pageBriefs);

      return {
        engine: 'ensemble',
        ensemble: true,
        modelsUsed,
        cached: Boolean(ensemble.cached),
        attempts: ensemble.attempts,
        quality: ensemble.best?.score ?? null,
        task,
        title: base.title,
        chapterTitle: base.chapterTitle,
        provider: used.provider,
        model: result.model || used.model,
        vision: Boolean(result.vision),
        headline: clampText(parsed.headline, 190) || (points[0] ? clampText(points[0], 190) : base.headline),
        summary,
        points: (points.length ? points : base.points).slice(0, 4),
        // وضع التلخيص لا يعرض شرحًا/أسئلة/مصطلحات في الواجهة — نُرجعها فارغة
        explanation: task === 'summary' ? [] : explanation.length ? explanation : base.explanation,
        simple: task === 'simple' ? (simple.length ? simple : base.simple) : [],
        terms: task === 'summary' ? [] : terms.length ? terms : base.terms,
        keywords,
        facts,
        pageBriefs,
        questions: task === 'summary'
          ? []
          : normalizeList(parsed.questions, 4, 240).length
            ? normalizeList(parsed.questions, 4, 240)
            : base.questions,
        answer: (() => {
          const answer = clampText(parsed.answer, 1200);
          return answer && !looksCorrupted(answer) ? answer : task === 'ask' ? base.answer : null;
        })(),
        images: normalizeImages(parsed.images, base.images),
        diagram: wantsDiagram ? normalizeDiagram(parsed.diagram, base.diagram) : null,
        followUps: normalizeList(parsed.followUps, 3, 110).length
          ? normalizeList(parsed.followUps, 3, 110)
          : base.followUps.slice(0, 3),
        pageNumbers,
        needsVision: false,
        notice,
      };
    },

    runLocal,
    buildDiagram,
    splitSentences,
    topSentences,
    topKeywords,
    explainImages,
  };
}
