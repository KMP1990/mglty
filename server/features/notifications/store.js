/**
 * مستودع الإشعارات — ملف لكل مستخدم: data/notifications/<userId>.json
 * بنية الملف: { version, seq, unread, items: [], devices: [], pushSubscriptions: [] }
 * كل كتابة ذرّية مع نسخة احتياطية (shared/store.js) وطابور لكل مستخدم.
 */
import path from 'node:path';
import crypto from 'node:crypto';
import { readJsonSafe, writeJsonSafe } from '../../shared/store.js';

const MAX_ITEMS = 200;
const MAX_PUSH_SUBSCRIPTIONS = 8;
const defaultBucket = () => ({ version: 1, seq: 0, unread: 0, items: [], devices: [], pushSubscriptions: [] });
const PUSH_ID_RE = /^[a-f0-9]{16,64}$/;

export function createNotificationStore(config) {
  return {
    filePath(userId) {
      return path.join(config.dataDir, 'notifications', `${userId}.json`);
    },

    async read(userId) {
      const bucket = await readJsonSafe(this.filePath(userId), null);
      if (!bucket || !Array.isArray(bucket.items)) return defaultBucket();
      if (!Array.isArray(bucket.devices)) bucket.devices = [];
      if (!Array.isArray(bucket.pushSubscriptions)) bucket.pushSubscriptions = [];
      return bucket;
    },

    async write(userId, bucket) {
      await writeJsonSafe(this.filePath(userId), bucket);
    },

    async addMany(userId, payloads) {
      const bucket = await this.read(userId);
      const created = [];
      for (const p of payloads) {
        bucket.seq += 1;
        const item = {
          id: crypto.randomUUID(),
          seq: bucket.seq,
          type: p.type || 'general',
          title: p.title,
          body: p.body || '',
          link: p.link || null,
          icon: p.icon || null,
          data: p.data || null,
          priority: p.priority || 'normal',
          read: false,
          createdAt: new Date().toISOString(),
        };
        bucket.items.unshift(item);
        created.push(item);
      }
      bucket.items = bucket.items.slice(0, MAX_ITEMS);
      bucket.unread = bucket.items.filter((i) => !i.read).length;
      await this.write(userId, bucket);
      return created;
    },

    async setRead(userId, id, read = true) {
      const bucket = await this.read(userId);
      const item = id === 'all' ? null : bucket.items.find((i) => i.id === id);
      if (!id || id === 'all') {
        bucket.items = bucket.items.map((i) => (i.read ? i : { ...i, read: true, readAt: new Date().toISOString() }));
      } else if (item) {
        Object.assign(item, { read, readAt: read ? new Date().toISOString() : null });
      } else {
        return null;
      }
      bucket.unread = bucket.items.filter((i) => !i.read).length;
      await this.write(userId, bucket);
      return bucket;
    },

    async remove(userId, id) {
      const bucket = await this.read(userId);
      const before = bucket.items.length;
      bucket.items = id === 'all' ? [] : bucket.items.filter((i) => i.id !== id);
      if (before === bucket.items.length && id !== 'all') return null;
      bucket.unread = bucket.items.filter((i) => !i.read).length;
      await this.write(userId, bucket);
      return bucket;
    },

    async saveDevice(userId, device) {
      const bucket = await this.read(userId);
      bucket.devices = bucket.devices.filter((d) => d.endpoint !== device.endpoint);
      bucket.devices.push({ ...device, createdAt: new Date().toISOString() });
      bucket.devices = bucket.devices.slice(-10);
      await this.write(userId, bucket);
      return bucket.devices.length;
    },

    async removeDevice(userId, endpointHash) {
      const bucket = await this.read(userId);
      const before = bucket.devices.length;
      bucket.devices = bucket.devices.filter((d) => d.endpointHash !== endpointHash);
      await this.write(userId, bucket);
      return before !== bucket.devices.length;
    },

    /** اشتراك Web Push حقيقي — يُحفظ مع مفاتيحه ولا يُرسل للعميل أبدًا */
    async savePushSubscription(userId, subscription, meta = {}) {
      const bucket = await this.read(userId);
      const now = new Date().toISOString();
      const endpointHash = crypto.createHash('sha256').update(subscription.endpoint).digest('hex').slice(0, 24);
      const existing = bucket.pushSubscriptions.find((s) => s.endpoint === subscription.endpoint);
      if (existing) {
        Object.assign(existing, {
          keys: subscription.keys,
          platform: String(meta.platform || existing.platform || '').slice(0, 40),
          userAgent: String(meta.userAgent || existing.userAgent || '').slice(0, 200),
          updatedAt: now,
        });
        existing.lastUsedAt = existing.lastUsedAt || now;
      } else {
        bucket.pushSubscriptions.push({
          id: endpointHash,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          platform: String(meta.platform || '').slice(0, 40),
          userAgent: String(meta.userAgent || '').slice(0, 200),
          createdAt: now,
          updatedAt: now,
          lastUsedAt: null,
        });
      }
      // نحتفظ بأحدث الأجهزة فقط
      bucket.pushSubscriptions = bucket.pushSubscriptions
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(-MAX_PUSH_SUBSCRIPTIONS);
      await this.write(userId, bucket);
      return bucket.pushSubscriptions.find((s) => s.endpoint === subscription.endpoint) || null;
    },

    async removePushSubscription(userId, id) {
      if (!PUSH_ID_RE.test(String(id || ''))) return false;
      const bucket = await this.read(userId);
      const before = bucket.pushSubscriptions.length;
      bucket.pushSubscriptions = bucket.pushSubscriptions.filter((s) => s.id !== id && s.endpoint !== id);
      if (before === bucket.pushSubscriptions.length) return false;
      await this.write(userId, bucket);
      return true;
    },

    async touchPushSubscription(userId, id) {
      const bucket = await this.read(userId);
      const sub = bucket.pushSubscriptions.find((s) => s.id === id);
      if (!sub) return false;
      sub.lastUsedAt = new Date().toISOString();
      sub.lastAttemptAt = sub.lastUsedAt;
      sub.lastError = null;
      await this.write(userId, bucket);
      return true;
    },

    /** تسجيل فشل إرسال (مفتاح VAPID قديم/اشتراك منتهٍ) ليظهر في الواجهة */
    async markPushSubscriptionError(userId, id, reason = 'failed') {
      const bucket = await this.read(userId);
      const sub = bucket.pushSubscriptions.find((s) => s.id === id);
      if (!sub) return false;
      sub.lastError = String(reason || 'failed').slice(0, 60);
      sub.lastAttemptAt = new Date().toISOString();
      await this.write(userId, bucket);
      return true;
    },

    /** أجهزة العرض العامة — بلا endpoint أو مفاتيح */
    publicPushDevices(userId, bucket) {
      void userId;
      return (bucket?.pushSubscriptions || []).map((s) => ({
        id: s.id,
        platform: s.platform || null,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        lastUsedAt: s.lastUsedAt,
        lastAttemptAt: s.lastAttemptAt || null,
        lastError: s.lastError || null,
      }));
    },

    async purgeOld(userId, olderThanMs = 60 * 24 * 60 * 60 * 1000) {
      const bucket = await this.read(userId);
      const cutoff = Date.now() - olderThanMs;
      const kept = bucket.items.filter((i) => Date.parse(i.createdAt) >= cutoff);
      if (kept.length !== bucket.items.length) {
        bucket.items = kept;
        bucket.unread = kept.filter((i) => !i.read).length;
        await this.write(userId, bucket);
      }
      return kept.length;
    },
  };
}

/** الشكل العام للعميل — بلا أي بيانات داخلية */
export function publicNotification(n) {
  return {
    id: n.id,
    seq: n.seq,
    type: n.type,
    title: n.title,
    body: n.body,
    link: n.link,
    icon: n.icon,
    priority: n.priority,
    read: n.read,
    createdAt: n.createdAt,
    data: n.data,
  };
}
