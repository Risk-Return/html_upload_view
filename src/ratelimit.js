export function utcDay(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export class RateLimiter {
  constructor(db, { dailyLimit, now = () => new Date() } = {}) {
    if (!db) throw new Error('db is required');
    if (!Number.isInteger(dailyLimit) || dailyLimit <= 0) {
      throw new Error('dailyLimit must be a positive integer');
    }
    this.db = db;
    this.dailyLimit = dailyLimit;
    this.now = now;
  }

  remaining(ip, day = utcDay(this.now())) {
    return Math.max(0, this.dailyLimit - this.db.getCounter(ip, day));
  }

  tryConsume(ip, n = 1) {
    if (!ip) throw new Error('ip is required');
    if (!Number.isInteger(n) || n <= 0) throw new Error('n must be > 0');

    const day = utcDay(this.now());
    const limit = this.dailyLimit;

    return this.db.transaction(() => {
      const current = this.db.getCounter(ip, day);
      if (current + n > limit) {
        return {
          ok: false,
          limit,
          remaining: Math.max(0, limit - current),
          requested: n,
          day,
        };
      }
      this.db.incrementCounter(ip, day, n);
      return {
        ok: true,
        limit,
        remaining: limit - (current + n),
        requested: n,
        day,
      };
    })();
  }
}
