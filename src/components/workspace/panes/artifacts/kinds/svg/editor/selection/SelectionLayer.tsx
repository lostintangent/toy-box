import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import type { SvgDocument } from "../../document";
import type { EditorStore, Point } from "../../store";
import {
  combineSelectionFrames,
  HANDLE_RADIUS,
  measureElementFrame,
  positionSelectionHandles,
} from "./frame";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Paints transient selection chrome and the marquee over the native SVG document. */
export function SelectionLayer({
  document,
  store,
  viewportRef,
}: {
  document: SvgDocument;
  store: EditorStore;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const overlayRef = useRef<SVGSVGElement>(null);
  const documentSnapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );
  const { readOnly, selection, viewport, marquee, transforming } = useSelector(
    store,
    (state) => ({
      readOnly: state.readOnly,
      selection: state.selection,
      viewport: state.viewport,
      marquee: state.gesture?.type === "marquee" ? state.gesture.rect : null,
      transforming: state.gesture?.type === "transform" || state.gesture?.type === "line-endpoint",
    }),
    { compare: shallow },
  );

  const paint = useEffectEvent(() => {
    const overlay = overlayRef.current;
    const viewportElement = viewportRef.current;
    if (!overlay || !viewportElement) return;
    renderSelectionFrame(overlay, selection, viewportElement.getBoundingClientRect(), !readOnly);
  });

  useLayoutEffect(() => {
    paint();
  }, [documentSnapshot, marquee, readOnly, selection, transforming, viewport]);

  useEffect(() => {
    if (!transforming) return;
    let frame = requestAnimationFrame(repaint);
    function repaint() {
      paint();
      frame = requestAnimationFrame(repaint);
    }
    return () => cancelAnimationFrame(frame);
  }, [transforming]);

  return (
    <>
      <svg
        ref={overlayRef}
        width={viewport.size.width}
        height={viewport.size.height}
        className="pointer-events-none absolute inset-0 z-[5]"
        aria-hidden="true"
      />

      {marquee && (
        <div
          style={{
            left: marquee.x,
            top: marquee.y,
            width: marquee.width,
            height: marquee.height,
          }}
          className="pointer-events-none absolute z-[6] border-2 border-accent bg-accent/20"
        />
      )}
    </>
  );
}

/** Paints member outlines and the shared manipulation frame into the transient overlay. */
export function renderSelectionFrame(
  overlay: SVGSVGElement,
  elements: readonly SVGGraphicsElement[],
  origin: Pick<DOMRect, "left" | "top">,
  interactive: boolean,
): void {
  overlay.replaceChildren();
  const memberFrames = elements.flatMap((element) => {
    const frame = measureElementFrame(element, origin);
    return frame ? [frame] : [];
  });
  for (const frame of memberFrames) appendOutline(overlay, frame.corners);

  const frame = combineSelectionFrames(memberFrames);
  if (!frame) return;
  if (memberFrames.length > 1) appendOutline(overlay, frame.corners);
  if (!interactive) return;

  const handles = positionSelectionHandles(frame);
  const rotateHandle = handles.find((positioned) => positioned.handle === "rotate");
  if (rotateHandle) {
    appendRotationGuide(overlay, midpoint(frame.corners[0], frame.corners[1]), rotateHandle.point);
  }
  for (const handle of handles) appendHandle(overlay, handle.point);
}

function appendOutline(
  overlay: SVGSVGElement,
  corners: readonly [Point, Point, Point, Point],
): void {
  const polygon = overlay.ownerDocument.createElementNS(SVG_NAMESPACE, "polygon");
  polygon.setAttribute("points", corners.map((point) => `${point.x},${point.y}`).join(" "));
  polygon.setAttribute("fill", "none");
  polygon.setAttribute("stroke", "var(--user-accent)");
  polygon.setAttribute("stroke-width", "2");
  polygon.setAttribute("stroke-dasharray", "4 3");
  overlay.appendChild(polygon);
}

function appendRotationGuide(overlay: SVGSVGElement, start: Point, end: Point): void {
  const line = overlay.ownerDocument.createElementNS(SVG_NAMESPACE, "line");
  line.setAttribute("x1", String(start.x));
  line.setAttribute("y1", String(start.y));
  line.setAttribute("x2", String(end.x));
  line.setAttribute("y2", String(end.y));
  line.setAttribute("stroke", "var(--user-accent)");
  line.setAttribute("stroke-width", "1.5");
  overlay.appendChild(line);
}

function appendHandle(overlay: SVGSVGElement, point: Point): void {
  const circle = overlay.ownerDocument.createElementNS(SVG_NAMESPACE, "circle");
  circle.setAttribute("cx", String(point.x));
  circle.setAttribute("cy", String(point.y));
  circle.setAttribute("r", String(HANDLE_RADIUS));
  circle.setAttribute("fill", "var(--background)");
  circle.setAttribute("stroke", "var(--user-accent)");
  circle.setAttribute("stroke-width", "1.5");
  overlay.appendChild(circle);
}

function midpoint(left: Point, right: Point): Point {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}
