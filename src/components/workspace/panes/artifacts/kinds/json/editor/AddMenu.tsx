import { useState } from "react";
import { Plus, Sparkles } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { JsonNode, JsonPointer } from "../document";
import type { NewNodeType } from "../store";
import { CONTAINER_NODE_TYPES, SCALAR_NODE_TYPES } from "./addTypes";
import { AskAgentDialog } from "./AskAgentDialog";

// The child-type choices, shared by the inline "+ Add" row and the row menu's
// "Add" submenu. When the agent can generate a child, "Ask agent" leads, set off
// by a divider; then scalars, then containers.
export function AddTypeItems({
  onAdd,
  onAskAgent,
}: {
  onAdd: (type: NewNodeType) => void;
  onAskAgent?: () => void;
}) {
  return (
    <>
      {onAskAgent && (
        <>
          <DropdownMenuItem onSelect={onAskAgent}>
            <Sparkles />
            Ask agent…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
        </>
      )}
      {SCALAR_NODE_TYPES.map((entry) => (
        <DropdownMenuItem key={entry.type} onSelect={() => onAdd(entry.type)}>
          {entry.label}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      {CONTAINER_NODE_TYPES.map((entry) => (
        <DropdownMenuItem key={entry.type} onSelect={() => onAdd(entry.type)}>
          {entry.label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** The inline affordance for growing a container, shown beneath its children. */
export function AddMenu({
  onAdd,
  label,
  node,
  pointer,
}: {
  onAdd: (type: NewNodeType) => void;
  label: string;
  node: JsonNode;
  pointer: JsonPointer;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1 rounded-sm px-1 font-mono text-[13px] leading-6 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Plus className="size-3.5" />
            {label}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" onCloseAutoFocus={(event) => event.preventDefault()}>
          <AddTypeItems onAdd={onAdd} onAskAgent={() => setAsking(true)} />
        </DropdownMenuContent>
      </DropdownMenu>

      <AskAgentDialog
        open={asking}
        onOpenChange={setAsking}
        node={node}
        pointer={pointer}
        intent="add"
      />
    </>
  );
}
