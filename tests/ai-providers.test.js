import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createLlmConfig, AI_MODELS } from '../server/shared/llm.js';
import { createAiCredentials } from '../server/features/books/ai/credentials.js';

test('إعداد Gemini يفعّل الرؤية تلقائيًا', () => {
  const llm = createLlmConfig({ provider: 'google', apiKey: 'test-key' });
  assert.ok(llm);
  assert.equal(llm.provider, 'google');
  assert.equal(llm.kind, 'google');
  assert.equal(llm.vision, true);
  assert.ok(llm.visionModel);
  assert.equal(llm.jsonMode, true);
});

test('Pollinations يعمل بلا مفتاح', () => {
  const llm = createLlmConfig({ provider: 'pollinations' });
  assert.ok(llm);
  assert.equal(llm.provider, 'pollinations');
  assert.equal(llm.apiKey, '');
});

test('مفتاح OpenAI يُخزَّن مشفّرًا ولا يظهر في الملف', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-ai-'));
  const credentials = createAiCredentials({ config: { dataDir, sessionSecret: 'unit-test-secret' } });
  await credentials.save('user-1', { provider: 'openai', model: 'gpt-4o', apiKey: 'sk-unit-test-123456789' });
  const raw = await fs.readFile(path.join(dataDir, 'ai-credentials.json'), 'utf8');
  assert.ok(!raw.includes('sk-unit-test-123456789'));
  const resolved = await credentials.resolve('user-1');
  assert.equal(resolved.apiKey, 'sk-unit-test-123456789');
  assert.equal(resolved.visionModel, 'gpt-4o');
  const state = await credentials.publicState('user-1');
  assert.equal(state.providers.openai.configured, true);
  assert.ok(!JSON.stringify(state).includes('sk-unit-test'));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('معرّف نموذج مزوّد آخر لا يُمرَّر لمزوّد مختلف', () => {
  const llm = createLlmConfig({ provider: 'openai', apiKey: 'sk-test', model: 'openai-fast' });
  assert.ok(llm);
  assert.equal(llm.model, 'gpt-4o');
});

test('الوضع المجاني المدمج يتجاهل المدفوع ويقدّم الرؤية', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-ai-free-'));
  const credentials = createAiCredentials({ config: { dataDir, sessionSecret: 'unit-test-secret' } });
  await credentials.save('user-2', { provider: 'openai', apiKey: 'sk-paid-should-be-ignored' });
  await credentials.save('user-2', { provider: 'google', apiKey: 'AIza-free-test-key-123456789' });
  const configs = await credentials.freeConfigs('user-2', { vision: true });
  assert.ok(configs.length >= 2);
  assert.ok(configs.every((config) => config.provider !== 'openai'));
  assert.equal(configs[0].provider, 'google');
  assert.equal(configs[0].vision, true);
  assert.ok(configs.some((config) => config.provider === 'pollinations'));
  await fs.rm(dataDir, { recursive: true, force: true });
});

test('الكتالوج يحتوي نماذج رؤية من مزوّدات متعددة', () => {
  const visionProviders = new Set(AI_MODELS.filter((model) => model.vision).map((model) => model.provider));
  assert.ok(visionProviders.size >= 5);
});
