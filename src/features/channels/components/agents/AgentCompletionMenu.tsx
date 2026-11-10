import { UserPlus, Users } from "lucide-react";
import { CompletionMenu } from "@/shared/composers/completions/CompletionMenu";
import type { Completions } from "@/shared/composers/completions/useCompletions";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { AgentAvatar } from "./AgentAvatar";
import { AgentEditor } from "./AgentEditor";
import type { AgentCompletionItem } from "./agentCompletionSource";

/** The agent mention menu. */
export function AgentCompletionMenu({
  completions,
}: {
  completions: Completions<AgentCompletionItem>;
}) {
  return (
    <CompletionMenu
      completions={completions}
      label="Mention an agent"
      icon={(item) =>
        item.kind === "everyone" ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-cyan-500/15 text-cyan-700 dark:text-cyan-300">
            <Users className="size-3.5" />
          </span>
        ) : item.kind === "create" ? (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <UserPlus className="size-3.5" />
          </span>
        ) : (
          <AgentAvatar agent={{ name: item.label, avatar: item.avatar }} className="size-7" />
        )
      }
      edit={({ agent }) =>
        agent && (() => openDialog((dialog) => <AgentEditor {...dialog} agent={agent} />))
      }
    />
  );
}
