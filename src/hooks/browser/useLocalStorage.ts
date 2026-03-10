import { useState, useCallback, useEffect, useRef } from "react";

/**
 * A hook that syncs state with localStorage.
 *
 * For strings, just use directly - no options needed:
 *   const [name, setName] = useLocalStorage("key", "default");
 *
 * For other types, provide a deserialize function to parse the stored string:
 *   const [size, setSize] = useLocalStorage("key", 15, (v) => parseFloat(v));
 */
export function useLocalStorage<T extends string>(
  key: string,
  defaultValue: T,
): [T, (value: T) => void];
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  deserialize: (value: string) => T | undefined,
): [T, (value: T) => void];
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  deserialize?: (value: string) => T | undefined,
): [T, (value: T) => void] {
  // Helper to read from localStorage
  const readValue = useCallback((): T => {
    try {
      const stored = localStorage.getItem(key);
      if (stored !== null) {
        if (deserialize) {
          const parsed = deserialize(stored);
          if (parsed !== undefined) return parsed;
        } else {
          return stored as T;
        }
      }
    } catch {
      // Ignore errors (SSR, etc.)
    }
    return defaultValue;
  }, [key, defaultValue, deserialize]);

  // Always start with defaultValue to match SSR and avoid hydration mismatch
  const [value, setValue] = useState<T>(defaultValue);
  const hasHydratedRef = useRef(false);

  // Sync from localStorage after hydration
  useEffect(() => {
    setValue(readValue());
    hasHydratedRef.current = true;
  }, [readValue]);

  // Update both state and localStorage
  const setStoredValue = useCallback(
    (newValue: T) => {
      setValue(newValue);
      if (!hasHydratedRef.current) return;
      try {
        localStorage.setItem(key, String(newValue));
      } catch {
        // Ignore errors (quota exceeded, etc.)
      }
    },
    [key],
  );

  return [value, setStoredValue];
}
