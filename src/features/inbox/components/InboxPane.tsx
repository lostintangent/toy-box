import { useEffect, useState } from "react";
import { useMutation, useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { SessionComposer } from "@sessions/components/composer/SessionComposer";
import type { SessionLocationPickerProps } from "@sessions/components/location/SessionLocationPicker";
import { getRecentDirectories } from "@sessions/model/recentDirectories";
import { useModels } from "@sessions/useModels";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import {
  createEditorPane,
  createEditorPaneId,
  INBOX_PANE,
  isEditorPane,
} from "@workspace/model/panes";
import { sessionFile } from "@files/model";
import { sessionMutations } from "@sessions/mutations";
import { selectNonWorkerSessions, sessionQueries } from "@sessions/queries";
import type { Attachment } from "@sessions/model";
import type { InboxEntry } from "../model";
import { inboxMutations } from "../mutations";
import { inboxQueries } from "../queries";
import { InboxEntries } from "./InboxEntries";

/** Starts work without opening a client stream. Run dispatches an Inbox task;
 *  Send leaves an ordinary new session in the normal list. */
export function InboxPane({ onFocusPane }: { onFocusPane?: (paneId: string) => void }) {
  const dispatchTaskMutation = useMutation(inboxMutations.dispatchTask());
  const createSessionMutation = useMutation(sessionMutations.createSession());
  const { panePublications } = useWorkspaceSurface();
  const { data: sessions = [] } = useQuery({
    ...sessionQueries.state(),
    select: selectNonWorkerSessions,
  });
  const { data: entries } = useSuspenseQuery(inboxQueries.list());
  const defaultUseWorktree = useWorkspaceSelector((workspace) => workspace.settings.useWorktree);
  const { models, defaultModel, setDefaultModel } = useModels();
  const linkedEditorPane = useSelector(panePublications, (linkedPanes) =>
    linkedPanes[INBOX_PANE.id]?.find(isEditorPane),
  );
  const [prompt, setPrompt] = useState("");
  // An untouched selection follows the latest directory; null preserves an explicit clear.
  const [directorySelection, setDirectorySelection] = useState<string | null>();
  const [useWorktree, setUseWorktree] = useState(defaultUseWorktree);
  const recentDirectory = getRecentDirectories(sessions)[0]?.cwd;
  const directory =
    directorySelection === undefined ? recentDirectory : (directorySelection ?? undefined);

  const locationPicker: SessionLocationPickerProps = {
    value: directorySelection,
    onValueChange: setDirectorySelection,
    useWorktree,
    onUseWorktreeChange: setUseWorktree,
  };

  const linkedArtifactExists =
    linkedEditorPane === undefined ||
    entries.some(
      (entry) =>
        entry.artifact !== undefined &&
        linkedEditorPane.id === createEditorPaneId(sessionFile(entry.id, entry.artifact)),
    );

  // Inbox rows are server-authoritative. Remove browser-local composition when
  // another client deletes or replaces the linked entry.
  useEffect(() => {
    if (linkedArtifactExists) return;
    panePublications.actions.clearLinkedPanes(INBOX_PANE.id);
  }, [linkedArtifactExists, panePublications]);

  function handleInboxArtifactSelect(entry: InboxEntry) {
    if (!entry.artifact) return;

    const artifactPane = createEditorPane(sessionFile(entry.id, entry.artifact));
    const pane = {
      ...artifactPane,
      title: entry.message ?? artifactPane.title,
    };
    const isLinked = linkedEditorPane?.id === pane.id;
    if (isLinked) {
      panePublications.actions.clearLinkedPanes(INBOX_PANE.id);
    } else {
      panePublications.actions.publishLinkedPanes(INBOX_PANE.id, [pane]);
    }

    if (!isLinked) onFocusPane?.(pane.id);
  }

  function handleRun(text: string, attachments: Attachment[]) {
    const launch = createLaunchInput(text, attachments);
    void dispatchTaskMutation
      .mutateAsync(launch)
      .catch(() => restorePrompt(launch.message.content));
  }

  function handleSend(text: string, attachments: Attachment[]) {
    const launch = createLaunchInput(text, attachments);
    void createSessionMutation
      .mutateAsync(launch)
      .catch(() => restorePrompt(launch.message.content));
  }

  function createLaunchInput(text: string, attachments: Attachment[]) {
    return {
      message: {
        content: text,
        attachments: attachments.length > 0 ? attachments : undefined,
        model: defaultModel ?? undefined,
      },
      directory,
      useWorktree,
    };
  }

  function restorePrompt(text: string) {
    // The composer clears itself on submit; restore the prompt unless the
    // user has already started composing the next task.
    setPrompt((current) => (current.trim() ? current : text));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="flex min-h-full items-start justify-center p-4 py-6 md:items-center md:p-8">
        <div className="w-full max-w-2xl space-y-10">
          <SessionComposer
            prompt={prompt}
            onPromptChange={setPrompt}
            onSubmit={handleSend}
            onRun={handleRun}
            models={models}
            model={defaultModel}
            onModelChange={setDefaultModel}
            locationPicker={locationPicker}
          />
          <InboxEntries
            entries={entries}
            sessions={sessions}
            linkedEditorPane={linkedEditorPane}
            onArtifactSelect={handleInboxArtifactSelect}
          />
        </div>
      </div>
    </div>
  );
}
