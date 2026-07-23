import {
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { useSelector } from "@tanstack/react-store";
import type { SvgDocument } from "../../document";
import { createChildrenHistoryEntry } from "../../document/history";
import { resolveActiveTool, type EditorStore, type Tool } from "../../store";

type TextEdit = {
  element: SVGTextElement;
  before: readonly Node[];
  dirty: boolean;
};

/** Lets the browser edit a selected SVG text subtree while retaining artifact history. */
export function useTextEditing({
  document,
  store,
  selection,
  focusEditor,
}: {
  document: SvgDocument;
  store: EditorStore;
  selection: readonly SVGGraphicsElement[];
  focusEditor: () => void;
}) {
  const root = useSyncExternalStore(
    document.subscribe,
    () => document.getSnapshot().root,
    () => document.getSnapshot().root,
  );
  const activeTool = useSelector(store, resolveActiveTool);
  const activeEditRef = useRef<TextEdit | null>(null);

  useLayoutEffect(() => {
    activeEditRef.current = null;
  }, [root]);

  function finishTextEdit() {
    const edit = activeEditRef.current;
    activeEditRef.current = null;
    if (!edit || !root?.contains(edit.element) || !edit.dirty) return;
    const entry = createChildrenHistoryEntry(
      edit.element,
      edit.before,
      cloneNodes(edit.element.childNodes),
    );
    store.actions.commit(entry);
  }

  const finishTextEditForSynchronization = useEffectEvent(finishTextEdit);

  useLayoutEffect(() => {
    const editableText = editableTextFromSelection(selection, activeTool);
    if (!editableText) finishTextEditForSynchronization();
    document.setTextEditing(editableText !== null);
  }, [activeTool, document, selection]);

  function cancelTextEdit() {
    const edit = activeEditRef.current;
    activeEditRef.current = null;
    if (edit && root?.contains(edit.element)) {
      replaceChildren(edit.element, edit.before);
      document.publishSource();
    }
  }

  function beginTextEdit(element: SVGTextElement) {
    const current = activeEditRef.current;
    if (current?.element === element) return;
    finishTextEdit();
    document.setTextEditing(true);
    activeEditRef.current = {
      element,
      before: cloneNodes(element.childNodes),
      dirty: false,
    };
  }

  function prepareSelection(elements: readonly SVGGraphicsElement[]) {
    const nextText = editableTextFromSelection(elements, activeTool);
    const currentText = activeEditRef.current?.element ?? null;
    if (currentText !== nextText) finishTextEdit();
    document.setTextEditing(nextText !== null);
    if (nextText) beginTextEdit(nextText);
  }

  function suspendTextEdit() {
    finishTextEdit();
    document.setTextEditing(false);
  }

  function onBeforeInput(event: FormEvent<HTMLDivElement>) {
    event.stopPropagation();
    const selectedText = editableTextFromSelection(selection, activeTool);
    if (selectedText) beginTextEdit(selectedText);
  }

  function onInput(event: FormEvent<HTMLDivElement>) {
    event.stopPropagation();
    const edit = activeEditRef.current;
    if (!edit) return;
    edit.dirty = true;
    document.publishSource();
  }

  function onFocus() {
    const selectedText = editableTextFromSelection(selection, activeTool);
    if (selectedText) beginTextEdit(selectedText);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    if (event.key === "Enter") {
      event.preventDefault();
      finishTextEdit();
      store.actions.select([]);
      focusEditor();
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancelTextEdit();
      store.actions.select([]);
      focusEditor();
    }
  }

  function onPaste(event: ClipboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    const selectedText = editableTextFromSelection(selection, activeTool);
    if (!selectedText) return;

    event.preventDefault();
    beginTextEdit(selectedText);
    replaceBrowserSelection(selectedText, event.clipboardData.getData("text/plain"));
    const edit = activeEditRef.current;
    if (edit) edit.dirty = true;
    document.publishSource();
  }

  return {
    prepareSelection,
    suspendTextEdit,
    editingProps: {
      onBeforeInput,
      onInput,
      onFocus,
      onBlur: finishTextEdit,
      onKeyDown,
      onKeyUp: (event: KeyboardEvent<HTMLDivElement>) => event.stopPropagation(),
      onPaste,
    },
  };
}

function editableTextFromSelection(
  selection: readonly SVGGraphicsElement[],
  activeTool: Tool,
): SVGTextElement | null {
  if (activeTool !== "select" || selection.length !== 1) return null;
  const element = selection[0];
  return element.localName.toLowerCase() === "text" ? (element as SVGTextElement) : null;
}

function cloneNodes(nodes: ArrayLike<Node>): Node[] {
  return Array.from(nodes, (node) => node.cloneNode(true));
}

function replaceChildren(parent: Element, children: readonly Node[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const child of children) parent.appendChild(child.cloneNode(true));
}

function replaceBrowserSelection(element: SVGTextElement, content: string): void {
  const selection = globalThis.getSelection();
  const currentRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
  const range =
    currentRange && element.contains(currentRange.commonAncestorContainer)
      ? currentRange
      : element.ownerDocument.createRange();
  if (range !== currentRange) {
    range.selectNodeContents(element);
    range.collapse(false);
  }

  range.deleteContents();
  const text = element.ownerDocument.createTextNode(content);
  range.insertNode(text);
  range.setStartAfter(text);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
