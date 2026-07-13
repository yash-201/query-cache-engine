import { describe, it, expect } from 'vitest';
import { createNestJSInterceptor } from '../src/middleware/nestjs';
import { CacheManager } from '../src/cache/CacheManager';
import { MemoryProvider } from '../src/cache/MemoryProvider';
import { of } from 'rxjs';

describe('NestJS Caching Interceptor', () => {
  it('should intercept NestJS calls, set headers, status codes, and cache responses', async () => {
    const cacheManager = new CacheManager({ provider: new MemoryProvider() });
    const interceptor = createNestJSInterceptor({
      cacheManager,
      ttl: 10,
      tags: ['nest-tag'],
    });

    let executionCount = 0;
    const mockRequest = {
      method: 'GET',
      url: '/nest-route',
      query: {},
      params: {},
      body: {},
      headers: {},
    };

    const headersMap = new Map<string, string>();
    const mockResponse = {
      statusCode: 200,
      setHeader(name: string, value: string) {
        headersMap.set(name.toLowerCase(), value);
      },
      getHeaders() {
        return Object.fromEntries(headersMap.entries());
      },
      status(code: number) {
        this.statusCode = code;
        return this;
      },
    };

    const mockContext = {
      switchToHttp() {
        return {
          getRequest() {
            return mockRequest;
          },
          getResponse() {
            return mockResponse;
          },
        };
      },
    };

    const mockCallHandler = {
      handle() {
        executionCount++;
        return of({ result: 'data', execution: executionCount });
      },
    };

    // 1st Interception: Cache MISS
    const obs1 = await interceptor.intercept(mockContext, mockCallHandler);
    let result1: any;
    obs1.subscribe((val) => {
      result1 = val;
    });

    expect(headersMap.get('x-cache')).toBe('MISS');
    expect(result1).toEqual({ result: 'data', execution: 1 });

    // Wait for the background cache set to finish
    await new Promise((r) => setTimeout(r, 20));

    // 2nd Interception: Cache HIT (handler should not execute again)
    const obs2 = await interceptor.intercept(mockContext, mockCallHandler);
    let result2: any;
    obs2.subscribe((val) => {
      result2 = val;
    });

    expect(headersMap.get('x-cache')).toBe('HIT');
    expect(result2).toEqual({ result: 'data', execution: 1 });
    expect(executionCount).toBe(1);
  });

  it('should work defensively when response object resembles Fastify (no setHeader)', async () => {
    const cacheManager = new CacheManager({ provider: new MemoryProvider() });
    const interceptor = createNestJSInterceptor({
      cacheManager,
      ttl: 10,
    });

    let executionCount = 0;
    const mockRequest = {
      method: 'GET',
      url: '/fastify-route',
      query: {},
      params: {},
      body: {},
      headers: {},
    };

    const headersMap = new Map<string, string>();
    // Simulating Fastify response structure in NestJS
    const mockResponse = {
      statusCode: 200,
      header(name: string, value: string) {
        headersMap.set(name.toLowerCase(), value);
        return this;
      },
      headers: {}, // fastify reply.headers or similar
      status(code: number) {
        this.statusCode = code;
        return this;
      },
    };

    const mockContext = {
      switchToHttp() {
        return {
          getRequest() {
            return mockRequest;
          },
          getResponse() {
            return mockResponse;
          },
        };
      },
    };

    const mockCallHandler = {
      handle() {
        executionCount++;
        return of({ fastify: true });
      },
    };

    // Should not throw, should set cache header and proceed
    const obs1 = await interceptor.intercept(mockContext, mockCallHandler);
    let result1: any;
    obs1.subscribe((val) => {
      result1 = val;
    });

    expect(headersMap.get('x-cache')).toBe('MISS');
    expect(result1).toEqual({ fastify: true });

    await new Promise((r) => setTimeout(r, 20));

    // Cache HIT
    const obs2 = await interceptor.intercept(mockContext, mockCallHandler);
    let result2: any;
    obs2.subscribe((val) => {
      result2 = val;
    });

    expect(headersMap.get('x-cache')).toBe('HIT');
    expect(result2).toEqual({ fastify: true });
    expect(executionCount).toBe(1);
  });
});
