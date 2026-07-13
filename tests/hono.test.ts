import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';

describe('Hono Caching Middleware', () => {
  let cacheManager: CacheManager;
  let app: Hono;
  let jsonCalls = 0;
  let htmlCalls = 0;

  beforeAll(() => {
    cacheManager = new CacheManager({ provider: new MemoryProvider() });
    app = new Hono();

    app.get(
      '/json',
      cacheManager.middleware({ ttl: 10, tags: ['hono-tag'] }),
      (c) => {
        jsonCalls++;
        return c.json({ count: jsonCalls });
      }
    );

    app.get(
      '/html',
      cacheManager.middleware({ ttl: 10 }),
      (c) => {
        htmlCalls++;
        return c.html(`<html><body>count:${htmlCalls}</body></html>`);
      }
    );
  });

  it('should cache and serve JSON responses correctly', async () => {
    // 1st request
    const res1 = await app.request('/json');
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    expect(res1.headers.get('content-type')).toContain('application/json');
    const body1 = await res1.json();
    expect(body1.count).toBe(1);

    // Wait a brief moment to write to memory cache in the background
    await new Promise((r) => setTimeout(r, 20));

    // 2nd request
    const res2 = await app.request('/json');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    expect(res2.headers.get('content-type')).toContain('application/json');
    const body2 = await res2.json();
    expect(body2.count).toBe(1);
  });

  it('should cache and serve HTML responses without JSON corrupting them', async () => {
    // 1st request
    const res1 = await app.request('/html');
    expect(res1.status).toBe(200);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    expect(res1.headers.get('content-type')).toContain('text/html');
    const text1 = await res1.text();
    expect(text1).toBe('<html><body>count:1</body></html>');

    // Wait a brief moment
    await new Promise((r) => setTimeout(r, 20));

    // 2nd request
    const res2 = await app.request('/html');
    expect(res2.status).toBe(200);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    expect(res2.headers.get('content-type')).toContain('text/html');
    const text2 = await res2.text();
    expect(text2).toBe('<html><body>count:1</body></html>');
  });

  it('should support tag invalidation', async () => {
    // We already have a cached JSON response. Let's invalidate tag: hono-tag
    await cacheManager.invalidateTag('hono-tag');

    // 3rd request should MISS
    const res = await app.request('/json');
    expect(res.headers.get('x-cache')).toBe('MISS');
    const body = await res.json();
    expect(body.count).toBe(2);
  });
});
