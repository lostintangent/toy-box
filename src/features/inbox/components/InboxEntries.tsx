import { useId, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Circle,
  FileText,
  Inbox as InboxIcon,
  Info,
  Loader2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { SessionPreview, useSessionPreview } from "@sessions/components/SessionPreview";
import { Button } from "@/shared/ui/button";
import { Markdown } from "@/shared/ui/markdown";
import { RunningIndicator } from "@/shared/ui/running-indicator";
import { Skeleton } from "@/shared/ui/skeleton";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import {
  useDispatchWorkspaceAction,
  useWorkspaceSelector,
  useWorkspaceSessionActivity,
} from "@workspace/hooks/state";
import { cn } from "@/shared/utils";
import type { Session } from "@sessions/model";
import type { InboxEntry } from "../model";
import { inboxMutations } from "../mutations";
import { isInboxTaskRunning, sortInboxEntries } from "../queries";

export function InboxEntries({
  entries,
  sessions,
  linkedEntryId,
  onSelect,
}: {
  entries: InboxEntry[];
  sessions: Session[];
  linkedEntryId?: string;
  onSelect: (entry: InboxEntry) => void;
}) {
  const sortedEntries = useWorkspaceSelector((workspace) => sortInboxEntries(entries, workspace));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  return (
    <section aria-labelledby="workspace-inbox-heading" className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h2 id="workspace-inbox-heading" className="flex items-center gap-2 text-sm font-medium">
          <InboxIcon className="h-4 w-4 text-muted-foreground" />
          Inbox
        </h2>
      </div>
      {entries.length === 0 ? (
        <p className="px-1 py-2 text-sm italic text-muted-foreground">
          When you run tasks above, their results will appear here.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          {sortedEntries.map((entry) => (
            <InboxEntryRow
              key={entry.id}
              entry={entry}
              session={sessionsById.get(entry.id)}
              linked={linkedEntryId === entry.id}
              onSelect={() => onSelect(entry)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function InboxEntryRow({
  entry,
  session,
  linked,
  onSelect,
}: {
  entry: InboxEntry;
  session?: Session;
  linked: boolean;
  onSelect: () => void;
}) {
  const deleteMutation = useMutation(inboxMutations.deleteEntry(entry.id));
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { unread } = useWorkspaceSessionActivity(entry.id);
  const running = useWorkspaceSelector((workspace) => isInboxTaskRunning(workspace, entry.id));
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
  const pending = entry.kind === "pending";
  const preview = useSessionPreview(!pending || !session);
  const label =
    entry.kind === "result"
      ? entry.message
      : session?.title || (entry.kind === "error" ? entry.error : undefined);
  const labelId = useId();

  function handleSelect() {
    preview.close();
    if (unread) dispatchWorkspaceAction({ type: "session.read", sessionId: entry.id });
    onSelect();
  }

  return (
    <>
      <div
        className={cn(
          "group/inbox flex items-center border-b text-sm transition-colors last:border-b-0 hover:bg-muted/50",
          pending && "bg-muted/30",
          linked && "bg-muted/60",
        )}
      >
        {entry.kind === "error" ? (
          <button
            type="button"
            aria-pressed={linked}
            onClick={handleSelect}
            className="flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <span className="min-w-0 break-words text-destructive">{entry.error}</span>
          </button>
        ) : (
          <div
            onMouseEnter={preview.onMouseEnter}
            onMouseLeave={preview.onMouseLeave}
            className="relative flex min-w-0 flex-1 items-start gap-3 px-4 py-3 text-left"
          >
            <SessionPreview sessionId={entry.id} {...preview}>
              <button
                type="button"
                aria-labelledby={label ? labelId : undefined}
                aria-label={label ? undefined : "Loading inbox entry"}
                aria-pressed={linked}
                onClick={handleSelect}
                className="absolute inset-0 cursor-pointer focus-visible:ring-2 focus-visible:ring-ring"
              />
            </SessionPreview>
            {entry.kind === "result" && entry.artifact ? (
              <FileText
                className={cn(
                  "pointer-events-none mt-0.5 h-4 w-4 shrink-0 text-muted-foreground",
                  linked && "text-primary",
                )}
              />
            ) : (
              <Info className="pointer-events-none mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            {label ? (
              <div
                id={labelId}
                className={cn(
                  "pointer-events-none relative z-10 min-w-0 break-words [&_a]:pointer-events-auto",
                  pending && "italic text-muted-foreground",
                )}
              >
                <Markdown preserveLineBreaks linkSafety={{ enabled: false }}>
                  {label}
                </Markdown>
              </div>
            ) : (
              <Skeleton className="pointer-events-none mt-0.5 h-4 w-3/5 max-w-80" />
            )}
          </div>
        )}
        <InboxEntryAction
          label={label}
          running={running}
          unread={unread}
          deleting={deleteMutation.isPending}
          onDelete={() => {
            if (entry.kind === "error" || (entry.kind === "result" && entry.artifact))
              setDeleteOpen(true);
            else deleteMutation.mutate();
          }}
        />
      </div>
      {deleteOpen && (
        <DestructiveConfirmationDialog
          title="Delete inbox entry?"
          description="This will permanently delete this inbox entry and its attached artifact. This action cannot be undone."
          mutation={inboxMutations.deleteEntry(entry.id)}
          onOpenChange={setDeleteOpen}
        />
      )}
    </>
  );
}

function InboxEntryAction({
  label,
  running,
  unread,
  deleting,
  onDelete,
}: {
  label?: string;
  running: boolean;
  unread: boolean;
  deleting: boolean;
  onDelete: () => void;
}) {
  const hasStatus = running || unread;
  const statusLabel = label || "Inbox entry";
  return (
    <div className="relative mr-2 h-8 w-8 shrink-0">
      {hasStatus && (
        <div
          className="absolute inset-0 flex items-center justify-center transition-opacity group-hover/inbox:opacity-0 group-focus-within/inbox:opacity-0"
          aria-label={running ? `${statusLabel} is running` : `${statusLabel} has unread activity`}
        >
          {running ? (
            <RunningIndicator className="h-4 w-4 text-muted-foreground" />
          ) : (
            <Circle className="h-2.5 w-2.5 fill-unread text-unread" />
          )}
        </div>
      )}
      <Button
        type="button"
        variant="destructive-ghost"
        size="icon"
        disabled={deleting}
        aria-label={label ? `Delete inbox entry: ${label}` : "Delete inbox entry"}
        className={cn(
          "absolute inset-0 h-8 w-8",
          hasStatus &&
            "pointer-events-none opacity-0 transition-opacity group-hover/inbox:pointer-events-auto group-hover/inbox:opacity-100 group-focus-within/inbox:pointer-events-auto group-focus-within/inbox:opacity-100",
        )}
        onClick={onDelete}
      >
        {deleting ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </Button>
    </div>
  );
}
