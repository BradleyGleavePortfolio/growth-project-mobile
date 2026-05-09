import { useEffect, useState } from 'react';

/**
 * useDebouncedValue
 *
 * Returns a value that lags behind `value` by `delayMs`. Used by the
 * cross-pillar `<UniversalClientSearch />` to coalesce rapid typing
 * into a single backend hit (default 200ms).
 *
 * No external dependency — most expo apps already pull lodash for
 * other reasons, but a four-line `setTimeout` is the right size of
 * primitive for what this does and avoids fattening the search-screen
 * bundle.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value);
      return undefined;
    }
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
