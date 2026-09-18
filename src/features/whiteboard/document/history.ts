import type { History, HistoryEntry } from "../store";

export type AttributeSnapshot = {
  readonly namespace: string | null;
  readonly name: string;
  readonly value: string | null;
};

type AttributeTransition = {
  readonly element: Element;
  readonly before: AttributeSnapshot;
  readonly after: AttributeSnapshot;
};

const MAX_SVG_HISTORY_SIZE = 50;

export function snapshotAttribute(
  element: Element,
  name: string,
  namespace: string | null = null,
): AttributeSnapshot {
  return {
    namespace,
    name,
    value: namespace ? element.getAttributeNS(namespace, name) : element.getAttribute(name),
  };
}

export function createAttributesHistoryEntry(
  transitions: readonly AttributeTransition[],
): HistoryEntry | null {
  const changedAttributes = transitions.filter(
    ({ before, after }) =>
      before.value !== after.value ||
      before.name !== after.name ||
      before.namespace !== after.namespace,
  );
  return changedAttributes.length > 0
    ? { type: "attributes", transitions: changedAttributes }
    : null;
}

export function createChildrenHistoryEntry(
  parent: Element,
  before: readonly Node[],
  after: readonly Node[],
): HistoryEntry | null {
  const unchanged =
    before.length === after.length &&
    before.every((node, index) => node === after[index] || node.isEqualNode(after[index]));
  return unchanged ? null : { type: "children", parent, before: [...before], after: [...after] };
}

export function createCompoundHistoryEntry(
  entries: readonly (HistoryEntry | null)[],
): HistoryEntry | null {
  const actualEntries = entries.filter((entry): entry is HistoryEntry => entry !== null);
  if (actualEntries.length === 0) return null;
  return actualEntries.length === 1
    ? actualEntries[0]
    : { type: "compound", entries: actualEntries };
}

export function recordHistoryEntry(history: History, entry: HistoryEntry): History {
  const undoStack = [...history.undoStack, entry].slice(-MAX_SVG_HISTORY_SIZE);
  return { undoStack, redoStack: [] };
}

export function undoHistory(history: History): History | null {
  const entry = history.undoStack.at(-1);
  if (!entry) return null;
  applyHistoryEntry(entry, "undo");
  return {
    undoStack: history.undoStack.slice(0, -1),
    redoStack: [...history.redoStack, entry],
  };
}

export function redoHistory(history: History): History | null {
  const entry = history.redoStack.at(-1);
  if (!entry) return null;
  applyHistoryEntry(entry, "redo");
  return {
    undoStack: [...history.undoStack, entry],
    redoStack: history.redoStack.slice(0, -1),
  };
}

export function applyHistoryEntry(entry: HistoryEntry, direction: "undo" | "redo"): void {
  switch (entry.type) {
    case "attributes": {
      for (const transition of entry.transitions) {
        writeAttribute(
          transition.element,
          direction === "undo" ? transition.before : transition.after,
        );
      }
      return;
    }
    case "children": {
      replaceChildren(entry.parent, direction === "undo" ? entry.before : entry.after);
      return;
    }
    case "compound": {
      const entries = direction === "undo" ? [...entry.entries].reverse() : entry.entries;
      for (const childEntry of entries) applyHistoryEntry(childEntry, direction);
    }
  }
}

function writeAttribute(element: Element, attribute: AttributeSnapshot): void {
  const { namespace, name, value } = attribute;
  if (value === null) {
    if (namespace) element.removeAttributeNS(namespace, name);
    else element.removeAttribute(name);
  } else if (namespace) {
    element.setAttributeNS(namespace, name, value);
  } else {
    element.setAttribute(name, value);
  }
}

function replaceChildren(parent: Element, children: readonly Node[]): void {
  while (parent.firstChild) parent.removeChild(parent.firstChild);
  for (const child of children) parent.appendChild(child);
}
