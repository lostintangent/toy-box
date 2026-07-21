import type { ComponentPropsWithoutRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";

export type ScrollableFadeAxis = "horizontal" | "vertical";

type ScrollableFadeProps = ComponentPropsWithoutRef<"div"> & {
  axis?: ScrollableFadeAxis;
  asChild?: boolean;
};

type ScrollableMeasurements = Pick<
  HTMLElement,
  "clientHeight" | "clientWidth" | "scrollHeight" | "scrollLeft" | "scrollTop" | "scrollWidth"
>;

const SCROLL_END_TOLERANCE = 1;

export function ScrollableFade({
  axis = "horizontal",
  asChild = false,
  className,
  ...props
}: ScrollableFadeProps) {
  const Component = asChild ? Slot : "div";

  function ref(element: HTMLElement | null) {
    if (!element) return;
    return observeScrollableFade(element, axis);
  }

  return (
    <Component
      {...props}
      ref={ref}
      data-slot="scrollable-fade"
      data-scrollable-fade={axis}
      className={cn(
        "scrollable-fade",
        axis === "horizontal" ? "overflow-x-auto" : "overflow-y-auto",
        className,
      )}
    />
  );
}

function observeScrollableFade(element: HTMLElement, axis: ScrollableFadeAxis) {
  let animationFrame: number | null = null;
  let active = true;

  function scheduleUpdate() {
    if (animationFrame !== null) return;
    animationFrame = requestAnimationFrame(() => {
      animationFrame = null;
      updateScrollableFade(element, axis);
    });
  }

  element.addEventListener("scroll", scheduleUpdate, { passive: true });
  element.addEventListener("pointerenter", scheduleUpdate);
  element.addEventListener("load", scheduleUpdate, true);

  const resizeObserver =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(scheduleUpdate);
  resizeObserver?.observe(element);

  const mutationObserver =
    typeof MutationObserver === "undefined" ? null : new MutationObserver(scheduleUpdate);
  mutationObserver?.observe(element, {
    childList: true,
    characterData: true,
    subtree: true,
  });

  const fonts = document.fonts;
  fonts?.addEventListener("loadingdone", scheduleUpdate);

  updateScrollableFade(element, axis);
  void fonts?.ready.then(() => {
    if (active) scheduleUpdate();
  });

  return () => {
    active = false;

    element.removeEventListener("scroll", scheduleUpdate);
    element.removeEventListener("pointerenter", scheduleUpdate);
    element.removeEventListener("load", scheduleUpdate, true);
    fonts?.removeEventListener("loadingdone", scheduleUpdate);

    resizeObserver?.disconnect();
    mutationObserver?.disconnect();

    if (animationFrame !== null) cancelAnimationFrame(animationFrame);
  };
}

function updateScrollableFade(element: HTMLElement, axis: ScrollableFadeAxis) {
  const { start, end } = getScrollableFadeEdges(element, axis);
  element.toggleAttribute("data-scroll-fade-start", start);
  element.toggleAttribute("data-scroll-fade-end", end);
}

export function getScrollableFadeEdges(
  element: ScrollableMeasurements,
  axis: ScrollableFadeAxis = "horizontal",
) {
  const offset = axis === "horizontal" ? element.scrollLeft : element.scrollTop;
  const viewportSize = axis === "horizontal" ? element.clientWidth : element.clientHeight;
  const scrollSize = axis === "horizontal" ? element.scrollWidth : element.scrollHeight;

  return {
    start: offset > 0,
    end: offset + viewportSize < scrollSize - SCROLL_END_TOLERANCE,
  };
}
