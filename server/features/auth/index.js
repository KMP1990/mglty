import express from 'express';
import crypto from 'node:crypto';
import { wrap, notFound } from '../../shared/http.js';
import { createRateLimiter } from '../../shared/rate-limit.js';
import { createUserStore, publicUser } from './users.js';
import { createSessionStore } from './sessions.js';
import { createAuthGuards } from './guards.js';
import { hashPassword, verifyPassword, burnPasswordTime } from './password.js';
import { validateSignup, validatePassword, normalizeEmail, validateEmail } from './validate.js';

/**
 * ميزة المصادقة
 * POST /api/auth/signup  — إنشاء حساب
 * POST /api/auth/login   — تسجيل الدخول
 * POST /api/auth/logout  — تسجيل الخروج
 * GET  /api/auth/session — حالة الجلسة الحالية
 * PUT  /api/auth/password— تغيير كلمة المرور
 */
export function createAuthService(ctx) {
  const { config } = ctx;
  const users = createUserStore(config);
  const sessions = createSessionStore(config);
  const guards = createAuthGuards({ config, sessions, users, presence: ctx.services?.presence || null });
  return { users, sessions, guards };
}

export default {
  register(app, ctx) {
    const { config, logger } = ctx;
    const auth = createAuthService(ctx);
    ctx.services = { ...(ctx.services || {}), auth };
    const { users, sessions, guards } = auth;

    const router = express.Router();
    const authLimiter = createRateLimiter(config.rateLimit.auth);
    const signupLimiter = createRateLimiter(config.rateLimit.signup);

    router.use(guards.loadSession);

    // لا معالجة كاش/تخزين لبيانات المصادقة
    router.use((req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    // عملية إنشاء حساب لمستخدم آخر: لا يحق استخدام جلسة قائمة
    const rejectIfSignedIn = (req, res, next) => {
      if (req.auth?.user) {
        return res.status(409).json({
          ok: false,
          error: { code: 'already_signed_in', message: 'أنت مسجل الدخول بالفعل', details: { user: publicUser(req.auth.user) } },
        });
      }
      next();
    };

    const SESSION_COOKIE_OPTS = {
      httpOnly: true,
      secure: config.cookieSecure,
      sameSite: 'lax',
      path: '/',
    };

    /** ينشئ جلسة جديدة ويعيد { user, csrfToken } بعد مسح أي جلسة سابقة */
    async function startSessionFor(req, res, user, { remember = true } = {}) {
      if (req.auth?.sid) await sessions.destroy(req.auth.sid).catch(() => {});
      const { sid, csrfToken } = await sessions.create({
        userId: user.id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        device: req.get('sec-ch-ua-platform') || null,
      });
      logger.info('session_started', { userId: user.id });
      const updated =
        (await users.update(user.id, {
          lastLoginAt: new Date().toISOString(),
          security: { ...(user.security || {}), failedLogins: 0, lockedUntil: null },
        })) || user;
      const cookieOpts = remember ? { ...SESSION_COOKIE_OPTS, maxAge: config.sessionTtlMs } : { ...SESSION_COOKIE_OPTS };
      res.cookie(config.cookieName, sessions.sign(sid), cookieOpts);
      guards.setCsrfCookie(res, csrfToken);
      return { user: updated, csrfToken };
    }

    // ---------- إنشاء حساب ----------
    router.post(
      '/signup',
      signupLimiter,
      rejectIfSignedIn,
      wrap(async (req, res) => {
        const { errors, value } = validateSignup(req.body || {});
        if (Object.keys(errors).length) {
          return res.status(400).json({
            ok: false,
            error: { code: 'validation_failed', message: 'تحقق من الحقول المطلوبة', details: { fields: errors } },
          });
        }
        const existing = await users.findByEmail(value.email);
        if (existing) {
          return res.status(409).json({
            ok: false,
            error: {
              code: 'email_taken',
              message: 'هذا البريد مسجل لدينا بالفعل. جرّب تسجيل الدخول بدلًا من ذلك.',
              details: { fields: { email: 'البريد مسجّل مسبقًا' } },
            },
          });
        }
        const passwordHash = await hashPassword(value.password);
        const created = await users.create({ name: value.name, email: value.email, passwordHash });
        if (created.conflict) {
          return res.status(409).json({
            ok: false,
            error: { code: 'email_taken', message: 'هذا البريد مسجل لدينا بالفعل', details: { fields: { email: 'البريد مسجّل مسبقًا' } } },
          });
        }
        const { user, csrfToken } = await startSessionFor(req, res, created.user);
        logger.info('signup', { userId: user.id });

        // إشعار الترحيب — ميزة الإشعارات تسمع لهذا الحدث عبر الواجهة العامة
        await ctx.services.notifications?.onUserSignedUp?.(user);

        res.status(201).json({ ok: true, data: { user: publicUser(user), csrfToken } });
      })
    );

    // ---------- تسجيل الدخول ----------
    router.post(
      '/login',
      authLimiter,
      rejectIfSignedIn,
      wrap(async (req, res) => {
        const body = req.body || {};
        const email = normalizeEmail(body.email);
        const password = String(body.password ?? '');
        const remember = body.remember === true;
        const genericError = {
          ok: false,
          error: { code: 'invalid_credentials', message: 'البريد الإلكتروني أو كلمة المرور غير صحيحة' },
        };

        const emailErr = validateEmail(email);
        if (emailErr) {
          return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: emailErr, details: { fields: { email: emailErr } } } });
        }
        if (!password || password.length > 128) {
          await burnPasswordTime(password || 'x');
          return res.status(401).json(genericError);
        }

        const user = await users.findByEmail(email);
        if (!user) {
          await burnPasswordTime(password);
          logger.warn('login_unknown_email', { emailHash: normalizeEmail(email).slice(0, 3) + '***' });
          return res.status(401).json(genericError);
        }

        // قفل مؤقت بعد محاولات فاشلة متكررة
        const lockedUntil = user.security?.lockedUntil ? Date.parse(user.security.lockedUntil) : 0;
        if (lockedUntil > Date.now()) {
          const minutes = Math.ceil((lockedUntil - Date.now()) / 60000);
          return res.status(429).json({
            ok: false,
            error: { code: 'account_locked', message: `تم إيقاف المحاولات مؤقتًا لحماية حسابك. حاول بعد ${minutes} دقيقة.` },
          });
        }

        const okPassword = await verifyPassword(password, user.passwordHash);
        if (!okPassword) {
          const failed = (user.security?.failedLogins || 0) + 1;
          const lockDelay = failed >= 5 ? new Date(Date.now() + Math.min(30, failed - 4) * 60_000).toISOString() : null;
          await users.update(user.id, { security: { ...user.security, failedLogins: failed, lockedUntil: lockDelay } });
          logger.warn('login_failed', { userId: user.id, failed });
          return res.status(401).json(genericError);
        }

        // remember=false => جلسة المتصفح فقط (تُمسح بإغلاق المتصفح)
        const { user: sessionUser, csrfToken } = await startSessionFor(req, res, user, { remember });
        logger.info('login_ok', { userId: user.id });

        // بصمة جهاز/IP + تنبيه أمني عند الدخول من جهاز لم نره مؤخرًا
        const hash = (value) => crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 32);
        const uaHash = hash(req.get('user-agent') || 'unknown');
        const ipHash = hash(req.ip || 'unknown');
        const previousUa = user.security?.lastUaHash || null;
        const isNewDevice = Boolean(previousUa && previousUa !== uaHash);
        await users
          .update(user.id, {
            security: { ...(sessionUser.security || {}), failedLogins: 0, lockedUntil: null, lastUaHash: uaHash, lastIpHash: ipHash, lastLoginPlatform: String(req.get('sec-ch-ua-platform') || '').slice(0, 40) },
          })
          .catch(() => {});
        if (isNewDevice) {
          const presence = ctx.services?.presence;
          const state = presence ? await presence.read(user.id).catch(() => null) : null;
          const lastSecurityAt = Date.parse(state?.reminders?.securityAt || 0) || 0;
          if (Date.now() - lastSecurityAt > 12 * 60 * 60 * 1000) {
            await ctx.services.notifications
              ?.notify?.(user.id, {
                type: 'security',
                title: 'دخول من جهاز جديد',
                body: `سجّلنا دخولًا إلى حسابك من جهاز/متصفح جديد${req.get('sec-ch-ua-platform') ? ` (${String(req.get('sec-ch-ua-platform')).slice(0, 40)})` : ''}. إن لم يكن أنت، غيّر كلمة المرور فورًا.`,
                link: '/account',
                priority: 'high',
                data: { source: 'auth', event: 'new-device' },
              })
              .catch(() => {});
            presence?.setReminderStamp?.(user.id, 'securityAt').catch(() => {});
          }
        }

        res.json({ ok: true, data: { user: publicUser(sessionUser), csrfToken } });
      })
    );

    // ---------- تسجيل الخروج ----------
    router.post(
      '/logout',
      guards.requireAuth,
      guards.requireCsrf,
      wrap(async (req, res) => {
        await sessions.destroy(req.auth.sid);
        res.clearCookie(config.cookieName, { ...SESSION_COOKIE_OPTS });
        guards.clearCsrfCookie(res);
        logger.info('logout', { userId: req.auth.user.id });
        res.json({ ok: true, data: { loggedOut: true } });
      })
    );

    // ---------- حالة الجلسة ----------
    router.get('/session', (req, res) => {
      if (!req.auth?.user) {
        return res.json({ ok: true, data: { authenticated: false, user: null, csrfToken: null } });
      }
      res.json({ ok: true, data: { authenticated: true, ...guards.userPayload(req) } });
    });

    // ---------- تغيير كلمة المرور ----------
    router.put(
      '/password',
      authLimiter,
      guards.requireAuth,
      guards.requireCsrf,
      wrap(async (req, res) => {
        const current = String(req.body?.currentPassword ?? '');
        const nextPass = String(req.body?.newPassword ?? '');
        const err = validatePassword(nextPass);
        if (err) {
          return res.status(400).json({ ok: false, error: { code: 'validation_failed', message: err, details: { fields: { newPassword: err } } } });
        }
        const ok = await verifyPassword(current, req.auth.user.passwordHash);
        if (!ok) {
          return res.status(400).json({ ok: false, error: { code: 'wrong_password', message: 'كلمة المرور الحالية غير صحيحة', details: { fields: { currentPassword: 'غير صحيحة' } } } });
        }
        // حفظ كلمة المرور الجديدة ثم إنهاء كل الجلسات (بما فيها الحالية) لأقصى درجة أمان
        const passwordHash = await hashPassword(nextPass);
        await users.update(req.auth.user.id, { passwordHash });
        await ctx.services.notifications
          ?.notify?.(req.auth.user.id, {
            type: 'security',
            title: 'تم تغيير كلمة المرور',
            body: 'أُنهيت كل الجلسات السابقة لحماية حسابك. إن لم تكن أنت من غيّرها، تواصل معنا فورًا.',
            link: '/account',
            priority: 'high',
            data: { source: 'auth', event: 'password-changed' },
          })
          .catch(() => {});
        await sessions.destroyAllForUser(req.auth.user.id);
        res.clearCookie(config.cookieName, { ...SESSION_COOKIE_OPTS });
        guards.clearCsrfCookie(res);
        logger.info('password_changed', { userId: req.auth.user.id });
        res.json({ ok: true, data: { changed: true, reauthRequired: true } });
      })
    );

    router.use((req, res, next) => next(notFound()));

    app.use('/api/auth', router);
  },
};
