import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ArtifactSavingIndicatorProps = {
  isSaving: boolean;
  className?: string;
};

export function ArtifactSavingIndicator({ isSaving, className }: ArtifactSavingIndicatorProps) {
  if (!isSaving) return null;

  return (
    <div
      className={cn("flex items-center justify-center p-1.5", className)}
      role="status"
      aria-label="Saving artifact"
      title="Saving artifact"
    >
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
    </div>
  );
}
