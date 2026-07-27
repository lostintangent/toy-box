import { createStore } from "@tanstack/store";
import {
  appendItem,
  arrayNode,
  createIdFactory,
  findNode,
  insertMember,
  objectNode,
  parseDocument,
  reconcile,
  removeNode,
  renameMemberKey,
  reorderChildren,
  serializeDocument,
  setValue,
  scalarNode,
  type JsonNode,
  type JsonPointer,
  type NodeId,
} from "../document";
import type { DropPosition, JsonEditorActions, JsonEditorState, NewNodeType } from "./types";

// The transient editing layer over one JSON document. The document tree is the
// durable value; everything else in the state describes an in-progress interaction.
// Mutating actions publish freshly serialized source exactly once so the artifact
// lifecycle can persist it; `loadSource` re-baselines from disk without publishing,
// which is what keeps an agent's external edit from echoing back as a user save.
//
// Because the tree is immutable, undo is simply a stack of past roots and redo a
// stack of future ones — no reversible edit log is needed.

export function createJsonEditorStore(readOnly: boolean) {
  const newId = createIdFactory();
  const sourceListeners = new Set<(source: string) => void>();

  const store = createStore<JsonEditorState, JsonEditorActions>(
    {
      readOnly,
      root: null,
      parseError: null,
      collapsed: new Set(),
      editing: null,
      drag: null,
      diff: new Map(),
      activePointers: new Set(),
      flash: null,
      past: [],
      future: [],
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
          diff: new Map(),
          past: current ? [...state.past, current] : state.past,
          future: [],
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
          const parsed = result.ok ? result.root : null;
          // Reconcile the incoming tree against the current one: node ids (and untouched
          // subtree references) are reused wherever a node is structurally unchanged, so
          // identity stays stable across the re-parse. When nothing changed — our own
          // save echoing back — the whole tree reconciles to the very same reference, so
          // there is nothing to apply.
          const change = previous && parsed ? reconcile(previous, parsed) : null;
          if (change && change.root === previous) return;
          const root = change ? change.root : parsed;
          setState((state) => ({
            ...state,
            root,
            parseError: result.ok ? null : result.error,
            // Stable ids mean collapse and an in-progress edit carry over untouched; the
            // edit only closes if the node it targets no longer exists.
            collapsed: change ? state.collapsed : new Set(),
            editing:
              change && state.editing && findNode(change.root, state.editing.id)
                ? state.editing
                : null,
            drag: null,
            diff: change ? change.diff : new Map(),
            flash: null,
            past: [],
            future: [],
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
            collapsed: collapsed && root ? collectContainerIds(root) : new Set(),
          }));
        },
        reveal(targetId, ancestorIds) {
          setState((state) => {
            let collapsed = state.collapsed;
            if (ancestorIds.some((id) => collapsed.has(id))) {
              const expanded = new Set(collapsed);
              for (const id of ancestorIds) expanded.delete(id);
              collapsed = expanded;
            }
            return { ...state, collapsed, flash: targetId };
          });
        },
        clearFlash() {
          setState((state) => (state.flash === null ? state : { ...state, flash: null }));
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
            diff: new Map(),
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
            diff: new Map(),
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
