import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Koa from 'koa';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';
import { Server } from 'http';

describe('Koa Caching Middleware', () => {
  let app: Koa;
  let server: Server;
  let port: number;
  let cacheManager: CacheManager;
  let count = 0;

  beforeAll(async () => {
    cacheManager = new CacheManager({ provider: new MemoryProvider() });
    app = new Koa();
    count = 0;

    app.use(cacheManager.middleware({
      ttl: 10,
      tags: ['koa-tag'],
    }));

    app.use(async (ctx) => {
      if (ctx.path === '/test') {
        count++;
        ctx.status = 200;
        ctx.body = { count };
      }
    });

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
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should cache and serve responses in Koa', async () => {
    // 1st request
    const res1 = await fetch(`http://localhost:${port}/test`);
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const body1 = await res1.json() as { count: number };
    expect(body1.count).toBe(1);

    // Wait a brief moment to write to memory cache in the background
    await new Promise((r) => setTimeout(r, 20));

    // 2nd request
    const res2 = await fetch(`http://localhost:${port}/test`);
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = await res2.json() as { count: number };
    expect(body2.count).toBe(1);
  });

  it('should support tag invalidation in Koa', async () => {
    await cacheManager.invalidateTag('koa-tag');

    const res = await fetch(`http://localhost:${port}/test`);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const body = await res.json() as { count: number };
    expect(body.count).toBe(2);
  });
});
