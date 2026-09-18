import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import { usePreferredColorScheme } from "@/shared/hooks/usePreferredColorScheme";
import { SvgDocument } from "./document";
import { Editor } from "./editor/Editor";
import {
  insertImageFile,
  SVG_RASTER_IMAGE_TYPES,
  writeSvgImageToClipboard,
} from "./editor/images/images";
import { createEditorStore, type EditorStore } from "./store";

export type WhiteboardActions = {
  zoom: number;
  canZoom: boolean;
  canFitContent: boolean;
  canInsertImage: boolean;
  canCopyAsImage: boolean;
  canClear: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  fitContent: () => void;
  insertImage: () => void;
  copyAsImage: () => Promise<boolean>;
  clear: () => void;
};

export type WhiteboardProps = {
  content: string;
  readOnly: boolean;
  baseUri?: string;
  onContentChange: (content: string) => void;
  renderActions?: (actions: WhiteboardActions) => ReactNode;
};

/** Owns one mount-local native SVG document and its transient editing state. */
export function Whiteboard({
  content,
  readOnly,
  baseUri,
  onContentChange,
  renderActions,
}: WhiteboardProps) {
  const [document] = useState(() => new SvgDocument());
  const [store] = useState(() => createEditorStore(document, readOnly));
  const appliedContentRef = useRef<string | undefined>(undefined);

  const publishContent = useEffectEvent(onContentChange);

  useLayoutEffect(
    () =>
      document.subscribeToSource((nextContent) => {
        appliedContentRef.current = nextContent;
        publishContent(nextContent);
      }),
    [document],
  );

  useLayoutEffect(() => {
    if (content === appliedContentRef.current) return;
    appliedContentRef.current = content;
    store.actions.loadDocument(content);
  }, [content, store]);

  useLayoutEffect(() => store.actions.setReadOnly(readOnly), [readOnly, store]);

  return (
    <>
      {renderActions && (
        <WhiteboardActionProjection document={document} store={store} render={renderActions} />
      )}
      <Editor document={document} store={store} baseUri={baseUri} />
    </>
  );
}

function WhiteboardActionProjection({
  document,
  store,
  render,
}: {
  document: SvgDocument;
  store: EditorStore;
  render: (actions: WhiteboardActions) => ReactNode;
}) {
  const colorScheme = usePreferredColorScheme();
  const isEmpty = useSyncExternalStore(
    document.subscribe,
    () => document.getSnapshot().isEmpty,
    () => document.getSnapshot().isEmpty,
  );
  const { zoom, readOnly, gestureActive } = useSelector(
    store,
    (state) => ({
      zoom: state.viewport.zoom,
      readOnly: state.readOnly,
      gestureActive: state.gesture !== null,
    }),
    { compare: shallow },
  );

  function insertImage() {
    const input = globalThis.document.createElement("input");
    input.type = "file";
    input.accept = [...SVG_RASTER_IMAGE_TYPES].join(",");
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) void insertImageFile(store, file);
    };
    input.click();
  }

  async function copyAsImage(): Promise<boolean> {
    const serialized = document.serialize();
    if ("error" in serialized) return false;
    await writeSvgImageToClipboard(
      serialized.content,
      document.page,
      colorScheme === "dark" ? "#0a0a0a" : "#ffffff",
    );
    return true;
  }

  return render({
    zoom,
    canZoom: !gestureActive,
    canFitContent: !isEmpty && !gestureActive,
    canInsertImage: !readOnly,
    canCopyAsImage: !isEmpty,
    canClear: !readOnly && !isEmpty,
    zoomIn: store.actions.zoomIn,
    zoomOut: store.actions.zoomOut,
    fitContent: store.actions.fitContent,
    insertImage,
    copyAsImage,
    clear: store.actions.clear,
  });
}
