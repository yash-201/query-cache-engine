// Cache engine exports
export { CacheProvider } from './cache/CacheProvider';
export { RedisProvider } from './cache/RedisProvider';
export { MemoryProvider } from './cache/MemoryProvider';
export {
  CacheManager,
  CacheManagerOptions,
  RememberOptions,
  CacheMiddlewareOptions,
} from './cache/CacheManager';

// Key utilities exports
export {
  generateCacheKey,
  KeyGeneratorOptions,
} from './utils/keyGenerator';
export { stableStringify } from './utils/stableStringify';
export { sha256 } from './utils/hash';

// Express middleware integration exports
export {
  createExpressMiddleware,
  ExpressCacheOptions,
} from './middleware/express';

// Fastify plugin integration exports
export {
  createFastifyPlugin,
  FastifyCacheOptions,
} from './middleware/fastify';

// Hono integration exports
export {
  createHonoMiddleware,
  HonoCacheOptions,
} from './middleware/hono';

// Koa integration exports
export {
  createKoaMiddleware,
  KoaCacheOptions,
} from './middleware/koa';

// NestJS integration exports
export {
  createNestJSInterceptor,
  NestJSCacheOptions,
} from './middleware/nestjs';
