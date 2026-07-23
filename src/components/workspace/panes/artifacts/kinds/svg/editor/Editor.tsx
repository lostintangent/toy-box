import { useEffectEvent, useLayoutEffect, useRef } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import { usePreferredColorScheme } from "@/hooks/browser/usePreferredColorScheme";
import type { SvgDocument } from "../document";
import { resolveActiveTool, type EditorStore } from "../store";
import { SvgToolbar } from "../toolbar/SvgToolbar";
import { DocumentLayer } from "./document/DocumentLayer";
import { isTextEntryTarget, useKeyboard } from "./document/useKeyboard";
import { DrawingCursor } from "./drawing/DrawingCursor";
import { createDrawingGestureSource } from "./drawing/source";
import { TextInsertion } from "./drawing/TextInsertion";
import { insertImageFile, SVG_RASTER_IMAGE_TYPES } from "./images/images";
import { ImageDropLayer } from "./images/ImageDropLayer";
import { activeToolForGesture } from "./gestures/gesture";
import { useGesture } from "./gestures/useGesture";
import { SelectionLayer } from "./selection/SelectionLayer";
import { useSelection } from "./selection/useSelection";
import { GridLayer } from "./viewport/GridLayer";
import { useViewport } from "./viewport/useViewport";

export function Editor({
  document,
  store,
  baseUri,
}: {
  document: SvgDocument;
  store: EditorStore;
  baseUri?: string;
}) {
  const { readOnly, activeTool, gestureType } = useSelector(
    store,
    (state) => ({
      readOnly: state.readOnly,
      activeTool: resolveActiveTool(state),
      gestureType: state.gesture?.type ?? null,
    }),
    { compare: shallow },
  );

  const editorRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  function focusEditor() {
    editorRef.current?.focus();
  }

  const colorScheme = usePreferredColorScheme();
  const themeForegroundColor = colorScheme === "dark" ? "#ffffff" : "#000000";

  const viewportGestureSource = useViewport({
    store,
    viewportRef,
  });

  const selection = useSelection({
    document,
    store,
    focusEditor,
  });

  const drawingGestureSource = createDrawingGestureSource({
    document,
    store,
    themeForegroundColor,
  });

  const { editorProps, spacePressed } = useKeyboard({
    store,
    selection: selection.commands,
    cancel: cancelCurrentAction,
    finishSpaceGesture,
  });

  const effectiveTool = activeToolForGesture({
    activeTool,
    spacePressed,
    readOnly,
  });

  const gesture = useGesture({
    store,
    activeTool: effectiveTool,
    sources: [viewportGestureSource, drawingGestureSource, selection.gestureSource],
    focusEditor,
  });

  const cancelEditing = useEffectEvent(() => {
    if (!gesture.isOwnedBy("viewport")) gesture.cancel();

    gesture.leaveHover();
  });

  useLayoutEffect(() => {
    if (readOnly) cancelEditing();
  }, [readOnly]);

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.composedPath().some(isTextEntryTarget)) return;
    if (readOnly) return;
    const imageItem = Array.from(event.clipboardData.items).find((item) =>
      SVG_RASTER_IMAGE_TYPES.has(item.type),
    );
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) {
        event.preventDefault();
        void insertImageFile(store, file);
      }
      return;
    }
    const text = event.clipboardData.getData("text/plain");
    if (text && selection.commands.paste(text)) event.preventDefault();
  }

  function cancelCurrentAction() {
    if (gesture.isActive()) gesture.cancel();
    else store.actions.select([]);
  }

  function finishSpaceGesture() {
    if (gesture.isOwnedBy("viewport")) gesture.finish("commit");
  }

  const cursor =
    gestureType === "pan"
      ? "grabbing"
      : gestureType === "draw"
        ? "crosshair"
        : effectiveTool === "hand"
          ? "grab"
          : effectiveTool === "select"
            ? selection.cursor
            : "crosshair";

  return (
    <div
      ref={editorRef}
      className="relative h-full w-full min-h-0 min-w-0 overflow-hidden bg-background outline-none"
      tabIndex={0}
      {...editorProps}
      onPaste={handlePaste}
    >
      <SvgToolbar
        document={document}
        store={store}
        themeForegroundColor={themeForegroundColor}
        activeTool={effectiveTool}
      />

      <div
        ref={viewportRef}
        className="absolute inset-0 overflow-hidden"
        style={{ cursor, touchAction: "none" }}
        {...gesture.viewportProps}
      >
        <GridLayer store={store} colorScheme={colorScheme} />

        <DocumentLayer
          document={document}
          store={store}
          baseUri={baseUri}
          editingProps={selection.editingProps}
        />

        <DrawingCursor
          store={store}
          activeTool={effectiveTool}
          themeForegroundColor={themeForegroundColor}
          viewportRef={viewportRef}
        />

        <TextInsertion
          document={document}
          store={store}
          themeForegroundColor={themeForegroundColor}
        />

        <SelectionLayer document={document} store={store} viewportRef={viewportRef} />

        <ImageDropLayer store={store} viewportRef={viewportRef} />
      </div>
    </div>
  );
}
