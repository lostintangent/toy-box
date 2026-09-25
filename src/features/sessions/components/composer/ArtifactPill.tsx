import type { ComponentProps } from "react";
import { Loader2 } from "lucide-react";
import { useEditorDisplay } from "@files/components/editor/kinds";
import type { WorkspaceFile } from "@files/model";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { cn } from "@/shared/utils";

export const outputPillClassName =
  "inline-flex max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-muted-foreground hover:bg-accent/40 hover:text-foreground";

export const emptyOutputPillClassName = `${outputPillClassName} pointer-events-none opacity-60`;

export function ArtifactPill({
  file,
  label,
  busy = false,
  open = false,
  className,
  ...props
}: ComponentProps<"button"> & {
  file: WorkspaceFile;
  label?: string;
  busy?: boolean;
  open?: boolean;
}) {
  const { name, Icon } = useEditorDisplay(file);

  return (
    <button
      {...props}
      type="button"
      title={file.path}
      className={cn(outputPillClassName, open && "bg-accent/15 text-foreground", className)}
    >
      {busy ? (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      )}
      <ScrollableFade className="flex max-w-48 whitespace-nowrap">
        <span className="shrink-0">{label ?? name}</span>
      </ScrollableFade>
    </button>
  );
}
