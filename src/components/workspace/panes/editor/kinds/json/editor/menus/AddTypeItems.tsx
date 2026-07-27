import { Sparkles } from "lucide-react";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { CONTAINER_TYPES, SCALAR_TYPES, type NewNodeType } from "../../store";

// The child-type choices for a container's "Add" menu: "Ask agent" leads (set off by
// a divider) when the agent can generate the child, then the scalar types, then the
// containers — each labelled by its capitalized type name.
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
      {SCALAR_TYPES.map((type) => (
        <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
          {capitalize(type)}
        </DropdownMenuItem>
      ))}
      <DropdownMenuSeparator />
      {CONTAINER_TYPES.map((type) => (
        <DropdownMenuItem key={type} onSelect={() => onAdd(type)}>
          {capitalize(type)}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/** "string" → "String" — the label the menu shows for a node type. */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
