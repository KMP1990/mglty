/**
 * Web Push حقيقي (VAPID) — إشعارات تصل والهاتف/المتصفح مغلق.
 * ------------------------------------------------------------
 * لا نضيف حزمة خارجية: التنفيذ يستخدم node:crypto فقط وفق RFC 8291 (aes128gcm)
 * و RFC 8292 (VAPID). هذا يعني أن الإشعار يصل حتى لو لم يفتح المستخدم التطبيق
 * لعدة أيام، طالما منح إذن الإشعارات واشترك جهازه.
 *
 * مفاتيح VAPID:
 *  • من البيئة: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (base64url أو PEM)
 *  • أو تُولَّد تلقائيًا مرة واحدة وتُحفظ في data/push-vapid.json
 *    (حتى لا تنكسر الاشتراكات بعد إعادة تشغيل الخادم).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { readJsonSafe, writeJsonSafe } from '../../shared/store.js';

const b64url = (value) => Buffer.from(value).toString('base64url');
const fromB64url = (value) => Buffer.from(String(value || ''), 'base64url');
const utf8 = (value) => Buffer.from(String(value), 'utf8');

const MAX_PAYLOAD = 3000; // أقل من حد aes128gcm (4078) مع هامش للترميز
const DELIVERY_TIMEOUT_MS = 8_000;

function rawPointToJwk(publicKey, privateKey) {
  const point = Buffer.from(publicKey);
  if (point.length !== 65 || point[0] !== 4) throw new Error('invalid_vapid_public_key');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: b64url(point.subarray(1, 33)),
    y: b64url(point.subarray(33, 65)),
    d: privateKey ? b64url(Buffer.from(privateKey)) : undefined,
  };
}

function parseKeyPair(publicInput, privateInput) {
  if (publicInput && String(publicInput).includes('BEGIN')) {
    const publicKey = crypto.createPublicKey(String(publicInput));
    const privateKey = privateInput ? crypto.createPrivateKey(String(privateInput)) : null;
    const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-65);
    return { publicKey, privateKey, publicKeyRaw: Buffer.from(raw) };
  }
  const rawPublic = fromB64url(publicInput);
  const rawPrivate = fromB64url(privateInput);
  const jwk = rawPointToJwk(rawPublic, rawPrivate);
  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });
  const publicKey = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  return { publicKey, privateKey, publicKeyRaw: rawPublic };
}

function generateKeyPair() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKeyRaw = ecdh.getPublicKey();
  const privateRaw = ecdh.getPrivateKey();
  const jwk = rawPointToJwk(publicKeyRaw, privateRaw);
  return {
    publicKey: crypto.createPublicKey({ key: jwk, format: 'jwk' }),
    privateKey: crypto.createPrivateKey({ key: jwk, format: 'jwk' }),
    publicKeyRaw,
    privateRaw,
  };
}

/** HKDF وفق RFC 5869 (extract + expand) باستخدام node:crypto */
function hkdf(ikm, salt, info, length) {
  return Buffer.from(crypto.hkdfSync('sha256', ikm, salt, info, length));
}

/** تشفير حمولة Web Push (aes128gcm) — مُصدَّر للاختبارات أيضًا */
export function encryptPayload(subscription, payload) {
  const keys = subscription?.keys || {};
  const userAgentPublic = fromB64url(keys.p256dh);
  const authSecret = fromB64url(keys.auth);
  if (userAgentPublic.length !== 65 || authSecret.length < 16) throw new Error('invalid_subscription_keys');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const sharedSecret = ecdh.computeSecret(userAgentPublic);

  const prk = hkdf(sharedSecret, authSecret, Buffer.concat([utf8('WebPush: info\0'), userAgentPublic, asPublic]), 32);
  const salt = crypto.randomBytes(16);
  const cek = hkdf(prk, salt, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(prk, salt, utf8('Content-Encoding: nonce\0'), 12);

  const plaintext = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  // آخر سجل ينتهي بمحدد الحشو 0x02
  const record = Buffer.concat([plaintext, Buffer.from([0x02])]);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1 + 65);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(65, 20);
  asPublic.copy(header, 21);
  return Buffer.concat([header, ciphertext]);
}

export function createPushService({ config, logger }) {
  const subject = process.env.VAPID_SUBJECT || 'mailto:hello@majalati.app';
  const keyPath = path.join(config.dataDir, 'push-vapid.json');

  let readyPromise = null;
  let keys = null;
  let enabled = false;

  async function loadKeys() {
    const envPublic = process.env.VAPID_PUBLIC_KEY;
    const envPrivate = process.env.VAPID_PRIVATE_KEY;
    if (envPublic && envPrivate) {
      return { ...parseKeyPair(envPublic, envPrivate), source: 'env' };
    }
    const stored = await readJsonSafe(keyPath, null);
    if (stored?.publicKey && stored?.privateKey) {
      try {
        return { ...parseKeyPair(stored.publicKey, stored.privateKey), source: 'file' };
      } catch (err) {
        logger.warn('vapid_keys_invalid', { message: err?.message });
      }
    }
    const generated = generateKeyPair();
    await writeJsonSafe(keyPath, {
      publicKey: b64url(generated.publicKeyRaw),
      privateKey: b64url(generated.privateRaw),
      createdAt: new Date().toISOString(),
    });
    logger.info('vapid_keys_generated', { path: keyPath });
    return { ...generated, source: 'generated' };
  }

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = loadKeys()
        .then((loaded) => {
          keys = loaded;
          enabled = true;
          return loaded;
        })
        .catch((err) => {
          logger.error('vapid_keys_failed', { message: err?.message });
          enabled = false;
          return null;
        });
    }
    return readyPromise;
  }

  function vapidHeaders(endpoint) {
    const audience = new URL(endpoint).origin;
    const header = b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
    const payload = b64url(
      JSON.stringify({
        aud: audience,
        exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
        sub: subject,
      })
    );
    const signingInput = `${header}.${payload}`;
    const signature = crypto.sign('sha256', Buffer.from(signingInput), {
      key: keys.privateKey,
      dsaEncoding: 'ieee-p1363',
    });
    return `vapid t=${signingInput}.${b64url(signature)}, k=${b64url(keys.publicKeyRaw)}`;
  }

  async function send(subscription, payload = {}) {
    if (!enabled) await ensureReady();
    if (!enabled || !keys) return { ok: false, status: 0, reason: 'disabled' };
    if (!subscription?.endpoint || !/^https:\/\//i.test(subscription.endpoint)) {
      return { ok: false, status: 0, reason: 'invalid_endpoint' };
    }

    let body;
    try {
      body = encryptPayload(subscription, Buffer.from(JSON.stringify(payload)));
    } catch (err) {
      return { ok: false, status: 0, reason: err?.message || 'encrypt_failed' };
    }
    if (body.length > MAX_PAYLOAD + 1024) {
      body = encryptPayload(subscription, Buffer.from(JSON.stringify({ ...payload, body: String(payload.body || '').slice(0, 160) })));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
    try {
      const res = await fetch(subscription.endpoint, {
        method: 'POST',
        headers: {
          Authorization: vapidHeaders(subscription.endpoint),
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: String(payload.ttl ?? 86_400),
          Urgency: payload.priority === 'high' ? 'high' : 'normal',
          ...(payload.topic ? { Topic: String(payload.topic).slice(0, 32) } : {}),
        },
        body,
        signal: controller.signal,
      });
      const status = res.status;
      if (status === 404 || status === 410) return { ok: false, status, reason: 'gone', remove: true };
      if (status >= 200 && status < 300) return { ok: true, status };
      return { ok: false, status, reason: `push_${status}` };
    } catch (err) {
      return { ok: false, status: 0, reason: err?.name === 'AbortError' ? 'timeout' : err?.message || 'network' };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    ready: ensureReady,
    get enabled() {
      return enabled;
    },
    get publicKey() {
      return keys ? b64url(keys.publicKeyRaw) : null;
    },
    get subject() {
      return subject;
    },
    encryptPayload,
    send,

    /** إرسال إشعارات لمستخدم عبر كل أجهزته المشتركة، مع تنظيف الاشتراكات الميتة */
    async deliver(userId, items, store) {
      if (!enabled) await ensureReady();
      if (!enabled) return { sent: 0, failed: 0, removed: 0 };
      const bucket = await store.read(userId);
      const subscriptions = Array.isArray(bucket.pushSubscriptions) ? bucket.pushSubscriptions : [];
      if (!subscriptions.length) return { sent: 0, failed: 0, removed: 0 };

      const list = (Array.isArray(items) ? items : [items]).filter(Boolean).slice(0, 3);
      let sent = 0;
      let failed = 0;
      let removed = 0;

      for (const sub of subscriptions) {
        let subFailed = false;
        for (const item of list) {
          const payload = {
            id: item.id,
            title: String(item.title || 'مجلتي وروتيني').slice(0, 120),
            body: String(item.body || '').slice(0, 320),
            url: item.link || '/notifications',
            type: item.type || 'general',
            priority: item.priority || 'normal',
            tag: item.id,
            topic: `mr-${item.type || 'general'}`,
            createdAt: item.createdAt,
            data: item.data || null,
            badge: bucket.unread,
          };
          const result = await send(sub, payload);
          if (result.ok) {
            sent += 1;
            // آخر إرسال ناجح يظهر في «أجهزتك» ويصفّر أي خطأ سابق
            await store.touchPushSubscription(userId, sub.id).catch(() => {});
          } else if (result.remove) {
            removed += 1;
            await store.removePushSubscription(userId, sub.id).catch(() => {});
            break;
          } else {
            subFailed = true;
            failed += 1;
            // 401/403 غالبًا مفتاح VAPID تغيّر أو الاشتراك صار غير صالح:
            // نتركه للواجهة تقترح «إيقاف ثم إعادة تفعيل» بدل حذفه صامتًا.
            if (result.status === 401 || result.status === 403) {
              await store.markPushSubscriptionError(userId, sub.id, `http_${result.status}`).catch(() => {});
            }
            logger.warn('push_delivery_failed', { userId, status: result.status, reason: result.reason });
          }
          if (subFailed) break;
        }
      }
      return { sent, failed, removed };
    },
  };
}
