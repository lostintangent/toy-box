import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import type { SvgDocument } from "../../document";
import { createAttributesHistoryEntry, snapshotAttribute } from "../../document/history";
import { resolveActiveTool, type EditorStore, type Gesture } from "../../store";
import type { GestureSource } from "../gestures/gesture";
import { startMarqueeGesture } from "../gestures/marquee";
import { startLineEndpointGesture, startTransformGesture } from "../gestures/transform";
import { pasteSvgSelectionClipboard, serializeSvgSelectionClipboard } from "./clipboard";
import {
  hitTestSelectionHandle,
  measureSelectionFrame,
  type SelectionFrame,
  type SelectionHandle,
} from "./frame";
import {
  applyScreenTransform,
  captureSelectionTransforms,
  invertMatrix,
  matrixFromDom,
  translationMatrix,
} from "./transform";
import { useTextEditing } from "./useTextEditing";

const CLIENT_COORDINATE_ORIGIN = { left: 0, top: 0 };

/** Owns selection policy, hit targeting, commands, hover, and browser text editing. */
export function useSelection({
  document,
  store,
  focusEditor,
}: {
  document: SvgDocument;
  store: EditorStore;
  focusEditor: () => void;
}) {
  const { activeTool, selection, cursorGesture } = useSelector(
    store,
    (state) => ({
      activeTool: resolveActiveTool(state),
      selection: state.selection,
      cursorGesture:
        state.gesture?.type === "transform" || state.gesture?.type === "line-endpoint"
          ? state.gesture
          : null,
    }),
    { compare: shallow },
  );
  const [hoveredHandle, setHoveredHandle] = useState<SelectionHandle | null>(null);

  const { prepareSelection, suspendTextEdit, editingProps } = useTextEditing({
    document,
    store,
    selection,
    focusEditor,
  });

  function select(elements: readonly SVGGraphicsElement[]) {
    prepareSelection(elements);
    store.actions.select(elements);
  }

  async function copySelection() {
    if (selection.length === 0) return;
    await navigator.clipboard.writeText(serializeSvgSelectionClipboard(document, selection));
  }

  function pasteSelection(text: string): boolean {
    const pasted = pasteSvgSelectionClipboard(document, text);
    if (!pasted) return false;

    suspendTextEdit();
    store.actions.commit(pasted.entry);
    store.actions.select(pasted.elements);
    return true;
  }

  function removeSelection(): boolean {
    if (selection.length === 0) return false;
    suspendTextEdit();
    return store.actions.removeSelection();
  }

  function claimSelectionGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const clientPoint = { x: event.clientX, y: event.clientY };
    const frame = measureSelectionFrame(selection, CLIENT_COORDINATE_ORIGIN);
    const handle = frame
      ? hitTestSelectionHandle(frame, clientPoint, event.pointerType === "touch")
      : null;
    if (frame && handle) {
      event.preventDefault();
      suspendTextEdit();
      return startHandleGesture(frame, handle, clientPoint);
    }

    const path = event.nativeEvent
      .composedPath()
      .filter((target): target is EventTarget => target !== undefined);
    const target = document.resolveSelectionTarget(path);
    return target ? startTargetGesture(event, target) : startMarqueeSelection(event);
  }

  function startTargetGesture(
    event: ReactPointerEvent<HTMLDivElement>,
    target: SVGGraphicsElement,
  ) {
    const nextSelection = event.shiftKey
      ? [...new Set([...selection, target])]
      : selection.includes(target)
        ? selection
        : [target];
    select(nextSelection);

    // The store normalizes parent/descendant selections before they are transformed.
    const captures = captureSelectionTransforms(store.state.selection);
    if (!captures) return null;
    // Preserve pointer-down's browser default so a text click can place its native caret.
    return startTransformGesture(store, {
      mode: "pending-move",
      start: { x: event.clientX, y: event.clientY },
      captures,
      onMoveStart: suspendTextEdit,
    });
  }

  function startMarqueeSelection(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const viewportBounds = event.currentTarget.getBoundingClientRect();
    const start = {
      x: event.clientX - viewportBounds.left,
      y: event.clientY - viewportBounds.top,
    };
    const additiveSelection = event.shiftKey ? selection : [];
    if (!event.shiftKey) select([]);
    return startMarqueeGesture({
      document,
      store,
      start,
      additiveSelection,
      select,
    });
  }

  function startHandleGesture(
    frame: SelectionFrame,
    handle: SelectionHandle,
    clientPoint: { x: number; y: number },
  ) {
    if (handle === "line-start" || handle === "line-end") {
      if (selection.length !== 1) return null;
      const element = selection[0];
      const screenMatrix = element.getScreenCTM();
      const screenInverse = screenMatrix && invertMatrix(matrixFromDom(screenMatrix));
      if (!screenInverse) return null;
      const prefix = handle === "line-start" ? "1" : "2";
      return startLineEndpointGesture({
        store,
        element,
        endpoint: handle === "line-start" ? "start" : "end",
        screenInverse,
        before: [
          snapshotAttribute(element, `x${prefix}`),
          snapshotAttribute(element, `y${prefix}`),
        ],
      });
    }

    const captures = captureSelectionTransforms(selection);
    if (!captures) return null;
    return handle === "rotate"
      ? startTransformGesture(store, {
          mode: "rotate",
          captures,
          center: frame.center,
          start: clientPoint,
        })
      : startTransformGesture(store, {
          mode: "resize",
          captures,
          frame,
          handle,
          start: clientPoint,
        });
  }

  function nudgeSelection(delta: { x: number; y: number }): boolean {
    if (activeTool !== "select" || selection.length === 0) return false;
    const captures = captureSelectionTransforms(selection);
    if (!captures) return false;

    suspendTextEdit();
    const translation = translationMatrix(delta.x, delta.y);
    for (const capture of captures) applyScreenTransform(capture, translation);
    const entry = createAttributesHistoryEntry(
      captures.map((capture) => ({
        element: capture.element,
        before: { namespace: null, name: "transform", value: capture.beforeTransform },
        after: snapshotAttribute(capture.element, "transform"),
      })),
    );
    return store.actions.commit(entry);
  }

  function updateHoveredHandle(event: ReactPointerEvent<HTMLDivElement>) {
    if (activeTool !== "select" || selection.length === 0) {
      setHoveredHandle(null);
      return;
    }
    const frame = measureSelectionFrame(selection, CLIENT_COORDINATE_ORIGIN);
    setHoveredHandle(
      frame
        ? hitTestSelectionHandle(
            frame,
            { x: event.clientX, y: event.clientY },
            event.pointerType === "touch",
          )
        : null,
    );
  }

  const gestureSource = {
    owner: "selection",
    claim: claimSelectionGesture,
    hover: {
      update: updateHoveredHandle,
      leave() {
        setHoveredHandle(null);
      },
    },
  } satisfies GestureSource<ReactPointerEvent<HTMLDivElement>>;

  return {
    cursor: selectionCursor(cursorGesture, hoveredHandle),
    gestureSource,
    commands: {
      copy: copySelection,
      paste: pasteSelection,
      remove: removeSelection,
      nudge: nudgeSelection,
    },
    editingProps,
  };
}

function selectionCursor(gesture: Gesture | null, handle: SelectionHandle | null): string {
  if (gesture?.type === "transform") return gesture.mode === "move" ? "move" : "grabbing";
  if (gesture?.type === "line-endpoint") return "crosshair";
  switch (handle) {
    case "resize-nw":
    case "resize-se":
      return "nwse-resize";
    case "resize-n":
    case "resize-s":
      return "ns-resize";
    case "resize-ne":
    case "resize-sw":
      return "nesw-resize";
    case "resize-e":
    case "resize-w":
      return "ew-resize";
    case "rotate":
      return "grab";
    case "line-start":
    case "line-end":
      return "crosshair";
    default:
      return "default";
  }
}
