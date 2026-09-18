import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
} from "react";
import { useKeyHold } from "@tanstack/react-hotkeys";
import { useSelector } from "@tanstack/react-store";
import type { EditorStore } from "../../store";

type KeyboardFocus = "editor" | "control" | "text" | "outside";

/** Owns keyboard focus, held-key state, and editor command bindings. */
export function useKeyboard({
  store,
  selection,
  cancel,
  finishSpaceGesture,
}: {
  store: EditorStore;
  selection: {
    copy: () => Promise<void>;
    remove: () => boolean;
    nudge: (delta: { x: number; y: number }) => boolean;
  };
  cancel: () => void;
  finishSpaceGesture: () => void;
}) {
  const readOnly = useSelector(store, (state) => state.readOnly);
  const spaceHeld = useKeyHold("Space");
  const [focus, setFocus] = useState<KeyboardFocus>("outside");
  const wasSpacePressedRef = useRef(false);
  const spacePressed = spaceHeld && focus === "editor" && !readOnly;
  const finishHeldGesture = useEffectEvent(finishSpaceGesture);

  useEffect(() => {
    if (wasSpacePressedRef.current && !spacePressed) finishHeldGesture();
    wasSpacePressedRef.current = spacePressed;
  }, [spacePressed]);

  function handleFocus(event: FocusEvent<HTMLDivElement>) {
    const path = event.nativeEvent.composedPath();
    setFocus(
      path.some(isTextEntryTarget)
        ? "text"
        : path.some(isEditorControlTarget)
          ? "control"
          : "editor",
    );
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
      setFocus("outside");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const path = event.nativeEvent.composedPath();
    if (path.some(isTextEntryTarget)) return;
    const hasSelection = store.state.selection.length > 0;

    if (event.code === "Space") {
      if (readOnly || path.some(isEditorControlTarget)) return;
      event.preventDefault();
    }
    if (!readOnly && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) store.actions.redo();
      else store.actions.undo();
    }
    if (!readOnly && event.ctrlKey && event.key.toLowerCase() === "y") {
      event.preventDefault();
      store.actions.redo();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && hasSelection) {
      event.preventDefault();
      void selection.copy();
    }

    const arrowDirection = ARROW_KEY_DIRECTIONS[event.key];
    if (
      !readOnly &&
      arrowDirection &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      selection.nudge({
        x: arrowDirection.x * (event.shiftKey ? 10 : 1),
        y: arrowDirection.y * (event.shiftKey ? 10 : 1),
      })
    ) {
      event.preventDefault();
      return;
    }
    if (!readOnly && hasSelection && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      selection.remove();
    }
    if (event.key === "Escape") cancel();
    if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      event.preventDefault();
      if (!store.state.gesture) store.actions.fitContent();
    }
    if ((event.ctrlKey || event.metaKey) && (event.key === "+" || event.key === "=")) {
      event.preventDefault();
      if (!store.state.gesture) store.actions.zoomIn();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "-") {
      event.preventDefault();
      if (!store.state.gesture) store.actions.zoomOut();
    }
  }

  const editorProps = {
    onFocusCapture: handleFocus,
    onBlurCapture: handleBlur,
    onKeyDown: handleKeyDown,
  } satisfies HTMLAttributes<HTMLDivElement>;

  return { editorProps, spacePressed };
}

const ARROW_KEY_DIRECTIONS: Partial<Record<string, { x: number; y: number }>> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** Identifies DOM targets whose native text-entry behavior the editor must preserve. */
export function isTextEntryTarget(target: EventTarget | null | undefined): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

function isEditorControlTarget(target: EventTarget | null | undefined): boolean {
  return (
    target instanceof HTMLElement &&
    (target.tagName === "BUTTON" ||
      (target.tagName === "A" && target.hasAttribute("href")) ||
      target.getAttribute("role") === "menuitem")
  );
}
