import { CacheManager } from "../../src/cache/CacheManager";

// Initialize CacheManager with simplified Redis configuration (Memory fallback is automatically enabled)
export const cacheManager = new CacheManager({
    redis: {
        host: '127.0.0.1',
        port: 6379,
        maxRetriesPerRequest: 1, // Fail fast to show fallback behavior if Redis is offline
        retryStrategy(times) {
            // Retry connecting every 5 seconds, stop after 3 attempts
            if (times > 3) {
                return null; // Stop reconnect attempts
            }
            return 5000;
        },
    },
    defaultTtl: 60, // 60 seconds
    logger: {
        info: (msg) => console.log(`[Cache INFO] ${msg}`),
        error: (msg) => console.error(`[Cache ERROR] ${msg}`),
    },
});