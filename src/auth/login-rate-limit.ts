/**
 * Failed logins only. A fixed window starts at the first failure and ends
 * FAILURE_WINDOW_MS later. A later failure inside the window increments that
 * counter. A failure after the window starts a new one. A successful login
 * does not clear either counter.
 *
 * An attempt is admitted before password verification. In-flight attempts
 * count against the same email and IP limits, so a burst cannot pass the
 * gate before earlier attempts record their failures. A finished success or
 * an infrastructure error releases its in-flight slot and does not add a
 * failure. A credential failure converts the slot into a failure.
 *
 * Unknown emails use the same normalized key as known emails and increment
 * both counters. Buckets are in-memory and process-local. They reset on
 * restart and are not shared across API processes. Expired buckets with no
 * in-flight attempt are deleted on each check. A store that is already at
 * MAX_TRACKED_BUCKETS rejects a new key instead of growing.
 *
 * The IP is Express req.ip. X-Forwarded-For is ignored unless the process is
 * started with TRUST_PROXY=true behind a proxy that overwrites that header.
 */
export const DEFAULT_EMAIL_FAILURE_LIMIT = 5;
export const DEFAULT_IP_FAILURE_LIMIT = 100;
export const FAILURE_WINDOW_MS = 15 * 60 * 1000;
export const MAX_TRACKED_BUCKETS = 10_000;

type Bucket = {
  windowStartedAt: number;
  failures: number;
  inFlight: number;
};

export class LoginRateLimiter {
  private readonly emailBuckets = new Map<string, Bucket>();
  private readonly ipBuckets = new Map<string, Bucket>();
  private readonly probeBuckets = new Map<string, Bucket>();

  constructor(private readonly maxBuckets = MAX_TRACKED_BUCKETS) {}

  reset(): void {
    this.emailBuckets.clear();
    this.ipBuckets.clear();
    this.probeBuckets.clear();
  }

  noteProbe(ip: string, now = Date.now()): void {
    this.pruneStore(this.probeBuckets, now);
    const existing = this.probeBuckets.get(ip);
    const count = existing && !this.windowExpired(existing, now) ? existing.failures : 0;
    if (count >= this.ipLimit()) {
      throw new RateLimitError();
    }
    if (!existing || this.windowExpired(existing, now)) {
      if (!this.probeBuckets.has(ip) && this.probeBuckets.size >= this.maxBuckets) {
        throw new RateLimitError();
      }
      this.probeBuckets.set(ip, { windowStartedAt: now, failures: 1, inFlight: 0 });
      return;
    }
    existing.failures += 1;
  }

  snapshot(): { emails: string[]; ips: string[] } {
    return {
      emails: [...this.emailBuckets.keys()],
      ips: [...this.ipBuckets.keys()],
    };
  }

  admit(emailKey: string, ip: string, now = Date.now()): void {
    this.prune(now);
    this.admitOne(this.emailBuckets, emailKey, this.emailLimit(), now);
    try {
      this.admitOne(this.ipBuckets, ip, this.ipLimit(), now);
    } catch (error) {
      this.releaseOne(this.emailBuckets, emailKey);
      throw error;
    }
  }

  settleFailure(emailKey: string, ip: string, now = Date.now()): void {
    this.failOne(this.emailBuckets, emailKey, now);
    this.failOne(this.ipBuckets, ip, now);
    this.prune(now);
  }

  settleSuccess(emailKey: string, ip: string, now = Date.now()): void {
    this.releaseOne(this.emailBuckets, emailKey);
    this.releaseOne(this.ipBuckets, ip);
    this.prune(now);
  }

  abandon(emailKey: string, ip: string, now = Date.now()): void {
    this.settleSuccess(emailKey, ip, now);
  }

  private admitOne(store: Map<string, Bucket>, key: string, limit: number, now: number): void {
    const existing = store.get(key);
    const failures = existing ? this.effectiveFailures(existing, now) : 0;
    const inFlight = existing?.inFlight ?? 0;
    if (failures >= limit || failures + inFlight >= limit) {
      throw new RateLimitError();
    }
    if (!existing || (this.windowExpired(existing, now) && existing.inFlight === 0)) {
      if (!store.has(key) && store.size >= this.maxBuckets) {
        throw new RateLimitError();
      }
      store.set(key, { windowStartedAt: now, failures: 0, inFlight: 1 });
      return;
    }
    if (this.windowExpired(existing, now)) {
      existing.windowStartedAt = now;
      existing.failures = 0;
    }
    existing.inFlight += 1;
  }

  private failOne(store: Map<string, Bucket>, key: string, now: number): void {
    const bucket = store.get(key);
    if (!bucket) {
      if (store.size >= this.maxBuckets) {
        return;
      }
      store.set(key, { windowStartedAt: now, failures: 1, inFlight: 0 });
      return;
    }
    if (bucket.inFlight > 0) {
      bucket.inFlight -= 1;
    }
    if (this.windowExpired(bucket, now)) {
      bucket.windowStartedAt = now;
      bucket.failures = 1;
      return;
    }
    bucket.failures += 1;
  }

  private releaseOne(store: Map<string, Bucket>, key: string): void {
    const bucket = store.get(key);
    if (!bucket) {
      return;
    }
    if (bucket.inFlight > 0) {
      bucket.inFlight -= 1;
    }
    if (bucket.inFlight === 0 && bucket.failures === 0) {
      store.delete(key);
    }
  }

  private prune(now: number): void {
    this.pruneStore(this.emailBuckets, now);
    this.pruneStore(this.ipBuckets, now);
  }

  private pruneStore(store: Map<string, Bucket>, now: number): void {
    for (const [key, bucket] of store) {
      if (bucket.inFlight === 0 && this.windowExpired(bucket, now)) {
        store.delete(key);
      }
    }
  }

  private effectiveFailures(bucket: Bucket, now: number): number {
    return this.windowExpired(bucket, now) ? 0 : bucket.failures;
  }

  private windowExpired(bucket: Bucket, now: number): boolean {
    return now - bucket.windowStartedAt >= FAILURE_WINDOW_MS;
  }

  private emailLimit(): number {
    return positiveInt(process.env.LOGIN_MAX_FAILURES_PER_EMAIL, DEFAULT_EMAIL_FAILURE_LIMIT);
  }

  private ipLimit(): number {
    return positiveInt(process.env.LOGIN_MAX_FAILURES_PER_IP, DEFAULT_IP_FAILURE_LIMIT);
  }
}

export class RateLimitError extends Error {
  constructor() {
    super('Too many login attempts. Try again later.');
  }
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}
