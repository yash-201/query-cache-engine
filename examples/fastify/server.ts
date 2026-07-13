import Fastify from 'fastify';
import { CacheManager } from '../../src/cache/CacheManager';

const fastify = Fastify({ logger: false });
const PORT = 3001;

// Initialize the same CacheManager (failover is automatically handled)
const cacheManager = new CacheManager({
  redis: {
    host: '127.0.0.1',
    port: 6379,
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      if (times > 3) return null;
      return 5000;
    },
  },
  defaultTtl: 60,
  logger: {
    info: (msg) => console.log(`[Cache INFO] ${msg}`),
    error: (msg) => console.error(`[Cache ERROR] ${msg}`),
  },
});

// Register the caching plugin globally for all GET routes
fastify.register(cacheManager.middleware({
  ttl: 30, // cache for 30s
  tags: ['users'],
}));

// Fastify Route (no caching boilerplate needed inside the handler!)
fastify.post('/api/users',
  {
    preHandler: cacheManager.middleware({
      ttl: 10, // cache for 30s
      tags: ['users'],
      methods: ["POST"]
    })
  },
  async (request, reply) => {
    console.log('[Fastify] Handler /api/users executing...');
    // Simulate query latency
    await new Promise((resolve) => setTimeout(resolve, 2000));

    return reply.send({
      timestamp: new Date().toISOString(),
      users: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
  });

// Clear cache manually
fastify.post('/api/invalidate', async (request, reply) => {
  console.log('[Fastify] Invalidating tag "users"...');
  await cacheManager.invalidateTag('users');
  return reply.send({ success: true, message: 'Invalidated cache tag "users"' });
});

const start = async () => {
  try {
    await fastify.listen({ port: PORT });
    console.log(`\n🚀 Fastify example server running at http://localhost:${PORT}`);
    console.log(`- Test cached response: http://localhost:${PORT}/api/users (2s delay on first request, instant on subsequent)`);
    console.log(`- Invalidate cache: POST to http://localhost:${PORT}/api/invalidate\n`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();
