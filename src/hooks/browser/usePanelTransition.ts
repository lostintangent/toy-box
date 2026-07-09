import { useEffect, useState } from "react";
import { getPanelElement } from "react-resizable-panels";

/**
 * Tracks the panel's actual flex transition rather than inferring animation
 * state from the React state that initiated it.
 */
export function usePanelTransition(panelId: string): boolean {
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    const element = getPanelElement(panelId);
    if (!element) return;

    const isPanelFlexTransition = (event: TransitionEvent) =>
      event.target === element && event.propertyName === "flex-grow";
    const handleTransitionStart = (event: TransitionEvent) => {
      if (isPanelFlexTransition(event)) setIsAnimating(true);
    };
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (isPanelFlexTransition(event)) setIsAnimating(false);
    };

    element.addEventListener("transitionrun", handleTransitionStart);
    element.addEventListener("transitionend", handleTransitionEnd);
    element.addEventListener("transitioncancel", handleTransitionEnd);
    return () => {
      element.removeEventListener("transitionrun", handleTransitionStart);
      element.removeEventListener("transitionend", handleTransitionEnd);
      element.removeEventListener("transitioncancel", handleTransitionEnd);
    };
  }, [panelId]);

  return isAnimating;
}
