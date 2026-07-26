import { createStore } from "@tanstack/store";
import {
  appendItem,
  arrayNode,
  createIdFactory,
  diffDocuments,
  findNode,
  insertMember,
  objectNode,
  parseDocument,
  removeNode,
  renameMemberKey,
  reorderChildren,
  serializeDocument,
  setValue,
  scalarNode,
  type DocumentDiff,
  type JsonNode,
  type JsonPointer,
  type JsonScalar,
  type NodeId,
  type ScalarType,
} from "./document";

// The complete transient editing layer over one JSON document. The document tree
// is the durable value; everything else here describes an in-progress interaction.
// Mutating actions publish freshly serialized source exactly once so the artifact
// lifecycle can persist it; `loadSource` re-baselines from disk without publishing,
// which is what keeps an agent's external edit from echoing back as a user save.
//
// Because the tree is immutable, undo is simply a stack of past roots and redo a
// stack of future ones — no reversible edit log is needed.

export type NewNodeType = ScalarType | "object" | "array";

type DropPosition = "before" | "after";

/** The inline field currently open for editing: a leaf's value or a member's key. */
type Editing = { readonly target: "key" | "value"; readonly id: NodeId };

/** One in-flight reorder, confined to `parentId` — a child never leaves its parent. */
type DragReorder = {
  readonly id: NodeId;
  readonly parentId: NodeId;
  readonly fromIndex: number;
  readonly over: {
    readonly id: NodeId;
    readonly index: number;
    readonly position: DropPosition;
  } | null;
};

export type JsonEditorState = {
  readonly readOnly: boolean;
  /** Null only when the current source failed to parse; `parseError` explains why. */
  readonly root: JsonNode | null;
  readonly parseError: string | null;
  readonly collapsed: ReadonlySet<NodeId>;
  readonly editing: Editing | null;
  readonly drag: DragReorder | null;
  /** What the last external edit added or changed, by pointer; empty once the user edits. */
  readonly diff: DocumentDiff;
  /** Pointers a worker is currently editing, shown as in-progress presence. */
  readonly activePointers: ReadonlySet<JsonPointer>;
  /** Roots to restore on undo (oldest first) and on redo; cleared by external reloads. */
  readonly past: readonly JsonNode[];
  readonly future: readonly JsonNode[];
};

/** The semantic operations one JSON editor supports. */
export type JsonEditorActions = {
  loadSource: (source: string) => void;
  setReadOnly: (readOnly: boolean) => void;
  setActivePointers: (pointers: ReadonlySet<JsonPointer>) => void;

  replaceValue: (id: NodeId, value: JsonScalar) => void;
  renameKey: (childId: NodeId, key: string) => boolean;
  /** Add a typed child to one container; the store dispatches on object vs array. */
  addChild: (containerId: NodeId, type: NewNodeType) => void;
  remove: (id: NodeId) => void;
  /** Reorder a child within its parent by index (the menu's Move up/down). */
  move: (parentId: NodeId, fromIndex: number, toIndex: number) => void;
  undo: () => void;
  redo: () => void;

  toggleCollapsed: (id: NodeId) => void;
  setCollapsedAll: (collapsed: boolean) => void;

  beginEdit: (target: "key" | "value", id: NodeId) => void;
  cancelEdit: () => void;

  beginDrag: (id: NodeId, parentId: NodeId, fromIndex: number) => void;
  updateDropTarget: (
    overId: NodeId,
    overParentId: NodeId,
    overIndex: number,
    position: DropPosition,
  ) => void;
  cancelDrag: () => void;
  commitDrag: () => void;
};

const EMPTY_COLLAPSED: ReadonlySet<NodeId> = new Set();
const EMPTY_DIFF: DocumentDiff = new Map();
const EMPTY_POINTERS: ReadonlySet<JsonPointer> = new Set();
const EMPTY_HISTORY: readonly JsonNode[] = [];

export function createJsonEditorStore(readOnly: boolean) {
  const newId = createIdFactory();
  const sourceListeners = new Set<(source: string) => void>();

  const store = createStore<JsonEditorState, JsonEditorActions>(
    {
      readOnly,
      root: null,
      parseError: null,
      collapsed: EMPTY_COLLAPSED,
      editing: null,
      drag: null,
      diff: EMPTY_DIFF,
      activePointers: EMPTY_POINTERS,
      past: EMPTY_HISTORY,
      future: EMPTY_HISTORY,
    },
    ({ setState, get }) => {
      function publish(root: JsonNode): void {
        const source = serializeDocument(root);
        for (const listener of sourceListeners) listener(source);
      }

      /** Adopt a new tree, recording the prior one for undo and publishing it, but
       *  only when it actually differs. */
      function commit(nextRoot: JsonNode, patch: Partial<JsonEditorState>): void {
        const current = get().root;
        if (nextRoot === current) {
          setState((state) => ({ ...state, ...patch }));
          return;
        }
        setState((state) => ({
          ...state,
          ...patch,
          root: nextRoot,
          diff: EMPTY_DIFF,
          past: current ? [...state.past, current] : state.past,
          future: EMPTY_HISTORY,
        }));
        publish(nextRoot);
      }

      function createNode(type: NewNodeType): JsonNode {
        switch (type) {
          case "object":
            return objectNode(newId());
          case "array":
            return arrayNode(newId());
          case "number":
            return scalarNode(newId(), 0);
          case "boolean":
            return scalarNode(newId(), false);
          case "null":
            return scalarNode(newId(), null);
          case "string":
            return scalarNode(newId(), "");
        }
      }

      return {
        loadSource(source) {
          const previous = get().root;
          const result = parseDocument(source, newId);
          const root = result.ok ? result.root : null;
          // Diff the outgoing tree against the agent's incoming one — never our own
          // save, which does not re-run this — so the change lands highlighted. The
          // first load has no previous tree and so produces no diff.
          const diff = previous && root ? diffDocuments(previous, root) : EMPTY_DIFF;
          setState((state) => ({
            ...state,
            root,
            parseError: result.ok ? null : result.error,
            collapsed: EMPTY_COLLAPSED,
            editing: null,
            drag: null,
            diff,
            past: EMPTY_HISTORY,
            future: EMPTY_HISTORY,
          }));
        },
        setReadOnly(nextReadOnly) {
          setState((state) =>
            state.readOnly === nextReadOnly
              ? state
              : {
                  ...state,
                  readOnly: nextReadOnly,
                  editing: nextReadOnly ? null : state.editing,
                  drag: nextReadOnly ? null : state.drag,
                },
          );
        },
        setActivePointers(pointers) {
          setState((state) =>
            samePointers(state.activePointers, pointers)
              ? state
              : { ...state, activePointers: pointers },
          );
        },
        replaceValue(id, value) {
          const root = get().root;
          if (!root || get().readOnly) return;
          commit(setValue(root, id, value), { editing: null });
        },
        renameKey(childId, key) {
          const root = get().root;
          if (!root || get().readOnly) return false;
          const next = renameMemberKey(root, childId, key);
          if (next === null) return false;
          commit(next, { editing: null });
          return true;
        },
        addChild(containerId, type) {
          const root = get().root;
          if (!root || get().readOnly) return;
          const container = findNode(root, containerId);
          if (!container) return;
          const node = createNode(type);
          const collapsed = withCollapsed(get().collapsed, containerId, false);
          if (container.kind === "object") {
            commit(insertMember(root, containerId, { key: uniqueKey(container), node }), {
              editing: { target: "key", id: node.id },
              collapsed,
            });
          } else if (container.kind === "array") {
            const editsValue = type !== "object" && type !== "array";
            commit(appendItem(root, containerId, node), {
              editing: editsValue ? { target: "value", id: node.id } : null,
              collapsed,
            });
          }
        },
        remove(id) {
          const root = get().root;
          if (!root || get().readOnly) return;
          commit(removeNode(root, id), {
            editing: null,
            drag: null,
            collapsed: withCollapsed(get().collapsed, id, false),
          });
        },
        move(parentId, fromIndex, toIndex) {
          const root = get().root;
          if (!root || get().readOnly) return;
          commit(reorderChildren(root, parentId, fromIndex, toIndex), {});
        },
        toggleCollapsed(id) {
          setState((state) => ({
            ...state,
            collapsed: withCollapsed(state.collapsed, id, !state.collapsed.has(id)),
          }));
        },
        setCollapsedAll(collapsed) {
          const root = get().root;
          setState((state) => ({
            ...state,
            collapsed: collapsed && root ? collectContainerIds(root) : EMPTY_COLLAPSED,
          }));
        },
        beginEdit(target, id) {
          if (get().readOnly) return;
          setState((state) => ({ ...state, editing: { target, id } }));
        },
        cancelEdit() {
          setState((state) => (state.editing ? { ...state, editing: null } : state));
        },
        beginDrag(id, parentId, fromIndex) {
          if (get().readOnly) return;
          setState((state) => ({
            ...state,
            editing: null,
            drag: { id, parentId, fromIndex, over: null },
          }));
        },
        updateDropTarget(overId, overParentId, overIndex, position) {
          const { drag } = get();
          if (!drag || overParentId !== drag.parentId) return;
          setState((state) =>
            state.drag
              ? {
                  ...state,
                  drag: { ...state.drag, over: { id: overId, index: overIndex, position } },
                }
              : state,
          );
        },
        cancelDrag() {
          setState((state) => (state.drag ? { ...state, drag: null } : state));
        },
        commitDrag() {
          const { drag, root } = get();
          if (!drag || !root) return;
          if (!drag.over) {
            setState((state) => ({ ...state, drag: null }));
            return;
          }
          const to = resolveDropIndex(drag.fromIndex, drag.over.index, drag.over.position);
          commit(reorderChildren(root, drag.parentId, drag.fromIndex, to), { drag: null });
        },
        undo() {
          const { past, root } = get();
          const previous = past.at(-1);
          if (!previous || !root) return;
          setState((state) => ({
            ...state,
            root: previous,
            past: state.past.slice(0, -1),
            future: [...state.future, root],
            editing: null,
            drag: null,
            diff: EMPTY_DIFF,
          }));
          publish(previous);
        },
        redo() {
          const { future, root } = get();
          const next = future.at(-1);
          if (!next || !root) return;
          setState((state) => ({
            ...state,
            root: next,
            future: state.future.slice(0, -1),
            past: [...state.past, root],
            editing: null,
            drag: null,
            diff: EMPTY_DIFF,
          }));
          publish(next);
        },
      };
    },
  );

  return Object.assign(store, {
    /** Observe freshly serialized source produced by user edits (never re-baselines). */
    subscribeToSource(listener: (source: string) => void): () => void {
      sourceListeners.add(listener);
      return () => {
        sourceListeners.delete(listener);
      };
    },
  });
}

export type JsonEditorStore = ReturnType<typeof createJsonEditorStore>;

/** Translate a before/after drop onto an original index into an array-move target. */
function resolveDropIndex(from: number, overIndex: number, position: DropPosition): number {
  const target = position === "before" ? overIndex : overIndex + 1;
  return target > from ? target - 1 : target;
}

function samePointers(a: ReadonlySet<JsonPointer>, b: ReadonlySet<JsonPointer>): boolean {
  if (a.size !== b.size) return false;
  for (const pointer of a) if (!b.has(pointer)) return false;
  return true;
}

function withCollapsed(
  collapsed: ReadonlySet<NodeId>,
  id: NodeId,
  next: boolean,
): ReadonlySet<NodeId> {
  if (next === collapsed.has(id)) return collapsed;
  const result = new Set(collapsed);
  if (next) result.add(id);
  else result.delete(id);
  return result;
}

function uniqueKey(object: JsonNode & { kind: "object" }, base = "key"): string {
  const keys = new Set(object.members.map((member) => member.key));
  if (!keys.has(base)) return base;
  let suffix = 2;
  while (keys.has(`${base}${suffix}`)) suffix += 1;
  return `${base}${suffix}`;
}

/** Every nested container's identity except the root, so "collapse all" keeps a top level. */
function collectContainerIds(root: JsonNode): ReadonlySet<NodeId> {
  const ids = new Set<NodeId>();
  const walk = (node: JsonNode): void => {
    const children =
      node.kind === "object"
        ? node.members.map((member) => member.node)
        : node.kind === "array"
          ? node.items
          : [];
    for (const child of children) {
      if (child.kind !== "scalar") ids.add(child.id);
      walk(child);
    }
  };
  walk(root);
  return ids;
}
