import { describe, it, expect } from 'vitest';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';

describe('Next.js / Generic Handler Middleware', () => {
  it('should cache and serve standard Web API Responses with mutable headers', async () => {
    const cacheManager = new CacheManager({ provider: new MemoryProvider() });
    let handlerExecutions = 0;

    const nextHandler = cacheManager.middleware({ ttl: 10 }, async (req) => {
      handlerExecutions++;
      const headers = new Headers();
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ count: handlerExecutions }), {
        status: 200,
        headers,
      });
    });

    const mockRequest = {
      method: 'GET',
      url: '/api/test',
      headers: new Headers(),
    };

    // 1st Call: Cache MISS
    const res1 = await nextHandler(mockRequest);
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const body1 = await res1.json() as { count: number };
    expect(body1.count).toBe(1);

    // Wait for the background cache set to finish
    await new Promise((r) => setTimeout(r, 20));

    // 2nd Call: Cache HIT
    const res2 = await nextHandler(mockRequest);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = await res2.json() as { count: number };
    expect(body2.count).toBe(1);
    expect(handlerExecutions).toBe(1);
  });

  it('should handle immutable response headers gracefully by cloning the Response', async () => {
    const cacheManager = new CacheManager({ provider: new MemoryProvider() });
    let handlerExecutions = 0;

    const nextHandler = cacheManager.middleware({ ttl: 10 }, async (req) => {
      handlerExecutions++;
      const res = Response.json({ count: handlerExecutions });
      // Force immutable headers simulation by overriding set to throw error
      Object.defineProperty(res.headers, 'set', {
        value: () => {
          throw new TypeError('Headers are read-only');
        },
        configurable: true,
      });
      return res;
    });

    const mockRequest = {
      method: 'GET',
      url: '/api/immutable',
      headers: new Headers(),
    };

    // 1st Call: Cache MISS, should clone/recreate and successfully attach X-Cache header
    const res1 = await nextHandler(mockRequest);
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const body1 = await res1.json() as { count: number };
    expect(body1.count).toBe(1);

    // Wait for background cache write
    await new Promise((r) => setTimeout(r, 20));

    // 2nd Call: Cache HIT
    const res2 = await nextHandler(mockRequest);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = await res2.json() as { count: number };
    expect(body2.count).toBe(1);
    expect(handlerExecutions).toBe(1);
  });
});
