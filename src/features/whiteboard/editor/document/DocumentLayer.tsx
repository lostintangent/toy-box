import { useLayoutEffect, useRef, useSyncExternalStore, type HTMLAttributes } from "react";
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
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    document.mount(host, baseUri);
    return () => document.unmount();
  }, [baseUri, document]);

  // Keep this subscription stable across source loads: selection measures after it.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let previousViewport = store.state.viewport;
    let previousNavigation = false;

    const renderViewport = () => {
      const { viewport, gesture } = store.state;
      const page = document.page;
      const navigating = gesture?.type === "pan" || gesture?.type === "pinch";
      previousViewport = viewport;
      previousNavigation = navigating;
      host.toggleAttribute("data-whiteboard-navigating", navigating);

      // Keep percentage geometry in the authored viewport, even after navigation ends.
      host.style.width = `${page.width}px`;
      host.style.height = `${page.height}px`;
      const x = (viewport.panX + page.x) * viewport.zoom;
      const y = (viewport.panY + page.y) * viewport.zoom;
      host.style.transform = `translate(${x}px, ${y}px) scale(${viewport.zoom})`;
      host.style.willChange = navigating ? "transform" : "";
    };

    renderViewport();
    const subscription = store.subscribe((state) => {
      const navigating = state.gesture?.type === "pan" || state.gesture?.type === "pinch";
      if (state.viewport === previousViewport && navigating === previousNavigation) return;
      renderViewport();
    });
    return () => subscription.unsubscribe();
  }, [document, store]);

  return (
    <>
      <div
        ref={hostRef}
        className="absolute left-0 top-0 origin-top-left"
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
