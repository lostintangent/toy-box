import { useSyncExternalStore, type RefObject } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

export type RequestPlacement = "above" | "below";

/** The pending request's message and the transcript row that holds it. */
type PendingRequest = { sequence: number; index: number };
type Span = { top: number; bottom: number };

// The pills cover this much of each edge, so a request showing only beneath one is still out of view.
const PILL_ZONE = 56;
// Landing leaves the request's header just below the top fade.
const LANDING_INSET = 32;

/**
 * Where a request lies outside the viewport, or undefined while any part of it shows inside the
 * viewport, inset by the pill zone. Spans are in scroll-content pixels.
 */
export function requestPlacement(request: Span, viewport: Span): RequestPlacement | undefined {
  if (request.bottom <= viewport.top + PILL_ZONE) return "above";
  if (request.top >= viewport.bottom - PILL_ZONE) return "below";
  return undefined;
}

/** Tracks where the pending request lies as the transcript scrolls, resizes, or changes. */
export function useRequestPlacement(
  scrollRef: RefObject<HTMLDivElement | null>,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  request: PendingRequest | undefined,
): RequestPlacement | undefined {
  return useSyncExternalStore(
    (onChange) => {
      const root = scrollRef.current;
      if (!root) return () => {};
      const observer = new ResizeObserver(onChange);
      observer.observe(root);
      root.addEventListener("scroll", onChange, { passive: true });
      return () => {
        observer.disconnect();
        root.removeEventListener("scroll", onChange);
      };
    },
    () => {
      const root = scrollRef.current;
      if (!root || !request) return undefined;
      const span = requestSpan(root, virtualizer, request);
      const viewport = { top: root.scrollTop, bottom: root.scrollTop + root.clientHeight };
      return span && requestPlacement(span, viewport);
    },
    () => undefined,
  );
}

/** Smoothly scrolls the request's message to the top, first bringing in its row if it's virtualized away. */
export function scrollToRequest(
  root: HTMLElement,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  request: PendingRequest,
) {
  const element = requestElement(root, request.sequence);
  if (element) {
    virtualizer.scrollToOffset(contentSpan(root, element).top - LANDING_INSET, {
      behavior: "smooth",
    });
  } else {
    virtualizer.scrollToIndex(request.index, { align: "start", behavior: "smooth" });
  }
}

/** The request's message while it's mounted, or else its row's virtual measurement. */
function requestSpan(
  root: HTMLElement,
  virtualizer: Virtualizer<HTMLDivElement, Element>,
  { sequence, index }: PendingRequest,
): Span | undefined {
  const element = requestElement(root, sequence);
  if (element) return contentSpan(root, element);
  const row = virtualizer.measurementsCache[index];
  return row && { top: row.start, bottom: row.end };
}

function requestElement(root: HTMLElement, sequence: number) {
  return root.querySelector(`[data-request-sequence="${sequence}"]`);
}

function contentSpan(root: HTMLElement, element: Element): Span {
  const offset = root.scrollTop - root.getBoundingClientRect().top;
  const { top, bottom } = element.getBoundingClientRect();
  return { top: top + offset, bottom: bottom + offset };
}
