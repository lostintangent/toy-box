import { useEffect, type ReactNode } from "react";
import { createStoreContext, useCreateStore, useSelector, type Store } from "@tanstack/react-store";
import {
  serializeWorkspaceLayout,
  type WorkspaceLayout,
} from "@workspace/model/config/layoutPrefs";

const { StoreProvider, useStoreContext: useLayoutStore } =
  createStoreContext<Store<WorkspaceLayout>>();

/**
 * Holds the workspace's layout preferences in one store, seeded from the layout cookie and written
 * back to it on every change. Each mount creates its own store, so server requests never share one.
 */
export function LayoutPrefsProvider({
  initialLayout,
  children,
}: {
  initialLayout: WorkspaceLayout;
  children: ReactNode;
}) {
  const layout = useCreateStore(initialLayout);
  useEffect(() => {
    // Writing on mount as well as on change keeps the cookie's expiry sliding with each visit.
    document.cookie = serializeWorkspaceLayout(layout.state);
    const { unsubscribe } = layout.subscribe((state) => {
      document.cookie = serializeWorkspaceLayout(state);
    });
    return unsubscribe;
  }, [layout]);

  return <StoreProvider value={layout}>{children}</StoreProvider>;
}

/** One layout preference and its setter. Its caller re-renders only when that preference changes. */
export function useLayoutPref<K extends keyof WorkspaceLayout>(key: K) {
  const layout = useLayoutStore();
  const setLayoutPrefs = useSetLayoutPrefs();
  const value = useSelector(layout, (state) => state[key]);
  return [value, (next: WorkspaceLayout[K]) => setLayoutPrefs({ [key]: next })] as const;
}

/** Sets layout preferences without subscribing to any. */
export function useSetLayoutPrefs() {
  const layout = useLayoutStore();
  return (prefs: Partial<WorkspaceLayout>) => layout.setState((state) => ({ ...state, ...prefs }));
}
