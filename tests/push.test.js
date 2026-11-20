/**
 * اختبار تشفير Web Push (RFC 8291): نُشفّر بحمولة الخادم ثم نفكّها بمفتاح
 * «جهاز» وهمي، ونتأكد أن النص يصل سليمًا — دون أي شبكة.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { encryptPayload, createPushService } from '../server/features/notifications/push.js';

const b64url = (value) => Buffer.from(value).toString('base64url');
const utf8 = (value) => Buffer.from(String(value), 'utf8');
const hkdf = (ikm, salt, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));

test('تشفير Web Push يُفكّ على الجهاز ويعيد نفس الحمولة', () => {
  const device = crypto.createECDH('prime256v1');
  device.generateKeys();
  const devicePublic = device.getPublicKey();
  const authSecret = crypto.randomBytes(16);
  const subscription = {
    endpoint: 'https://push.example.test/abc',
    keys: { p256dh: b64url(devicePublic), auth: b64url(authSecret) },
  };
  const payload = JSON.stringify({ title: 'اختبار', body: 'نص عربي', url: '/notifications' });
  const body = encryptPayload(subscription, Buffer.from(payload));

  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  assert.equal(idLength, 65);
  const serverPublic = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);

  const shared = device.computeSecret(serverPublic);
  const prk = hkdf(shared, authSecret, Buffer.concat([utf8('WebPush: info\0'), devicePublic, serverPublic]), 32);
  const cek = hkdf(prk, salt, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(prk, salt, utf8('Content-Encoding: nonce\0'), 12);

  const tag = ciphertext.subarray(ciphertext.length - 16);
  const data = ciphertext.subarray(0, ciphertext.length - 16);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(data), decipher.final()]);
  assert.equal(plaintext[plaintext.length - 1], 0x02, 'محدد آخر سجل');
  assert.equal(plaintext.subarray(0, -1).toString('utf8'), payload);
});

test('مفاتيح VAPID تُولَّد مرة واحدة وتبقى ثابتة بين إقلاعين', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-push-'));
  const config = { dataDir };
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  try {
    const first = createPushService({ config, logger });
    await first.ready();
    assert.equal(first.enabled, true);
    assert.equal(Buffer.from(first.publicKey, 'base64url').length, 65);

    const second = createPushService({ config, logger });
    await second.ready();
    assert.equal(second.publicKey, first.publicKey);
  } finally {
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('إرسال Push يبني ترويسة VAPID صحيحة ويوقّعها بمفتاح الخادم', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mr-push-send-'));
  const logger = { info() {}, warn() {}, error() {}, debug() {} };
  const originalFetch = globalThis.fetch;
  let captured = null;
  try {
    const service = createPushService({ config: { dataDir }, logger });
    await service.ready();

    const device = crypto.createECDH('prime256v1');
    device.generateKeys();
    const subscription = {
      endpoint: 'https://push.example.test/send',
      keys: { p256dh: b64url(device.getPublicKey()), auth: b64url(crypto.randomBytes(16)) },
    };

    globalThis.fetch = async (url, options) => {
      captured = { url, options };
      return new Response(null, { status: 201 });
    };

    const result = await service.send(subscription, { title: 'إشعار', body: 'اختبار', url: '/notifications' });
    assert.equal(result.ok, true);
    assert.ok(captured);
    assert.equal(captured.options.headers['Content-Encoding'], 'aes128gcm');

    const auth = captured.options.headers.Authorization;
    const match = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
    assert.ok(match, 'صيغة VAPID');
    const [headerB64, payloadB64, sigB64] = match[1].split('.');
    const signingInput = `${headerB64}.${payloadB64}`;
    const raw = Buffer.from(service.publicKey, 'base64url');
    const publicKey = crypto.createPublicKey({
      key: { kty: 'EC', crv: 'P-256', x: b64url(raw.subarray(1, 33)), y: b64url(raw.subarray(33, 65)) },
      format: 'jwk',
    });
    const valid = crypto.verify(
      'sha256',
      Buffer.from(signingInput),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(sigB64, 'base64url')
    );
    assert.equal(valid, true, 'توقيع ES256 صالح');
    const claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    assert.equal(claims.aud, 'https://push.example.test');
    assert.ok(claims.exp > Date.now() / 1000);
  } finally {
    globalThis.fetch = originalFetch;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
