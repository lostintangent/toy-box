import { Diff } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InputGroupButton } from "@/components/ui/input-group";
import type { FileDiff, LineDiff } from "@/hooks/diffs/useEditDiffs";

export interface DiffPopupProps {
  total: LineDiff;
  byFile: FileDiff[];
}

export function DiffPopup({ total, byFile }: DiffPopupProps) {
  const { added, removed } = total;

  // Don't show if no changes
  if (added === 0 && removed === 0) {
    return null;
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <InputGroupButton
          size="xs"
          aria-label="View diff stats"
          className="gap-1 font-mono text-xs"
        >
          <span className="text-diff-added">+{added}</span>
          <span className="text-diff-removed">-{removed}</span>
        </InputGroupButton>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <div className="text-sm">
          <div className="flex items-center gap-2 px-3 py-2 border-b">
            <Diff className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">Changed Files</span>
          </div>
          <div className="px-3 py-2 space-y-1 max-h-48 overflow-y-auto">
            {byFile.map((file) => (
              <div key={file.path} className="flex items-center gap-2 text-xs">
                <span className="truncate flex-1 font-mono text-muted-foreground">
                  {file.displayPath}
                </span>
                <span className="shrink-0 font-mono">
                  <span className="text-diff-added">+{file.diff.added}</span>{" "}
                  <span className="text-diff-removed">-{file.diff.removed}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
