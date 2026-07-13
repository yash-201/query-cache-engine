import Redis, { RedisOptions } from 'ioredis';
import { CacheProvider } from './CacheProvider';

export class RedisProvider implements CacheProvider {
  private client: Redis;

  constructor(options: RedisOptions = {}) {
    this.client = new Redis(options);
  }

  /**
   * Helper to get the underlying ioredis client.
   */
  getClient(): Redis {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async clear(): Promise<void> {
    const prefix = this.client.options.keyPrefix || '';
    if (prefix) {
      const keys = await this.keys('*');
      if (keys.length > 0) {
        // Strip the prefix before passing to del() as ioredis will prepend it again.
        const keysWithoutPrefix = keys.map((k) =>
          k.startsWith(prefix) ? k.slice(prefix.length) : k
        );
        await this.client.del(...keysWithoutPrefix);
      }
    } else {
      await this.client.flushdb();
    }
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.client.exists(key);
    return res === 1;
  }

  async keys(pattern: string): Promise<string[]> {
    // ioredis keys() pattern searches within the prefix automatically.
    // However, the keys returned will contain the prefix.
    return this.client.keys(pattern);
  }

  async disconnect(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit();
    }
  }

  async addToSet(key: string, value: string): Promise<void> {
    await this.client.sadd(key, value);
  }

  async getSet(key: string): Promise<string[]> {
    return this.client.smembers(key);
  }
}
