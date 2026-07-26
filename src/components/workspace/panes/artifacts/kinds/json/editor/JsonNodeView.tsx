import { useRef, type DragEvent } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import { ChevronDown, ChevronRight, GripVertical, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  childCount,
  childPointer,
  scalarTypeOf,
  type JsonNode,
  type JsonPointer,
} from "../document";
import type { JsonEditorStore } from "../store";
import { useJsonTheme } from "../theme";
import { AddMenu } from "./AddMenu";
import { InlineEdit } from "./InlineEdit";
import { RowMenu } from "./RowMenu";
import { inferScalar, valueText } from "./values";

// How a node attaches to its parent — the context a row needs that the node
// itself does not carry: its key (in an object), its index among `count`
// siblings, and its parent's id.
export type Edge =
  | { kind: "root" }
  | { kind: "member"; parentId: string; index: number; count: number; key: string }
  | { kind: "item"; parentId: string; index: number; count: number };

const INDENT_STEP = 14;
const INDENT_BASE = 8;

export function JsonNodeView({
  editor,
  node,
  edge,
  depth,
  pointer,
}: {
  editor: JsonEditorStore;
  node: JsonNode;
  edge: Edge;
  depth: number;
  pointer: JsonPointer;
}) {
  const theme = useJsonTheme();
  const view = useSelector(
    editor,
    (state) => {
      const { drag } = state;
      // A row only participates in a drag that belongs to its own parent, which is
      // what confines reordering to siblings.
      const related =
        drag !== null && edge.kind !== "root" && drag.parentId === edge.parentId ? drag : null;
      const over = related?.over ?? null;
      return {
        readOnly: state.readOnly,
        collapsed: state.collapsed.has(node.id),
        editingValue: state.editing?.target === "value" && state.editing.id === node.id,
        editingKey: state.editing?.target === "key" && state.editing.id === node.id,
        dragging: drag?.id === node.id,
        droppable: related !== null && related.id !== node.id,
        dropBefore: over !== null && over.id === node.id && over.position === "before",
        dropAfter: over !== null && over.id === node.id && over.position === "after",
        change: state.diff.get(pointer),
        busy: state.activePointers.has(pointer),
      };
    },
    { compare: shallow },
  );
  const { actions } = editor;
  const rowRef = useRef<HTMLDivElement>(null);

  const indent = depth * INDENT_STEP + INDENT_BASE;
  // A node a worker is editing is locked: no drag, edit, or menu, because moving or
  // renaming it would change the pointer the worker is about to write back to.
  const draggable = !view.readOnly && edge.kind !== "root" && !view.busy;
  // A landed edit tints the row; an in-progress worker shows only the spinner, so
  // "working" never reads as "changed".
  const background =
    view.change === "added"
      ? theme.diff.added
      : view.change === "changed"
        ? theme.diff.changed
        : undefined;

  function handleDragStart(event: DragEvent<HTMLElement>): void {
    if (edge.kind === "root") return;
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", node.id);
    if (rowRef.current) event.dataTransfer.setDragImage(rowRef.current, 12, 12);
    actions.beginDrag(node.id, edge.parentId, edge.index);
  }

  function handleDragOver(event: DragEvent<HTMLElement>): void {
    if (!view.droppable || edge.kind === "root") return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
    actions.updateDropTarget(node.id, edge.parentId, edge.index, position);
  }

  function handleDrop(event: DragEvent<HTMLElement>): void {
    if (!view.droppable) return;
    event.preventDefault();
    event.stopPropagation();
    actions.commitDrag();
  }

  return (
    <div>
      <div
        ref={rowRef}
        className={cn(
          "group relative flex min-w-0 items-center gap-1 py-0.5 pr-2 font-mono text-[13px] leading-6 hover:bg-muted/40",
          view.dragging && "opacity-40",
        )}
        style={{ paddingLeft: indent, backgroundColor: background }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {(view.dropBefore || view.dropAfter) && (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-2 h-0.5 rounded-full",
              view.dropBefore ? "top-0" : "bottom-0",
            )}
            style={{ left: indent, background: theme.accent }}
          />
        )}

        {draggable ? (
          <span
            draggable
            onDragStart={handleDragStart}
            onDragEnd={() => actions.cancelDrag()}
            className="flex size-4 shrink-0 cursor-grab items-center justify-center text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            aria-label="Drag to reorder"
          >
            <GripVertical className="size-3.5" />
          </span>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {node.kind !== "scalar" ? (
          <button
            type="button"
            onClick={() => actions.toggleCollapsed(node.id)}
            className="flex size-4 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={view.collapsed ? "Expand" : "Collapse"}
          >
            {view.collapsed ? (
              <ChevronRight className="size-3.5" />
            ) : (
              <ChevronDown className="size-3.5" />
            )}
          </button>
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {edge.kind === "member" &&
          (view.editingKey ? (
            <InlineEdit
              initial={edge.key}
              ariaLabel="Edit property name"
              onCommit={(text) => actions.renameKey(node.id, text)}
              onCancel={actions.cancelEdit}
            />
          ) : (
            <span
              className={cn(
                "shrink-0 text-foreground",
                !view.readOnly && !view.busy && "cursor-text",
              )}
              onDoubleClick={() => !view.busy && actions.beginEdit("key", node.id)}
              title={view.readOnly || view.busy ? undefined : "Double-click to rename"}
            >
              {edge.key}
              <span className="text-muted-foreground">: </span>
            </span>
          ))}

        {node.kind !== "scalar" ? (
          <ContainerSummary node={node} />
        ) : view.editingValue ? (
          <InlineEdit
            initial={valueText(node.value)}
            ariaLabel="Edit value"
            color={theme.values[scalarTypeOf(node.value)]}
            onCommit={(text) => {
              actions.replaceValue(node.id, inferScalar(text));
              return true;
            }}
            onCancel={actions.cancelEdit}
          />
        ) : typeof node.value === "boolean" ? (
          <Checkbox
            checked={node.value}
            disabled={view.readOnly || view.busy}
            onCheckedChange={(checked) => actions.replaceValue(node.id, checked === true)}
            aria-label="Toggle value"
          />
        ) : (
          <span
            className={cn("min-w-0 truncate", !view.readOnly && !view.busy && "cursor-text")}
            style={{ color: theme.values[scalarTypeOf(node.value)] }}
            onDoubleClick={() => !view.busy && actions.beginEdit("value", node.id)}
            title={view.readOnly || view.busy ? undefined : "Double-click to edit"}
          >
            {typeof node.value === "string" ? (
              <>
                <span className="text-muted-foreground">"</span>
                {node.value}
                <span className="text-muted-foreground">"</span>
              </>
            ) : (
              valueText(node.value)
            )}
          </span>
        )}

        {view.busy ? (
          <span
            className="ml-1 flex size-5 shrink-0 items-center justify-center"
            aria-label="Agent editing this node"
          >
            <Loader2 className="size-3.5 animate-spin" style={{ color: theme.accent }} />
          </span>
        ) : (
          edge.kind !== "root" &&
          !view.readOnly && (
            <RowMenu
              editor={editor}
              node={node}
              pointer={pointer}
              parentId={edge.parentId}
              index={edge.index}
              count={edge.count}
              hasKey={edge.kind === "member"}
            />
          )
        )}
      </div>

      {node.kind !== "scalar" && !view.collapsed && (
        <div>
          {node.kind === "object"
            ? node.members.map((member, index) => (
                <JsonNodeView
                  key={member.node.id}
                  editor={editor}
                  node={member.node}
                  edge={{
                    kind: "member",
                    parentId: node.id,
                    index,
                    count: node.members.length,
                    key: member.key,
                  }}
                  depth={depth + 1}
                  pointer={childPointer(pointer, member.key)}
                />
              ))
            : node.items.map((item, index) => (
                <JsonNodeView
                  key={item.id}
                  editor={editor}
                  node={item}
                  edge={{ kind: "item", parentId: node.id, index, count: node.items.length }}
                  depth={depth + 1}
                  pointer={childPointer(pointer, index)}
                />
              ))}
          {!view.readOnly && (
            <div
              className="flex items-center gap-1 py-0.5"
              style={{ paddingLeft: (depth + 1) * INDENT_STEP + INDENT_BASE }}
            >
              {/* Empty grip and caret columns so the control aligns under sibling content. */}
              <span className="size-4 shrink-0" />
              <span className="size-4 shrink-0" />
              <AddMenu
                label={node.kind === "object" ? "Add property" : "Add item"}
                node={node}
                pointer={pointer}
                onAdd={(type) => actions.addChild(node.id, type)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ContainerSummary({ node }: { node: JsonNode }) {
  const [open, close] = node.kind === "array" ? ["[", "]"] : ["{", "}"];
  const count = childCount(node);
  return (
    <span className="text-muted-foreground">
      {open}
      {count > 0 ? ` ${count} ` : ""}
      {close}
    </span>
  );
}
