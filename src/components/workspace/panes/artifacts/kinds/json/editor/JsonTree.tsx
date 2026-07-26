import type { KeyboardEvent } from "react";
import { useSelector } from "@tanstack/react-store";
import { ROOT_POINTER } from "../document";
import type { JsonEditorStore } from "../store";
import { JsonNodeView } from "./JsonNodeView";

/** The scrollable projection of one JSON document, or a reason it can't be shown. */
export function JsonTree({ editor }: { editor: JsonEditorStore }) {
  const root = useSelector(editor, (state) => state.root);
  const parseError = useSelector(editor, (state) => state.parseError);

  // Undo/redo while the tree is focused; an open field keeps its own native undo.
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (!(event.metaKey || event.ctrlKey)) return;
    const tag = (event.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) editor.actions.redo();
      else editor.actions.undo();
    } else if (key === "y") {
      event.preventDefault();
      editor.actions.redo();
    }
  }

  if (!root) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center">
        <p className="text-sm text-muted-foreground">This file isn&apos;t valid JSON yet.</p>
        {parseError && <p className="font-mono text-xs text-muted-foreground/80">{parseError}</p>}
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="h-full overflow-auto py-2 text-foreground outline-none"
    >
      <JsonNodeView
        editor={editor}
        node={root}
        edge={{ kind: "root" }}
        depth={0}
        pointer={ROOT_POINTER}
      />
    </div>
  );
}
