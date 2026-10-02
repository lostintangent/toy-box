import { ListTodo } from "lucide-react";
import { Checklist, type ChecklistItem } from "@/shared/ui/checklist";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ProgressBar } from "@/shared/ui/progress-bar";
import { emptyOutputPillClassName, outputPillClassName } from "./ArtifactPill";

/** Checklist progress as a tray pill that opens the complete checklist. */
export function ChecklistPopup({
  items,
  label,
}: {
  items: readonly ChecklistItem[];
  label: string;
}) {
  const completedCount = items.filter((item) => item.status === "done").length;
  if (items.length === 0) {
    return (
      <span className={emptyOutputPillClassName}>
        <ListTodo className="size-3.5 shrink-0" />
        0/0
      </span>
    );
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`View ${label.toLowerCase()}`}
        className={outputPillClassName}
        render={<button type="button" />}
      >
        <ListTodo className="size-3.5 shrink-0" />
        {completedCount}/{items.length}
        <ProgressBar value={completedCount / items.length} className="max-sm:hidden" />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" side="top">
        <div className="text-sm">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <ListTodo className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">
              {label} ({completedCount}/{items.length})
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto px-3 py-2">
            <Checklist items={items} className="space-y-1 text-xs" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
