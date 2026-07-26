import { useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { JsonNode, JsonPointer } from "../document";
import type { JsonEditorStore } from "../store";
import type { AskIntent } from "../agent";
import { AddTypeItems } from "./AddMenu";
import { AskAgentDialog } from "./AskAgentDialog";

// Every row's actions in one tap-reachable place — the path that works without a
// hover or a pointer drag (touch, keyboard). "Ask agent" leads every menu; editing
// and reordering are direct. The desktop grip drag and this menu share the same
// store operations, so neither is the privileged way to reorder. The trigger hides
// until hover on pointer devices, and always shows where hover does not exist.

export function RowMenu({
  editor,
  node,
  pointer,
  parentId,
  index,
  count,
  hasKey,
}: {
  editor: JsonEditorStore;
  node: JsonNode;
  pointer: JsonPointer;
  parentId: string;
  index: number;
  count: number;
  hasKey: boolean;
}) {
  const { actions } = editor;
  const [asking, setAsking] = useState<AskIntent | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Row actions"
            className="ml-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DropdownMenuItem onSelect={() => setAsking("edit")}>
            <Sparkles />
            Ask agent…
          </DropdownMenuItem>
          <DropdownMenuSeparator />

          {(node.kind === "scalar" || hasKey) && (
            <>
              {node.kind === "scalar" && (
                <DropdownMenuItem onSelect={() => actions.beginEdit("value", node.id)}>
                  <Pencil />
                  Edit value
                </DropdownMenuItem>
              )}
              {hasKey && (
                <DropdownMenuItem onSelect={() => actions.beginEdit("key", node.id)}>
                  <Pencil />
                  Edit key
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => actions.move(parentId, index, index - 1)}
          >
            <ArrowUp />
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index >= count - 1}
            onSelect={() => actions.move(parentId, index, index + 1)}
          >
            <ArrowDown />
            Move down
          </DropdownMenuItem>
          {node.kind !== "scalar" && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Plus />
                {node.kind === "object" ? "Add property" : "Add item"}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <AddTypeItems
                  onAdd={(type) => actions.addChild(node.id, type)}
                  onAskAgent={() => setAsking("add")}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}

          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => actions.remove(node.id)}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AskAgentDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        node={node}
        pointer={pointer}
        intent={asking ?? "edit"}
      />
    </>
  );
}
