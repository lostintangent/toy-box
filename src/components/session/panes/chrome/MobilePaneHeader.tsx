import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

/** Mobile-only pane header: a back button plus optional trailing actions (e.g. an
 *  artifact's saving indicator and mode menu). Hidden on desktop, where each pane's
 *  own controls take over. */
export function MobilePaneHeader({
  onBack,
  trailing,
}: {
  onBack?: () => void;
  trailing?: ReactNode;
}) {
  if (!onBack) return null;

  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b bg-background p-2 pt-0 md:hidden">
      <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0 gap-2">
        <ArrowLeft className="h-4 w-4" />
        Back to Sessions
      </Button>
      {trailing && <div className="flex min-w-0 items-center gap-1.5">{trailing}</div>}
    </div>
  );
}
