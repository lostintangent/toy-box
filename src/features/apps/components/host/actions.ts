import {
  abortSession,
  createSession,
  deleteSession,
  deliverMessage,
  waitForSession,
} from "@sessions/server/functions";
import { consumeAppShare } from "@apps/server/functions";
import { readFile, writeFile } from "@files/server/functions";
import type { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import type { AppActions, useAppActions } from "@apps/sdk";
import {
  createEditorPane,
  createLinkedSessionPane,
  type WorkspacePane,
} from "@workspace/model/panes";

/** Binds capabilities shared by every mounted app to its workspace surface. */
export function bindAppActions({
  publisherPaneId,
  beforeDeliverMessage,
  surface,
}: {
  publisherPaneId: string;
  beforeDeliverMessage?: () => Promise<void>;
  surface: ReturnType<typeof useWorkspaceSurface>;
}): ReturnType<typeof useAppActions> {
  function changeLinkedPanes(
    change: (current: readonly WorkspacePane[]) => readonly WorkspacePane[],
  ) {
    const publications = surface.panePublications;
    publications.actions.publishLinkedPanes(
      publisherPaneId,
      change(publications.get()[publisherPaneId] ?? []),
    );
  }

  function closePane(paneId: string) {
    changeLinkedPanes((current) => current.filter((candidate) => candidate.id !== paneId));
  }

  function openPane(nextPane: WorkspacePane) {
    if (surface.panes.some(({ id }) => id === nextPane.id)) return;
    if (surface.panes.length >= surface.capacity) {
      closePane(nextPane.id);
      return;
    }
    changeLinkedPanes((current) => [
      ...current.filter((candidate) => candidate.id !== nextPane.id),
      nextPane,
    ]);
  }

  function togglePane(nextPane: WorkspacePane) {
    if (surface.panes.some(({ id }) => id === nextPane.id)) {
      closePane(nextPane.id);
      return;
    }
    openPane(nextPane);
  }

  return {
    async createSession(input) {
      const { open, ...launch } = input;
      const result = await createSession({ data: launch });
      if (open) openPane(createLinkedSessionPane(result.sessionId));
      return result;
    },
    waitForSession(sessionId, timeoutMs) {
      return waitForSession({ data: { sessionId, timeoutMs } });
    },
    async deleteSession(sessionId) {
      await deleteSession({ data: { sessionId } });
      closePane(createLinkedSessionPane(sessionId).id);
    },
    async deliverMessage(sessionId, message) {
      await beforeDeliverMessage?.();
      await deliverMessage({ data: { sessionId, message } });
    },
    async abortSession(sessionId) {
      await abortSession({ data: { sessionId } });
    },
    openSession(sessionId) {
      openPane(createLinkedSessionPane(sessionId));
    },
    closeSession(sessionId) {
      closePane(createLinkedSessionPane(sessionId).id);
    },
    toggleSession(sessionId) {
      togglePane(createLinkedSessionPane(sessionId));
    },
    openFile(file, mode) {
      openPane(createEditorPane(file, mode));
    },
    closeFile(file) {
      closePane(createEditorPane(file).id);
    },
    toggleFile(file, mode) {
      togglePane(createEditorPane(file, mode));
    },
    async readFile(file) {
      return (await readFile({ data: { file } })).content;
    },
    async writeFile(file, content) {
      await writeFile({ data: { file, content } });
    },
  };
}

/** Adds saved-instance capabilities to the common mounted app actions. */
export function bindSavedAppActions({
  appId,
  actions,
  flushState,
  spawnWorker,
  cancelWorker,
}: {
  appId: string;
  actions: ReturnType<typeof useAppActions>;
  flushState: () => Promise<void>;
  spawnWorker: AppActions["spawnWorker"];
  cancelWorker: AppActions["cancelWorker"];
}): AppActions {
  return {
    ...actions,
    consumeShare(shareId) {
      return consumeAppShare({ data: { appId, shareId } });
    },
    async spawnWorker(input) {
      await flushState();
      return spawnWorker(input);
    },
    cancelWorker(sessionId) {
      return cancelWorker(sessionId);
    },
  };
}
