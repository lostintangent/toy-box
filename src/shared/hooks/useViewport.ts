import { useHydrated } from "@tanstack/react-router";
import { useMediaQuery } from "./useMediaQuery";

export const MOBILE_VIEWPORT_QUERY = "(max-width: 767px)";
export const DESKTOP_VIEWPORT_QUERY = "(min-width: 768px)";

export function useViewport() {
  const hydrated = useHydrated();
  const isMobile = useMediaQuery(MOBILE_VIEWPORT_QUERY);
  return { hydrated, isMobile };
}
