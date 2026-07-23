import type { SvgDocument } from "../../document";
import type { HistoryEntry } from "../../store";

const SVG_CLIPBOARD_TYPE = "toy-box-svg-elements";
const PASTE_OFFSET = 20;

type PastedSelection = {
  elements: readonly SVGGraphicsElement[];
  entry: HistoryEntry;
};

export function serializeSvgSelectionClipboard(
  document: SvgDocument,
  selection: readonly SVGGraphicsElement[],
): string {
  return JSON.stringify({
    type: SVG_CLIPBOARD_TYPE,
    elements: selection.map((element) => document.serializeElement(element)),
  });
}

export function pasteSvgSelectionClipboard(
  document: SvgDocument,
  text: string,
): PastedSelection | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isSvgClipboardPayload(value)) return null;

  const imported = document.importElements(value.elements.join(""));
  if ("error" in imported) return null;
  for (const element of imported.elements) {
    const transform = element.getAttribute("transform");
    element.setAttribute(
      "transform",
      `translate(${PASTE_OFFSET} ${PASTE_OFFSET})${transform ? ` ${transform}` : ""}`,
    );
  }
  const entry = document.appendElements(imported.elements);
  if (!entry) return null;
  return { elements: imported.elements.filter(isSvgGraphicsElement), entry };
}

function isSvgClipboardPayload(value: unknown): value is { type: string; elements: string[] } {
  if (!value || typeof value !== "object") return false;
  const payload = value as { type?: unknown; elements?: unknown };
  return (
    payload.type === SVG_CLIPBOARD_TYPE &&
    Array.isArray(payload.elements) &&
    payload.elements.length <= 10_000 &&
    payload.elements.every((element) => typeof element === "string")
  );
}

function isSvgGraphicsElement(element: Element): element is SVGGraphicsElement {
  return "getBBox" in element && typeof element.getBBox === "function";
}
