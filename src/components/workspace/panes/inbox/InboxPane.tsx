import { useEffect, useState } from "react";
import { useSelector } from "@tanstack/react-store";
import { dispatchInboxTask } from "@/functions/inbox";
import { createSession } from "@/functions/sessions";
import { getSettings } from "@/lib/config/settings";
import { getRecentDirectories } from "@/lib/session/recentDirectories";
import { SessionComposer } from "@/components/composer/SessionComposer";
import type { SessionLocationPickerProps } from "@/components/workspace/panes/session/location/SessionLocationPicker";
import { useModels } from "@/hooks/workspace/useModels";
import { useSessions } from "@/hooks/session/useSessions";
import { selectInboxEntries, useWorkspaceSelector } from "@/hooks/workspace/state";
import {
  clearLinkedPanes,
  linkedPanesStore,
  publishLinkedPanes,
} from "@/hooks/workspace/layout/linkedPanes";
import { createArtifactPane, INBOX_PANE, isArtifactPane } from "@/lib/workspace/panes";
import type { Attachment, InboxEntry } from "@/types";
import { InboxEntries } from "./InboxEntries";

/** Starts work without opening a client stream. Run dispatches an Inbox task;
 *  Send leaves an ordinary new session in the normal list. */
export function InboxPane({ onFocusPane }: { onFocusPane?: (paneId: string) => void }) {
  const { sessions } = useSessions();
  const entries = useWorkspaceSelector(selectInboxEntries);
  const { defaultModel, setDefaultModel } = useModels();
  const linkedArtifactPane = useSelector(linkedPanesStore, (linkedPanes) =>
    linkedPanes[INBOX_PANE.id]?.find(isArtifactPane),
  );
  const [prompt, setPrompt] = useState("");
  // An untouched selection follows the latest directory; null preserves an explicit clear.
  const [directorySelection, setDirectorySelection] = useState<string | null>();
  const [useWorktree, setUseWorktree] = useState(() => getSettings().useWorktree);
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
    linkedArtifactPane === undefined ||
    entries.some(
      (entry) =>
        entry.id === linkedArtifactPane.sourceSessionId &&
        entry.artifact === linkedArtifactPane.path,
    );

  // Inbox rows are server-authoritative. Remove browser-local composition when
  // another client deletes or replaces the linked entry.
  useEffect(() => {
    if (linkedArtifactExists) return;
    clearLinkedPanes(INBOX_PANE.id);
  }, [linkedArtifactExists]);

  function handleInboxArtifactSelect(entry: InboxEntry) {
    if (!entry.artifact) return;

    const artifactPane = createArtifactPane(entry.id, entry.artifact);
    const pane = { ...artifactPane, title: entry.message ?? artifactPane.title };
    const isLinked = linkedArtifactPane?.id === pane.id;
    if (isLinked) {
      clearLinkedPanes(INBOX_PANE.id);
    } else {
      publishLinkedPanes(INBOX_PANE.id, [pane]);
    }

    if (!isLinked) onFocusPane?.(pane.id);
  }

  function handleInboxArtifactRemoved(entryId: string) {
    if (linkedArtifactPane?.sourceSessionId === entryId) {
      clearLinkedPanes(INBOX_PANE.id);
    }
  }

  function handleRun(text: string, attachments: Attachment[]) {
    dispatchInboxTask({ data: createLaunchInput(text, attachments) }).catch((error) => {
      console.error("Failed to dispatch inbox task:", error);
      restorePrompt(text);
    });
  }

  function handleSend(text: string, attachments: Attachment[]) {
    createSession({
      data: createLaunchInput(text, attachments),
    }).catch((error) => {
      console.error("Failed to create session:", error);
      restorePrompt(text);
    });
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
            value={prompt}
            onValueChange={setPrompt}
            onSubmit={handleSend}
            onRun={handleRun}
            model={defaultModel}
            onModelChange={setDefaultModel}
            locationPicker={locationPicker}
          />
          <InboxEntries
            entries={entries}
            sessions={sessions}
            linkedArtifactPane={linkedArtifactPane}
            onArtifactSelect={handleInboxArtifactSelect}
            onArtifactRemoved={handleInboxArtifactRemoved}
          />
        </div>
      </div>
    </div>
  );
}
