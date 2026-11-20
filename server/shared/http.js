export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (code, message, details) => new HttpError(400, code, message, details);
export const unauthorized = (message = 'يجب تسجيل الدخول أولًا') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'غير مسموح') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'غير موجود') => new HttpError(404, 'not_found', message);
export const conflict = (code, message, details) => new HttpError(409, code, message, details);
export const tooMany = (message = 'محاولات كثيرة، جرّب لاحقًا') => new HttpError(429, 'rate_limited', message);

/** غلاف async لمسار Express يمرر الأخطاء للمعالج الموحد */
export const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** معالج أخطاء موحد لكل الميزات (يُركَّب مرة واحدة على التطبيق) */
export function handleError(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      ok: false,
      error: { code: err.code, message: err.message, details: err.details },
    });
  }
  req.log?.error?.('unhandled_error', { message: err?.message, stack: err?.stack });
  res.status(500).json({ ok: false, error: { code: 'server_error', message: 'حدث خطأ غير متوقع' } });
}
