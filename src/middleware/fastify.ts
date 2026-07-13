import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { CacheManager } from '../cache/CacheManager';
import { generateCacheKey, KeyGeneratorOptions } from '../utils/keyGenerator';

export interface FastifyCacheOptions {
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
  tags?: string[] | ((req: FastifyRequest) => string[]);

  /**
   * Key generation options (e.g. tracking specific custom headers).
   */
  keyOptions?: KeyGeneratorOptions;

  /**
   * HTTP methods allowed for caching. Defaults to ['GET'].
   */
  methods?: string[];
}

export function createFastifyHook(options: FastifyCacheOptions) {
  const { cacheManager, ttl, tags, keyOptions, methods = ['GET'] } = options;
  const allowedMethods = methods.map((m) => m.toUpperCase());

  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!allowedMethods.includes(request.method)) {
      return;
    }

    // Map Fastify request structure to cache key generator format
    const key = generateCacheKey(
      {
        method: request.method,
        originalUrl: request.url,
        query: request.query,
        params: request.params,
        body: request.body,
        headers: request.headers,
      },
      keyOptions
    );

    try {
      const cached = await cacheManager.get<{
        body: any;
        headers: Record<string, string | string[] | undefined>;
        statusCode: number;
      }>(key);

      if (cached !== null) {
        // Cache HIT!
        reply.header('X-Cache', 'HIT');
        reply.status(cached.statusCode);

        // Restore headers
        if (cached.headers) {
          for (const [headerName, headerValue] of Object.entries(cached.headers)) {
            if (headerValue !== undefined && headerName.toLowerCase() !== 'x-cache') {
              reply.header(headerName, headerValue);
            }
          }
        }

        // Send and finalize reply
        (reply as any)._cacheSent = true;
        return reply.send(cached.body);
      }
    } catch {
      // Proceed on cache read errors
    }

    reply.header('X-Cache', 'MISS');

    // Intercept reply.send to capture response on miss
    const originalSend = reply.send;
    reply.send = function (payload: any) {
      reply.send = originalSend;

      const isSuccessful = reply.statusCode >= 200 && reply.statusCode < 300;
      if (isSuccessful) {
        try {
          let cleanBody = payload;
          if (typeof payload === 'string') {
            try {
              cleanBody = JSON.parse(payload);
            } catch {
              // Plain text or pre-serialized response, keep as is
            }
          }

          const responseToCache = {
            body: cleanBody,
            headers: reply.getHeaders(),
            statusCode: reply.statusCode,
          };

          const resolvedTags = typeof tags === 'function' ? tags(request) : (tags ?? []);

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

      return originalSend.call(this, payload);
    };
  };
}

export function createFastifyPlugin(options: FastifyCacheOptions) {
  const hook = createFastifyHook(options);

  const plugin = async (fastify: FastifyInstance) => {
    fastify.addHook('preHandler', hook);
  };

  (plugin as any)[Symbol.for('skip-override')] = true;
  return plugin;
}



export type FastifyCachePlugin = ReturnType<typeof createFastifyPlugin>;
