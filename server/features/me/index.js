import express from 'express';
import crypto from 'node:crypto';
import { wrap } from '../../shared/http.js';
import { publicUser } from '../auth/users.js';
import { createRateLimiter } from '../../shared/rate-limit.js';
import { validateAvatar } from './avatar.js';

/**
 * ميزة "حسابي" — بيانات المستخدم وتفضيلاته
 * Header: X-CSRF-Token مطلوب لكل طلب تعديل
 */
export default {
  register(app, ctx) {
    const { config } = ctx;
    const { guards, users } = ctx.services.auth;
    const router = express.Router();
    const limiter = createRateLimiter(config.rateLimit.api);

    router.use(guards.loadSession, guards.requireAuth);
    router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    // ---------- بياناتي ----------
    router.get(
      '/',
      wrap(async (req, res) => {
        res.json({ ok: true, data: { user: publicUser(req.auth.user) } });
      })
    );

    // ---------- تحديث الاسم والتفضيلات ----------
    router.patch(
      '/',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const { validateName } = await import('../auth/validate.js');
        const patch = {};
        if (req.body?.name !== undefined) {
          const name = String(req.body.name).trim().replace(/\s+/g, ' ');
          const err = validateName(name);
          if (err) return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: err, details: { fields: { name: err } } } });
          patch.name = name;
        }
        if (req.body?.preferences && typeof req.body.preferences === 'object') {
          const prefs = req.auth.user.preferences || {};
          const incoming = req.body.preferences;
          const theme = incoming.theme;
          const next = {
            ...prefs,
            ...(theme === 'light' || theme === 'dark' || theme === 'system' ? { theme } : {}),
            notifications: (() => {
              const current = prefs.notifications || {};
              const patch = incoming.notifications && typeof incoming.notifications === 'object' ? incoming.notifications : {};
              const time = (value, fallback) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || '')) ? value : fallback);
              const quiet = patch.quietHours && typeof patch.quietHours === 'object' ? patch.quietHours : {};
              return {
                ...current,
                ...(typeof patch.push === 'boolean' ? { push: patch.push } : {}),
                ...(typeof patch.email === 'boolean' ? { email: patch.email } : {}),
                ...(typeof patch.digest === 'boolean' ? { digest: patch.digest } : {}),
                ...(typeof patch.reengage === 'boolean' ? { reengage: patch.reengage } : {}),
                ...(typeof patch.awayReminders === 'boolean' ? { awayReminders: patch.awayReminders } : {}),
                ...(typeof patch.routineReminders === 'boolean' ? { routineReminders: patch.routineReminders } : {}),
                ...(typeof patch.achievements === 'boolean' ? { achievements: patch.achievements } : {}),
                ...(typeof patch.systemEvents === 'boolean' ? { systemEvents: patch.systemEvents } : {}),
                ...(typeof patch.cloudAi === 'boolean' ? { cloudAi: patch.cloudAi } : {}),
                digestTime: patch.digestTime !== undefined ? time(patch.digestTime, current.digestTime || '08:30') : current.digestTime || '08:30',
                quietHours: {
                  enabled:
                    typeof quiet.enabled === 'boolean' ? quiet.enabled : current.quietHours?.enabled !== false,
                  from: quiet.from !== undefined ? time(quiet.from, current.quietHours?.from || '23:00') : current.quietHours?.from || '23:00',
                  to: quiet.to !== undefined ? time(quiet.to, current.quietHours?.to || '07:00') : current.quietHours?.to || '07:00',
                },
              };
            })(),
          };
          if (incoming.sound && typeof incoming.sound === 'object') {
            next.sound = {
              enabled: typeof incoming.sound.enabled === 'boolean' ? incoming.sound.enabled : prefs.sound?.enabled !== false,
              volume:
                typeof incoming.sound.volume === 'number' && Number.isFinite(incoming.sound.volume)
                  ? Math.max(0, Math.min(1, incoming.sound.volume))
                  : prefs.sound?.volume ?? 0.55,
              tone:
                typeof incoming.sound.tone === 'string' && /^[a-z-]{2,24}$/.test(incoming.sound.tone)
                  ? incoming.sound.tone
                  : prefs.sound?.tone || 'chime',
            };
          }
          if (incoming.readingReminder && typeof incoming.readingReminder === 'object') {
            const time = String(incoming.readingReminder.time ?? '').trim();
            next.readingReminder = {
              enabled:
                typeof incoming.readingReminder.enabled === 'boolean'
                  ? incoming.readingReminder.enabled
                  : prefs.readingReminder?.enabled === true,
              time: /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : prefs.readingReminder?.time || '20:30',
            };
          }
          patch.preferences = next;
        }
        const updated = await users.update(req.auth.user.id, patch);
        res.json({ ok: true, data: { user: publicUser(updated) } });
      })
    );

    // ---------- صورة الحساب ----------
    router.put(
      '/avatar',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const result = validateAvatar(req.body?.avatar);
        if (!result.ok) {
          return res.status(400).json({ ok: false, error: { code: result.code, message: result.message } });
        }
        const updated = await users.update(req.auth.user.id, { avatar: result.avatar });
        if (!updated) {
          return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'الحساب غير موجود' } });
        }
        res.json({ ok: true, data: { user: publicUser(updated) } });
      })
    );

    router.delete(
      '/avatar',
      limiter,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const updated = await users.update(req.auth.user.id, { avatar: null });
        if (!updated) {
          return res.status(404).json({ ok: false, error: { code: 'not_found', message: 'الحساب غير موجود' } });
        }
        res.json({ ok: true, data: { user: publicUser(updated) } });
      })
    );

    // ---------- نسخة من بياناتي (للهجرة/الاحتفاظ) ----------
    router.get(
      '/export',
      wrap(async (req, res) => {
        const bucket = {};
        res.setHeader('Content-Disposition', 'attachment; filename="my-account.json"');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        bucket.exportedAt = new Date().toISOString();
        bucket.user = publicUser(req.auth.user);
        bucket.note = 'بيانات مجلة/روتينات المستخدم محفوظة على جهازه مشفّرة، والتصدير الكامل من صفحة الإعدادات.';
        res.send(JSON.stringify(bucket, null, 2));
      })
    );

    // ---------- حذف الحساب نهائيًا ----------
    router.delete(
      '/',
      guards.requireCsrf,
      wrap(async (req, res) => {
        if (req.body?.confirm !== 'DELETE') {
          return res.status(400).json({ ok: false, error: { code: 'confirmation_required', message: 'اكتب DELETE للتأكيد' } });
        }
        const user = req.auth.user;
        await ctx.services.notifications?.notify?.(user.id, { type: 'security', title: 'تم حذف الحساب', body: 'شكرًا لاستخدامك مجلتي وروتيني. تم مسح بيانات حسابك من الخادم.' }).catch(() => { });
        await ctx.services.auth.sessions.destroyAllForUser(user.id);
        const fs = await import('node:fs/promises');
        const path = await import('node:path');
        const usersDir = path.join(config.dataDir, 'users');
        const idxPath = path.join(usersDir, 'index.json');
        try {
          const { readJsonSafe, writeJsonSafe, backupName } = await import('../../shared/store.js');
          const idx = await readJsonSafe(idxPath, { byEmail: {} });
          const emailKey = crypto.createHash('sha256').update(user.email).digest('hex');
          if (idx.byEmail?.[emailKey]) delete idx.byEmail[emailKey];
          await writeJsonSafe(idxPath, idx);
          const targets = [
            path.join(usersDir, `${user.id}.json`),
            path.join(config.dataDir, 'notifications', `${user.id}.json`),
          ];
          for (const target of targets) {
            const name = path.basename(target);
            const dir = path.dirname(target);
            for (const file of [name, backupName(name), `bakold.${name}`]) {
              await fs.rm(path.join(dir, file), { force: true });
            }
          }
          await ctx.services.presence?.remove?.(user.id);
        } catch { }
        res.clearCookie(config.cookieName, { path: '/' });
        guards.clearCsrfCookie(res);
        res.json({ ok: true, data: { deleted: true } });
      })
    );

    app.use('/api/me', router);
  },
};
