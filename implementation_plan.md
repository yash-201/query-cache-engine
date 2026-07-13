# Implementation Plan - Transparent Redis Caching Package

We will build **`query-cache-engine`**, a framework-agnostic transparent response and function caching package for Node.js. It features automatic stable key generation, request coalescing (single-flight), Express middleware interception, and fallback memory caching.

---

## User Review Required

> [!IMPORTANT]
> **Key Decisions in Plan**:
> 1. **Project Scope**: Single npm package structure with folder-based modular architecture (faster build, test, publish lifecycle) instead of a monorepo setup, unless explicitly required.
> 2. **Express Middleware Mechanism**: Overriding `res.send` and `res.json` to capture response payloads transparently.
> 3. **Request Coalescing (Single Flight)**: Implementation of an active-promise map in the `CacheManager` to deduplicate concurrent requests for the same cache key.
> 4. **Redis Failover (Memory fallback)**: Automatically fallback to an in-memory TTL map if Redis goes offline.

---

## Open Questions

> [!NOTE]
> *No immediate blockers, but the user can specify if a monorepo structure is preferred for future additions (like NestJS/Fastify plugins).*

---

## Proposed Changes

We will establish a TypeScript package structure in `d:\query-cache-engine`.

### Project Setup and Infrastructure

#### [NEW] [package.json](file:///d:/query-cache-engine/package.json)
Initialize npm package with dependencies:
- Production dependencies: `ioredis`
- Development dependencies: `typescript`, `tsup`, `vitest`, `@types/node`, `@types/express`, `express` (for testing/examples).

#### [NEW] [tsconfig.json](file:///d:/query-cache-engine/tsconfig.json)
Configure TypeScript compiler settings targetting Node 18+ and ES2022.

#### [NEW] [tsup.config.ts](file:///d:/query-cache-engine/tsup.config.ts)
Configure `tsup` for bundling commonjs, esm format, and generating declaration types (`.d.ts`).

---

### Core Module

#### [NEW] [CacheProvider.ts](file:///d:/query-cache-engine/src/cache/CacheProvider.ts)
Define the base interface for cache backends (get, set, delete, clear, exists, keys).

#### [NEW] [RedisProvider.ts](file:///d:/query-cache-engine/src/cache/RedisProvider.ts)
Implement `CacheProvider` using `ioredis`. Includes:
- Prefix support (namespace).
- Automatic JSON serialization.
- TTL support.
- Silent error handling (for fallback logic).

#### [NEW] [MemoryProvider.ts](file:///d:/query-cache-engine/src/cache/MemoryProvider.ts)
Implement `CacheProvider` using an in-memory Map with automatic entry expiration (TTL) acting as a failover/fallback provider.

#### [NEW] [CacheManager.ts](file:///d:/query-cache-engine/src/cache/CacheManager.ts)
Coordinate providers and present the public API:
- `remember(key, ttl, callback, options)`: Serves cached value or executes the callback, caching the result.
- **Request Coalescing (Single Flight)**: Ensures multiple concurrent calls for the same key execute the callback *once*.
- **Failover Handling**: Graces connection drops by switching to `MemoryProvider`.
- Manual invalidation methods (`invalidate`, `invalidatePattern`, `clear`).

---

### Utilities and Key Generation

#### [NEW] [stableStringify.ts](file:///d:/query-cache-engine/src/utils/stableStringify.ts)
Deterministic JSON stringifier that recursively sorts object keys to ensure identical objects yield the exact same string (e.g. `{a:1, b:2}` vs `{b:2, a:1}`).

#### [NEW] [hash.ts](file:///d:/query-cache-engine/src/utils/hash.ts)
SHA-256 hash generator using Node's native `crypto` module.

#### [NEW] [keyGenerator.ts](file:///d:/query-cache-engine/src/utils/keyGenerator.ts)
Constructs cache keys from route requests by sorting and hashing:
- Request method
- Route URL
- Query parameters
- Route parameters
- Body (if present)
- Selected headers (e.g. `tenant-id`)

---

### Integrations and Middleware

#### [NEW] [express.ts](file:///d:/query-cache-engine/src/middleware/express.ts)
Express middleware builder:
- intercepts `res.send`, `res.json`, and `res.end` to capture output buffer/payload.
- Checks CacheManager for hitting existing cache.
- Auto-caches response payload with custom TTL and Tags.
- Exposes route-level overrides.

#### [NEW] [index.ts](file:///d:/query-cache-engine/src/index.ts)
Main library entrypoint exporting `CacheManager`, `RedisProvider`, `MemoryProvider`, the Express middleware, and utilities.

---

### Verification and Examples

#### [NEW] [server.ts](file:///d:/query-cache-engine/examples/express/server.ts)
An example Express application demonstrating:
- Setting up cache middleware.
- Caching standard database query returns.
- Custom invalidation endpoints.

#### [NEW] [keyGenerator.test.ts](file:///d:/query-cache-engine/tests/keyGenerator.test.ts)
Unit test verifying stable stringify and deterministic key hashing.

#### [NEW] [cacheManager.test.ts](file:///d:/query-cache-engine/tests/cacheManager.test.ts)
Unit test checking `remember()`, request coalescing, TTL, and cache invalidation.

#### [NEW] [express.test.ts](file:///d:/query-cache-engine/tests/express.test.ts)
Integration test spawning an Express server and verifying transparent response interception.

---

## Verification Plan

### Automated Tests
- Run `npx vitest run` to verify key generator, cache manager, request coalescing, and Express middleware.

### Manual Verification
- Start the example server (`ts-node examples/express/server.ts`) and trigger curl requests. Confirm that subsequent identical requests respond instantly and hitting Redis prints logs/stats indicating cache hit.
