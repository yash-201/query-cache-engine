import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';
import { Server } from 'http';

describe('Express Caching Middleware', () => {
  let app: express.Express;
  let server: Server;
  let port: number;
  let cacheManager: CacheManager;
  let handlerExecutions = 0;
  let postExecutions = 0;

  beforeAll(async () => {
    cacheManager = new CacheManager({ provider: new MemoryProvider() });
    app = express();
    app.use(express.json());
    handlerExecutions = 0;
    postExecutions = 0;

    app.get(
      '/test-route',
      cacheManager.middleware({
        ttl: 10,
        tags: ['route-tag'],
      }),
      (req, res) => {
        handlerExecutions++;
        res.json({ executionCount: handlerExecutions, query: req.query });
      }
    );

    app.post(
      '/post-route',
      cacheManager.middleware({
        ttl: 10,
        methods: ['POST'],
      }),
      (req, res) => {
        postExecutions++;
        res.json({ executionCount: postExecutions, body: req.body });
      }
    );

    // Bind to any available port dynamically
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          port = addr.port;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  it('should capture, cache, and serve Express responses', async () => {
    // 1st request: Cache MISS
    const res1 = await fetch(`http://localhost:${port}/test-route?a=1`);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    expect(res1.headers.get('content-type')).toContain('application/json');
    const body1 = (await res1.json()) as { executionCount: number };
    expect(body1.executionCount).toBe(1);

    // Sleep briefly to ensure async background caching finishes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 2nd request: Cache HIT (same query parameters)
    const res2 = await fetch(`http://localhost:${port}/test-route?a=1`);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = (await res2.json()) as { executionCount: number };
    expect(body2.executionCount).toBe(1); // Cached value

    // 3rd request: Cache MISS (different query parameters)
    const res3 = await fetch(`http://localhost:${port}/test-route?a=2`);
    expect(res3.headers.get('x-cache')).toBe('MISS');
    const body3 = (await res3.json()) as { executionCount: number };
    expect(body3.executionCount).toBe(2);

    expect(handlerExecutions).toBe(2);
  });

  it('should invalidate middleware responses via tags', async () => {
    // Ensure cache is hot for ?a=1
    const resCache = await fetch(`http://localhost:${port}/test-route?a=1`);
    expect(resCache.headers.get('x-cache')).toBe('HIT');

    // Invalidate the tag
    await cacheManager.invalidateTag('route-tag');

    // Next request should miss
    const resMiss = await fetch(`http://localhost:${port}/test-route?a=1`);
    expect(resMiss.headers.get('x-cache')).toBe('MISS');
  });

  it('should support caching POST requests when configured', async () => {
    const payload = { filter: 'value1' };

    // 1st request: Cache MISS
    const res1 = await fetch(`http://localhost:${port}/post-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const body1 = (await res1.json()) as { executionCount: number };
    expect(body1.executionCount).toBe(1);

    // Sleep briefly to ensure async background caching finishes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 2nd request: Cache HIT (same body payload)
    const res2 = await fetch(`http://localhost:${port}/post-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = (await res2.json()) as { executionCount: number };
    expect(body2.executionCount).toBe(1); // Cached value

    // 3rd request: Cache MISS (different body payload)
    const res3 = await fetch(`http://localhost:${port}/post-route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter: 'value2' }),
    });
    expect(res3.headers.get('x-cache')).toBe('MISS');
    const body3 = (await res3.json()) as { executionCount: number };
    expect(body3.executionCount).toBe(2);

    expect(postExecutions).toBe(2);
  });

  it('should auto-override global middleware when route-specific cache middleware is present', async () => {
    const localCacheManager = new CacheManager({ provider: new MemoryProvider() });
    const localApp = express();
    let localExecs = 0;
    
    // Global middleware
    localApp.use(localCacheManager.middleware({
      ttl: 50,
      tags: ['global-tag'],
    }));
    
    // Route-specific middleware with specific header key option and different tag
    localApp.get(
      '/override-route',
      localCacheManager.middleware({
        ttl: 60,
        tags: ['route-tag'],
        keyOptions: {
          headers: ['x-tenant']
        }
      }),
      (req, res) => {
        localExecs++;
        res.json({ count: localExecs });
      }
    );

    let localServer: Server;
    let localPort = 0;
    await new Promise<void>((resolve) => {
      localServer = localApp.listen(0, () => {
        const addr = localServer.address();
        if (addr && typeof addr === 'object') {
          localPort = addr.port;
        }
        resolve();
      });
    });

    try {
      // 1. Initial request with x-tenant: A
      const res1 = await fetch(`http://localhost:${localPort}/override-route`, {
        headers: { 'x-tenant': 'A' }
      });
      expect(res1.headers.get('x-cache')).toBe('MISS');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 2. Request with same route but x-tenant: B (should MISS because route-level caching hashes x-tenant)
      const res2 = await fetch(`http://localhost:${localPort}/override-route`, {
        headers: { 'x-tenant': 'B' }
      });
      expect(res2.headers.get('x-cache')).toBe('MISS');
      await new Promise((resolve) => setTimeout(resolve, 50));

      // 3. Request with x-tenant: A again (should HIT)
      const res3 = await fetch(`http://localhost:${localPort}/override-route`, {
        headers: { 'x-tenant': 'A' }
      });
      expect(res3.headers.get('x-cache')).toBe('HIT');
      
      // 4. Invalidate only route-tag
      await localCacheManager.invalidateTag('route-tag');
      
      // 5. Request with x-tenant: A again (should MISS since we invalidated its tag)
      const res4 = await fetch(`http://localhost:${localPort}/override-route`, {
        headers: { 'x-tenant': 'A' }
      });
      expect(res4.headers.get('x-cache')).toBe('MISS');

    } finally {
      await new Promise<void>((resolve) => localServer.close(() => resolve()));
    }
  });
});
