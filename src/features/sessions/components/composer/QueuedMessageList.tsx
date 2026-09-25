// Messages waiting behind the active turn, listed in the composer's tray. Each can be sent now,
// removed, or edited: editing takes it out of the queue and back into the composer.

import { useImperativeHandle } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Loader2, Pencil, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Button } from "@/shared/ui/button";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { AttachmentGallery } from "@/shared/attachments/AttachmentGallery";
import { cn } from "@/shared/utils";
import type { SessionState } from "../../model";
import { systemMessageLabel } from "../../model/systemMessages";
import { sessionMutations } from "../../mutations";

type QueuedMessage = SessionState["queuedMessages"][number];
type QueuedUserMessage = Extract<QueuedMessage, { role: "user" }>;

export type QueuedMessageListHandle = {
  /** Edits the last queued user message, if any. */
  editLast: () => void;
};

/** Shared by a queued row and the transcript message it becomes. */
export const queuedMessageLayoutId = (clientId: string) => `queued-message-${clientId}`;

export function QueuedMessageList({
  sessionId,
  messages,
  handle,
  onEdit,
}: {
  sessionId: string;
  messages: QueuedMessage[];
  handle: React.RefObject<QueuedMessageListHandle | null>;
  /** Receives a message once it has left the queue to be edited in the composer. */
  onEdit: (message: QueuedUserMessage) => void;
}) {
  const cancelMutation = useMutation(sessionMutations.cancelQueuedMessage(sessionId));

  // A message already on its way can no longer be cancelled, so it stays sent.
  const edit = (message: QueuedUserMessage) =>
    cancelMutation.mutate(message.clientId, {
      onSuccess: (cancelled) => {
        if (cancelled) onEdit(message);
      },
    });

  useImperativeHandle(handle, () => ({
    editLast: () => {
      const last = messages
        .filter(
          (message): message is QueuedUserMessage =>
            message.role === "user" && message.status === "queued",
        )
        .at(-1);
      if (last) edit(last);
    },
  }));

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {messages.map((message) => (
        <m.div
          key={message.clientId}
          layoutId={queuedMessageLayoutId(message.clientId)}
          layout="position"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
        >
          <QueuedMessageRow
            sessionId={sessionId}
            message={message}
            isCancelling={cancelMutation.isPending && cancelMutation.variables === message.clientId}
            isBusy={cancelMutation.isPending}
            onCancel={() => cancelMutation.mutate(message.clientId)}
            onEdit={message.role === "user" ? () => edit(message) : undefined}
          />
        </m.div>
      ))}
    </AnimatePresence>
  );
}

function QueuedMessageRow({
  sessionId,
  message,
  isCancelling,
  isBusy,
  onCancel,
  onEdit,
}: {
  sessionId: string;
  message: QueuedMessage;
  isCancelling: boolean;
  /** Another queue action is in flight. */
  isBusy: boolean;
  onCancel: () => void;
  onEdit?: () => void;
}) {
  const steerMutation = useMutation(sessionMutations.steerQueuedMessage(sessionId));
  const isSending =
    message.status !== "queued" || steerMutation.isPending || steerMutation.data === true;
  const attachments = message.role === "user" ? (message.attachments ?? []) : [];
  const label =
    message.role === "system" ? systemMessageLabel(message.content) : message.content.trim();

  return (
    <div
      role="group"
      aria-label={`Queued message: ${label}`}
      className="flex min-h-8 items-center gap-2 rounded-md p-0.5 text-sm hover:bg-muted"
    >
      {isSending ? (
        <span className="flex size-6 shrink-0 items-center justify-center">
          <Loader2 aria-label="Sending" className="size-3.5 animate-spin text-muted-foreground" />
        </span>
      ) : onEdit ? (
        <QueuedMessageAction
          label="Send now"
          variant="accent"
          disabled={isBusy}
          onClick={() => steerMutation.mutate(message.clientId)}
        >
          <ArrowUp />
        </QueuedMessageAction>
      ) : (
        // System messages cannot be sent early; keep their text aligned with the others.
        <span className="size-6 shrink-0" />
      )}
      <ScrollableFade
        className={cn("flex-1 whitespace-nowrap", message.role === "system" && "italic")}
      >
        <span className="shrink-0">{label}</span>
      </ScrollableFade>
      {attachments.length > 0 && <AttachmentGallery attachments={attachments} variant="summary" />}
      {!isSending && (
        <div className="flex shrink-0 items-center">
          {onEdit && (
            <QueuedMessageAction label="Edit" disabled={isBusy} onClick={onEdit}>
              <Pencil />
            </QueuedMessageAction>
          )}
          <QueuedMessageAction
            label="Remove"
            variant="destructive-ghost"
            disabled={isBusy}
            onClick={onCancel}
          >
            {isCancelling ? <Loader2 className="animate-spin" /> : <X />}
          </QueuedMessageAction>
        </div>
      )}
    </div>
  );
}

/** One icon action on a queued row, named by its tooltip. */
function QueuedMessageAction({
  label,
  variant = "ghost",
  disabled,
  onClick,
  children,
}: {
  label: string;
  variant?: "ghost" | "accent" | "destructive-ghost";
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant={variant}
            size="icon-xs"
            aria-label={label}
            disabled={disabled}
            onClick={onClick}
            className={cn("[&_svg]:size-3.5", variant === "ghost" && "text-muted-foreground")}
          >
            {children}
          </Button>
        }
      />
      <TooltipContent sideOffset={4}>{label}</TooltipContent>
    </Tooltip>
  );
}
