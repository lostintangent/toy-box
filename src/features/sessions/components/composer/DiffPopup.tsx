import { Diff } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { cn } from "@/shared/utils";
import type { DiffStats } from "../../model/fileDiffs";
import type { FileDiffSummary } from "../transcript/editDiffs";
import { outputPillClassName } from "./ArtifactPill";

export function DiffPopup({ total, byFile }: { total: DiffStats; byFile: FileDiffSummary[] }) {
  const { added, removed } = total;

  return (
    <Popover>
      <PopoverTrigger
        aria-label="View changed files"
        className={cn(outputPillClassName, "gap-1 font-mono")}
        render={<button type="button" />}
      >
        <span className="text-diff-added">+{added}</span>
        <span className="text-diff-removed">-{removed}</span>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="end" side="top">
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
