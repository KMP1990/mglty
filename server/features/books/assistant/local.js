/**
 * مساعد القراءة المحلي — يعمل دائمًا وبلا إنترنت وبلا مفاتيح.
 * ------------------------------------------------------------
 * ليس نموذجًا لغويًا، لكنه محرّك قراءة عملي: يستخرج الفكرة العامة،
 * يرتّب الأفكار، يلتقط التعريفات والأرقام، يبسّط الجمل، ويجيب عن سؤال
 * بالاستناد إلى نص الصفحة نفسها، ويشرح الصور/الرسوم من سياقها.
 * عند ضبط مزوّد LLM تُحسَّن الصياغة في index.js مع رجوع آمن إلى هنا.
 */
import { buildBrief } from './summary.js';
import { extractFacts } from './facts.js';

const STOPWORDS = new Set(
  `من في على إلى الى عن مع هذا هذه ذلك تلك التي الذي الذين اللذين كان كانت يكون تكون قد لقد ثم أو او و لكن لكنه بل لا لم لن ما ماذا هل كيف لماذا أين اين متى من هو هي هم هن أنا انا أنت انت نحن كانوا كل بعض غير بين بعد قبل عند حتى إذا اذا فإن فان كما أيضا ايضا حيث وهو وهي به بها له لها فيه فيها عليه عليها منه منها إليه إليها أي اي كم لدى لدي نحو خلال ضمن دون سوى إلا الا غير عندما بينما لأن لان بسبب لذلك بالتالي عليه عنها بهذا بهذه هؤلاء أولئك نفس ذاته ذات قد يكون هناك هنا الآن الان أكثر اقل أقل جدا جدًا تماما تمامًا ربما لعل كي لكي سوف سوفت`.split(
    /\s+/
  )
);

const normalize = (text = '') =>
  String(text)
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .toLowerCase();

const tidy = (text = '') =>
  String(text)
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();

export function splitSentences(text = '') {
  const raw = tidy(text)
    .replace(/\r/g, '')
    .replace(/([.!?؟۔…])\s*(?=[^.!?؟۔…\s])/g, '$1\n')
    .replace(/\n{2,}/g, '\n');
  const parts = raw
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?؟۔…])\s+/))
    .map((s) => s.replace(/^[•·▪◦*\-–—]\s*/, '').trim())
    .filter((s) => s.length >= 12 && /[\p{L}]/u.test(s));
  const seen = new Set();
  return parts.filter((s) => {
    const key = normalize(s).slice(0, 120);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function tokenize(text = '') {
  return normalize(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

function keywordWeights(text) {
  const counts = new Map();
  for (const word of tokenize(text)) {
    const weight = 1 + Math.min(1.4, word.length / 14);
    counts.set(word, (counts.get(word) || 0) + weight);
  }
  return counts;
}

export function topKeywords(text, limit = 8) {
  // نُعيد الشكل الأصلي للكلمة كما وردت في الصفحة (الفكرة، القراءة…)
  // لا الشكل المطبَّع المستخدم للمطابقة (الفكره، القراءه).
  const originals = String(text)
    .split(/[^\p{L}\p{N}]+/u)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2);
  const byKey = new Map();
  for (const word of originals) {
    const key = normalize(word);
    if (!key || byKey.has(key)) continue;
    byKey.set(key, word);
  }
  return [...keywordWeights(text).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([word]) => byKey.get(word) || word);
}

function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let shared = 0;
  if (A.size < B.size) for (const w of A) if (B.has(w)) shared += 1;
  else for (const w of B) if (A.has(w)) shared += 1;
  return shared / (A.size + B.size - shared);
}

/** أفضل جمل الصفحة: كثافة الكلمات المفتاحية + موقع الجملة + قوة البداية */
export function topSentences(text, limit = 5) {
  const sentences = splitSentences(text);
  if (!sentences.length) return [];
  const weights = keywordWeights(text);
  const scored = sentences.map((sentence, index) => {
    const words = tokenize(sentence);
    const keywordScore = words.reduce((sum, w) => sum + (weights.get(w) || 0), 0);
    const density = keywordScore / Math.sqrt(Math.max(6, words.length));
    const positionBonus = index < 2 ? 1.6 : index < 5 ? 0.7 : 0;
    const cueBonus = /(?:هو|هي|يعني|تعني|النتيجة|لذلك|بسبب|الأهم|أهم|يجب|يمكن|نستنتج|الخلاصة|الهدف|الفرق|يُعد|يعد)/.test(sentence)
      ? 0.9
      : 0;
    const lengthBonus = sentence.length >= 45 && sentence.length <= 260 ? 0.5 : 0;
    return { sentence, index, score: density + positionBonus + cueBonus + lengthBonus };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const item of scored) {
    if (picked.some((p) => jaccard(p.sentence, item.sentence) > 0.62)) continue;
    picked.push(item);
    if (picked.length >= limit) break;
  }
  return picked.sort((a, b) => a.index - b.index).map((p) => p.sentence);
}

function truncate(text, max = 220) {
  const value = tidy(String(text || ''))
    .replace(/^[•·▪◦*\-–—]\s*/, '')
    .replace(/\s+/g, ' ');
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).replace(/\s+\S*$/, '')}…`;
}

const SIMPLE_WORDS = [
  ['استراتيجية', 'خطة'],
  ['استراتيجيات', 'خطط'],
  ['منهجية', 'طريقة'],
  ['منهج', 'طريقة'],
  ['فعالية', 'تأثير'],
  ['كفاءة', 'جودة الأداء'],
  ['بالتالي', 'لذلك'],
  ['على الرغم من', 'مع أن'],
  ['بالإضافة إلى', 'وأيضًا'],
  ['بشكل كبير', 'كثيرًا'],
  ['يتطلب', 'يحتاج'],
  ['تتطلب', 'تحتاج'],
  ['مفهوم', 'فكرة'],
  ['المفاهيم', 'الأفكار'],
  ['تحليل', 'تفكيك وفهم'],
  ['استنتاج', 'نتيجة'],
  ['فرضية', 'تفسير مبدئي'],
  ['بيانات', 'معلومات'],
  ['ظاهرة', 'شيء نلاحظه'],
  ['عوامل', 'أسباب'],
  ['تأثير', 'أثر'],
  ['تطور', 'تغيّر'],
  ['تطبيق', 'استخدام'],
  ['أساسي', 'مهم'],
  ['رئيسي', 'أهم'],
  ['نسبة', 'مقدار'],
  ['مؤشر', 'علامة'],
  ['سياق', 'الظروف المحيطة'],
];

export function simplifyText(text) {
  let out = tidy(text);
  for (const [from, to] of SIMPLE_WORDS) out = out.replaceAll(from, to);
  return out;
}

function splitClauses(sentence) {
  return sentence
    .split(/[،؛]|\s+(?:لكن|ولكن|بينما|حيث|لأن|لان|إذ|اذ)\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 16);
}

/** تعريفات الصفحة: «س هو ص» و «س: ص» */
export function extractTerms(text) {
  const clean = tidy(text).replace(/\n+/g, ' ');
  const terms = [];
  const seen = new Set();
  const patterns = [
    /([\p{L}\p{N}][\p{L}\p{N}\s_-]{1,38}?)\s*(?:هو|هي|يعني|تعني|عبارة عن|يُقصد به|يقصد به|يُعرف بأنه|يعرف بانه)\s+([^.!?؟۔\n]{8,180})/gu,
    /([\p{L}\p{N}][\p{L}\p{N}\s_-]{1,30}?)\s*:\s*([^.!?؟۔\n]{8,180})/gu,
  ];
  for (const re of patterns) {
    for (const match of clean.matchAll(re)) {
      const term = match[1].trim().replace(/^(?:و|أو|او|ثم)\s+/, '');
      const meaning = truncate(match[2], 190);
      const key = normalize(term);
      if (key.length < 2 || key.length > 40 || seen.has(key)) continue;
      if (STOPWORDS.has(key) || tokenize(term).length > 6) continue;
      seen.add(key);
      terms.push({ term, meaning });
      if (terms.length >= 6) return terms;
    }
  }
  return terms;
}

function sentenceWithNumbers(text) {
  return splitSentences(text)
    .filter((s) => /[0-9]|٪|%/.test(s))
    .slice(0, 3);
}

const IMAGE_KINDS = [
  {
    kind: 'رسم بياني',
    re: /(رسم بياني|مخطط بياني|إحصاء|احصاء|نسبة|نسب|محور|أعمدة|اعمده|خط بياني|دائري|بيانات)/,
    how: [
      'اقرأ عنوان الرسم والمحورين لتعرف ما الذي يُقاس.',
      'قارن القيم الكبيرة بالصغيرة، ولا تتوقف عند أول عمود.',
      'ابحث في النص عن تفسير السبب وراء الارتفاع أو الانخفاض.',
    ],
    why: 'الرسم البياني يحوّل الأرقام إلى صورة سريعة، فيكشف الاتجاه أو المقارنة التي يصعب ملاحظتها في النص.',
  },
  {
    kind: 'مخطط توضيحي',
    re: /(مخطط|رسم توضيحي|توضيحي|أجزاء|اجزاء|مراحل|خطوات|عملية|آلية|اليه|هيكل|تركيب|دورة)/,
    how: [
      'ابدأ من أعلى المخطط أو من نقطة البداية، ثم اتبع الأسهم بالترتيب.',
      'سمِّ كل جزء لنفسك بكلماتك قبل الانتقال إلى الذي بعده.',
      'ارجع إلى النص الذي يذكر أسماء الأجزاء لتثبيت المعنى.',
    ],
    why: 'المخطط يوضح العلاقة بين الأجزاء أو تسلسل المراحل، وهو غالبًا خلاصة الشرح كله في صورة واحدة.',
  },
  {
    kind: 'جدول',
    re: /(جدول|جدول بيانات|أعمدة وصفوف|اعمده وصفوف)/,
    how: [
      'اقرأ عنوان الجدول وأسماء الأعمدة أولًا.',
      'قارن صفًا بصف أو عمودًا بعمود بحسب السؤال الذي تبحث عنه.',
      'دوّن أكبر فرق أو أعلى قيمة لأنها غالبًا موضع الفكرة.',
    ],
    why: 'الجدول ينظّم معلومات كثيرة في مساحة صغيرة ويجعل المقارنة الدقيقة ممكنة.',
  },
  {
    kind: 'خريطة',
    re: /(خريطة|خريطه|موقع|حدود|مناطق|دولة|دوله|مدينة|مدينه|جغرافيا)/,
    how: [
      'حدّد المنطقة التي تتحدث عنها الصفحة قبل النظر إلى التفاصيل.',
      'تتبع الاتجاهات: شمال/جنوب/شرق/غرب.',
      'اربط المواقع المذكورة في النص بالعلامات على الخريطة.',
    ],
    why: 'الخريطة تربط المعلومة بالمكان، وهذا يثبّت الفهم أكثر من الأسماء وحدها.',
  },
  {
    kind: 'صورة فوتوغرافية',
    re: /(صورة|صوره|فوتوغراف|فوتوغرافية|تصوير|مشهد|لوحة|لوحه)/,
    how: [
      'انظر إلى العنصر الأكبر أولًا ثم إلى التفاصيل المحيطة به.',
      'ابحث عن عنوان أو تعليق أسفل الصورة يشرح سياقها.',
      'اسأل نفسك: لماذا اختار الكتاب هذه الصورة تحديدًا؟',
    ],
    why: 'الصورة تنقل السياق والملمح الذي يعجز النص عن وصفه، وتصنع رابطًا بصريًا للفكرة.',
  },
];

function classifyImage({ alt = '', caption = '' }, pageText = '') {
  const own = `${alt} ${caption}`.trim();
  const haystack = own || pageText;
  for (const item of IMAGE_KINDS) if (item.re.test(haystack)) return item;
  return {
    kind: 'رسمة/صورة توضيحية',
    how: [
      'اقرأ التعليق أو العنوان المرتبط بالصورة إن وُجد.',
      'حدّد العناصر الأساسية ثم علاقتها ببعضها.',
      'اربط ما تراه بأقرب فقرة في الصفحة.',
    ],
    why: 'الرسمة التوضيحية تختصر فكرة معقدة في مشهد واحد، وتُستخدم لتثبيت الفهم أو تلخيص العلاقات.',
    re: /(شكل|رسم|صورة|صوره|مخطط|بياني|جدول|خريطة|خريطه)/,
  };
}

export function explainImages(images = [], pageText = '') {
  const list = Array.isArray(images) ? images.slice(0, 6) : [];
  const sentences = splitSentences(pageText);
  return list.map((image, index) => {
    const meta = classifyImage(image, pageText);
    const caption = tidy(image.caption || image.alt || '');
    const nearby =
      sentences.find((s) => caption && jaccard(s, caption) > 0.25) ||
      sentences.find((s) => meta.re.test(s)) ||
      sentences[0] ||
      '';
    const feminine = ['صورة فوتوغرافية', 'خريطة', 'رسمة/صورة توضيحية'].includes(meta.kind);
    const pronoun = feminine ? 'هذه' : 'هذا';
    const subject = feminine ? 'موضوعها' : 'موضوعه';
    const what = caption
      ? `${pronoun} ${meta.kind} ${subject}: «${truncate(caption, 160)}».`
      : nearby
        ? `${pronoun} ${meta.kind} مرتبط بالفقرة التي تقول: «${truncate(nearby, 170)}».`
        : `${pronoun} ${meta.kind} داخل الصفحة، ولا يوجد تعليق نصي يوضح ${subject} مباشرة.`;
    return {
      index: index + 1,
      kind: meta.kind,
      what,
      why: meta.why,
      how: meta.how,
      caption: caption || null,
    };
  });
}

function buildFollowUps({ keywords, terms, task }) {
  const out = [];
  if (terms[0]) out.push(`وش يعني «${terms[0].term}» بالضبط؟`);
  if (keywords[0]) out.push(`أعطني مثال على «${keywords[0]}»`);
  if (task !== 'simple') out.push('أوضحها بأسلوب أبسط');
  out.push('شنو الفكرة اللي ممكن يجيبون عنها بالامتحان بهذي الصفحة؟');
  return [...new Set(out)].slice(0, 4);
}

function answerFromPage(text, question) {
  const sentences = splitSentences(text);
  if (!sentences.length) return null;
  const questionWords = tokenize(question);
  const weights = keywordWeights(text);
  const scored = sentences.map((sentence, index) => {
    const words = new Set(tokenize(sentence));
    let overlap = 0;
    for (const q of questionWords) {
      if (words.has(q)) overlap += 2;
      else if ([...words].some((w) => w.startsWith(q) || q.startsWith(w))) overlap += 1;
    }
    const keywordBonus = tokenize(sentence).reduce((sum, w) => sum + (weights.get(w) || 0), 0) / 12;
    return { sentence, index, score: overlap + keywordBonus + (index < 3 ? 0.5 : 0) };
  });
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const matches = scored.filter((s) => s.score >= 2 && s.score > best.score - 3).slice(0, 3);
  if (!best || best.score < 2) return { found: false, sentences: topSentences(text, 2) };
  return { found: true, sentences: matches.map((m) => m.sentence) };
}

/** يبني شرحًا محليًا كاملًا لصفحة واحدة */
/** إزالة آثار ترويسة/تذييل PDF وأرقام الصفحات والنقاط من نص الصفحة */
function stripPageArtifacts(source) {
  return tidy(source)
    .replace(/\bP\s*a\s*g\s*e\b/gi, ' ')
    .replace(/KETABPEDIA(?:\.COM)?/gi, ' ')
    .replace(/www\.[^\s]+/gi, ' ')
    .replace(/^[ \t]*\d+[ \t]*\|[ \t]*$/gm, ' ')
    .replace(/^[ \t]*\d+[ \t]*$/gm, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function stripLeadHeading(source, chapterTitle = '') {
  let text = tidy(source);
  const firstLine = text.split('\n')[0].trim();
  if (!firstLine || firstLine.length > 130) return text;
  const key = normalize(firstLine);
  const chapterKey = normalize(chapterTitle || '');
  const looksLikeHeading =
    (chapterKey && (key === chapterKey || key.startsWith(chapterKey) || chapterKey.startsWith(key))) ||
    /^(?:الفصل|الباب|القسم|المقدمه|مقدمه|الخاتمه|خاتمه|الملحق|ملحق)(?:\s|:|$)/.test(key);
  if (looksLikeHeading) text = text.slice(firstLine.length).trim();
  return text;
}

export function buildDiagram({ title = '', points = [] } = {}) {
  const branches = [];
  for (const point of (points || []).slice(0, 5)) {
    const clean = truncate(String(point || '').replace(/^[•·▪◦*\-–—\s]+/, ''), 120);
    if (!clean) continue;
    const [head, ...tail] = clean.split(/[:：]/);
    const label = truncate(tail.length ? head : clean, 48);
    const leaves = tail.length
      ? tail
          .join(':')
          .split(/[،؛]/)
          .map((part) => part.trim())
          .filter((part) => part.length > 3)
          .slice(0, 3)
      : [];
    branches.push({ label, leaves });
  }
  if (branches.length < 2) return null;
  return { type: 'mindmap', title: truncate(title || 'خريطة أفكار الصفحة', 72), branches };
}

function splitPageChunks(source) {
  const text = String(source || '');
  const re = /^[ \t]*===\s*صفحة\s*([^=\n]+?)\s*===[ \t]*$/gm;
  const hits = [...text.matchAll(re)];
  if (hits.length < 2) return [];
  return hits.map((hit, index) => ({
    label: hit[1].trim(),
    text: text.slice(hit.index + hit[0].length, hits[index + 1]?.index ?? text.length).trim(),
  }));
}

export function runLocal({ task = 'explain', pageText = '', question = '', images = [], title = '', chapterTitle = '', pageNumbers = [], bookContext = '' }) {
  const chunks = splitPageChunks(pageText);
  const multi = chunks.length > 1 || (Array.isArray(pageNumbers) && pageNumbers.length > 1);
  const text = stripLeadHeading(stripPageArtifacts(pageText), chapterTitle).slice(0, 14_000);
  const sentences = splitSentences(text);
  const keywords = topKeywords(text, 8);
  const terms = extractTerms(text);
  const facts = extractFacts(text);
  const top = topSentences(text, 5);
  // الفكرة أولًا، ثم جملة العدد/القائمة — حتى لا يبدأ الملخص بـ«وعددها ٦…» وحدها.
  const important = [...new Set([top[0], ...facts.map((fact) => fact.text), ...top.slice(1)].filter(Boolean))].slice(0, 6);
  const numbers = sentenceWithNumbers(text);
  const imageExplanations = explainImages(images, text);
  const shortPage = sentences.length < 2;
  const wantsDiagram = /مخطط|خريطة|خارطه|شجرة|diagram|mind\s*map/i.test(question);
  const noImage = task === 'image' && !imageExplanations.length;

  const pageBriefs = chunks.slice(0, 5).map((chunk) => {
    const chunkText = stripPageArtifacts(chunk.text);
    const chunkTop = topSentences(chunkText, 2);
    const fact = extractFacts(chunkText).find((item) => !chunkTop[0]?.includes(item.text));
    const best = fact
      ? `${chunkTop[0] || ''} ${fact.text}`.trim()
      : chunkTop[0] || extractFacts(chunkText)[0]?.text || chunkText;
    return { page: chunk.label, text: truncate(best, 190) };
  });
  const brief = buildBrief({
    important,
    keywords,
    pageBriefs,
    multi,
    pageNumber: pageNumbers[0] || '',
    fallback: imageExplanations[0]?.what || '',
  });

  const headline = noImage
    ? 'ما بيه صورة بهذي الصفحة'
    : shortPage && imageExplanations.length
      ? `الصفحة تعتمد على ${imageExplanations[0].kind}`
      : brief.headline;

  const summary = noImage
    ? 'هذي صفحة نصّية وما بيهة صورة أو رسمة. الملخص يخص النص، فاسألني عن فكرة فيه.'
    : shortPage && imageExplanations.length
      ? `الزبدة: ${truncate(imageExplanations[0].what, 260)}`
      : shortPage
        ? 'الزبدة: النص بهذي الصفحة قصير جدًا، وما بيه فكرة كافية للتلخيص. جرّب صفحة فيها فقرات أكثر.'
        : `الزبدة: ${brief.summary}`;

  let points = noImage ? [] : brief.points;
  if (!points.length) {
    // صفحة قصيرة: نعطي تفصيلين إضافيين بدل قسم فارغ
    points = important.slice(1, 4).map((sentence) => truncate(sentence, 190));
  }

  const explanation = [
    { label: 'شنو فكرة الصفحة؟', text: summary },
    {
      label: 'شلون مترابطة الأفكار؟',
      text:
        sentences.length >= 3
          ? `تبدأ الصفحة بـ«${truncate(sentences[0], 130)}»، وبعدها تنتقل إلى «${truncate(sentences[1], 130)}»، وتختم بـ«${truncate(sentences[sentences.length - 1], 130)}». هذا التسلسل يودّي الفكرة من التمهيد للتوضيح وبعدين للنتيجة.`
          : 'الصفحة قصيرة، وما بيهة تسلسل طويل للأفكار. اقرأ الجملة الأساسية وبعدين اربطها بعنوان الفصل.',
    },
    {
      label: 'كلمات لازم تعرفها',
      text: terms.length
        ? terms.map((t) => `«${t.term}»: ${truncate(t.meaning, 170)}`).join(' • ')
        : keywords.length
          ? `أبرز الكلمات: ${keywords.slice(0, 6).join('، ')}. دوّر عليها بباقي الفصل حتى تكوّن صورة كاملة.`
          : 'ما بيه مصطلحات واضحة بهذي الصفحة.',
    },
    {
      label: 'أرقام تستاهل الانتباه',
      text: numbers.length
        ? numbers.map((s) => truncate(s, 190)).join(' • ')
        : 'ما تذكر الصفحة أرقام أو نسب بارزة. اعتمد على الأفكار والعلاقات بدل الأرقام.',
    },
    {
      label: 'جرّب نفسك',
      text: important[0]
        ? `سدّ الصفحة واشرح بجملتك: «${truncate(important[0], 120)}». إذا كدرت تشرحها بلا ما تنظر، يعني فهمت الفكرة الأساسية.`
        : 'اقرأ الصفحة مرة وحدة وبعدين لخّصها بجملة وحدة.',
    },
  ];

  if (/شكل|رسم|صورة|صوره|مخطط|بياني|جدول|خريطة|خريطه/.test(text) && !imageExplanations.length) {
    explanation.push({
      label: 'إشارة إلى رسمة',
      text: 'النص يشير لشكل أو رسمة، بس الصورة نفسها مو بهذي الصفحة. روح للصفحة اللي بيهة الرسمة (أو افتح صورة الكتاب) وأشرحها لك.',
    });
  }

  const simple = important.length
    ? [
        `يعني ببساطة: ${truncate(simplifyText(important[0]), 260)}`,
        ...important.slice(1, 3).map((s) => `وبكلام أسهل: ${truncate(simplifyText(s), 220)}`),
        terms.length
          ? `إذا صادفت كلمة صعبة، تذكّر: ${terms
              .slice(0, 3)
              .map((t) => `«${t.term}» = ${truncate(simplifyText(t.meaning), 100)}`)
              .join('، ')}.`
          : 'اقرأ الجملة مرة ثانية بشوية تأني، واسأل نفسك: شنو الجديد اللي كالته هاي الجملة؟',
      ]
    : ['ما بيه نص كافي حتى أبسطه بهذي الصفحة.'];

  let answer = null;
  if (task === 'ask') {
    const wantsSimple = /(ما فهمت|مافهمت|مو فاهم|لم أفهم|لم افهم|بسط|بسّط|وضح|اشرح|مثال|ببساطة)/.test(question);
    const result = answerFromPage(bookContext ? `${text}
${bookContext}` : text, question);
    if (wantsSimple) {
      const lead = result.found ? result.sentences[0] : result.sentences[0] || important[0];
      answer = lead
        ? `ببساطة: ${truncate(simplifyText(lead), 300)}`
        : 'ببساطة: الصفحة ما بيهة جملة كافية للتبسيط.';
    } else if (result.found) {
      answer = result.sentences
        .slice(0, 2)
        .map((sentence) => truncate(sentence, 280))
        .join(' ');
    } else {
      answer = `الصفحة ما تذكر جواب «${truncate(question, 80)}» مباشرة.${
        result.sentences[0] ? ` أقرب فكرة: ${truncate(result.sentences[0], 220)}` : ''
      }`;
    }
  }

  if (wantsDiagram) {
    const map = buildDiagram({ title: chapterTitle || headline, points: important.length >= 3 ? important : points });
    if (map) {
      answer = `هدي خريطة أفكار ${multi ? 'الصفحات' : 'الصفحة'} — كل فرع فكرة رئيسية وتحته تفاصيلها:\n${map.branches
        .map((branch) => `• ${branch.label}${branch.leaves.length ? `: ${branch.leaves.join('، ')}` : ''}`)
        .join('\n')}`;
    }
  }

  return {
    engine: 'local',
    task,
    pageNumbers: pageNumbers.length ? pageNumbers.slice(0, 8) : [1],
    title: title || null,
    chapterTitle: chapterTitle || null,
    headline,
    summary,
    points: points.slice(0, 4),
    facts: facts.slice(0, 4),
    pageBriefs: brief.pageBriefs,
    explanation,
    simple,
    terms: terms.slice(0, 5),
    keywords: brief.keywords.length ? brief.keywords : keywords.slice(0, 6),
    questions: [
      keywords[0] ? `شنو يعني «${keywords[0]}» بهذي الصفحة؟` : 'شنو الفكرة الرئيسية بهذي الصفحة؟',
      keywords[1] ? `شنو العلاقة بين «${keywords[0] || 'الفكرة الأولى'}» و«${keywords[1]}»؟` : 'شنو أهم نتيجة كالتها الصفحة؟',
      'تكدر تبسط الفكرة بمثال من الحياة اليومية؟',
    ],
    answer,
    images: imageExplanations,
    diagram:
      wantsDiagram || (multi && (task === 'summary' || task === 'explain') && points.length >= 2)
        ? buildDiagram({ title: chapterTitle || headline, points: important.length >= 3 ? important : points })
        : null,
    followUps: buildFollowUps({ keywords, terms, task }),
  };
}
