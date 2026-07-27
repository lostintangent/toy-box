import { parseSvgDocument, serializeSvgDocument, SVG_NAMESPACE, validateSvgRoot } from "./source";
import { createChildrenHistoryEntry, createCompoundHistoryEntry } from "./history";
import { createSvgImage, createSvgText, type SvgEraserNodes } from "./nodes";
import type { HistoryEntry, Point, Rect, Size } from "../store";

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const DEFAULT_PAGE: Rect = { x: 0, y: 0, width: 800, height: 600 };
const NON_RENDERING_CONTAINERS = new Set([
  "clippath",
  "defs",
  "desc",
  "filter",
  "lineargradient",
  "marker",
  "mask",
  "metadata",
  "pattern",
  "radialgradient",
  "style",
  "symbol",
  "title",
]);

type SvgSourceIO = {
  parser: Pick<DOMParser, "parseFromString">;
  serializer: Pick<XMLSerializer, "serializeToString">;
};

export type SvgDocumentSnapshot = {
  error: string | null;
  root: SVGSVGElement | null;
  page: Rect;
  isEmpty: boolean;
};

/** Owns one parsed SVG document, its mounted DOM, and serialized source. */
export class SvgDocument {
  #root: SVGSVGElement | null = null;
  #page = DEFAULT_PAGE;
  #shadowRoot: ShadowRoot | null = null;
  #mountStyle: HTMLStyleElement | null = null;
  #editingHost: HTMLElement | null = null;
  #baseUri: string | undefined;
  #authoredXmlBase: string | null = null;
  #authoredViewBox: string | null = null;
  #renderedViewport: Rect | null = null;
  #snapshot: SvgDocumentSnapshot = {
    error: null,
    root: null,
    page: DEFAULT_PAGE,
    isEmpty: true,
  };
  readonly #listeners = new Set<() => void>();
  readonly #sourceListeners = new Set<(source: string) => void>();
  readonly #sourceIO: SvgSourceIO | undefined;

  constructor(sourceIO?: SvgSourceIO) {
    this.#sourceIO = sourceIO;
  }

  get root(): SVGSVGElement {
    if (!this.#root) throw new Error("The SVG document has not been loaded.");
    return this.#root;
  }

  get page(): Rect {
    return this.#page;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): SvgDocumentSnapshot => this.#snapshot;

  subscribeToSource = (listener: (source: string) => void): (() => void) => {
    this.#sourceListeners.add(listener);
    return () => this.#sourceListeners.delete(listener);
  };

  load(content: string): void {
    this.setTextEditing(false);
    const parsed = parseSvgDocument(content, this.#sourceIO?.parser);
    if (!parsed.root) {
      this.#root = null;
      this.#page = DEFAULT_PAGE;
      this.#authoredXmlBase = null;
      this.#authoredViewBox = null;
      this.#editingHost?.replaceChildren();
      this.#publish({
        error: parsed.error,
        root: null,
        page: this.#page,
        isEmpty: true,
      });
      return;
    }

    this.#root = parsed.root;
    this.#page = readSvgPage(parsed.root);
    this.#authoredXmlBase = parsed.root.getAttributeNS(XML_NAMESPACE, "base");
    this.#authoredViewBox = parsed.root.getAttribute("viewBox");
    this.#applyRuntimePresentation();
    this.#mountLoadedRoot();
    this.#publish({
      error: null,
      root: this.#root,
      page: this.#page,
      isEmpty: this.listSelectionCandidates().length === 0,
    });
  }

  mount(host: HTMLDivElement, baseUri?: string): void {
    this.#baseUri = baseUri;
    this.#shadowRoot = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    this.#mountStyle = document.createElement("style");
    this.#mountStyle.textContent = `
      :host, [data-toybox-svg-editing-host] {
        display: block;
        width: 100%;
        height: 100%;
        overflow: visible;
        outline: none;
      }
      svg { display: block; width: 100% !important; height: 100% !important; overflow: visible; user-select: none; }
      [data-toybox-svg-editing-host][contenteditable="true"] {
        caret-color: var(--user-accent);
      }
      [data-toybox-svg-editing-host][contenteditable="true"] svg { user-select: text; }
      a { cursor: inherit; }
    `;
    this.#editingHost = document.createElement("main");
    this.#editingHost.dataset.toyboxSvgEditingHost = "";
    this.#editingHost.contentEditable = "false";
    this.#editingHost.spellcheck = false;
    this.#applyRuntimePresentation();
    this.#mountLoadedRoot();
  }

  unmount(): void {
    this.#shadowRoot?.replaceChildren();
    this.#shadowRoot = null;
    this.#mountStyle = null;
    this.#editingHost = null;
  }

  setTextEditing(editable: boolean): void {
    if (!this.#editingHost) return;
    this.#editingHost.contentEditable = editable ? "true" : "false";
    this.#editingHost.spellcheck = editable;
  }

  /** Renders document coordinates through the editor viewport. */
  setRenderedViewport(viewport: Rect): void {
    this.#renderedViewport = viewport;
    this.#applyRuntimeViewport();
  }

  serialize(): { content: string; error?: never } | { content?: never; error: string } {
    if (!this.#root) {
      return { error: this.#snapshot.error ?? "The SVG document has not been loaded." };
    }
    const validationError = validateSvgRoot(this.#root);
    if (validationError) return { error: validationError };

    const clone = this.#root.cloneNode(true) as SVGSVGElement;
    restoreXmlBase(clone, this.#authoredXmlBase);
    restoreAttribute(clone, "viewBox", this.#authoredViewBox);
    return { content: serializeSvgDocument(clone, this.#sourceIO?.serializer) };
  }

  /** Publishes the current DOM after an editor or browser-managed mutation. */
  publishSource(): boolean {
    const serialized = this.serialize();
    if ("error" in serialized) {
      console.error("Unable to save SVG artifact:", serialized.error);
      return false;
    }
    this.#publish({
      ...this.#snapshot,
      isEmpty: this.#root ? this.listSelectionCandidates().length === 0 : true,
    });
    for (const listener of this.#sourceListeners) listener(serialized.content);
    return true;
  }

  appendText(
    content: string,
    point: Point,
    style: { color: string; fontSize: number; fontFamily: string },
  ): HistoryEntry {
    return this.appendElement(createSvgText(this.root, content, point, style));
  }

  appendImage(dataUrl: string, point: Point, size: Size) {
    const image = createSvgImage(this.root, dataUrl, point, size);
    return { image, entry: this.appendElement(image) };
  }

  importElements(markup: string): { elements: Element[]; error?: never } | { error: string } {
    const parsed = parseSvgDocument(
      `<svg xmlns="${SVG_NAMESPACE}">${markup}</svg>`,
      this.#sourceIO?.parser,
    );
    if (!parsed.root) return { error: parsed.error };
    const elements = Array.from(parsed.root.children).map((element) =>
      this.root.ownerDocument.importNode(element, true),
    );
    return { elements };
  }

  serializeElement(element: Element): string {
    const serializer = this.#sourceIO?.serializer ?? new XMLSerializer();
    return serializer.serializeToString(element);
  }

  appendElements(elements: readonly Element[], parent: Element = this.root): HistoryEntry | null {
    const before = Array.from(parent.childNodes);
    const trailingWhitespace = getTrailingWhitespace(parent);
    for (const element of elements) parent.insertBefore(element, trailingWhitespace);
    return createChildrenHistoryEntry(parent, before, Array.from(parent.childNodes));
  }

  appendElement(
    element: Element,
    definitions: readonly SVGElement[] = [],
    parent: Element = this.root,
  ): HistoryEntry {
    const definitionsEntry = this.appendDefinitions(definitions);
    const before = Array.from(parent.childNodes);
    const trailingWhitespace = getTrailingWhitespace(parent);
    parent.insertBefore(element, trailingWhitespace);
    return createCompoundHistoryEntry([
      definitionsEntry,
      createChildrenHistoryEntry(parent, before, Array.from(parent.childNodes)),
    ])!;
  }

  appendDefinitions(definitions: readonly SVGElement[]): HistoryEntry | null {
    if (definitions.length === 0) return null;
    let defs = Array.from(this.root.children).find(
      (child) => child.localName.toLowerCase() === "defs",
    );
    let creationEntry: HistoryEntry | null = null;
    if (!defs) {
      const before = Array.from(this.root.childNodes);
      defs = this.root.ownerDocument.createElementNS(SVG_NAMESPACE, "defs");
      this.root.insertBefore(defs, this.root.firstChild);
      creationEntry = createChildrenHistoryEntry(
        this.root,
        before,
        Array.from(this.root.childNodes),
      );
    }

    const before = Array.from(defs.childNodes);
    const trailingWhitespace = getTrailingWhitespace(defs);
    for (const definition of definitions) defs.insertBefore(definition, trailingWhitespace);
    return createCompoundHistoryEntry([
      creationEntry,
      createChildrenHistoryEntry(defs, before, Array.from(defs.childNodes)),
    ]);
  }

  deleteElements(elements: readonly Element[]): HistoryEntry | null {
    const connected = new Set(elements.filter((element) => isDescendantOf(element, this.root)));
    const topLevel = [...connected].filter(
      (element) => !ancestorsOf(element).some((ancestor) => connected.has(ancestor)),
    );
    const beforeByParent = new Map<Element, readonly Node[]>();
    for (const element of topLevel) {
      const parent = element.parentElement;
      if (!parent) continue;
      if (!beforeByParent.has(parent)) beforeByParent.set(parent, Array.from(parent.childNodes));
      parent.removeChild(element);
    }
    return createCompoundHistoryEntry(
      [...beforeByParent].map(([parent, before]) =>
        createChildrenHistoryEntry(parent, before, Array.from(parent.childNodes)),
      ),
    );
  }

  clearVisibleContent(): HistoryEntry | null {
    const before = Array.from(this.root.childNodes);
    for (const child of Array.from(this.root.children)) {
      if (!NON_RENDERING_CONTAINERS.has(child.localName.toLowerCase())) {
        this.root.removeChild(child);
      }
    }
    return createChildrenHistoryEntry(this.root, before, Array.from(this.root.childNodes));
  }

  eraseVisibleContent({ mask, maskedContent }: SvgEraserNodes): HistoryEntry {
    const definitionEntry = this.appendDefinitions([mask]);
    const rootBefore = Array.from(this.root.childNodes);
    const contentBefore = Array.from(maskedContent.childNodes);
    for (const child of Array.from(this.root.children)) {
      if (NON_RENDERING_CONTAINERS.has(child.localName.toLowerCase())) continue;
      maskedContent.appendChild(child);
    }
    this.root.appendChild(maskedContent);
    return createCompoundHistoryEntry([
      definitionEntry,
      createChildrenHistoryEntry(
        maskedContent,
        contentBefore,
        Array.from(maskedContent.childNodes),
      ),
      createChildrenHistoryEntry(this.root, rootBefore, Array.from(this.root.childNodes)),
    ])!;
  }

  /**
   * Resolves a browser hit path into one editable object: text remains directly
   * editable, named groups act as authored objects, and otherwise the deepest
   * renderable SVG element wins.
   */
  resolveSelectionTarget(path: readonly EventTarget[]): SVGGraphicsElement | null {
    const text = textTargetFromPath(path, this.root);
    if (text) return text;

    let fallback: SVGGraphicsElement | null = null;
    for (const target of path) {
      if (target === this.root) break;
      if (!isElement(target) || !isSelectableElement(target)) continue;
      fallback ??= target as SVGGraphicsElement;
      if (isSemanticGroup(target)) return target as SVGGraphicsElement;
    }
    return fallback;
  }

  /** Enumerates marquee candidates using the same authored-group boundaries as hit testing. */
  listSelectionCandidates(): readonly SVGGraphicsElement[] {
    const candidates: SVGGraphicsElement[] = [];
    collectSelectionCandidates(this.root, candidates);
    return candidates;
  }

  measureContentBounds(): Rect {
    try {
      const bounds = this.root.getBBox();
      if (bounds.width > 0 && bounds.height > 0) {
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
      }
    } catch {
      // Detached and empty SVG roots may not expose geometry yet.
    }
    return this.#page;
  }

  #applyRuntimeBase(): void {
    if (!this.#root) return;
    if (this.#baseUri) this.#root.setAttributeNS(XML_NAMESPACE, "xml:base", this.#baseUri);
    else restoreXmlBase(this.#root, this.#authoredXmlBase);
  }

  #applyRuntimeViewport(): void {
    if (!this.#root || !this.#renderedViewport) return;
    const { x, y, width, height } = this.#renderedViewport;
    this.#root.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  }

  #applyRuntimePresentation(): void {
    this.#applyRuntimeBase();
    this.#applyRuntimeViewport();
  }

  #mountLoadedRoot(): void {
    if (!this.#shadowRoot || !this.#mountStyle || !this.#editingHost || !this.#root) return;
    this.#editingHost.replaceChildren(this.#root);
    this.#shadowRoot.replaceChildren(this.#mountStyle, this.#editingHost);
  }

  #publish(snapshot: SvgDocumentSnapshot): void {
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener();
  }
}

function readSvgPage(root: Element): Rect {
  const viewBox = root
    .getAttribute("viewBox")
    ?.trim()
    .split(/[\s,]+/u)
    .map(Number);
  if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
    return { x: viewBox[0], y: viewBox[1], width: viewBox[2], height: viewBox[3] };
  }

  const width = parseSvgLength(root.getAttribute("width"));
  const height = parseSvgLength(root.getAttribute("height"));
  return width && height ? { x: 0, y: 0, width, height } : DEFAULT_PAGE;
}

function parseSvgLength(value: string | null): number | null {
  if (!value || value.trim().endsWith("%")) return null;
  const number = Number.parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function restoreXmlBase(root: Element, authoredValue: string | null): void {
  if (authoredValue === null) root.removeAttributeNS(XML_NAMESPACE, "base");
  else root.setAttributeNS(XML_NAMESPACE, "xml:base", authoredValue);
}

function restoreAttribute(element: Element, name: string, authoredValue: string | null): void {
  if (authoredValue === null) element.removeAttribute(name);
  else element.setAttribute(name, authoredValue);
}

function getTrailingWhitespace(parent: Element): ChildNode | null {
  const last = parent.lastChild;
  return last?.nodeType === 3 && !last.textContent?.trim() ? (last as ChildNode) : null;
}

function isElement(value: EventTarget): value is Element {
  return "nodeType" in value && (value as Node).nodeType === 1;
}

function isSelectableElement(element: Element): boolean {
  return (
    element.namespaceURI === SVG_NAMESPACE &&
    !element.hasAttribute("data-toybox-eraser-bounds") &&
    !NON_RENDERING_CONTAINERS.has(element.localName.toLowerCase())
  );
}

function isSemanticGroup(element: Element): boolean {
  if (element.localName.toLowerCase() !== "g") return false;
  return Boolean(
    element.getAttribute("id") ||
    element.getAttribute("aria-label") ||
    element.getAttribute("data-name") ||
    element.getAttribute("data-toybox-selectable"),
  );
}

function textTargetFromPath(
  path: readonly EventTarget[],
  root: SVGSVGElement,
): SVGTextElement | null {
  for (const target of path) {
    if (target === root) break;
    if (
      isElement(target) &&
      target.namespaceURI === SVG_NAMESPACE &&
      target.localName.toLowerCase() === "text"
    ) {
      return target as SVGTextElement;
    }
  }
  return null;
}

function collectSelectionCandidates(parent: Element, candidates: SVGGraphicsElement[]): void {
  for (const child of Array.from(parent.children)) {
    const name = child.localName.toLowerCase();
    if (NON_RENDERING_CONTAINERS.has(name)) continue;
    if (isSemanticGroup(child)) {
      candidates.push(child as SVGGraphicsElement);
    } else if (name === "g" || name === "a" || name === "svg") {
      collectSelectionCandidates(child, candidates);
    } else if (isSelectableElement(child)) {
      candidates.push(child as SVGGraphicsElement);
    }
  }
}

function ancestorsOf(element: Element): Element[] {
  const ancestors: Element[] = [];
  let current = element.parentElement;
  while (current) {
    ancestors.push(current);
    current = current.parentElement;
  }
  return ancestors;
}

function isDescendantOf(element: Element, ancestor: Element): boolean {
  let current: Element | null = element;
  while (current) {
    if (current === ancestor) return true;
    current = current.parentElement;
  }
  return false;
}
