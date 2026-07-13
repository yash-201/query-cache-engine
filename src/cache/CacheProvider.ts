export interface CacheProvider {
  /**
   * Retrieve a value from the cache by key.
   */
  get(key: string): Promise<string | null>;

  /**
   * Store a value in the cache with an optional TTL (in seconds).
   */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /**
   * Delete a key from the cache.
   */
  delete(key: string): Promise<void>;

  /**
   * Clear all keys in the cache (within namespace, if applicable).
   */
  clear(): Promise<void>;

  /**
   * Check if a key exists in the cache.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Find keys matching a specific pattern.
   */
  keys(pattern: string): Promise<string[]>;

  /**
   * Add a value to a set key.
   */
  addToSet(key: string, value: string): Promise<void>;

  /**
   * Retrieve all members of a set key.
   */
  getSet(key: string): Promise<string[]>;
}
