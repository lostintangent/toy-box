import { useSyncExternalStore } from "react";

/** Subscribes to one media query with an explicit server-rendered fallback. */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => undefined;

      const media = window.matchMedia(query);
      media.addEventListener("change", onStoreChange);
      return () => media.removeEventListener("change", onStoreChange);
    },
    () => (typeof window === "undefined" ? serverFallback : window.matchMedia(query).matches),
    () => serverFallback,
  );
}
