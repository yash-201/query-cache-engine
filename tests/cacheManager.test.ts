import { describe, it, expect } from 'vitest';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';

describe('CacheManager', () => {
  it('should store and retrieve serialized payloads', async () => {
    const memory = new MemoryProvider();
    const manager = new CacheManager({ provider: memory });

    const key = 'test-key';
    const payload = { data: 'hello', numbers: [1, 2, 3] };

    await manager.set(key, payload);
    const retrieved = await manager.get<typeof payload>(key);
    expect(retrieved).toEqual(payload);
  });

  it('should support coalescing concurrent callback requests (Single-Flight)', async () => {
    const memory = new MemoryProvider();
    const manager = new CacheManager({ provider: memory, enableSingleFlight: true });

    const key = 'stampede-key';
    let callCount = 0;

    const dbQueryCallback = async () => {
      callCount++;
      // Simulate database lookup latency
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { executionId: callCount, value: 'data_from_db' };
    };

    // Trigger multiple concurrent requests for the same key
    const [res1, res2, res3] = await Promise.all([
      manager.remember(key, 10, dbQueryCallback),
      manager.remember(key, 10, dbQueryCallback),
      manager.remember(key, 10, dbQueryCallback),
    ]);

    // All results must be identical and from the FIRST execution
    expect(res1).toEqual({ executionId: 1, value: 'data_from_db' });
    expect(res2).toEqual({ executionId: 1, value: 'data_from_db' });
    expect(res3).toEqual({ executionId: 1, value: 'data_from_db' });

    // The callback must only run once
    expect(callCount).toBe(1);
  });

  it('should support tag-based cache invalidation', async () => {
    const memory = new MemoryProvider();
    const manager = new CacheManager({ provider: memory });

    await manager.remember('k1', { tags: ['users'] }, async () => 'user-1');
    await manager.remember('k2', { tags: ['users', 'dashboard'] }, async () => 'user-2');
    await manager.remember('k3', { tags: ['dashboard'] }, async () => 'user-3');

    // Verify stored
    expect(await manager.get('k1')).toBe('user-1');
    expect(await manager.get('k2')).toBe('user-2');
    expect(await manager.get('k3')).toBe('user-3');

    // Invalidate users
    await manager.invalidateTag('users');

    expect(await manager.get('k1')).toBeNull();
    expect(await manager.get('k2')).toBeNull();
    // Dashboard key should not be invalidated if it wasn't marked with tag 'users'
    expect(await manager.get('k3')).toBe('user-3');
  });
});
