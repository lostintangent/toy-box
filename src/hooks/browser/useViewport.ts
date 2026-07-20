import { useHydrated } from "@tanstack/react-router";
import { useMediaQuery } from "./useMediaQuery";

const MOBILE_QUERY = "(max-width: 767px)";

export function useViewport() {
  const hydrated = useHydrated();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  return { hydrated, isMobile, isDesktop: !isMobile };
}
