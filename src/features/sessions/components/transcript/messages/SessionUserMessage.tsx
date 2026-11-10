import { Undo2 } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { DestructiveConfirmationDialog } from "@/shared/dialogs/DestructiveConfirmationDialog";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { isLiveActivity } from "../../../model/activity";
import { useSessionsActivity } from "../../../useSessionActivity";
import type { UserMessage as UserMessageType } from "../../../model";
import { sessionMutations } from "../../../mutations";
import { useCurrentSession } from "../../CurrentSessionContext";
import { UserMessage } from "@/shared/messages/UserMessage";
import { PromptReferenceMarkdown } from "../../references/PromptReferences";

export function SessionUserMessage({ message }: { message: UserMessageType }) {
  const { sessionId, mode } = useCurrentSession();
  const isSessionLive = useSessionsActivity((activities) =>
    isLiveActivity(activities[sessionId]?.status),
  );

  const rewindAction =
    message.timestamp && message.rewindable !== false && mode !== "passive" && !isSessionLive ? (
      <RewindControl sessionId={sessionId} timestamp={message.timestamp} />
    ) : undefined;

  return (
    <UserMessage message={message} extraActions={rewindAction}>
      <PromptReferenceMarkdown content={message.content} />
    </UserMessage>
  );
}

function RewindControl({ sessionId, timestamp }: { sessionId: string; timestamp: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground hover:text-foreground"
            aria-label="Rewind to before this message"
            onClick={() =>
              openDialog((dialog) => (
                <DestructiveConfirmationDialog
                  {...dialog}
                  title="Rewind conversation?"
                  description="This removes this message and every message after it. Files are not changed. This action cannot be undone."
                  confirmLabel="Rewind"
                  pendingLabel="Rewinding..."
                  mutation={sessionMutations.rewindSession(sessionId, timestamp)}
                />
              ))
            }
          >
            <Undo2 aria-hidden />
          </Button>
        }
      />
      <TooltipContent sideOffset={4}>Rewind to before this message</TooltipContent>
    </Tooltip>
  );
}
