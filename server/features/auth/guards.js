/**
 * مصادقة الطلبات: قراءة الجلسة، حماية CSRF (رأس + Double Submit Cookie)،
 * وتحديد الوصول للمسارات المحمية.
 */
import crypto from 'node:crypto';
import { unauthorized, forbidden } from '../../shared/http.js';
import { publicUser } from './users.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function createAuthGuards({ config, sessions, users, presence = null }) {
  const csrfCookieName = 'mr_csrf';

  /** يقرأ التوكن من الكوكي ويتحقق منه؛ يضع req.auth دون إجبار تسجيل الدخول */
  async function loadSession(req, res, next) {
    try {
      req.auth = { user: null, session: null, sid: null };
      const token = req.cookies?.[config.cookieName];
      const sid = sessions.unsign(token);
      if (!sid) return next();
      const session = await sessions.get(sid);
      if (!session || session.expiresAt <= Date.now()) return next();
      if (Date.now() - session.lastSeenAt > config.sessionIdleMs) {
        await sessions.destroy(sid).catch(() => { });
        return next();
      }
      const user = await users.findById(session.userId);
      if (!user) {
        await sessions.destroy(sid).catch(() => { });
        return next();
      }
      req.auth = { user, session, sid };
      await sessions.touch(sid);
      // نبض حضور غير حاجب: لا نؤخر الطلب بسبب كتابة إحصائية
      presence?.touch(user.id, { source: req.originalUrl?.split('?')[0] || null }).catch(() => {});
      setCsrfCookie(res, session.csrfToken);
      next();
    } catch (err) {
      next(err);
    }
  }

  function setCsrfCookie(res, token) {
    res.cookie(csrfCookieName, token, {
      httpOnly: false, // يقرأه JS لإرساله في الرأس (Double Submit)
      sameSite: 'strict',
      secure: config.cookieSecure,
      path: '/',
      maxAge: config.sessionTtlMs,
    });
  }

  function clearCsrfCookie(res) {
    res.clearCookie(csrfCookieName, { path: '/', sameSite: 'strict', secure: config.cookieSecure });
  }

  /** حماية CSRF: طرق التعديل تتطلب رأس X-CSRF-Token مطابقًا للجلسة وللكوكي */
  function requireCsrf(req, res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const header = req.get('x-csrf-token');
    const cookie = req.cookies?.[csrfCookieName];
    if (!req.auth?.session) return next(forbidden('الجلسة غير صالحة، أعد تسجيل الدخول'));
    if (!header || header !== cookie || !sessions.csrfEquals(req.auth.session, header)) {
      return next(forbidden('رمز الحماية (CSRF) غير صالح، أعد تحميل الصفحة'));
    }
    next();
  }

  function requireAuth(req, res, next) {
    if (!req.auth?.user) return next(unauthorized());
    next();
  }

  /** يستخدم بعد verifyResetCsrf في تدفق الاستعادة */
  function verifyCsrfFor(req, session, token) {
    return sessions.csrfEquals(session, token);
  }

  const userPayload = (req) => ({
    user: publicUser(req.auth.user),
    csrfToken: req.auth.session?.csrfToken || null,
  });

  return { loadSession, requireCsrf, requireAuth, setCsrfCookie, clearCsrfCookie, userPayload, verifyCsrfFor, csrfCookieName };
}

export const csrfCookie = 'mr_csrf';
export const randomToken = () => crypto.randomBytes(24).toString('base64url');
