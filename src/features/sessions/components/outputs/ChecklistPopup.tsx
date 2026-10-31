import { ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import { Checklist, type ChecklistItem } from "@/shared/ui/checklist";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { ProgressBar } from "@/shared/ui/progress-bar";
import { SectionHeading } from "@/shared/ui/section-heading";
import { emptyOutputPillClassName, outputPillClassName } from "./ArtifactPill";

/** Checklist progress as a tray pill that opens the complete checklist. */
export function ChecklistPopup({
  items,
  label,
  headerDetail,
}: {
  items: readonly ChecklistItem[];
  label: string;
  headerDetail?: ReactNode;
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
      <PopoverContent
        data-slot="checklist-popup"
        className="w-80 p-0 text-sm"
        align="end"
        side="top"
      >
        <div className="border-b px-3 py-2">
          <SectionHeading
            title={label}
            count={`${completedCount}/${items.length}`}
            detail={headerDetail}
          />
        </div>
        <div className="max-h-80 overflow-y-auto px-3 py-2">
          <Checklist items={items} className="space-y-1 text-xs" />
        </div>
      </PopoverContent>
    </Popover>
  );
}
