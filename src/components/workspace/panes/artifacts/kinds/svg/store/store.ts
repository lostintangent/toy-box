import { createStore } from "@tanstack/store";
import type { SvgDocument } from "../document";
import { recordHistoryEntry, redoHistory, undoHistory } from "../document/history";
import { styleElements } from "../document/style";
import type {
  EditorState,
  Gesture,
  HistoryEntry,
  Point,
  Rect,
  Size,
  StyleChange,
  Tool,
  Viewport,
} from "./types";
import {
  DEFAULT_VIEWPORT,
  fitViewport,
  panViewport,
  resolveViewport,
  toDocumentPoint,
  zoomViewport,
} from "./viewport";

/** The semantic operations supported by one SVG editor. */
export type EditorActions = {
  setReadOnly: (readOnly: boolean) => void;
  loadDocument: (source: string) => void;

  activateTool: (tool: Tool) => void;
  changeStyle: (change: StyleChange) => void;

  beginGesture: (gesture: Gesture) => boolean;
  updateGesture: (gesture: Gesture) => void;
  endGesture: () => void;

  select: (elements: readonly SVGGraphicsElement[]) => void;
  removeSelection: () => boolean;
  insertImage: (source: string, size: Size) => boolean;
  clear: () => boolean;
  commit: (entry: HistoryEntry | null) => boolean;

  resizeViewport: (size: Size) => void;
  fitContent: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomAt: (direction: "in" | "out", viewportPoint: Point) => void;
  panBy: (viewportDelta: Point) => void;

  undo: () => boolean;
  redo: () => boolean;
};

/** Creates the complete ephemeral editor state layered over one SVG document. */
export function createEditorStore(document: SvgDocument, readOnly: boolean) {
  return createStore<EditorState, EditorActions>(
    {
      readOnly,
      viewport: DEFAULT_VIEWPORT,
      activeTool: "hand",
      styleDefaults: {
        color: null,
        strokeWidth: 4,
        fill: null,
        fontSize: 16,
      },
      selection: [],
      gesture: null,
      history: { undoStack: [], redoStack: [] },
    },
    ({ setState, get }) => {
      function traverseHistory(direction: "undo" | "redo"): boolean {
        const history =
          direction === "undo" ? undoHistory(get().history) : redoHistory(get().history);
        if (!history) return false;

        const root = document.getSnapshot().root;
        setState((current) => ({
          ...current,
          history,
          selection: root ? current.selection.filter((element) => root.contains(element)) : [],
        }));
        document.publishSource();
        return true;
      }

      return {
        setReadOnly(nextReadOnly) {
          setState((current) =>
            current.readOnly === nextReadOnly ? current : { ...current, readOnly: nextReadOnly },
          );
        },
        loadDocument(source) {
          document.load(source);
          setState((current) => ({
            ...current,
            gesture: null,
            selection: [],
            viewport: resizeViewport(
              current.viewport,
              document.getSnapshot().page,
              current.viewport.size,
            ),
            history: { undoStack: [], redoStack: [] },
          }));
        },
        activateTool(activeTool) {
          setState((current) =>
            current.activeTool === activeTool ? current : { ...current, activeTool, selection: [] },
          );
        },
        changeStyle(change) {
          const current = get();
          if (resolveActiveTool(current) === "select") {
            const entry = styleElements(document, current.selection, change);
            if (entry) {
              setState((state) => ({
                ...state,
                history: recordHistoryEntry(state.history, entry),
              }));
              document.publishSource();
              return;
            }
          }
          setState((current) => ({
            ...current,
            styleDefaults: applyStyleChange(current.styleDefaults, change),
          }));
        },
        beginGesture(gesture) {
          if (get().gesture) return false;
          setState((current) => ({ ...current, gesture }));
          return true;
        },
        updateGesture(gesture) {
          if (!get().gesture) return;
          setState((current) => ({ ...current, gesture }));
        },
        endGesture() {
          setState((current) => (current.gesture ? { ...current, gesture: null } : current));
        },
        select(selection) {
          const nextSelection = topLevelSelection(selection);
          setState((current) => {
            const nextTool = nextSelection.length > 0 ? "select" : current.activeTool;
            return sameElements(current.selection, nextSelection) && current.activeTool === nextTool
              ? current
              : { ...current, activeTool: nextTool, selection: nextSelection };
          });
        },
        removeSelection() {
          const current = get();
          if (current.selection.length === 0) return false;
          const entry = document.deleteElements(current.selection);
          if (!entry) return false;

          setState((state) => ({
            ...state,
            selection: [],
            history: recordHistoryEntry(state.history, entry),
          }));
          document.publishSource();
          return true;
        },
        insertImage(source, size) {
          const current = get();
          if (current.viewport.size.width <= 0 || current.viewport.size.height <= 0) return false;
          const center = toDocumentPoint(current.viewport, {
            x: current.viewport.size.width / 2,
            y: current.viewport.size.height / 2,
          });
          const { image, entry } = document.appendImage(source, center, size);
          const bounds = {
            x: center.x - size.width / 2,
            y: center.y - size.height / 2,
            width: size.width,
            height: size.height,
          };

          setState((state) => ({
            ...state,
            activeTool: "select",
            selection: [image],
            history: recordHistoryEntry(state.history, entry),
            viewport: positionViewport(
              state.viewport,
              { type: "manual" },
              fitViewport(
                bounds,
                state.viewport.size.width,
                state.viewport.size.height,
                Math.min(state.viewport.zoom, 1),
              ),
            ),
          }));
          document.publishSource();
          return true;
        },
        clear() {
          const entry = document.clearVisibleContent();
          if (!entry) return false;

          setState((state) => ({
            ...state,
            selection: [],
            history: recordHistoryEntry(state.history, entry),
          }));
          document.publishSource();
          return true;
        },
        commit(entry) {
          if (!entry) return false;
          setState((current) => ({
            ...current,
            history: recordHistoryEntry(current.history, entry),
          }));
          document.publishSource();
          return true;
        },
        resizeViewport(size) {
          setState((current) => ({
            ...current,
            viewport: resizeViewport(current.viewport, document.getSnapshot().page, size),
          }));
        },
        fitContent() {
          const bounds = document.measureContentBounds();
          setState((current) => ({
            ...current,
            viewport: positionViewport(
              current.viewport,
              { type: "fit-bounds", bounds },
              fitViewport(bounds, current.viewport.size.width, current.viewport.size.height),
            ),
          }));
        },
        zoomIn() {
          setState((current) => ({
            ...current,
            viewport: positionViewport(
              current.viewport,
              { type: "manual" },
              zoomViewport(current.viewport, "in"),
            ),
          }));
        },
        zoomOut() {
          setState((current) => ({
            ...current,
            viewport: positionViewport(
              current.viewport,
              { type: "manual" },
              zoomViewport(current.viewport, "out"),
            ),
          }));
        },
        zoomAt(direction, viewportPoint) {
          setState((current) => ({
            ...current,
            viewport: positionViewport(
              current.viewport,
              { type: "manual" },
              zoomViewport(current.viewport, direction, viewportPoint),
            ),
          }));
        },
        panBy(viewportDelta) {
          setState((current) => ({
            ...current,
            viewport: positionViewport(
              current.viewport,
              { type: "manual" },
              panViewport(current.viewport, viewportDelta),
            ),
          }));
        },
        undo() {
          return traverseHistory("undo");
        },
        redo() {
          return traverseHistory("redo");
        },
      };
    },
  );
}

export type EditorStore = ReturnType<typeof createEditorStore>;

export function resolveActiveTool(state: Pick<EditorState, "activeTool" | "readOnly">): Tool {
  return state.readOnly ? "hand" : state.activeTool;
}

export function styleColor(
  state: Pick<EditorState, "styleDefaults">,
  themeForegroundColor: string,
): string {
  return state.styleDefaults.color ?? themeForegroundColor;
}

function applyStyleChange(
  defaults: EditorState["styleDefaults"],
  change: StyleChange,
): EditorState["styleDefaults"] {
  switch (change.property) {
    case "color":
      return { ...defaults, color: change.value };
    case "strokeWidth":
      return { ...defaults, strokeWidth: change.value };
    case "fill":
      return { ...defaults, fill: change.value };
    case "fontSize":
      return { ...defaults, fontSize: change.value };
  }
}

function resizeViewport(viewport: Viewport, page: Rect | null, size: Size): Viewport {
  if (viewport.mode.type === "manual") return { ...viewport, size };
  const position = resolveViewport(viewport.mode, page, size);
  return { ...viewport, ...position, size };
}

function positionViewport(
  viewport: Viewport,
  mode: Viewport["mode"],
  position: Pick<Viewport, "zoom" | "panX" | "panY">,
): Viewport {
  return { ...viewport, mode, ...position };
}

function sameElements(
  left: readonly SVGGraphicsElement[],
  right: readonly SVGGraphicsElement[],
): boolean {
  return left.length === right.length && left.every((element, index) => element === right[index]);
}

/** Prevents a selected group and its descendant from receiving the same transform twice. */
function topLevelSelection(elements: readonly SVGGraphicsElement[]): SVGGraphicsElement[] {
  const unique = [...new Set(elements)];
  const selected = new Set<Element>(unique);
  return unique.filter((element) => {
    let parent = element.parentElement;
    while (parent) {
      if (selected.has(parent)) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}
