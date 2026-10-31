import { machineFile } from "@files/model";
import { useRevealFile } from "@files/useRevealFile";
import { CompletionMenu } from "@/shared/composers/completions/CompletionMenu";
import type { Completions } from "@/shared/composers/completions/useCompletions";
import { Badge } from "@/shared/ui/badge";
import { RelativeTime } from "@/shared/ui/relative-time";
import type { PromptCompletionItem } from "./completionSources";

export function PromptCompletionMenu({
  completions,
}: {
  completions: Completions<PromptCompletionItem>;
}) {
  const revealFile = useRevealFile();
  return (
    <CompletionMenu
      completions={completions}
      label="Prompt completions"
      icon={(item) => item.icon && <item.icon className="size-4 shrink-0 text-muted-foreground" />}
      trailing={(item) => (
        <>
          {item.badge && <Badge variant="metadata">{item.badge}</Badge>}
          {item.updatedAt && (
            <RelativeTime
              date={item.updatedAt}
              className="shrink-0 text-xs text-muted-foreground"
            />
          )}
        </>
      )}
      edit={({ filePath }) => (filePath ? () => revealFile(machineFile(filePath)) : undefined)}
    />
  );
}
