import crypto from 'node:crypto';
import { logger } from './store.js';

/** يعطي كل طلب: معرف، وقت بدء، رأس أمان، وسجل مرتبط بالطلب */
export function requestContext(req, res, next) {
  req.id = crypto.randomBytes(8).toString('hex');
  req.startedAt = performance.now();
  logger.debug('req_start', { method: req.method, path: req.originalUrl, hasCookie: Boolean(req.headers.cookie) });
  req.log = {
    debug: (e, m) => logger.debug(e, { reqId: req.id, ...m }),
    info: (e, m) => logger.info(e, { reqId: req.id, ...m }),
    warn: (e, m) => logger.warn(e, { reqId: req.id, ...m }),
    error: (e, m) => logger.error(e, { reqId: req.id, ...m }),
  };
  res.setHeader('X-Request-Id', req.id);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  res.on('finish', () => {
    if (!req.path.startsWith('/api/')) return;
    req.log.debug('request', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(performance.now() - req.startedAt),
    });
  });
  next();
}
