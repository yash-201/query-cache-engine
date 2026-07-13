import { generateCacheKey, KeyGeneratorOptions } from '../utils/keyGenerator';
import type { CacheManager } from '../cache/CacheManager';

export interface HonoCacheOptions {
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
  tags?: string[] | ((c: any) => string[]);

  /**
   * Key generation options (e.g. tracking specific custom headers).
   */
  keyOptions?: KeyGeneratorOptions;

  /**
   * HTTP methods allowed for caching. Defaults to ['GET'].
   */
  methods?: string[];
}

export function createHonoMiddleware(options: HonoCacheOptions) {
  const { cacheManager, ttl, tags, keyOptions, methods = ['GET'] } = options;
  const allowedMethods = methods.map((m) => m.toUpperCase());

  return async (c: any, next: () => Promise<any>) => {
    if (!allowedMethods.includes(c.req.method)) {
      return next();
    }

    // Map Hono request context structure to cache key generator format
    const key = generateCacheKey(
      {
        method: c.req.method,
        originalUrl: c.req.path,
        query: c.req.query(),
        params: c.req.param(),
        body: c.req.body,
        headers: c.req.header(),
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
        const headers = new Headers();
        if (cached.headers) {
          for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            if (headerValue !== undefined && headerName.toLowerCase() !== 'x-cache') {
              headers.set(headerName, String(headerValue));
            }
          }
        }
        headers.set('X-Cache', 'HIT');

        const bodyStr = typeof cached.body === 'string' ? cached.body : JSON.stringify(cached.body);
        return new Response(bodyStr, {
          status: cached.statusCode,
          headers,
        });
      }
    } catch {
      // Proceed on cache read errors
    }

    c.header('X-Cache', 'MISS');

    // Run downstream request handlers
    await next();

    // Capture response and write to cache on successful GET/POST requests
    const isSuccessful = c.res.status >= 200 && c.res.status < 300;
    if (isSuccessful) {
      try {
        // Clone the response to avoid consuming the original stream
        const resClone = c.res.clone();
        let body: any;
        const contentType = resClone.headers.get('content-type') ?? '';

        if (contentType.includes('application/json')) {
          body = await resClone.json();
        } else {
          body = await resClone.text();
        }

        const headers: Record<string, string> = {};
        resClone.headers.forEach((v: string, k: string) => {
          headers[k] = v;
        });

        const responseToCache = {
          body,
          headers,
          statusCode: c.res.status,
        };

        const resolvedTags = typeof tags === 'function' ? tags(c) : (tags ?? []);

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


