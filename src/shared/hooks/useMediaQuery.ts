import { useSyncExternalStore } from "react";

type MediaQueryStore = {
  getSnapshot: () => boolean;
  subscribe: (onStoreChange: () => void) => () => void;
};

const stores = new Map<string, MediaQueryStore>();

function getMediaQueryStore(query: string): MediaQueryStore {
  const existing = stores.get(query);
  if (existing) return existing;

  let media: MediaQueryList | undefined;
  const subscribers = new Set<() => void>();
  const getMedia = () => (media ??= window.matchMedia(query));
  const notifySubscribers = () => {
    for (const subscriber of subscribers) subscriber();
  };

  const store: MediaQueryStore = {
    getSnapshot: () => getMedia().matches,
    subscribe: (onStoreChange) => {
      subscribers.add(onStoreChange);
      if (subscribers.size === 1) getMedia().addEventListener("change", notifySubscribers);

      return () => {
        subscribers.delete(onStoreChange);
        if (subscribers.size === 0) media?.removeEventListener("change", notifySubscribers);
      };
    },
  };
  stores.set(query, store);
  return store;
}

/** Subscribes to one media query with an explicit server-rendered fallback. */
export function useMediaQuery(query: string, serverFallback = false): boolean {
  const store = getMediaQueryStore(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, () => serverFallback);
}
