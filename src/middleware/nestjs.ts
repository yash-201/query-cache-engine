import { generateCacheKey, KeyGeneratorOptions } from '../utils/keyGenerator';
import type { CacheManager } from '../cache/CacheManager';
import { Observable, of } from 'rxjs';
import { tap } from 'rxjs/operators';

function setResponseHeader(res: any, name: string, value: any): void {
  if (typeof res.setHeader === 'function') {
    res.setHeader(name, value);
  } else if (typeof res.header === 'function') {
    res.header(name, value);
  } else if (typeof res.set === 'function') {
    res.set(name, value);
  }
}

function setResponseStatus(res: any, code: number): void {
  if (typeof res.status === 'function') {
    res.status(code);
  } else if (typeof res.code === 'function') {
    res.code(code);
  } else if (typeof res.statusCode === 'number') {
    res.statusCode = code;
  }
}

function getResponseHeaders(res: any): Record<string, any> {
  if (typeof res.getHeaders === 'function') {
    return res.getHeaders();
  } else if (res.headers && typeof res.headers === 'object') {
    return res.headers;
  } else if (typeof res.get === 'function') {
    // If it's express, res.getHeaders() is standard, but fallback to single lookups or empty if not supported
    return {};
  }
  return {};
}

export interface NestJSCacheOptions {
  /**
   * The active CacheManager instance.
   */
  cacheManager: CacheManager;

  /**
   * Time-to-live for the cached response (in seconds).
   */
  ttl?: number;

  /**
   * List of tags associated with the cache entry, or a function generating them from the request context.
   */
  tags?: string[] | ((context: any) => string[]);

  /**
   * Key generation options (e.g. tracking specific custom headers).
   */
  keyOptions?: KeyGeneratorOptions;

  /**
   * HTTP methods allowed for caching. Defaults to ['GET'].
   */
  methods?: string[];
}

export function createNestJSInterceptor(options: NestJSCacheOptions) {
  const { cacheManager, ttl, tags, keyOptions, methods = ['GET'] } = options;
  const allowedMethods = methods.map((m) => m.toUpperCase());

  return {
    intercept(context: any, next: any): Observable<any> | Promise<Observable<any>> {
      const httpCtx = context.switchToHttp();
      const req = httpCtx.getRequest();
      const res = httpCtx.getResponse();

      if (!allowedMethods.includes(req.method)) {
        return next.handle();
      }

      // Map NestJS HTTP context to cache key structure
      const key = generateCacheKey(
        {
          method: req.method,
          originalUrl: req.originalUrl || req.url,
          query: req.query || {},
          params: req.params || {},
          body: req.body || {},
          headers: req.headers || {},
        },
        keyOptions
      );

      const execute = async (): Promise<Observable<any>> => {
        try {
          const cached = await cacheManager.get<{
            body: any;
            headers: Record<string, string>;
            statusCode: number;
          }>(key);

          if (cached !== null) {
            // Cache HIT!
            setResponseHeader(res, 'X-Cache', 'HIT');
            setResponseStatus(res, cached.statusCode);

            if (cached.headers) {
              for (const [headerName, headerValue] of Object.entries(cached.headers)) {
                if (headerValue !== undefined && headerName.toLowerCase() !== 'x-cache') {
                  setResponseHeader(res, headerName, headerValue);
                }
              }
            }

            return of(cached.body);
          }
        } catch {
          // Proceed on cache read errors
        }

        setResponseHeader(res, 'X-Cache', 'MISS');

        return next.handle().pipe(
          tap(async (data: any) => {
            try {
              const responseToCache = {
                body: data,
                headers: getResponseHeaders(res),
                statusCode: res.statusCode || 200,
              };

              const resolvedTags = typeof tags === 'function' ? tags(context) : (tags ?? []);

              await cacheManager.set(key, responseToCache, ttl);
              if (resolvedTags.length > 0) {
                await cacheManager.trackTags(key, resolvedTags);
              }
            } catch {
              // Suppress background errors
            }
          })
        );
      };

      return execute();
    },
  };
}

// Prototype Extension to avoid circular dependency loops
declare module '../cache/CacheManager' {
  interface CacheManager {
    /**
     * Creates a caching middleware/plugin compatible with NestJS.
     */
    middleware(options?: Omit<NestJSCacheOptions, 'cacheManager'>): any;
  }
}
