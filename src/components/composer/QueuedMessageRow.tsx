import { useState } from "react";
import { LoaderCircle, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLongPress } from "@/hooks/browser/useLongPress";
import { notificationLabel } from "@/lib/session/agentNotifications";
import { cn } from "@/lib/utils";
import type { QueuedMessage } from "@/types";

const LONG_PRESS_DELAY_MS = 2_000;

type QueuedMessageRowProps = {
  message: QueuedMessage;
  onEdit?: (queuedMessageId: string) => Promise<void>;
  onCancel?: (queuedMessageId: string) => Promise<boolean>;
  onSteer?: (queuedMessageId: string) => Promise<boolean>;
};

export function QueuedMessageRow({ message, onEdit, onCancel, onSteer }: QueuedMessageRowProps) {
  const [isSteeringLocally, setIsSteeringLocally] = useState(false);
  const isSteering = message.role === "user" && (isSteeringLocally || message.isSteering === true);
  const canSteer = message.role === "user" && Boolean(onSteer) && !isSteering;
  const label =
    message.role === "agent_notification"
      ? notificationLabel(message.notification)
      : message.content.trim() ||
        message.attachments?.map((attachment) => attachment.displayName).join(", ") ||
        "Attachment";
  const steer = () => {
    if (!onSteer || !canSteer) return;
    setIsSteeringLocally(true);
    void onSteer(message.id).then(
      (accepted) => {
        if (!accepted) setIsSteeringLocally(false);
      },
      () => setIsSteeringLocally(false),
    );
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
        disabled={isSteering || message.role !== "user" || !onEdit}
        data-long-press-ignore
        className="h-5 w-5 shrink-0 rounded-full"
        onClick={() => void onEdit?.(message.id)}
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
          disabled={!onCancel}
          data-long-press-ignore
          className="h-5 w-5 shrink-0 rounded-full"
          onClick={() => void onCancel?.(message.id)}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
