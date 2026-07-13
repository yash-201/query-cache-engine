/**
 * Deterministic JSON stringify.
 * Recursively sorts keys of objects so that the string representation is identical
 * regardless of the order of properties in the source object.
 */
export function stableStringify(val: any): string {
  if (val === null) {
    return 'null';
  }
  if (val === undefined) {
    return 'undefined';
  }

  // Handle Arrays
  if (Array.isArray(val)) {
    return '[' + val.map(stableStringify).join(',') + ']';
  }

  // Handle Dates
  if (val instanceof Date) {
    return JSON.stringify(val.toISOString());
  }

  // Handle RegExp
  if (val instanceof RegExp) {
    return JSON.stringify(val.toString());
  }

  // Handle Objects
  if (typeof val === 'object') {
    const keys = Object.keys(val).sort();
    const properties = keys.map(
      (key) => `${JSON.stringify(key)}:${stableStringify(val[key])}`
    );
    return '{' + properties.join(',') + '}';
  }

  // Handle primitives (strings, numbers, booleans)
  return JSON.stringify(val);
}
