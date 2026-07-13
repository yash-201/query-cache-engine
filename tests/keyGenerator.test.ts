import { describe, it, expect } from 'vitest';
import { stableStringify } from '../src/utils/stableStringify';
import { generateCacheKey } from '../src/utils/keyGenerator';

describe('stableStringify', () => {
  it('should recursively sort keys of objects', () => {
    const obj1 = { b: 2, a: 1, c: { y: 'nested', x: 10 } };
    const obj2 = { a: 1, b: 2, c: { x: 10, y: 'nested' } };
    expect(stableStringify(obj1)).toBe(stableStringify(obj2));
  });

  it('should format array elements stably', () => {
    const obj1 = [{ b: 1 }, { d: 2, c: 1 }];
    const obj2 = [{ b: 1 }, { c: 1, d: 2 }];
    expect(stableStringify(obj1)).toBe(stableStringify(obj2));
  });
});

describe('generateCacheKey', () => {
  it('should generate same key for identical query parameters in different orders', () => {
    const req1 = {
      method: 'GET',
      originalUrl: '/users?page=2&limit=10',
      query: { page: '2', limit: '10' },
    };
    const req2 = {
      method: 'get',
      originalUrl: '/users?limit=10&page=2',
      query: { limit: '10', page: '2' },
    };
    expect(generateCacheKey(req1)).toBe(generateCacheKey(req2));
  });

  it('should incorporate custom headers when configured', () => {
    const req1 = {
      method: 'GET',
      originalUrl: '/users',
      headers: { 'tenant-id': 'tenant_1', 'accept-language': 'en' },
    };
    const req2 = {
      method: 'GET',
      originalUrl: '/users',
      headers: { 'Tenant-Id': 'tenant_1', 'accept-language': 'es' },
    };
    
    // Only verify tenant-id
    const keyOpts = { headers: ['tenant-id'] };
    expect(generateCacheKey(req1, keyOpts)).toBe(generateCacheKey(req2, keyOpts));

    // Verify both tenant-id and accept-language (should differ)
    const keyOptsDiff = { headers: ['tenant-id', 'accept-language'] };
    expect(generateCacheKey(req1, keyOptsDiff)).not.toBe(generateCacheKey(req2, keyOptsDiff));
  });

  it('should extract and include custom request properties in key generation', () => {
    const req1 = {
      method: 'GET',
      originalUrl: '/logs',
      user: { id: 'user_123', role: 'admin' },
      session: { active: true },
    };
    const req2 = {
      method: 'GET',
      originalUrl: '/logs',
      user: { id: 'user_456', role: 'admin' },
      session: { active: true },
    };
    const req3 = {
      method: 'GET',
      originalUrl: '/logs',
      user: { id: 'user_123', role: 'user' }, // Different role
      session: { active: true },
    };

    // Cache keys should differ between different user IDs
    const keyOptsId = { customFields: ['user.id'] };
    expect(generateCacheKey(req1, keyOptsId)).not.toBe(generateCacheKey(req2, keyOptsId));

    // Cache keys should be identical if they share the same user.id even if user.role differs (since we only track user.id)
    expect(generateCacheKey(req1, keyOptsId)).toBe(generateCacheKey(req3, keyOptsId));

    // Cache keys should differ when tracking user.role
    const keyOptsRole = { customFields: ['user.id', 'user.role'] };
    expect(generateCacheKey(req1, keyOptsRole)).not.toBe(generateCacheKey(req3, keyOptsRole));
  });
});
