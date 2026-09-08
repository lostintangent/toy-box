import { useState } from "react";
import { Undo2 } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { isWorkspaceSessionLive } from "@workspace/model/state/reducer";
import type { UserMessage as UserMessageType } from "../../../model";
import { sessionMutations } from "../../../mutations";
import { useCurrentSession } from "../../CurrentSessionContext";
import { UserMessage } from "./UserMessage";

export function SessionUserMessage({ message }: { message: UserMessageType }) {
  const { sessionId, mode } = useCurrentSession();
  const isSessionLive = useWorkspaceSelector((workspace) =>
    isWorkspaceSessionLive(workspace.sessionStates[sessionId]?.status),
  );
  const rewindAction =
    message.timestamp && mode !== "passive" && !isSessionLive ? (
      <RewindControl sessionId={sessionId} timestamp={message.timestamp} />
    ) : undefined;

  return <UserMessage message={message} extraActions={rewindAction} />;
}

function RewindControl({ sessionId, timestamp }: { sessionId: string; timestamp: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-muted-foreground hover:text-foreground"
              aria-label="Rewind to before this message"
              onClick={() => setOpen(true)}
            >
              <Undo2 aria-hidden />
            </Button>
          }
        />
        <TooltipContent sideOffset={4}>Rewind to before this message</TooltipContent>
      </Tooltip>
      {open && (
        <DestructiveConfirmationDialog
          title="Rewind conversation?"
          description="This removes this message and every message after it. Files are not changed. This action cannot be undone."
          confirmLabel="Rewind"
          pendingLabel="Rewinding..."
          mutation={sessionMutations.rewindSession(sessionId, timestamp)}
          onOpenChange={setOpen}
        />
      )}
    </>
  );
}
