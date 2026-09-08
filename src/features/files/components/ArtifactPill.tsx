import { Loader2 } from "lucide-react";
import { useEditorDisplay } from "@files/components/editor/kinds";
import type { WorkspaceFile } from "@files/model";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";

export function ArtifactPill({
  file,
  label,
  busy = false,
  onSelect,
}: {
  file: WorkspaceFile;
  label?: string;
  busy?: boolean;
  onSelect: () => void;
}) {
  const { name, Icon } = useEditorDisplay(file);

  return (
    <button
      type="button"
      title={file.path}
      className="inline-flex max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-full border bg-secondary-background px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      onClick={onSelect}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" />
      )}
      <ScrollableFade className="flex max-w-48 whitespace-nowrap">
        <span className="shrink-0">{label ?? name}</span>
      </ScrollableFade>
    </button>
  );
}
