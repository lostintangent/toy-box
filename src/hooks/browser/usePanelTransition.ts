import { useState, useEffect, useRef } from "react";
import { getPanelElement } from "react-resizable-panels";

/**
 * Tracks whether a resizable panel is mid-transition by listening for
 * `transitionend` on its DOM element. Returns `true` from the moment
 * `open` changes until the panel's `flex-grow` transition completes.
 *
 * Skips the initial render since no transition occurs when the panel
 * first mounts at its default size.
 */
export function usePanelTransition(panelId: string, open: boolean): boolean {
  const [isAnimating, setIsAnimating] = useState(false);
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const el = getPanelElement(panelId);
    if (!el) return;

    setIsAnimating(true);

    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName === "flex-grow") {
        setIsAnimating(false);
      }
    };

    el.addEventListener("transitionend", onEnd);
    return () => el.removeEventListener("transitionend", onEnd);
  }, [panelId, open]);

  return isAnimating;
}
