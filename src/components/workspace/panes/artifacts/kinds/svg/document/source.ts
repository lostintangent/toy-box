// Owns the boundary between persisted SVG source text and the editable SVG DOM.

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";

const BLOCKED_ELEMENTS = new Set([
  "base",
  "canvas",
  "embed",
  "foreignobject",
  "iframe",
  "link",
  "meta",
  "object",
  "script",
]);

const CSS_URL_PATTERN = /url\(\s*(["']?)(.*?)\1\s*\)/giu;
const BLOCKED_CSS_PATTERN = /(?:@import|expression\s*\(|-moz-binding|javascript\s*:)/iu;
const SAFE_DATA_IMAGE_PATTERN = /^data:image\/(?:png|jpe?g|gif|webp);base64,/iu;
const EXPLICIT_PROTOCOL_PATTERN = /^([a-z][a-z\d+.-]*):/iu;
const ALLOWED_PROTOCOLS = new Set(["http", "https"]);

type SvgDocumentParseResult =
  | { root: SVGSVGElement; error?: never }
  | { root?: never; error: string };

/** Parses one static SVG document without silently dropping unsupported content. */
export function parseSvgDocument(
  content: string,
  parser: Pick<DOMParser, "parseFromString"> = new DOMParser(),
): SvgDocumentParseResult {
  if (/<!doctype\b/iu.test(content)) {
    return { error: "SVG documents with a doctype are not supported." };
  }

  let parsedDocument: Document;
  try {
    parsedDocument = parser.parseFromString(content, "image/svg+xml");
  } catch {
    return { error: "This SVG is not valid XML." };
  }

  const root = parsedDocument.documentElement;
  if (!root || root.localName.toLowerCase() === "parsererror") {
    return { error: "This SVG is not valid XML." };
  }
  if (root.localName.toLowerCase() !== "svg") {
    return { error: "The document root must be an <svg> element." };
  }
  if (root.namespaceURI !== SVG_NAMESPACE) {
    return { error: `The <svg> root must use the ${SVG_NAMESPACE} namespace.` };
  }

  const validationError = validateSvgRoot(root);
  return validationError ? { error: validationError } : { root: root as unknown as SVGSVGElement };
}

/** Validates the executable and resource-bearing parts of an otherwise broad static SVG tree. */
export function validateSvgRoot(root: Element): string | null {
  const elements = [root, ...Array.from(root.getElementsByTagName("*"))];
  for (const element of elements) {
    const name = element.localName.toLowerCase();
    if (BLOCKED_ELEMENTS.has(name) || element.namespaceURI === HTML_NAMESPACE) {
      return `The <${element.localName}> element is not supported in editable SVG artifacts.`;
    }

    if (name === "style") {
      const error = validateCss(element.textContent ?? "");
      if (error) return error;
    }

    for (const attribute of Array.from(element.attributes)) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith("on")) {
        return `The ${attribute.name} event attribute is not supported in editable SVG artifacts.`;
      }
      if (attribute.localName.toLowerCase() === "href") {
        const error = validateResourceReference(attribute.value);
        if (error) return error;
      }
      if (attributeName === "style" || attribute.value.includes("url(")) {
        const error = validateCss(attribute.value);
        if (error) return error;
      }
    }
  }

  return null;
}

/** Serializes the mounted source tree only; editor overlays live outside this root. */
export function serializeSvgDocument(
  root: SVGSVGElement,
  serializer: Pick<XMLSerializer, "serializeToString"> = new XMLSerializer(),
): string {
  return `${serializer.serializeToString(root).trim()}\n`;
}

function validateCss(css: string): string | null {
  if (BLOCKED_CSS_PATTERN.test(css)) {
    return "Executable or imported CSS is not supported in editable SVG artifacts.";
  }

  CSS_URL_PATTERN.lastIndex = 0;
  for (const match of css.matchAll(CSS_URL_PATTERN)) {
    const error = validateResourceReference(match[2]);
    if (error) return error;
  }
  return null;
}

function validateResourceReference(reference: string): string | null {
  const value = Array.from(reference.trim(), (character) =>
    character.codePointAt(0)! <= 0x20 ? "" : character,
  ).join("");
  if (!value || value.startsWith("#") || SAFE_DATA_IMAGE_PATTERN.test(value)) return null;

  const protocol = EXPLICIT_PROTOCOL_PATTERN.exec(value)?.[1]?.toLowerCase();
  if (!protocol || ALLOWED_PROTOCOLS.has(protocol)) return null;
  return `The ${protocol}: resource protocol is not supported in editable SVG artifacts.`;
}
