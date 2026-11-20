/**
 * طبقة مزوّدات الذكاء الاصطناعي — سحابية ومحلية، مع دعم الرؤية.
 * ------------------------------------------------------------
 * المبدأ: التطبيق يبقى يعمل بلا أي مفتاح، لكنه لم يبقَ «محليًا فقط».
 *  • كتالوج نماذج مدمج (OpenAI، Anthropic، Google، Groq، OpenRouter،
 *    DeepSeek، Mistral، xAI، Together، Fireworks، Cerebras، Ollama،
 *    LM Studio، Pollinations المجاني بلا مفتاح).
 *  • وضع مجاني مدمج: Pollinations + أي مفتاح مجاني متاح، بلا اختيار نموذج.
 *    المفاتيح تُخزَّن مشفّرة على الخادم (credentials.js) ولا تُعاد للواجهة.
 *  • الرؤية: صور الصفحات تُرسل للنماذج البصرية (OpenAI/Anthropic/Gemini
 *    وأي مزوّد متوافق) عبر ثلاث واجهات مختلفة.
 *  • أي فشل شبكة/مفتاح/مهلة يُرجع خطأً مفصّلًا للمستدعي ليعرض سببًا
 *    عربيًا واضحًا، مع إمكانية الرجوع للمحرك المحلي.
 */

/** مزوّدات معروفة: kind يحدد شكل الطلب، needsKey هل يعمل بلا مفتاح */
export const AI_PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    needsKey: true,
    keysUrl: 'https://platform.openai.com/api-keys',
    note: 'أقوى النماذج البصرية واللغوية',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    needsKey: true,
    keysUrl: 'https://console.anthropic.com/settings/keys',
    note: 'ممتاز في الشرح الطويل والتحليل',
  },
  google: {
    id: 'google',
    name: 'Google Gemini',
    kind: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    needsKey: true,
    keysUrl: 'https://aistudio.google.com/app/apikey',
    note: 'طبقة مجانية سخية + رؤية قوية',
  },
  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    needsKey: true,
    keysUrl: 'https://console.groq.com/keys',
    note: 'سرعة عالية جدًا',
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    keysUrl: 'https://openrouter.ai/keys',
    note: 'مفتاح واحد لعشرات النماذج',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    kind: 'openai',
    baseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    keysUrl: 'https://platform.deepseek.com/api_keys',
    note: 'رخيص وقوي في التحليل',
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    needsKey: true,
    keysUrl: 'https://console.mistral.ai/api-keys',
    note: 'نماذج Pixtral البصرية',
  },
  xai: {
    id: 'xai',
    name: 'xAI',
    kind: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    needsKey: true,
    keysUrl: 'https://console.x.ai',
    note: 'Grok بنسخة بصرية',
  },
  together: {
    id: 'together',
    name: 'Together AI',
    kind: 'openai',
    baseUrl: 'https://api.together.xyz/v1',
    needsKey: true,
    keysUrl: 'https://api.together.xyz/settings/api-keys',
    note: 'نماذج مفتوحة المصدر',
  },
  fireworks: {
    id: 'fireworks',
    name: 'Fireworks AI',
    kind: 'openai',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    needsKey: true,
    keysUrl: 'https://fireworks.ai/account/api-keys',
    note: 'نماذج سريعة ورؤية',
  },
  cerebras: {
    id: 'cerebras',
    name: 'Cerebras',
    kind: 'openai',
    baseUrl: 'https://api.cerebras.ai/v1',
    needsKey: true,
    keysUrl: 'https://cloud.cerebras.ai',
    note: 'استدلال سريع',
  },
  ollama: {
    id: 'ollama',
    name: 'Ollama (محلي)',
    kind: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    keysUrl: 'https://ollama.com/download',
    note: 'يعمل على جهازك بلا إنترنت',
  },
  lmstudio: {
    id: 'lmstudio',
    name: 'LM Studio (محلي)',
    kind: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    keysUrl: 'https://lmstudio.ai',
    note: 'خادم نماذج محلي متوافق مع OpenAI',
  },
  pollinations: {
    id: 'pollinations',
    name: 'Pollinations (مجاني بلا مفتاح)',
    kind: 'openai',
    baseUrl: 'https://text.pollinations.ai/openai',
    needsKey: false,
    keysUrl: 'https://pollinations.ai',
    note: 'نصّي بلا مفتاح — حدّ استجابة كل ٤٥ ثانية',
  },
};

/**
 * كتالوج النماذج المدمجة. vision=true يعني يقرأ صور الصفحات مباشرة.
 * tier: flagship / fast / cheap / local / free
 */
export const AI_MODELS = [
  { id: 'openai:gpt-4o', provider: 'openai', model: 'gpt-4o', label: 'GPT-4o', vision: true, tier: 'flagship', note: 'قراءة صور دقيقة وشرح عربي ممتاز' },
  { id: 'openai:gpt-4o-mini', provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o mini', vision: true, tier: 'fast', note: 'سريع ورخيص للاستخدام اليومي' },
  { id: 'openai:gpt-4.1-mini', provider: 'openai', model: 'gpt-4.1-mini', label: 'GPT-4.1 mini', vision: true, tier: 'fast', note: 'توازن جيد بين السعر والذكاء' },
  { id: 'anthropic:claude-3-5-sonnet-latest', provider: 'anthropic', model: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', vision: true, tier: 'flagship', note: 'شرح عميق ونصوص طويلة' },
  { id: 'anthropic:claude-3-5-haiku-latest', provider: 'anthropic', model: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', vision: true, tier: 'fast', note: 'سريع ورخيص' },
  { id: 'google:gemini-2.0-flash', provider: 'google', model: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', vision: true, tier: 'free', note: 'طبقة مجانية + رؤية' },
  { id: 'google:gemini-1.5-pro', provider: 'google', model: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', vision: true, tier: 'flagship', note: 'سياق طويل جدًا' },
  { id: 'groq:llama-3.3-70b-versatile', provider: 'groq', model: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B', vision: false, tier: 'fast', note: 'نصّي فائق السرعة' },
  { id: 'groq:llama-3.2-90b-vision-preview', provider: 'groq', model: 'llama-3.2-90b-vision-preview', label: 'Llama 3.2 90B Vision', vision: true, tier: 'fast', note: 'رؤية سريعة' },
  { id: 'openrouter:google/gemini-2.0-flash-001', provider: 'openrouter', model: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash (OpenRouter)', vision: true, tier: 'fast', note: 'مفتاح واحد لكل النماذج' },
  { id: 'openrouter:qwen/qwen2.5-vl-72b-instruct', provider: 'openrouter', model: 'qwen/qwen2.5-vl-72b-instruct', label: 'Qwen2.5-VL 72B', vision: true, tier: 'flagship', note: 'قوي في العربية والصور' },
  { id: 'deepseek:deepseek-chat', provider: 'deepseek', model: 'deepseek-chat', label: 'DeepSeek Chat', vision: false, tier: 'cheap', note: 'رخيص للتحليل' },
  { id: 'mistral:pixtral-12b-2409', provider: 'mistral', model: 'pixtral-12b-2409', label: 'Pixtral 12B', vision: true, tier: 'cheap', note: 'رؤية أوروبية' },
  { id: 'xai:grok-2-vision-1212', provider: 'xai', model: 'grok-2-vision-1212', label: 'Grok 2 Vision', vision: true, tier: 'flagship' },
  { id: 'together:meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', provider: 'together', model: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo', label: 'Llama 3.2 Vision (Together)', vision: true, tier: 'fast' },
  { id: 'fireworks:llama-v3p2-90b-vision-instruct', provider: 'fireworks', model: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct', label: 'Llama 3.2 Vision (Fireworks)', vision: true, tier: 'fast' },
  { id: 'cerebras:llama-3.3-70b', provider: 'cerebras', model: 'llama-3.3-70b', label: 'Llama 3.3 70B (Cerebras)', vision: false, tier: 'fast' },
  { id: 'ollama:llama3.2-vision', provider: 'ollama', model: 'llama3.2-vision', label: 'Llama 3.2 Vision (Ollama)', vision: true, tier: 'local', note: 'محلي بلا إنترنت' },
  { id: 'lmstudio:local-model', provider: 'lmstudio', model: 'local-model', label: 'نموذج LM Studio', vision: true, tier: 'local' },
  { id: 'pollinations:openai-fast', provider: 'pollinations', model: 'openai-fast', label: 'Pollinations Fast', vision: false, tier: 'free', note: 'نصّي سريع بلا مفتاح' },
  { id: 'pollinations:openai', provider: 'pollinations', model: 'openai', label: 'Pollinations OpenAI', vision: false, tier: 'free', note: 'نصّي متوازن بلا مفتاح' },
  { id: 'pollinations:openai-large', provider: 'pollinations', model: 'openai-large', label: 'Pollinations Large', vision: false, tier: 'free', note: 'نصّي أطول بلا مفتاح' },
  { id: 'pollinations:mistral', provider: 'pollinations', model: 'mistral', label: 'Pollinations Mistral', vision: false, tier: 'free', note: 'نصّي بديل بلا مفتاح' },
  { id: 'pollinations:llama-fast', provider: 'pollinations', model: 'llama-fast', label: 'Pollinations Llama', vision: false, tier: 'free', note: 'نصّي سريع بلا مفتاح' },
  { id: 'pollinations:deepseek', provider: 'pollinations', model: 'deepseek', label: 'Pollinations DeepSeek', vision: false, tier: 'free', note: 'تحليل نصّي بلا مفتاح' },
  { id: 'pollinations:gemini', provider: 'pollinations', model: 'gemini', label: 'Pollinations Gemini', vision: false, tier: 'free', note: 'نصّي بديل بلا مفتاح' },
  { id: 'pollinations:llama', provider: 'pollinations', model: 'llama', label: 'Pollinations Llama', vision: false, tier: 'free', note: 'نصّي مفتوح بلا مفتاح' },
  { id: 'pollinations:deepseek-r1', provider: 'pollinations', model: 'deepseek-r1', label: 'Pollinations DeepSeek R1', vision: false, tier: 'free', note: 'استدلال نصّي بلا مفتاح' },
  { id: 'pollinations:gemini-thinking', provider: 'pollinations', model: 'gemini-thinking', label: 'Pollinations Gemini Thinking', vision: false, tier: 'free', note: 'تفكير نصّي بلا مفتاح' },
  { id: 'pollinations:qwen-coder', provider: 'pollinations', model: 'qwen-coder', label: 'Pollinations Qwen', vision: false, tier: 'free', note: 'نصّي بديل بلا مفتاح' },
  { id: 'pollinations:searchgpt', provider: 'pollinations', model: 'searchgpt', label: 'Pollinations SearchGPT', vision: false, tier: 'free', note: 'بحث وإجابة بلا مفتاح' },
];

export const DEFAULT_VISION_MODEL = {
  openai: 'gpt-4o',
  anthropic: 'claude-3-5-sonnet-latest',
  google: 'gemini-2.0-flash',
  groq: 'llama-3.2-90b-vision-preview',
  openrouter: 'google/gemini-2.0-flash-001',
  mistral: 'pixtral-12b-2409',
  xai: 'grok-2-vision-1212',
  together: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
  fireworks: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct',
  ollama: 'llama3.2-vision',
  lmstudio: 'local-model',
};

export function modelById(id) {
  return AI_MODELS.find((item) => item.id === id) || null;
}

export function modelsForProvider(provider) {
  return AI_MODELS.filter((item) => item.provider === provider);
}

export function providerInfo(provider) {
  return AI_PROVIDERS[provider] || null;
}

const ENV_KEYS = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  groq: 'GROQ_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  together: 'TOGETHER_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  cerebras: 'CEREBRAS_API_KEY',
  ollama: 'OLLAMA_API_KEY',
  lmstudio: 'LMSTUDIO_API_KEY',
  pollinations: 'POLLINATIONS_API_KEY',
};

function envKey(provider) {
  return process.env[ENV_KEYS[provider]] || '';
}

/** يبني إعدادًا موحّدًا من مزوّد/نموذج/مفتاح. يرجع null إذا احتاج مفتاحًا ولم يوجد. */
export function createLlmConfig(overrides = {}) {
  const envProvider = (process.env.AI_PROVIDER || '').toLowerCase();
  const provider = String(overrides.provider || envProvider || '').toLowerCase();
  const def = AI_PROVIDERS[provider];
  if (!def) return null;

  const apiKey = String(overrides.apiKey || envKey(provider) || '').trim();
  if (def.needsKey && !apiKey) return null;

  let requestedModel =
    String(overrides.model || (provider === envProvider ? process.env.AI_MODEL : '') || '').trim() ||
    AI_MODELS.find((item) => item.provider === provider)?.model ||
    '';
  // لا تسمح بتمرير معرّف نموذج يخصّ مزوّدًا آخر (خطأ إعداد شائع)
  if (AI_MODELS.some((item) => item.provider !== provider && item.model === requestedModel)) {
    requestedModel = AI_MODELS.find((item) => item.provider === provider)?.model || '';
  }
  const modelMeta = AI_MODELS.find((item) => item.provider === provider && item.model === requestedModel);
  const model = requestedModel || modelMeta?.model;
  if (!model) return null;

  const visionModel =
    (modelMeta?.vision ? model : '') ||
    String(overrides.visionModel || process.env.AI_VISION_MODEL || DEFAULT_VISION_MODEL[provider] || '').trim() ||
    null;

  const baseUrl = String(
    overrides.baseUrl || (provider === envProvider ? process.env.AI_BASE_URL : '') || def.baseUrl || ''
  )
    .trim()
    .replace(/\/+$/, '');

  return {
    provider,
    kind: def.kind,
    apiKey,
    model,
    modelVision: Boolean(modelMeta?.vision),
    visionModel,
    vision: Boolean(visionModel) && process.env.AI_VISION !== 'false',
    baseUrl,
    temperature: Number(overrides.temperature ?? 0.35),
    jsonMode: overrides.jsonMode !== false && !['pollinations', 'ollama', 'lmstudio'].includes(provider),
    source: overrides.source || (apiKey ? 'key' : 'free'),
  };
}

const DATA_URL_RE = /^data:image\/(png|jpe?g|webp|gif);base64,([a-z0-9+/=\s]+)$/i;

function dataUrlParts(url) {
  const m = DATA_URL_RE.exec(String(url || '').trim());
  if (!m) return null;
  const subtype = m[1].toLowerCase();
  return {
    mime: `image/${subtype === 'jpg' ? 'jpeg' : subtype}`,
    base64: m[2].replace(/\s+/g, ''),
  };
}

function imageParts(images = []) {
  const out = [];
  for (const raw of images.slice(0, 4)) {
    const parts = dataUrlParts(raw);
    if (parts) out.push(parts);
  }
  return out;
}

function trimMessages(messages = []) {
  return messages
    .filter((m) => m && (m.content || (Array.isArray(m.images) && m.images.length)))
    .slice(-12);
}

async function postJson(url, { headers = {}, body, signal, timeoutMs }) {
  const controller = signal ? null : new AbortController();
  const activeSignal = signal || controller.signal;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: activeSignal,
    });
    let payload = null;
    const text = await res.text();
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    return { res, payload, text };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function errorFrom(res, payload, text) {
  const detail =
    payload?.error?.message ||
    payload?.error?.status ||
    payload?.message ||
    (text || '').replace(/\s+/g, ' ').slice(0, 220) ||
    '';
  return {
    status: res.status,
    code:
      res.status === 401 || res.status === 403
        ? 'unauthorized'
        : res.status === 402 || res.status === 429
          ? 'rate_limited'
          : `http_${res.status}`,
    message: detail,
  };
}

/**
 * يرسل طلبًا مفصّلًا ويرجع {text, error, provider, model, vision}.
 * لا يرمي استثناءً: كل فشل يُترجم إلى error واضح.
 */
export async function askLlmDetailed(llm, opts = {}) {
  if (!llm) return { text: null, error: { code: 'not_configured', message: 'لا يوجد مزوّد مهيأ' } };
  const { system = '', messages = [], maxTokens = 1400, json = false, timeoutMs = 40_000, logger = console } = opts;
  const list = trimMessages(messages);
  const wantsVision = list.some((m) => Array.isArray(m.images) && m.images.length);
  const canVision = Boolean(llm.vision && llm.visionModel);
  const model = wantsVision && canVision ? llm.visionModel : llm.model;
  const useJson = json && llm.jsonMode;

  try {
    if (llm.kind === 'openai') {
      const outMessages = [];
      if (system) outMessages.push({ role: 'system', content: system });
      for (const m of list) {
        const imgs = imageParts(Array.isArray(m.images) ? m.images : []);
        if (imgs.length && canVision) {
          const parts = [{ type: 'text', text: m.content || 'اقرأ هذه الصفحة واشرحها.' }];
          for (const part of imgs) {
            parts.push({ type: 'image_url', image_url: { url: `data:${part.mime};base64,${part.base64}` } });
          }
          outMessages.push({ role: m.role, content: parts });
        } else {
          outMessages.push({ role: m.role, content: m.content || '' });
        }
      }
      const body = {
        model,
        temperature: llm.temperature,
        max_tokens: maxTokens,
        messages: outMessages,
      };
      if (useJson) body.response_format = { type: 'json_object' };
      const headers = {};
      if (llm.apiKey) headers.Authorization = `Bearer ${llm.apiKey}`;
      if (llm.provider === 'openrouter') {
        headers['HTTP-Referer'] = process.env.PUBLIC_ORIGIN || 'https://localhost';
        headers['X-Title'] = 'Majalati';
      }
      const { res, payload, text } = await postJson(`${llm.baseUrl}/chat/completions`, {
        headers,
        body,
        timeoutMs,
      });
      if (!res.ok) return { text: null, error: errorFrom(res, payload, text), provider: llm.provider, model };
      const content = payload?.choices?.[0]?.message?.content;
      const value = Array.isArray(content)
        ? content.map((part) => part?.text || '').join('\n').trim()
        : String(content || '').trim();
      // بعض المزوّدات ترجع JSON داخل code fence
      return { text: value || null, error: null, provider: llm.provider, model, vision: Boolean(wantsVision && canVision) };
    }

    if (llm.kind === 'anthropic') {
      const outMessages = list.map((m) => {
        const imgs = imageParts(Array.isArray(m.images) ? m.images : []);
        if (!imgs.length || !canVision) return { role: m.role, content: m.content || '' };
        const content = imgs.map((part) => ({
          type: 'image',
          source: { type: 'base64', media_type: part.mime, data: part.base64 },
        }));
        content.push({ type: 'text', text: m.content || 'اقرأ هذه الصفحة واشرحها.' });
        return { role: m.role, content };
      });
      const { res, payload, text } = await postJson(`${llm.baseUrl}/messages`, {
        headers: {
          'x-api-key': llm.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: {
          model,
          max_tokens: maxTokens,
          temperature: llm.temperature,
          ...(system ? { system } : {}),
          messages: outMessages,
        },
        timeoutMs,
      });
      if (!res.ok) return { text: null, error: errorFrom(res, payload, text), provider: llm.provider, model };
      const value = (payload?.content || [])
        .map((part) => part?.text || '')
        .join('\n')
        .trim();
      return { text: value || null, error: null, provider: llm.provider, model, vision: Boolean(wantsVision && canVision) };
    }

    if (llm.kind === 'google') {
      const contents = [];
      for (const m of list) {
        const imgs = imageParts(Array.isArray(m.images) ? m.images : []);
        const parts = [];
        if (imgs.length && canVision) {
          for (const part of imgs) parts.push({ inline_data: { mime_type: part.mime, data: part.base64 } });
        }
        parts.push({ text: m.content || 'اقرأ هذه الصفحة واشرحها.' });
        contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts });
      }
      const body = {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        generationConfig: {
          temperature: llm.temperature,
          maxOutputTokens: maxTokens,
          ...(useJson ? { responseMimeType: 'application/json' } : {}),
        },
      };
      const { res, payload, text } = await postJson(
        `${llm.baseUrl}/models/${encodeURIComponent(model)}:generateContent`,
        {
          headers: { 'x-goog-api-key': llm.apiKey },
          body,
          timeoutMs,
        }
      );
      if (!res.ok) return { text: null, error: errorFrom(res, payload, text), provider: llm.provider, model };
      const value = (payload?.candidates?.[0]?.content?.parts || [])
        .map((part) => part?.text || '')
        .join('\n')
        .trim();
      return { text: value || null, error: null, provider: llm.provider, model, vision: Boolean(wantsVision && canVision) };
    }

    return { text: null, error: { code: 'unsupported_provider', message: `مزوّد غير مدعوم: ${llm.provider}` } };
  } catch (err) {
    const timeout = err?.name === 'AbortError';
    const error = {
      code: timeout ? 'timeout' : 'network',
      message: timeout ? 'انتهت مهلة الاتصال بالمزوّد' : String(err?.message || 'تعذّر الاتصال'),
    };
    logger.warn?.('llm_failed', { provider: llm.provider, code: error.code });
    return { text: null, error, provider: llm.provider, model };
  }
}

/** واجهة متوافقة مع القديم: نص أو null */
export async function askLlm(llm, opts = {}) {
  const result = await askLlmDetailed(llm, opts);
  return result.text;
}

/** يستخرج أول كائن JSON من نص (المزوّدات قد تضيف شرحًا حوله) */
export function parseJsonObject(text) {
  if (!text) return null;
  const raw = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * النماذج المجانية فقط — «وضع تلقائي مدمج» بلا اختيار من المستخدم.
 * كل مزوّد هنا له طبقة مجانية (أو يعمل محليًا بلا مفتاح). الترتيب
 * يفضّل الرؤية ثم النص، والخادم يتخطى أي مزوّد بلا مفتاح.
 */
export const FREE_PROVIDERS = [
  'google',
  'openrouter',
  'groq',
  'mistral',
  'cerebras',
  'pollinations',
  'ollama',
  'lmstudio',
];

export const FREE_MODELS = {
  google: { text: 'gemini-2.0-flash', vision: 'gemini-2.0-flash' },
  openrouter: { text: 'meta-llama/llama-3.3-70b-instruct:free', vision: 'google/gemini-2.0-flash-exp:free' },
  groq: { text: 'llama-3.3-70b-versatile', vision: 'meta-llama/llama-4-scout-17b-16e-instruct' },
  mistral: { text: 'mistral-small-latest', vision: 'pixtral-12b-2409' },
  cerebras: { text: 'llama3.1-8b', vision: null },
  pollinations: { text: 'openai-fast', vision: null },
  ollama: { text: 'llama3.2', vision: 'llava' },
  lmstudio: { text: 'local-model', vision: 'local-model' },
};

export function freeModelFor(provider, { vision = false } = {}) {
  const entry = FREE_MODELS[provider];
  if (!entry) return '';
  return (vision ? entry.vision : entry.text) || entry.text || '';
}

export const FREE_VISION_PROVIDERS = FREE_PROVIDERS.filter((provider) => FREE_MODELS[provider]?.vision);

/**
 * نماذج مجانية متعددة لنفس المزوّد (Pollinations) — تُجرَّب كخلايا مستقلة
 * حتى لا تتوقف الإجابة عند نموذج واحد مشغول.
 */
export const FREE_MODEL_CHOICES = {
  pollinations: [
    'openai-fast',
    'openai',
    'mistral',
    'llama-fast',
    'deepseek',
    'gemini',
    'openai-large',
    'llama',
    'deepseek-r1',
    'gemini-thinking',
    'qwen-coder',
    'searchgpt',
  ],
};
