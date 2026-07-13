import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';

describe('Fastify Caching Middleware', () => {
  let app: FastifyInstance;
  let port: number;
  let cacheManager: CacheManager;
  let pluginExecutions = 0;
  let routeExecutions = 0;

  beforeAll(async () => {
    cacheManager = new CacheManager({ provider: new MemoryProvider() });
    app = Fastify({ logger: false });
    pluginExecutions = 0;
    routeExecutions = 0;

    // 1. Register caching plugin globally (Option A)
    app.register(
      cacheManager.middleware({
        ttl: 10,
        tags: ['plugin-tag'],
      })
    );

    app.get('/plugin-route', async (request, reply) => {
      pluginExecutions++;
      return { executionCount: pluginExecutions };
    });

    // 2. Register caching via route preHandler (Option B)
    app.get('/route-option-route', {
      preHandler: cacheManager.middleware({
        ttl: 10,
        tags: ['route-tag'],
      })
    }, async (request, reply) => {
      routeExecutions++;
      return { executionCount: routeExecutions };
    });

    await app.listen({ port: 0 });
    const address = app.server.address();
    if (address && typeof address === 'object') {
      port = address.port;
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('should support Option A (plugin-level) transparent caching', async () => {
    // 1st request: Cache MISS
    const res1 = await fetch(`http://localhost:${port}/plugin-route`);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const body1 = (await res1.json()) as { executionCount: number };
    expect(body1.executionCount).toBe(1);

    // Sleep briefly to ensure async background caching finishes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 2nd request: Cache HIT
    const res2 = await fetch(`http://localhost:${port}/plugin-route`);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = (await res2.json()) as { executionCount: number };
    expect(body2.executionCount).toBe(1);

    expect(pluginExecutions).toBe(1);
  });

  it('should support Option B (route-level preHandler) transparent caching', async () => {
    // 1st request: Cache MISS
    const res1 = await fetch(`http://localhost:${port}/route-option-route`);
    expect(res1.headers.get('x-cache')).toBe('MISS');
    const body1 = (await res1.json()) as { executionCount: number };
    expect(body1.executionCount).toBe(1);

    // Sleep briefly to ensure async background caching finishes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // 2nd request: Cache HIT
    const res2 = await fetch(`http://localhost:${port}/route-option-route`);
    expect(res2.headers.get('x-cache')).toBe('HIT');
    const body2 = (await res2.json()) as { executionCount: number };
    expect(body2.executionCount).toBe(1);

    expect(routeExecutions).toBe(1);
  });
});
