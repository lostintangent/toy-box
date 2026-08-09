import { useState, useEffect } from "react";

/**
 * Hook that tracks page visibility state.
 *
 * Uses the Page Visibility API to detect when the page becomes hidden
 * (user switches tabs, backgrounds the app, locks screen) or visible again.
 *
 * This is the canonical way to handle mobile app backgrounding - more reliable
 * than beforeunload/pagehide which are designed for page navigation.
 *
 * @returns true when page is visible, false when hidden
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document !== "undefined" ? document.visibilityState === "visible" : true,
  );

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  return isVisible;
}
