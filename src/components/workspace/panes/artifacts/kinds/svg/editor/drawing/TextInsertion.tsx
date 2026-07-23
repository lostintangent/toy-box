import { useLayoutEffect, useRef } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import type { SvgDocument } from "../../document";
import type { EditorStore } from "../../store";

const TEXT_FONT_FAMILY =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

/** Owns the transient HTML input used to create one native SVG text node. */
export function TextInsertion({
  document,
  store,
  themeForegroundColor,
}: {
  document: SvgDocument;
  store: EditorStore;
  themeForegroundColor: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const finishedRef = useRef(false);
  const { viewport, styleDefaults, insertion } = useSelector(
    store,
    (state) => ({
      viewport: state.viewport,
      styleDefaults: state.styleDefaults,
      insertion: state.gesture?.type === "insert-text" ? state.gesture : null,
    }),
    { compare: shallow },
  );

  useLayoutEffect(() => {
    if (!insertion) return;
    finishedRef.current = false;
    inputRef.current?.focus();
  }, [insertion]);

  function finish(content: string, commit: boolean) {
    if (finishedRef.current) return;
    finishedRef.current = true;
    if (commit && insertion && content.trim()) {
      store.actions.commit(
        document.appendText(content, insertion.documentPoint, {
          color: styleDefaults.color ?? themeForegroundColor,
          fontSize: styleDefaults.fontSize,
          fontFamily: TEXT_FONT_FAMILY,
        }),
      );
    }
    store.actions.endGesture();
  }

  if (!insertion) return null;
  return (
    <input
      ref={inputRef}
      type="text"
      style={{
        left: insertion.viewportPoint.x,
        top: insertion.viewportPoint.y,
        color: styleDefaults.color ?? themeForegroundColor,
        fontFamily: TEXT_FONT_FAMILY,
        fontSize: styleDefaults.fontSize * viewport.zoom,
      }}
      className="absolute z-20 min-w-24 rounded border border-accent bg-transparent px-1 outline-none"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(event.currentTarget.value, true);
        else if (event.key === "Escape") finish("", false);
      }}
      onBlur={(event) => finish(event.currentTarget.value, true)}
    />
  );
}
