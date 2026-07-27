import { useLayoutEffect, useRef, useSyncExternalStore, type HTMLAttributes } from "react";
import { useSelector } from "@tanstack/react-store";
import type { SvgDocument } from "../../document";
import type { EditorStore } from "../../store";

/** Mounts the native SVG DOM, projects its viewport, and presents load errors. */
export function DocumentLayer({
  document,
  store,
  baseUri,
  editingProps,
}: {
  document: SvgDocument;
  store: EditorStore;
  baseUri?: string;
  editingProps: HTMLAttributes<HTMLDivElement>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const snapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );
  const viewport = useSelector(store, (state) => state.viewport);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    document.mount(host, baseUri);
    return () => document.unmount();
  }, [baseUri, document]);

  useLayoutEffect(() => {
    if (!snapshot.root || viewport.size.width <= 0 || viewport.size.height <= 0) return;
    document.setRenderedViewport({
      x: -viewport.panX,
      y: -viewport.panY,
      width: viewport.size.width / viewport.zoom,
      height: viewport.size.height / viewport.zoom,
    });
  }, [document, snapshot.root, viewport]);

  return (
    <>
      <div
        ref={hostRef}
        className="absolute inset-0 overflow-hidden"
        hidden={Boolean(snapshot.error)}
        {...editingProps}
      />

      {snapshot.error && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-muted-foreground">
          <div className="max-w-md space-y-2">
            <p className="font-medium text-foreground">Unable to open this SVG.</p>
            <p>{snapshot.error}</p>
          </div>
        </div>
      )}
    </>
  );
}
