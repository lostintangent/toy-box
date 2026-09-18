import { useMutation } from "@tanstack/react-query";
import { LoaderCircle, Pencil, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Button } from "@/shared/components/ui/button";
import { ScrollableFade } from "@/shared/components/ui/scrollable-fade";
import { useLongPress } from "@/shared/hooks/useLongPress";
import { cn } from "@/shared/utils";
import type { SessionState } from "../../model";
import { systemMessageLabel } from "../../model/systemMessages";
import { sessionMutations } from "../../mutations";
import { AttachmentGallery } from "../AttachmentGallery";

const LONG_PRESS_DELAY_MS = 2_000;

export function QueuedMessageList({
  sessionId,
  messages,
  onEdit,
}: {
  sessionId: string;
  messages: SessionState["queuedMessages"];
  onEdit: (message: Extract<SessionState["queuedMessages"][number], { role: "user" }>) => void;
}) {
  const cancelMutation = useMutation(sessionMutations.cancelQueuedMessage(sessionId));

  return (
    <div className="relative mb-3 flex flex-col gap-2 empty:hidden">
      <AnimatePresence initial={false} mode="popLayout">
        {messages.map((message) => (
          <m.div
            key={message.clientId}
            layout="position"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <QueuedMessageRow
              sessionId={sessionId}
              message={message}
              cancelDisabled={cancelMutation.isPending}
              isCancelling={
                cancelMutation.isPending && cancelMutation.variables === message.clientId
              }
              onEdit={() => {
                if (message.role !== "user") return;
                cancelMutation.mutate(message.clientId, {
                  onSuccess: (cancelled) => {
                    if (cancelled) onEdit(message);
                  },
                });
              }}
              onCancel={() => cancelMutation.mutate(message.clientId)}
            />
          </m.div>
        ))}
      </AnimatePresence>
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
  message: SessionState["queuedMessages"][number];
  cancelDisabled: boolean;
  isCancelling: boolean;
  onEdit: () => void;
  onCancel: () => void;
}) {
  const steerMutation = useMutation(sessionMutations.steerQueuedMessage(sessionId));
  const isSubmitted =
    message.status !== "queued" ||
    (message.role === "user" && (steerMutation.isPending || steerMutation.data === true));
  const canSteer = message.role === "user" && !cancelDisabled && !isSubmitted;
  const attachments = message.role === "user" ? (message.attachments ?? []) : [];
  const label =
    message.role === "system"
      ? systemMessageLabel(message.content)
      : message.content.trim() ||
        `${attachments.length} attachment${attachments.length === 1 ? "" : "s"}`;
  const steer = () => {
    if (canSteer) steerMutation.mutate(message.clientId);
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
        "relative flex touch-manipulation items-center gap-2 rounded-lg bg-secondary-background px-3 py-2 text-sm text-muted-foreground transition-colors",
        canSteer && "cursor-pointer",
        isHolding && "select-none bg-user-accent/30",
      )}
      style={{
        transitionDuration: isHolding ? `${LONG_PRESS_DELAY_MS}ms` : "150ms",
      }}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={isSubmitted ? "Sending queued message now" : "Edit queued message"}
        aria-live="polite"
        disabled={isSubmitted || cancelDisabled || message.role !== "user"}
        data-long-press-ignore
        className="h-5 w-5 shrink-0 rounded-full"
        onClick={onEdit}
      >
        {isSubmitted ? (
          <LoaderCircle className="h-3 w-3 animate-spin" />
        ) : (
          <Pencil className="h-3 w-3" />
        )}
      </Button>

      <div className="min-w-0 flex-1">
        <ScrollableFade className={cn("whitespace-nowrap", message.role === "system" && "italic")}>
          {label}
        </ScrollableFade>
        {attachments.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            <AttachmentGallery attachments={attachments} size="compact" />
          </div>
        )}
      </div>

      {!isSubmitted && (
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
