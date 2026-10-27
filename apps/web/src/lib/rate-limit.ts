interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
}

/**
 * Single-process sliding-window limiter. The demo runs as one Node process; a
 * production deployment should replace this with a shared Redis limiter.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const timestamp = Date.now();
  if (timestamp - lastSweep > 60_000) {
    for (const [bucketKey, bucket] of buckets) {
      if (bucket.resetAt <= timestamp) buckets.delete(bucketKey);
    }
    lastSweep = timestamp;
  }
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= timestamp) {
    const resetAt = timestamp + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { ok: true, remaining: limit - 1, resetAt, limit };
  }
  if (existing.count >= limit) {
    return { ok: false, remaining: 0, resetAt: existing.resetAt, limit };
  }
  existing.count += 1;
  return { ok: true, remaining: limit - existing.count, resetAt: existing.resetAt, limit };
}

export function resetRateLimits(): void {
  buckets.clear();
}
