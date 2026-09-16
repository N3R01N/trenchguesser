import { Redis } from '@upstash/redis';

/**
 * The subset of Redis this game needs.
 *
 * Upstash's REST client is used in production; an in-memory implementation keeps
 * local development and headless tests working before a store exists.
 */
export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(
    key: string,
    value: unknown,
    opts?: { ex?: number; nx?: boolean },
  ): Promise<boolean>;
  del(key: string): Promise<void>;
  /** Atomic per-field write — lets concurrent guesses land without a lock. */
  hset(key: string, field: string, value: unknown): Promise<void>;
  hgetall<T>(key: string): Promise<Record<string, T>>;
  expire(key: string, seconds: number): Promise<void>;
}

function upstashStore(url: string, token: string): Store {
  const redis = new Redis({ url, token });
  return {
    async get<T>(key: string) {
      return (await redis.get<T>(key)) ?? null;
    },
    async set(key, value, opts) {
      // SetCommandOptions is a discriminated union, so the combinations have to
      // be spelled out rather than spread together.
      const res =
        opts?.ex && opts.nx
          ? await redis.set(key, value, { ex: opts.ex, nx: true })
          : opts?.ex
            ? await redis.set(key, value, { ex: opts.ex })
            : opts?.nx
              ? await redis.set(key, value, { nx: true })
              : await redis.set(key, value);
      return res === 'OK';
    },
    async del(key) {
      await redis.del(key);
    },
    async hset(key, field, value) {
      await redis.hset(key, { [field]: value });
    },
    async hgetall<T>(key: string) {
      return (await redis.hgetall<Record<string, T>>(key)) ?? {};
    },
    async expire(key, seconds) {
      await redis.expire(key, seconds);
    },
  };
}

interface Entry {
  value: unknown;
  expiresAt: number | null;
}

/** Process-local store. Survives hot reloads via globalThis, dies with the process. */
function memoryStore(): Store {
  const g = globalThis as unknown as { __tgStore?: Map<string, Entry> };
  const map = (g.__tgStore ??= new Map<string, Entry>());

  const live = (key: string): Entry | undefined => {
    const e = map.get(key);
    if (!e) return undefined;
    if (e.expiresAt !== null && e.expiresAt < Date.now()) {
      map.delete(key);
      return undefined;
    }
    return e;
  };

  const clone = <T>(v: T): T =>
    v === undefined || v === null ? v : (JSON.parse(JSON.stringify(v)) as T);

  return {
    async get<T>(key: string) {
      const e = live(key);
      return e ? clone(e.value as T) : null;
    },
    async set(key, value, opts) {
      if (opts?.nx && live(key)) return false;
      map.set(key, {
        value: clone(value),
        expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
      });
      return true;
    },
    async del(key) {
      map.delete(key);
    },
    async hset(key, field, value) {
      const e = live(key);
      const hash = (e?.value as Record<string, unknown>) ?? {};
      hash[field] = clone(value);
      map.set(key, { value: hash, expiresAt: e?.expiresAt ?? null });
    },
    async hgetall<T>(key: string) {
      const e = live(key);
      return e ? clone(e.value as Record<string, T>) : {};
    },
    async expire(key, seconds) {
      const e = live(key);
      if (e) e.expiresAt = Date.now() + seconds * 1000;
    },
  };
}

let cached: Store | null = null;

export function store(): Store {
  if (cached) return cached;

  // Vercel names these KV_REST_API_* when the Redis store is connected through
  // the dashboard, and UPSTASH_REDIS_REST_* when the credentials come straight
  // from Upstash. Both carry the same REST URL and token.
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;

  if (url && token) {
    // REDIS_URL is the rediss:// protocol endpoint and will not work here.
    if (!url.startsWith('http')) {
      throw new Error(
        `Redis URL must be the REST endpoint (https://...), got "${url.slice(0, 12)}..."`,
      );
    }
    cached = upstashStore(url, token);
  } else {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Redis credentials are required in production: set UPSTASH_REDIS_REST_URL ' +
          'and UPSTASH_REDIS_REST_TOKEN, or KV_REST_API_URL and KV_REST_API_TOKEN',
      );
    }
    console.warn('[store] no Upstash credentials — using in-memory store');
    cached = memoryStore();
  }
  return cached;
}

/** Test seam: drop the cached client so env changes take effect. */
export function resetStore(): void {
  cached = null;
}
