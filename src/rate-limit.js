const buckets = new Map();

export function createRateLimiter({ windowMs, max, keyPrefix, key }) {
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const identity = key ? key(req) : req.auth?.id || req.ip || "anonymous";
    const bucketKey = `${keyPrefix}:${identity}`;
    const current = buckets.get(bucketKey);

    if (!current || current.resetAt <= now) {
      buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      return next();
    }

    current.count += 1;
    if (current.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((current.resetAt - now) / 1000)));
      return res.status(429).json({ ok: false, error: "Upload rate limit exceeded." });
    }

    next();
  };
}
