import { generateCacheKey, KeyGeneratorOptions } from '../utils/keyGenerator';
import type { CacheManager } from '../cache/CacheManager';

export interface KoaCacheOptions {
  /**
   * The active CacheManager instance.
   */
  cacheManager: CacheManager;

  /**
   * Time-to-live for the cached response (in seconds).
   */
  ttl?: number;

  /**
   * List of tags associated with the cache entry, or a function generating them from the request.
   */
  tags?: string[] | ((ctx: any) => string[]);

  /**
   * Key generation options (e.g. tracking specific custom headers).
   */
  keyOptions?: KeyGeneratorOptions;

  /**
   * HTTP methods allowed for caching. Defaults to ['GET'].
   */
  methods?: string[];
}

export function createKoaMiddleware(options: KoaCacheOptions) {
  const { cacheManager, ttl, tags, keyOptions, methods = ['GET'] } = options;
  const allowedMethods = methods.map((m) => m.toUpperCase());

  return async (ctx: any, next: () => Promise<any>) => {
    if (!allowedMethods.includes(ctx.method)) {
      return next();
    }

    // Map Koa context to key generator structure
    const key = generateCacheKey(
      {
        method: ctx.method,
        originalUrl: ctx.url,
        query: ctx.query,
        params: ctx.params || {},
        body: ctx.request ? ctx.request.body : {},
        headers: ctx.headers,
      },
      keyOptions
    );

    try {
      const cached = await cacheManager.get<{
        body: any;
        headers: Record<string, string>;
        statusCode: number;
      }>(key);

      if (cached !== null) {
        // Cache HIT!
        ctx.set('X-Cache', 'HIT');
        ctx.status = cached.statusCode;

        if (cached.headers) {
          for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            if (headerValue !== undefined && headerName.toLowerCase() !== 'x-cache') {
              ctx.set(headerName, headerValue);
            }
          }
        }

        ctx.body = cached.body;
        return;
      }
    } catch {
      // Proceed on cache read errors
    }

    ctx.set('X-Cache', 'MISS');

    // Proceed downstream
    await next();

    // Cache the response on successful downstream execution
    const isSuccessful = ctx.status >= 200 && ctx.status < 300;
    if (isSuccessful && ctx.body !== undefined) {
      try {
        const responseToCache = {
          body: ctx.body,
          headers: ctx.response ? ctx.response.headers : {},
          statusCode: ctx.status,
        };

        const resolvedTags = typeof tags === 'function' ? tags(ctx) : (tags ?? []);

        // Cache in the background
        cacheManager.set(key, responseToCache, ttl).then(() => {
          if (resolvedTags.length > 0) {
            return cacheManager.trackTags(key, resolvedTags);
          }
        }).catch(() => {});
      } catch {
        // Suppress background errors
      }
    }
  };
}

// Prototype Extension to avoid circular dependency loops
declare module '../cache/CacheManager' {
  interface CacheManager {
    /**
     * Creates a caching middleware/plugin compatible with Koa.
     */
    middleware(options?: Omit<KoaCacheOptions, 'cacheManager'>): any;
  }
}
