import express from 'express';
import { cacheManager } from './queryEngine';

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(cacheManager.middleware({
  ttl: 50, // cache for 50s
  tags: ['root'],
}))
// A route with 2-second simulated delay to demonstrate cache hit vs miss
app.get(
  '/api/users',
  cacheManager.middleware({
    ttl: 30, // cache for 30s
    tags: ['users'],
    keyOptions: {
      headers: ["tenant"]
    }
  }),
  async (req, res) => {
    console.log('[Server] Controller /api/users executing...');
    // Simulate database query latency
    await new Promise((resolve) => setTimeout(resolve, 2000));

    res.json({
      timestamp: new Date().toISOString(),
      data: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
  }
);

// Another route using query parameter sorting checks
app.get(
  '/api/search',
  cacheManager.middleware({
    ttl: 60,
    tags: ['search'],
  }),
  async (req, res) => {
    console.log('[Server] Controller /api/search executing...');
    res.json({
      query: req.query,
      timestamp: new Date().toISOString(),
      message: 'Sorted query parameters generate the same cache key!',
    });
  }
);

// Invalidation route to test purging specific tags
app.post('/api/invalidate/users', async (req, res) => {
  console.log('[Server] Invalidating "users" tag cache...');
  await cacheManager.invalidateTag('users');
  res.json({ success: true, message: 'Invalidated cache for tag "users"' });
});

// General clear route to flush everything
app.post('/api/clear', async (req, res) => {
  console.log('[Server] Clearing all cache entries...');
  await cacheManager.clear();
  res.json({ success: true, message: 'Cleared all cache entries' });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Example Express server running at http://localhost:${PORT}`);
  console.log(`- Test cached latency: http://localhost:${PORT}/api/users (2s delay on first request, instant on subsequent)`);
  console.log(`- Test query order: http://localhost:${PORT}/api/search?q=apple&category=fruit vs ?category=fruit&q=apple`);
  console.log(`- Invalidate user cache: POST to http://localhost:${PORT}/api/invalidate/users\n`);
});
