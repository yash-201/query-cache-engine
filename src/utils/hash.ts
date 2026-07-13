import { createHash } from 'crypto';

/**
 * Computes the SHA-256 hash of a string input and returns it in hexadecimal format.
 */
export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
