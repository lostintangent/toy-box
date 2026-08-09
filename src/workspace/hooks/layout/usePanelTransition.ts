import { useEffect, useState } from "react";
import { getPanelElement } from "react-resizable-panels";

/**
 * Tracks the panel's actual flex transition rather than inferring animation
 * state from the React state that initiated it, so a panel can stay mounted for
 * exactly as long as it is still animating. Transitions from descendants bubble
 * to the panel and are not its own.
 */
export function usePanelTransition(panelId: string): boolean {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const element = getPanelElement(panelId);
    if (!element) return;

    const isOwnTransition = (event: TransitionEvent) =>
      event.target === element && event.propertyName === "flex-grow";
    const handleStart = (event: TransitionEvent) => {
      if (isOwnTransition(event)) setIsAnimating(true);
    };
    const handleEnd = (event: TransitionEvent) => {
      if (isOwnTransition(event)) setIsAnimating(false);
    };

    element.addEventListener("transitionrun", handleStart);
    element.addEventListener("transitionend", handleEnd);
    element.addEventListener("transitioncancel", handleEnd);
    return () => {
      element.removeEventListener("transitionrun", handleStart);
      element.removeEventListener("transitionend", handleEnd);
      element.removeEventListener("transitioncancel", handleEnd);
    };
  }, [panelId]);

  return isAnimating;
}
