import type {
  DocumentDiff,
  JsonNode,
  JsonPointer,
  JsonScalar,
  NodeId,
  ScalarType,
} from "../document";

// The type surface of one JSON editor: the shape of its transient editing state
// and the semantic verbs that advance it. The document tree is the durable value;
// every other field in the state describes an in-progress interaction.

/** The scalar leaf types a new node can take, in the order the add menu offers them. */
export const SCALAR_TYPES = [
  "string",
  "number",
  "boolean",
  "null",
] as const satisfies readonly ScalarType[];

/** The container types a new node can take, offered after the scalars. */
export const CONTAINER_TYPES = ["object", "array"] as const;

/** Every type the editor can create: a scalar leaf or an empty container. */
export type NewNodeType = ScalarType | (typeof CONTAINER_TYPES)[number];

export type DropPosition = "before" | "after";

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
  /** A node a jump just revealed, briefly highlighted so the landing is obvious. */
  readonly flash: NodeId | null;
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
  /** Expand a jump target's ancestors and briefly highlight it. */
  reveal: (targetId: NodeId, ancestorIds: readonly NodeId[]) => void;
  clearFlash: () => void;

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
