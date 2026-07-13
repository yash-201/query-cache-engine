import { stableStringify } from './stableStringify';
import { sha256 } from './hash';

export interface KeyGeneratorOptions {
  /**
   * Namespace prefix for the cache keys. Defaults to 'cache:'.
   */
  prefix?: string;

  /**
   * Request headers to include in the cache key generation (e.g. 'tenant-id', 'accept-language').
   * Custom headers are case-insensitive.
   */
  headers?: string[];
}

export function generateCacheKey(
  req: {
    method: string;
    originalUrl: string;
    query?: any;
    params?: any;
    body?: any;
    headers?: Record<string, any>;
  },
  options: KeyGeneratorOptions = {}
): string {
  const prefix = options.prefix ?? 'cache:';
  const headerKeys = options.headers ?? [];

  // Extract selected headers, matching case-insensitively
  const selectedHeaders: Record<string, string> = {};
  if (req.headers) {
    const lowerHeaders: Record<string, any> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) {
        lowerHeaders[k.toLowerCase()] = v;
      }
    }

    for (const key of headerKeys) {
      const lowerKey = key.toLowerCase();
      const val = lowerHeaders[lowerKey];
      if (val !== undefined) {
        selectedHeaders[lowerKey] = String(val);
      }
    }
  }

  // Separate path from query parameters to avoid duplicate query representation
  const urlPath = req.originalUrl.split('?')[0];

  // Construct normalized request payload
  const normalized = {
    method: req.method.toUpperCase(),
    url: urlPath,
    query: req.query ?? {},
    params: req.params ?? {},
    body: req.body ?? {},
    headers: selectedHeaders,
  };

  // Deterministic serialization and hashing
  const serialized = stableStringify(normalized);
  const hash = sha256(serialized);

  // Generate key: prefix + METHOD + clean_path + hash
  // Convert leading/trailing slashes and internal slashes of path to colons
  const pathSegment = urlPath
    .replace(/^\/|\/$/g, '') // remove leading/trailing slashes
    .replace(/\//g, ':');    // replace slashes with colons

  const pathPrefix = pathSegment ? `${pathSegment}:` : '';
  return `${prefix}${normalized.method}:${pathPrefix}${hash}`;
}
export type GenerateCacheKeyType = typeof generateCacheKey;
