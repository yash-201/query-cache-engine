import { Request, Response, NextFunction } from 'express';
import type { CacheManager } from '../cache/CacheManager';
import { generateCacheKey, KeyGeneratorOptions } from '../utils/keyGenerator';

export interface ExpressCacheOptions {
  /**
   * The active CacheManager instance.
   */
  cacheManager: CacheManager;

  /**
   * Time-to-live for the cached response (in seconds).
   * Overrides CacheManager's defaultTtl.
   */
  ttl?: number;

  /**
   * List of tags associated with the cache entry, or a function generating them from the request.
   */
  tags?: string[] | ((req: Request) => string[]);

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

export function createExpressMiddleware(options: ExpressCacheOptions) {
  const {
    cacheManager,
    ttl,
    tags,
    keyOptions,
    methods = ['GET'],
    cacheErrorResponses = false,
  } = options;

  const allowedMethods = methods.map((m) => m.toUpperCase());

  return async (req: Request, res: Response, next: NextFunction) => {
    // Only cache configured HTTP methods
    if (!allowedMethods.includes(req.method)) {
      return next();
    }

    const key = generateCacheKey(req, keyOptions);
    try {
      // Try to fetch from cache
      const cached = await cacheManager.get<{
        body: any;
        headers: Record<string, string | string[] | undefined>;
        statusCode: number;
      }>(key);

      if (cached !== null) {
        // Cache HIT!
        res.setHeader('X-Cache', 'HIT');
        res.status(cached.statusCode);

        // Restore cached headers
        if (cached.headers) {
          for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            if (headerValue !== undefined && headerName.toLowerCase() !== 'x-cache') {
              res.setHeader(headerName, headerValue);
            }
          }
        }

        // Send cached body and end the request
        return res.send(cached.body);
      }
    } catch {
      // If primary cache fails, fallback handles it silently. We proceed.
    }

    // Cache MISS
    res.setHeader('X-Cache', 'MISS');

    // Capture standard response send and json methods
    const originalSend = res.send;
    const originalJson = res.json;

    // Resolve tags if it is a function of the request
    const resolvedTags = typeof tags === 'function' ? tags(req) : (tags ?? []);

    let cachePromise: Promise<void> | null = null;

    // Custom send interceptor
    res.send = function (body: any): Response {
      // Restore original send method to prevent recursion
      res.send = originalSend;
      res.json = originalJson;

      // Invoke the original send immediately for minimal latency
      const result = originalSend.call(this, body);

      const isSuccessful = res.statusCode >= 200 && res.statusCode < 300;
      if (isSuccessful || cacheErrorResponses) {
        let cleanBody = body;
        if (typeof body === 'string') {
          try {
            cleanBody = JSON.parse(body);
          } catch {
            // Not a JSON string, cache raw string
          }
        }

        const responseToCache = {
          body: cleanBody,
          headers: res.getHeaders(),
          statusCode: res.statusCode,
        };

        // Cache asynchronously in the background
        cachePromise = (async () => {
          try {
            await cacheManager.set(key, responseToCache, ttl);
            if (resolvedTags.length > 0) {
              await cacheManager.trackTags(key, resolvedTags);
            }
          } catch {
            // Suppress background errors
          }
        })();
      }

      return result;
    };

    // Custom json interceptor
    res.json = function (obj: any): Response {
      // Set correct content-type header
      res.setHeader('Content-Type', 'application/json; charset=utf-8');

      const body = JSON.stringify(obj);
      return res.send(body);
    };

    // Store reference to promise on response object for testing purposes
    (res as any)._cachePromise = () => cachePromise;

    next();
  };
}
export type ExpressCacheMiddleware = ReturnType<typeof createExpressMiddleware>;
