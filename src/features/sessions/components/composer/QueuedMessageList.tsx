import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Pencil, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { useLongPress } from "@/shared/hooks/useLongPress";
import { cn } from "@/shared/utils";
import type { QueuedMessage, QueuedUserMessage } from "../../model";
import { notificationLabel } from "../../model/agentNotifications";
import { sessionMutations } from "../../mutations";

const LONG_PRESS_DELAY_MS = 2_000;

export function QueuedMessageList({
  sessionId,
  messages,
  onEdit,
}: {
  sessionId: string;
  messages: QueuedMessage[];
  onEdit: (message: QueuedUserMessage) => void;
}) {
  const cancelMutation = useMutation(sessionMutations.cancelQueuedMessage(sessionId));

  if (messages.length === 0) return null;

  return (
    <div className="mb-3 space-y-2">
      {messages.map((message) => (
        <QueuedMessageRow
          key={message.id}
          sessionId={sessionId}
          message={message}
          cancelDisabled={cancelMutation.isPending}
          isCancelling={cancelMutation.isPending && cancelMutation.variables === message.id}
          onEdit={() => {
            if (message.role !== "user") return;
            cancelMutation.mutate(message.id, {
              onSuccess: (cancelled) => {
                if (cancelled) onEdit(message);
              },
            });
          }}
          onCancel={() => cancelMutation.mutate(message.id)}
        />
      ))}
    </div>
  );
}

function QueuedMessageRow({
  sessionId,
  message,
  cancelDisabled,
  isCancelling,
  onEdit,
  onCancel,
}: {
  sessionId: string;
  message: QueuedMessage;
  cancelDisabled: boolean;
  isCancelling: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const steerMutation = useMutation(sessionMutations.steerQueuedMessage(sessionId));
  const isSteering =
    message.role === "user" &&
    (message.isSteering === true || steerMutation.isPending || steerMutation.data === true);
  const canSteer = message.role === "user" && !cancelDisabled && !isSteering;
  const label =
    message.role === "agent_notification"
      ? notificationLabel(message.notification)
      : message.content.trim() ||
        message.attachments?.map((attachment) => attachment.displayName).join(", ") ||
        "Attachment";
  const steer = () => {
    if (canSteer) steerMutation.mutate(message.id);
  };
  const { isHolding, longPressProps } = useLongPress<HTMLDivElement>(
    canSteer ? steer : undefined,
    LONG_PRESS_DELAY_MS,
  );

  return (
    <div
      {...longPressProps}
      role="group"
      aria-label={`Queued message: ${label}`}
      className={cn(
        "relative flex touch-manipulation items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground transition-colors",
        canSteer && "cursor-pointer",
        isHolding && "select-none bg-user-accent/30",
      )}
      style={{ transitionDuration: isHolding ? `${LONG_PRESS_DELAY_MS}ms` : "150ms" }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={isSteering ? "Sending queued message now" : "Edit queued message"}
        aria-live="polite"
        disabled={isSteering || cancelDisabled || message.role !== "user"}
        data-long-press-ignore
        className="h-5 w-5 shrink-0 rounded-full"
        onClick={onEdit}
      >
        {isSteering ? (
          <LoaderCircle className="h-3 w-3 animate-spin" />
        ) : (
          <Pencil className="h-3 w-3" />
        )}
      </Button>

      <span
        className={cn("min-w-0 flex-1 truncate", message.role === "agent_notification" && "italic")}
      >
        {label}
      </span>

      {!isSteering && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Cancel queued message"
          disabled={cancelDisabled}
          data-long-press-ignore
          className="h-5 w-5 shrink-0 rounded-full"
          onClick={onCancel}
        >
          {isCancelling ? (
            <LoaderCircle className="h-3 w-3 animate-spin" />
          ) : (
            <X className="h-3 w-3" />
          )}
        </Button>
      )}
    </div>
  );
}
