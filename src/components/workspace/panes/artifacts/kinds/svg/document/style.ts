import type { Fill, HistoryEntry, StyleChange } from "../store";
import type { SvgDocument, SvgDocumentSnapshot } from "./document";
import {
  createAttributesHistoryEntry,
  createCompoundHistoryEntry,
  snapshotAttribute,
} from "./history";
import { resolveSvgFillPattern } from "./nodes";

type ElementStyle = {
  colorElements: readonly SVGGraphicsElement[];
  widthElements: readonly SVGGraphicsElement[];
  fillElements: readonly SVGGraphicsElement[];
  color?: string;
  strokeWidth?: number;
  fill?: Fill;
};

const STYLABLE_ELEMENT_NAMES = new Set([
  "circle",
  "ellipse",
  "line",
  "path",
  "polygon",
  "polyline",
  "rect",
  "text",
]);

/** Projects the common style represented by a set of native SVG elements. */
export function readElementStyle(
  elements: readonly SVGGraphicsElement[],
  snapshot: Pick<SvgDocumentSnapshot, "root">,
): ElementStyle {
  const { root } = snapshot;
  const colorElements = elements.filter((element) =>
    STYLABLE_ELEMENT_NAMES.has(element.localName.toLowerCase()),
  );
  const widthElements = colorElements.filter(
    (element) => element.localName.toLowerCase() !== "text",
  );
  const fillElements = colorElements.filter((element) =>
    ["rect", "ellipse", "circle"].includes(element.localName.toLowerCase()),
  );
  const first = colorElements[0];
  const color = first
    ? (first.getAttribute(first.localName.toLowerCase() === "text" ? "fill" : "stroke") ??
      undefined)
    : undefined;
  const widthValue = widthElements[0]?.getAttribute("stroke-width");
  const strokeWidth =
    widthValue === null || widthValue === undefined ? undefined : Number(widthValue);
  return {
    colorElements,
    widthElements,
    fillElements,
    ...(color ? { color } : {}),
    ...(strokeWidth !== undefined && Number.isFinite(strokeWidth) ? { strokeWidth } : {}),
    ...(root && fillElements[0] ? { fill: readFill(root, fillElements[0]) } : {}),
  };
}

/** Mutates the native attributes supported by a set of SVG elements. */
export function styleElements(
  document: SvgDocument,
  elements: readonly SVGGraphicsElement[],
  change: StyleChange,
): HistoryEntry | null {
  const style = readElementStyle(elements, document.getSnapshot());
  if (change.property === "color" && style.colorElements.length > 0) {
    return setElementColor(style.colorElements, change.value);
  }
  if (change.property === "strokeWidth" && style.widthElements.length > 0) {
    return setElementWidth(style.widthElements, change.value);
  }
  if (change.property === "fill" && style.fillElements.length > 0) {
    return setElementFill(document, style.fillElements, change.value);
  }
  return null;
}

export function setElementColor(
  elements: readonly SVGGraphicsElement[],
  color: string,
): HistoryEntry | null {
  return createAttributesHistoryEntry(
    elements.map((element) => {
      const attributeName = element.localName.toLowerCase() === "text" ? "fill" : "stroke";
      const before = snapshotAttribute(element, attributeName);
      element.setAttribute(attributeName, color);
      return { element, before, after: snapshotAttribute(element, attributeName) };
    }),
  );
}

export function setElementWidth(
  elements: readonly SVGGraphicsElement[],
  width: number,
): HistoryEntry | null {
  return createAttributesHistoryEntry(
    elements.map((element) => {
      const before = snapshotAttribute(element, "stroke-width");
      element.setAttribute("stroke-width", String(width));
      return { element, before, after: snapshotAttribute(element, "stroke-width") };
    }),
  );
}

export function setElementFill(
  document: SvgDocument,
  elements: readonly SVGGraphicsElement[],
  fill: Fill | null,
): HistoryEntry | null {
  let value = "none";
  let definitionEntry: HistoryEntry | null = null;
  if (fill?.style === "solid") {
    value = fill.color;
  } else if (fill) {
    const pattern = resolveSvgFillPattern(document.root, fill.style, fill.color);
    value = `url(#${pattern.id})`;
    definitionEntry = pattern.definition ? document.appendDefinitions([pattern.definition]) : null;
  }

  const attributeEntry = createAttributesHistoryEntry(
    elements.map((element) => {
      const before = snapshotAttribute(element, "fill");
      element.setAttribute("fill", value);
      return { element, before, after: snapshotAttribute(element, "fill") };
    }),
  );
  return createCompoundHistoryEntry([definitionEntry, attributeEntry]);
}

function readFill(root: SVGSVGElement, element: SVGGraphicsElement): Fill | undefined {
  const value = element.getAttribute("fill");
  if (!value || value === "none") return undefined;
  const reference = /^url\(#(.+)\)$/u.exec(value)?.[1];
  if (!reference) return { color: value, style: "solid" };
  const pattern = Array.from(root.getElementsByTagName("pattern")).find(
    (candidate) => candidate.getAttribute("id") === reference,
  );
  const definition = pattern?.getAttribute("data-toybox-definition");
  if (!definition) return undefined;
  const separator = definition.indexOf(":");
  const patternName = definition.slice(0, separator);
  const color = definition.slice(separator + 1);
  const style =
    patternName === "diagonal" || patternName === "cross" || patternName === "dots"
      ? patternName
      : null;
  return color && style ? { color, style } : undefined;
}
