import { RedisOptions } from 'ioredis';
import { CacheProvider } from './CacheProvider';
import { RedisProvider } from './RedisProvider';
import { MemoryProvider } from './MemoryProvider';
import { generateCacheKey, KeyGeneratorOptions } from '../utils/keyGenerator';
import { createExpressMiddleware, ExpressCacheOptions } from '../middleware/express';
import { createFastifyPlugin, createFastifyHook, FastifyCacheOptions } from '../middleware/fastify';
import { createHonoMiddleware, HonoCacheOptions } from '../middleware/hono';
import { createKoaMiddleware, KoaCacheOptions } from '../middleware/koa';
import { createNestJSInterceptor, NestJSCacheOptions } from '../middleware/nestjs';

export interface CacheManagerOptions {
  /**
   * The primary cache provider (e.g. RedisProvider).
   * If omitted, a provider is automatically created using `redis` option or falls back to MemoryProvider.
   */
  provider?: CacheProvider;

  /**
   * Optional fallback cache provider (e.g. MemoryProvider) when the primary is offline.
   * If omitted and `useMemoryFallback` is enabled, a MemoryProvider is automatically set up.
   */
  fallbackProvider?: CacheProvider;

  /**
   * Optional connection configurations for Redis.
   * If specified, CacheManager automatically configures RedisProvider as the primary caching backend.
   */
  redis?: RedisOptions;

  /**
   * Whether to configure and use an in-memory fallback cache if Redis drops.
   * Only applicable when `redis` config is provided. Defaults to true.
   */
  useMemoryFallback?: boolean;

  /**
   * Default time-to-live for cache entries (in seconds). Defaults to 300 seconds (5 minutes).
   */
  defaultTtl?: number;

  /**
   * Enable request coalescing (single-flight) to prevent cache stampedes. Defaults to true.
   */
  enableSingleFlight?: boolean;

  /**
   * Optional custom logger.
   */
  logger?: {
    info?: (msg: string) => void;
    error?: (msg: string) => void;
  };
}

export interface RememberOptions {
  ttl?: number;
  tags?: string[];
}

export interface CacheMiddlewareOptions {
  /**
   * Time-to-live for the cached response (in seconds).
   * Overrides CacheManager's defaultTtl.
   */
  ttl?: number;

  /**
   * List of tags associated with the cache entry, or a function generating them from the request.
   */
  tags?: string[] | ((req: any) => string[]);

  /**
   * Key generation options (e.g. tracking specific custom headers).
   */
  keyOptions?: KeyGeneratorOptions;

  /**
   * HTTP methods allowed for caching. Defaults to ['GET'].
   */
  methods?: string[];

  /**
   * If true, errors or non-2xx responses will also be cached. Defaults to false.
   */
  cacheErrorResponses?: boolean;
}

export class CacheManager {
  private primary: CacheProvider;
  private fallback?: CacheProvider;
  private defaultTtl: number;
  private singleFlightEnabled: boolean;
  private activePromises = new Map<string, Promise<any>>();
  private useFallback = false;
  private logger?: CacheManagerOptions['logger'];

  constructor(options: CacheManagerOptions) {
    this.defaultTtl = options.defaultTtl ?? 300;
    this.singleFlightEnabled = options.enableSingleFlight ?? true;
    this.logger = options.logger;

    if (options.provider) {
      this.primary = options.provider;
      this.fallback = options.fallbackProvider;
    } else if (options.redis) {
      this.primary = new RedisProvider(options.redis);
      if (options.useMemoryFallback !== false) {
        this.fallback = options.fallbackProvider ?? new MemoryProvider();
      }
    } else {
      // Default to pure local in-memory caching if no primary or Redis configuration is given
      this.primary = new MemoryProvider();
    }

    // Set up monitoring for connection failures if primary provider is RedisProvider
    const client = (this.primary as any).getClient?.();
    if (client) {
      client.on('error', (err: any) => {
        if (!this.useFallback) {
          this.logger?.error?.(`Redis error: ${err.message}. Switching to fallback provider.`);
          this.useFallback = true;
        }
      });
      client.on('connect', () => {
        if (this.useFallback) {
          this.logger?.info?.('Redis connected. Resuming primary cache usage.');
          this.useFallback = false;
        }
      });
    }
  }

  /**
   * Creates a caching middleware/plugin compatible with Express, Fastify, Hono, Koa, NestJS, and Next.js.
   */
  middleware(
    options: CacheMiddlewareOptions = {},
    handler?: (req: any, ctx?: any) => Promise<any>
  ) {
    if (typeof handler === 'function') {
      return async (req: any, ctx?: any) => {
        const allowedMethods = (options.methods || ['GET']).map((m) => m.toUpperCase());
        if (!allowedMethods.includes(req.method)) {
          return handler(req, ctx);
        }

        // Parse query parameters dynamically from request URL
        let query = {};
        try {
          const urlObj = new URL(req.url, 'http://localhost');
          query = Object.fromEntries(urlObj.searchParams.entries());
        } catch {}

        const key = generateCacheKey(
          {
            method: req.method,
            originalUrl: req.url,
            query,
            params: ctx && ctx.params ? ctx.params : {},
            body: req.body,
            headers: req.headers && typeof req.headers.entries === 'function'
              ? Object.fromEntries(req.headers.entries())
              : (req.headers || {}),
          },
          options.keyOptions
        );

        try {
          const cached = await this.get<{
            body: any;
            headers: Record<string, string>;
            statusCode: number;
          }>(key);

          if (cached !== null) {
            // Cache HIT!
            const headers = new Headers();
            if (cached.headers) {
              for (const [k, v] of Object.entries(cached.headers)) {
                if (k.toLowerCase() !== 'x-cache') {
                  headers.set(k, String(v));
                }
              }
            }
            headers.set('X-Cache', 'HIT');
            return new Response(
              typeof cached.body === 'string' ? cached.body : JSON.stringify(cached.body),
              {
                status: cached.statusCode,
                headers,
              }
            );
          }
        } catch {
          // Proceed on cache read errors
        }

        // Run downstream Next.js handler
        const res = await handler(req, ctx);

        const isSuccessful = res && res.status >= 200 && res.status < 300;
        if (isSuccessful) {
          try {
            const resClone = res.clone();
            let body: any;
            const contentType = resClone.headers.get('content-type') ?? '';
            if (contentType.includes('application/json')) {
              body = await resClone.json();
            } else {
              body = await resClone.text();
            }

            const responseToCache = {
              body,
              headers: Object.fromEntries(resClone.headers.entries()),
              statusCode: resClone.status,
            };

            const resolvedTags = typeof options.tags === 'function' ? options.tags(req) : (options.tags ?? []);
            this.set(key, responseToCache, options.ttl).then(() => {
              if (resolvedTags.length > 0) {
                return this.trackTags(key, resolvedTags);
              }
            }).catch(() => {});
          } catch {
            // Suppress background errors
          }
        }

        try {
          res.headers.set('X-Cache', 'MISS');
          return res;
        } catch {
          try {
            const newHeaders = new Headers(res.headers);
            newHeaders.set('X-Cache', 'MISS');
            return new Response(res.body, {
              status: res.status,
              statusText: res.statusText,
              headers: newHeaders,
            });
          } catch {
            return res;
          }
        }
      };
    }

    const expressMiddleware = createExpressMiddleware({
      ...options,
      cacheManager: this,
    });

    const fastifyPlugin = createFastifyPlugin({
      ...options,
      cacheManager: this,
    });

    const fastifyHook = createFastifyHook({
      ...options,
      cacheManager: this,
    });

    const honoMiddleware = createHonoMiddleware({
      ...options,
      cacheManager: this,
    });

    const koaMiddleware = createKoaMiddleware({
      ...options,
      cacheManager: this,
    });

    const nestJSInterceptor = createNestJSInterceptor({
      ...options,
      cacheManager: this,
    });

    const dispatcher = function (this: any, arg1: any, arg2?: any, arg3?: any) {
      // Detect when instantiated via 'new' (e.g. by NestJS @UseInterceptors decorator)
      if (new.target) {
        return nestJSInterceptor as any;
      }

      // 1. Detect NestJS Interceptor context: intercept(context, next)
      if (arg1 && typeof arg1.switchToHttp === 'function' && arg2 && typeof arg2.handle === 'function') {
        return nestJSInterceptor.intercept(arg1, arg2);
      }

      // 2. Detect Fastify plugin registration: fastify.register(plugin) -> plugin(fastify, opts, next)
      if (arg1 && typeof arg1.addHook === 'function') {
        const p = fastifyPlugin(arg1);
        if (typeof arg3 === 'function') {
          p.then(() => arg3()).catch((err) => arg3(err));
        }
        return p;
      }

      // 3. Detect Fastify route-level hook: preHandler -> hook(request, reply, next)
      if (arg2 && typeof arg2.header === 'function' && typeof arg2.setHeader === 'undefined') {
        const p = fastifyHook(arg1, arg2);
        if (typeof arg3 === 'function') {
          p.then(() => {
            if (!arg2._cacheSent) {
              arg3();
            }
          }).catch((err) => arg3(err));
          return;
        }
        return p;
      }

      // 4. Detect Hono Middleware context: (c, next)
      if (arg1 && typeof arg1.req === 'object' && typeof arg1.json === 'function' && typeof arg2 === 'function' && typeof arg3 === 'undefined') {
        return honoMiddleware(arg1, arg2);
      }

      // 5. Detect Koa Middleware context: (ctx, next)
      if (arg1 && typeof arg1.state === 'object' && typeof arg1.request === 'object' && typeof arg2 === 'function' && typeof arg3 === 'undefined') {
        return koaMiddleware(arg1, arg2);
      }

      // 6. Default to Express middleware: app.use(middleware) -> middleware(req, res, next)
      return expressMiddleware(arg1, arg2, arg3);
    };

    (dispatcher as any)[Symbol.for('skip-override')] = true;
    (dispatcher as any)._isCacheMiddleware = true;
    return dispatcher;
  }

  /**
   * Retrieve the active provider depending on health status.
   */
  private getProvider(): CacheProvider {
    if (this.useFallback && this.fallback) {
      return this.fallback;
    }
    return this.primary;
  }

  /**
   * Run a provider command with automatic error handling and fallback switching.
   */
  private async executeCommand<T>(
    cmd: (provider: CacheProvider) => Promise<T>,
    fallbackVal: T
  ): Promise<T> {
    const provider = this.getProvider();
    try {
      return await cmd(provider);
    } catch (err: any) {
      this.logger?.error?.(`Cache command failed on provider: ${err.message}`);

      // If we failed on primary and have a fallback, switch to fallback and try once more
      if (provider === this.primary && this.fallback) {
        this.logger?.info?.('Attempting failover command execution on memory fallback.');
        this.useFallback = true;
        try {
          return await cmd(this.fallback);
        } catch (fallbackErr: any) {
          this.logger?.error?.(`Fallback provider also failed: ${fallbackErr.message}`);
        }
      }
      return fallbackVal;
    }
  }

  /**
   * Store a value in cache, serialization handled.
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const serialized = JSON.stringify(value);
    const ttlSeconds = ttl ?? this.defaultTtl;
    await this.executeCommand(p => p.set(key, serialized, ttlSeconds), undefined);
  }

  /**
   * Retrieve a value from cache, deserialization handled.
   */
  async get<T>(key: string): Promise<T | null> {
    const data = await this.executeCommand(p => p.get(key), null);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

  /**
   * Delete cache entry.
   */
  async delete(key: string): Promise<void> {
    await this.executeCommand(p => p.delete(key), undefined);
  }

  /**
   * Transparent wrapper: serves cached data, or fetches from callback on miss.
   * Leverages request coalescing (single-flight).
   */
  async remember<T>(
    key: string,
    ttlOrOptions: number | RememberOptions,
    callback: () => Promise<T>
  ): Promise<T> {
    const options: RememberOptions =
      typeof ttlOrOptions === 'number' ? { ttl: ttlOrOptions } : (ttlOrOptions ?? {});
    const ttl = options.ttl ?? this.defaultTtl;
    const tags = options.tags ?? [];

    // 1. Check Cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      this.logger?.info?.(`Cache HIT for key: ${key}`);
      return cached;
    }

    this.logger?.info?.(`Cache MISS for key: ${key}`);

    // 2. Coalescing (Single Flight)
    if (this.singleFlightEnabled) {
      if (this.activePromises.has(key)) {
        this.logger?.info?.(`Coalescing request for key: ${key}`);
        return this.activePromises.get(key)!;
      }

      const promise = (async () => {
        try {
          const result = await callback();
          await this.set(key, result, ttl);
          if (tags.length > 0) {
            await this.trackTags(key, tags);
          }
          return result;
        } finally {
          this.activePromises.delete(key);
        }
      })();

      this.activePromises.set(key, promise);
      return promise;
    }

    // Coalescing disabled fallback
    const result = await callback();
    await this.set(key, result, ttl);
    if (tags.length > 0) {
      await this.trackTags(key, tags);
    }
    return result;
  }

  /**
   * Associate keys with tags.
   */
  public async trackTags(key: string, tags: string[]): Promise<void> {
    for (const tag of tags) {
      const tagKey = `tag:${tag}`;
      await this.executeCommand(async (provider) => {
        await provider.addToSet(tagKey, key);
      }, undefined);
    }
  }

  /**
   * Invalidate cache by direct key.
   */
  async invalidate(key: string): Promise<void> {
    await this.delete(key);
  }

  /**
   * Invalidate cache by route path (essentially same as matching keys).
   */
  async invalidateRoute(route: string): Promise<void> {
    // Find all keys matching this route path prefix (e.g. *route*)
    await this.invalidatePattern(`*${route}*`);
  }

  /**
   * Invalidate cache by glob pattern.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    await this.executeCommand(async (provider) => {
      const keys = await provider.keys(pattern);
      if (keys.length > 0) {
        for (const k of keys) {
          await provider.delete(k);
        }
      }
    }, undefined);
  }

  /**
   * Invalidate all keys matching a specific tag.
   */
  async invalidateTag(tag: string): Promise<void> {
    const tagKey = `tag:${tag}`;
    await this.executeCommand(async (provider) => {
      const keys = await provider.getSet(tagKey);
      if (keys && keys.length > 0) {
        for (const key of keys) {
          await provider.delete(key);
        }
      }
      await provider.delete(tagKey);
    }, undefined);
  }

  /**
   * Clear all cache.
   */
  async clear(): Promise<void> {
    await this.executeCommand(p => p.clear(), undefined);
  }
}
