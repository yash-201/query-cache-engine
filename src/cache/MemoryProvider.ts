import { CacheProvider } from './CacheProvider';

interface MemoryCacheEntry {
  value: string;
  expiresAt: number | null; // Timestamp in milliseconds, null for infinite
}

export class MemoryProvider implements CacheProvider {
  private cache = new Map<string, MemoryCacheEntry>();
  private sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    if (entry.expiresAt !== null && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.cache.delete(key);
    this.sets.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.sets.clear();
  }

  async exists(key: string): Promise<boolean> {
    const val = await this.get(key);
    return val !== null;
  }

  async keys(pattern: string): Promise<string[]> {
    // Convert Redis-style wildcard glob (e.g. "users:*") to RegExp
    const regexStr = '^' + pattern.replace(/[-[\]{}()+?.,\\^$|#\s]/g, '\\$&').replace(/\\\*/g, '.*') + '$';
    const regex = new RegExp(regexStr);
    const result: string[] = [];

    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt !== null && now > entry.expiresAt) {
        this.cache.delete(key);
        continue;
      }
      if (regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  async addToSet(key: string, value: string): Promise<void> {
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    this.sets.get(key)!.add(value);
  }

  async getSet(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }
}
