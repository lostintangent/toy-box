import type { Fill, Point, Rect, Size } from "../store";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export type CreatedSvgShape = {
  element: SVGGraphicsElement;
  definitions: readonly SVGElement[];
};

export type SvgEraserNodes = {
  mask: SVGMaskElement;
  maskedContent: SVGGElement;
  path: SVGPathElement;
};

type SvgDefinitionReference<T extends SVGElement> = {
  id: string;
  definition: T | null;
};

/** Applies the shaft style shared by detached line and arrow nodes. */
export function applySvgLineStyle(
  element: SVGElement,
  style: { color: string; width: number },
): void {
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", style.color);
  element.setAttribute("stroke-width", String(style.width));
  element.setAttribute("stroke-linecap", "butt");
  element.setAttribute("stroke-linejoin", "round");
}

/** Creates the open arrowhead used by native arrow nodes. */
export function createSvgArrowMarker(document: Document, id: string): SVGMarkerElement {
  const marker = document.createElementNS(SVG_NAMESPACE, "marker") as SVGMarkerElement;
  marker.setAttribute("id", id);
  marker.setAttribute("viewBox", "0 0 12 12");
  marker.setAttribute("refX", "12");
  marker.setAttribute("refY", "6");
  marker.setAttribute("markerWidth", "3");
  marker.setAttribute("markerHeight", "3");
  marker.setAttribute("markerUnits", "strokeWidth");
  marker.setAttribute("orient", "auto-start-reverse");
  marker.setAttribute("overflow", "visible");
  const head = document.createElementNS(SVG_NAMESPACE, "polyline");
  head.setAttribute("points", "1.189,0.793 12,6 1.189,11.207");
  head.setAttribute("fill", "none");
  head.setAttribute("stroke", "context-stroke");
  head.setAttribute("stroke-width", "2");
  head.setAttribute("stroke-linecap", "round");
  head.setAttribute("stroke-linejoin", "round");
  marker.appendChild(head);
  return marker;
}

export function createSvgPath(
  root: SVGSVGElement,
  points: readonly Point[],
  style: { color: string; width: number },
): SVGPathElement {
  const path = createSvgNode(root, "path") as SVGPathElement;
  path.setAttribute("id", createSvgNodeId("path"));
  path.setAttribute("d", pointsToPathData(points));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", style.color);
  path.setAttribute("stroke-width", String(style.width));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  return path;
}

export function createSvgText(
  root: SVGSVGElement,
  content: string,
  point: Point,
  style: { color: string; fontSize: number; fontFamily: string },
): SVGTextElement {
  const text = createSvgNode(root, "text") as SVGTextElement;
  text.setAttribute("id", createSvgNodeId("text"));
  text.setAttribute("x", formatNumber(point.x));
  text.setAttribute("y", formatNumber(point.y));
  text.setAttribute("fill", style.color);
  text.setAttribute("font-size", String(style.fontSize));
  text.setAttribute("font-family", style.fontFamily);
  text.setAttribute("dominant-baseline", "hanging");
  text.textContent = content;
  return text;
}

export function createSvgImage(
  root: SVGSVGElement,
  dataUrl: string,
  point: Point,
  size: Size,
): SVGImageElement {
  const image = createSvgNode(root, "image") as SVGImageElement;
  image.setAttribute("id", createSvgNodeId("image"));
  image.setAttribute("href", dataUrl);
  image.setAttribute("x", formatNumber(point.x - size.width / 2));
  image.setAttribute("y", formatNumber(point.y - size.height / 2));
  image.setAttribute("width", formatNumber(size.width));
  image.setAttribute("height", formatNumber(size.height));
  image.setAttribute("preserveAspectRatio", "xMidYMid meet");
  return image;
}

export function createSvgShape(
  root: SVGSVGElement,
  shapeType: "rectangle" | "ellipse" | "line" | "arrow",
  start: Point,
  end: Point,
  style: { color: string; width: number; fill?: Fill },
): CreatedSvgShape {
  if (shapeType === "line" || shapeType === "arrow") {
    const line = createSvgNode(root, "line") as SVGLineElement;
    line.setAttribute("id", createSvgNodeId(shapeType));
    applySvgLineStyle(line, style);
    updateSvgShape(line, shapeType, start, end);
    if (shapeType === "arrow") {
      const marker = resolveSvgArrowMarker(root);
      line.setAttribute("marker-end", `url(#${marker.id})`);
      return { element: line, definitions: marker.definition ? [marker.definition] : [] };
    }
    return { element: line, definitions: [] };
  }

  let fillValue = "none";
  let definitions: readonly SVGElement[] = [];
  if (style.fill?.style === "solid") {
    fillValue = style.fill.color;
  } else if (style.fill) {
    const pattern = resolveSvgFillPattern(root, style.fill.style, style.fill.color);
    fillValue = `url(#${pattern.id})`;
    definitions = pattern.definition ? [pattern.definition] : [];
  }

  if (shapeType === "rectangle") {
    const rectangle = createSvgNode(root, "rect") as SVGRectElement;
    applySvgShapeStyle(rectangle, shapeType, style);
    updateSvgShape(rectangle, shapeType, start, end);
    rectangle.setAttribute("fill", fillValue);
    return { element: rectangle, definitions };
  }

  const ellipse = createSvgNode(root, "ellipse") as SVGEllipseElement;
  applySvgShapeStyle(ellipse, shapeType, style);
  updateSvgShape(ellipse, shapeType, start, end);
  ellipse.setAttribute("fill", fillValue);
  return { element: ellipse, definitions };
}

/** Mutates one provisional shape using document-space pointer geometry. */
export function updateSvgShape(
  element: SVGGraphicsElement,
  shapeType: "rectangle" | "ellipse" | "line" | "arrow",
  start: Point,
  end: Point,
): void {
  if (shapeType === "line" || shapeType === "arrow") {
    element.setAttribute("x1", formatNumber(start.x));
    element.setAttribute("y1", formatNumber(start.y));
    element.setAttribute("x2", formatNumber(end.x));
    element.setAttribute("y2", formatNumber(end.y));
    return;
  }

  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);
  if (shapeType === "rectangle") {
    element.setAttribute("x", formatNumber(x));
    element.setAttribute("y", formatNumber(y));
    element.setAttribute("width", formatNumber(width));
    element.setAttribute("height", formatNumber(height));
    return;
  }

  element.setAttribute("cx", formatNumber(x + width / 2));
  element.setAttribute("cy", formatNumber(y + height / 2));
  element.setAttribute("rx", formatNumber(width / 2));
  element.setAttribute("ry", formatNumber(height / 2));
}

/** Creates a self-sizing native mask and content group for one eraser stroke. */
export function createSvgEraserNodes(
  root: SVGSVGElement,
  page: Rect,
  points: readonly Point[],
  strokeWidth: number,
): SvgEraserNodes {
  const maskId = uniqueDefinitionId(root, "toybox-eraser-mask");
  const mask = createSvgNode(root, "mask") as SVGMaskElement;
  mask.setAttribute("id", maskId);
  mask.setAttribute("data-toybox-eraser-mask", "");
  mask.setAttribute("maskUnits", "objectBoundingBox");
  mask.setAttribute("maskContentUnits", "userSpaceOnUse");
  mask.setAttribute("x", "-50%");
  mask.setAttribute("y", "-50%");
  mask.setAttribute("width", "200%");
  mask.setAttribute("height", "200%");

  const background = createSvgNode(root, "rect") as SVGRectElement;
  applySvgBounds(background, {
    x: page.x - page.width * 1_000,
    y: page.y - page.height * 1_000,
    width: page.width * 2_001,
    height: page.height * 2_001,
  });
  background.setAttribute("fill", "white");
  const path = createSvgNode(root, "path") as SVGPathElement;
  path.setAttribute("data-toybox-eraser-path", "");
  path.setAttribute("d", pointsToPathData(points));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "black");
  path.setAttribute("stroke-width", String(strokeWidth));
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  mask.appendChild(background);
  mask.appendChild(path);

  const maskedContent = createSvgNode(root, "g") as SVGGElement;
  const bounds = createSvgNode(root, "rect") as SVGRectElement;
  bounds.setAttribute("data-toybox-eraser-bounds", "");
  applySvgBounds(bounds, page);
  bounds.setAttribute("fill", "none");
  bounds.setAttribute("stroke", "none");
  bounds.setAttribute("pointer-events", "none");
  maskedContent.appendChild(bounds);
  maskedContent.setAttribute("data-toybox-eraser-layer", "");
  maskedContent.setAttribute("mask", `url(#${maskId})`);
  return { mask, maskedContent, path };
}

function applySvgBounds(element: SVGElement, bounds: Rect): void {
  element.setAttribute("x", formatNumber(bounds.x));
  element.setAttribute("y", formatNumber(bounds.y));
  element.setAttribute("width", formatNumber(bounds.width));
  element.setAttribute("height", formatNumber(bounds.height));
}

export function pointsToPathData(points: readonly Point[]): string {
  if (points.length === 0) return "";
  return points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${formatNumber(point.x)} ${formatNumber(point.y)}`,
    )
    .join(" ");
}

/** Resolves an existing fill pattern or creates one detached definition for the caller to attach. */
export function resolveSvgFillPattern(
  root: SVGSVGElement,
  patternName: Exclude<Fill["style"], "solid">,
  color: string,
): SvgDefinitionReference<SVGPatternElement> {
  const key = `${patternName}:${color}`;
  const existing = findOwnedDefinition(root, "pattern", key);
  if (existing) return { id: existing.getAttribute("id")!, definition: null };

  const pattern = createSvgNode(root, "pattern") as SVGPatternElement;
  const id = uniqueDefinitionId(
    root,
    `toybox-fill-${patternName}-${color.replace(/[^a-z\d]/giu, "")}`,
  );
  pattern.setAttribute("id", id);
  pattern.setAttribute("data-toybox-definition", key);
  pattern.setAttribute("patternUnits", "userSpaceOnUse");
  pattern.setAttribute("width", "8");
  pattern.setAttribute("height", "8");

  if (patternName === "dots") {
    const dot = createSvgNode(root, "circle");
    dot.setAttribute("cx", "4");
    dot.setAttribute("cy", "4");
    dot.setAttribute("r", "1.5");
    dot.setAttribute("fill", color);
    pattern.appendChild(dot);
  } else {
    const lines = createSvgNode(root, "path");
    lines.setAttribute(
      "d",
      patternName === "cross" ? "M0 4H8 M4 0V8" : "M-2 2L2-2 M0 8L8 0 M6 10L10 6",
    );
    lines.setAttribute("fill", "none");
    lines.setAttribute("stroke", color);
    lines.setAttribute("stroke-width", "1.5");
    pattern.appendChild(lines);
  }
  return { id, definition: pattern };
}

function resolveSvgArrowMarker(root: SVGSVGElement): SvgDefinitionReference<SVGMarkerElement> {
  const existing = findOwnedDefinition(root, "marker", "arrow");
  if (existing) return { id: existing.getAttribute("id")!, definition: null };
  const id = uniqueDefinitionId(root, "toybox-arrow");
  const marker = createSvgArrowMarker(root.ownerDocument, id);
  marker.setAttribute("data-toybox-definition", "arrow");
  return { id, definition: marker };
}

function applySvgShapeStyle(
  element: SVGGraphicsElement,
  shapeType: "rectangle" | "ellipse",
  style: { color: string; width: number },
): void {
  element.setAttribute("id", createSvgNodeId(shapeType));
  element.setAttribute("stroke", style.color);
  element.setAttribute("stroke-width", String(style.width));
  element.setAttribute("stroke-linecap", "round");
  element.setAttribute("stroke-linejoin", "round");
}

function createSvgNode(root: SVGSVGElement, name: string): SVGElement {
  return root.ownerDocument.createElementNS(SVG_NAMESPACE, name) as SVGElement;
}

function findOwnedDefinition(root: Element, name: string, key: string): Element | null {
  return (
    Array.from(root.getElementsByTagName(name)).find(
      (element) => element.getAttribute("data-toybox-definition") === key,
    ) ?? null
  );
}

function uniqueDefinitionId(root: Element, base: string): string {
  const ids = new Set(
    Array.from(root.getElementsByTagName("*"))
      .map((element) => element.getAttribute("id"))
      .filter((id): id is string => Boolean(id)),
  );
  if (!ids.has(base)) return base;
  let suffix = 2;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function createSvgNodeId(kind: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${kind}-${suffix}`;
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}
