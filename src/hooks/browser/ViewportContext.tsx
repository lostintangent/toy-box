import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { useHydrated } from "@tanstack/react-router";

const MOBILE_BREAKPOINT = 768;
const MOBILE_QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`;

type ViewportContextValue = {
  hydrated: boolean;
  isMobile: boolean;
  isDesktop: boolean;
};

const ViewportContext = createContext<ViewportContextValue | null>(null);

export function ViewportProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const isMobile = useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => undefined;

      const mql = window.matchMedia(MOBILE_QUERY);
      const handler = () => onStoreChange();
      mql.addEventListener("change", handler);

      return () => {
        mql.removeEventListener("change", handler);
      };
    },
    () => (typeof window === "undefined" ? false : window.matchMedia(MOBILE_QUERY).matches),
    () => false,
  );

  const value = useMemo(
    () => ({
      hydrated,
      isMobile,
      isDesktop: !isMobile,
    }),
    [hydrated, isMobile],
  );

  return <ViewportContext.Provider value={value}>{children}</ViewportContext.Provider>;
}

export function useViewport() {
  const context = useContext(ViewportContext);
  if (!context) {
    throw new Error("useViewport must be used within a ViewportProvider.");
  }
  return context;
}
