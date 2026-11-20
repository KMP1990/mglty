import { tooMany } from './http.js';

/**
 * محدد معدل بسيط داخل الذاكرة (نافذة ثابتة). كافٍ لخادم واحد؛
 * عند التوسع الأفقي يُستبدل بمخزن مشترك (Redis) بنفس الواجهة.
 */
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map();
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of hits) if (bucket.resetAt <= now) hits.delete(key);
  }, Math.max(windowMs, 60_000));
  sweep.unref?.();

  const limiter = (req, res, next) => {
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let bucket = hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      hits.set(key, bucket);
    }
    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader('RateLimit-Limit', String(max));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)));
      return next(tooMany());
    }
    next();
  };
  limiter.reset = () => hits.clear();
  return limiter;
}
