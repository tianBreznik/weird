/**
 * Simple LRU-ish cache for DOM height measurements during a pagination run.
 * Cleared when the measure container is destroyed / geometry changes.
 */

const DEFAULT_MAX = 400;

export function createMeasureCache(maxEntries = DEFAULT_MAX) {
  const map = new Map();

  const makeKey = (parts) => parts.map((p) => (p == null ? '' : String(p))).join('\u0001');

  return {
    get(parts) {
      const key = makeKey(parts);
      if (!map.has(key)) return undefined;
      const value = map.get(key);
      // refresh insertion order
      map.delete(key);
      map.set(key, value);
      return value;
    },
    set(parts, value) {
      const key = makeKey(parts);
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      if (map.size > maxEntries) {
        const oldest = map.keys().next().value;
        map.delete(oldest);
      }
      return value;
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}
