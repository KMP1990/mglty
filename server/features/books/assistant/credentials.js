/**
 * مفاتيح مزوّدات الذكاء الاصطناعي — تخزين مشفّر على الخادم.
 * ------------------------------------------------------------
 * • مفتاح كل مستخدم يُشفَّر AES-256-GCM بمفتاح مشتق من SESSION_SECRET.
 * • لا يُعاد المفتاح للواجهة أبدًا؛ الواجهة ترى «مهيأ/غير مهيأ» فقط.
 * • المزوّدات المجانية (Pollinations/Ollama/LM Studio) لا تحتاج مفتاحًا.
 * • الاختيار النشط (المزوّد + النموذج) محفوظ لكل مستخدم، فالمساعد
 *   يستخدم النموذج المختار تلقائيًا في كل محادثة.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { readJsonSafe, writeJsonSafe } from '../../../shared/store.js';
import { AI_PROVIDERS, AI_MODELS, createLlmConfig, FREE_PROVIDERS, FREE_MODELS, FREE_MODEL_CHOICES, freeModelFor } from '../../../shared/llm.js';

const FILE_NAME = 'ai-credentials.json';
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

export function createAiCredentials({ config, logger = console }) {
  const file = path.join(config.dataDir, FILE_NAME);
  const secret = String(config.sessionSecret || 'dev-only-secret-change-me');
  const encryptionKey = crypto.scryptSync(secret, 'mr-ai-credentials-v1', 32);

  let queue = Promise.resolve();
  function serialize(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  async function readAll() {
    const raw = await readJsonSafe(file, { users: {} });
    return raw && typeof raw === 'object' && raw.users && typeof raw.users === 'object' ? raw : { users: {} };
  }

  function encrypt(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return {
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  }

  function decrypt(payload) {
    if (!payload?.iv || !payload?.tag || !payload?.data) return '';
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(payload.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(payload.tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(payload.data, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      logger.warn?.('ai_credentials_decrypt_failed');
      return '';
    }
  }

  function userEntry(all, userId) {
    return all.users[userId] || { active: null, providers: {} };
  }

  function envKey(provider) {
    return process.env[ENV_KEYS[provider]] || '';
  }

  function keyFor(entry, provider) {
    const stored = entry.providers?.[provider];
    return decrypt(stored?.apiKey) || envKey(provider);
  }

  function defaultsFor(provider) {
    return AI_MODELS.find((item) => item.provider === provider) || null;
  }

  return {
    /** الإعدادات العامة للواجهة — بلا أي مفتاح */
    async publicState(userId) {
      const all = await readAll();
      const entry = userEntry(all, userId);
      const providers = {};
      for (const def of Object.values(AI_PROVIDERS)) {
        const stored = entry.providers?.[def.id];
        const env = Boolean(envKey(def.id));
        const configured = Boolean(stored?.apiKey || env || !def.needsKey);
        providers[def.id] = {
          id: def.id,
          name: def.name,
          needsKey: def.needsKey,
          keysUrl: def.keysUrl,
          note: def.note,
          configured,
          fromEnv: env && !stored?.apiKey,
          model: stored?.model || defaultsFor(def.id)?.model || null,
          updatedAt: stored?.updatedAt || null,
        };
      }
      const active = entry.active?.provider
        ? { ...entry.active, model: entry.active.model || providers[entry.active.provider]?.model || null }
        : null;
      return { active, providers, models: AI_MODELS, hasAnyKey: Object.values(providers).some((p) => p.configured) };
    },

    /**
     * كل المزوّدات المجانية المتاحة لهذا المستخدم — مدموجة في قائمة واحدة.
     * لا تحتاج الواجهة لاختيار نموذج: الخادم يجرّبها بالترتيب.
     */
    async freeConfigs(userId, { vision = false, includeCloud = true } = {}) {
      const all = await readAll();
      const entry = userEntry(all, userId);
      const activeProvider = entry.active?.provider;
      const activeModel = String(entry.active?.model || '').trim();
      const list = [...FREE_PROVIDERS];
      // اختيار المستخدم السابق (لو كان مجانيًا) يتقدّم، لكن لا نسمح بالمدفوع
      if (activeProvider && list.includes(activeProvider)) {
        list.splice(list.indexOf(activeProvider), 1);
        list.unshift(activeProvider);
      }
      if (vision) {
        list.sort((a, b) => Number(Boolean(FREE_MODELS[b]?.vision)) - Number(Boolean(FREE_MODELS[a]?.vision)));
      }
      const configs = [];
      const seen = new Set();
      for (const provider of list) {
        const def = AI_PROVIDERS[provider];
        if (!def) continue;
        const isCloud = !['ollama', 'lmstudio'].includes(provider);
        if (!includeCloud && isCloud) continue;
        const stored = entry.providers?.[provider];
        const key = keyFor(entry, provider);
        if (def.needsKey && !key) continue;
        // لا نجرّب Ollama/LM Studio تلقائيًا إلا إذا أعدّهما المستخدم أو شغّلهما
        if (
          (provider === 'ollama' || provider === 'lmstudio') &&
          !stored &&
          !process.env[provider === 'ollama' ? 'OLLAMA_HOST' : 'LMSTUDIO_HOST']
        ) {
          continue;
        }
        const wantedVision = vision && Boolean(FREE_MODELS[provider]?.vision);
        const choices = [];
        // عدة نماذج لنفس المزوّد المجاني = عدة خلايا، لا نموذج واحد هش
        if (provider === 'pollinations') {
          if (activeModel) choices.push(activeModel);
          if (stored?.model) choices.push(stored.model);
          choices.push(...(FREE_MODEL_CHOICES.pollinations || []));
        } else {
          const model = freeModelFor(provider, { vision: wantedVision }) || stored?.model || defaultsFor(provider)?.model || '';
          if (model) choices.push(model);
        }
        for (const model of [...new Set(choices.map((item) => String(item || '').trim()).filter(Boolean))]) {
          const cfg = createLlmConfig({
            provider,
            apiKey: key,
            model,
            ...(wantedVision ? { visionModel: model } : {}),
            baseUrl: stored?.baseUrl,
            source: stored?.apiKey ? 'user-free' : key ? 'env-free' : 'free',
          });
          if (!cfg) continue;
          const id = `${cfg.provider}:${cfg.model}:${cfg.visionModel || ''}`;
          if (seen.has(id)) continue;
          seen.add(id);
          configs.push(cfg);
          if (configs.length >= 12) break;
        }
        if (configs.length >= 12) break;
      }
      return configs;
    },

    /** الإعداد الكامل (داخلي) — يحتوي المفتاح المفكوك */
    async resolve(userId, override = {}) {
      const all = await readAll();
      const entry = userEntry(all, userId);
      const provider = String(override.provider || entry.active?.provider || '').toLowerCase();
      if (!provider || !AI_PROVIDERS[provider]) return null;
      const stored = entry.providers?.[provider];
      const model = String(override.model || stored?.model || entry.active?.model || '').trim() || undefined;
      const cfg = createLlmConfig({
        provider,
        apiKey: keyFor(entry, provider),
        model,
        baseUrl: stored?.baseUrl,
        source: stored?.apiKey ? 'user' : envKey(provider) ? 'env' : 'free',
      });
      if (cfg) cfg.configuredModel = model || cfg.model;
      return cfg;
    },

    /** هل يوجد أي مزوّد صالح بلا مفتاح؟ (Pollinations دائمًا) */
    async anyAvailable(userId) {
      const state = await this.publicState(userId);
      return Boolean(state.hasAnyKey || AI_PROVIDERS.pollinations);
    },

    async save(userId, { provider, model, apiKey, baseUrl } = {}) {
      const id = String(provider || '').toLowerCase();
      const def = AI_PROVIDERS[id];
      if (!def) throw new Error('مزوّد غير معروف');
      const key = String(apiKey || '').trim();
      if (key && (key.length < 8 || key.length > 400 || /\s/.test(key))) throw new Error('المفتاح غير صالح');
      const cleanModel = String(model || '').trim().slice(0, 160);
      const cleanBase = String(baseUrl || '').trim().slice(0, 300);
      if (cleanBase && !/^https?:\/\/[^\s]+$/i.test(cleanBase)) throw new Error('عنوان الخدمة غير صالح');
      return serialize(async () => {
        const all = await readAll();
        const entry = userEntry(all, userId);
        entry.providers = entry.providers || {};
        const previous = entry.providers[id] || {};
        entry.providers[id] = {
          ...previous,
          ...(key ? { apiKey: encrypt(key) } : {}),
          ...(cleanModel ? { model: cleanModel } : {}),
          ...(cleanBase ? { baseUrl: cleanBase } : {}),
          updatedAt: new Date().toISOString(),
        };
        if (!entry.providers[id].apiKey && !envKey(id) && def.needsKey) {
          // لا مفتاح ولا مفتاح بيئة: لا نحفظ تهيئة فارغة بلا فائدة
          delete entry.providers[id];
          throw new Error('هذا المزوّد يحتاج مفتاح API');
        }
        entry.active = { provider: id, ...(cleanModel ? { model: cleanModel } : {}), updatedAt: new Date().toISOString() };
        all.users[userId] = entry;
        await writeJsonSafe(file, all);
        logger.info?.('ai_provider_saved', { userId, provider: id });
        return true;
      });
    },

    async setActive(userId, { provider, model } = {}) {
      const id = String(provider || '').toLowerCase();
      if (!AI_PROVIDERS[id]) throw new Error('مزوّد غير معروف');
      return serialize(async () => {
        const all = await readAll();
        const entry = userEntry(all, userId);
        const stored = entry.providers?.[id];
        if (AI_PROVIDERS[id].needsKey && !stored?.apiKey && !envKey(id)) throw new Error('هذا المزوّد غير مهيأ للاستخدام');
        const cleanModel = String(model || stored?.model || '').trim().slice(0, 160);
        entry.active = { provider: id, ...(cleanModel ? { model: cleanModel } : {}), updatedAt: new Date().toISOString() };
        if (cleanModel && stored) stored.model = cleanModel;
        all.users[userId] = entry;
        await writeJsonSafe(file, all);
        return true;
      });
    },

    async remove(userId, provider) {
      const id = String(provider || '').toLowerCase();
      return serialize(async () => {
        const all = await readAll();
        const entry = userEntry(all, userId);
        if (entry.providers?.[id]) delete entry.providers[id];
        if (entry.active?.provider === id) entry.active = null;
        all.users[userId] = entry;
        await writeJsonSafe(file, all);
        return true;
      });
    },
  };
}
