import {
  abortSession,
  createSession,
  deleteSession,
  deliverMessage,
  waitForSession,
} from "@/functions/sessions";
import { consumeAppShare } from "@/functions/apps";
import { readFile, writeFile } from "@/functions/fs";
import { cancelWorker, spawnWorker } from "@/functions/workers";
import type { useWorkspaceSurface } from "@/hooks/workspace/layout/surface";
import type { AppActions } from "@/lib/apps/sdk";
import {
  createEditorPane,
  createLinkedSessionPane,
  type WorkspacePane,
} from "@/lib/workspace/panes";

/** Binds the public app capabilities to one mounted app and workspace surface. */
export function bindAppActions({
  appId,
  publisherPaneId,
  flushState,
  surface,
}: {
  appId: string;
  publisherPaneId: string;
  flushState: () => Promise<void>;
  surface: ReturnType<typeof useWorkspaceSurface>;
}): AppActions {
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
    consumeShare(shareId) {
      return consumeAppShare({ data: { appId, shareId } });
    },
    async createSession(input) {
      const { open, ...launch } = input;
      const result = await createSession({ data: launch });
      if (open) openPane(createLinkedSessionPane(result.sessionId));
      return result;
    },
    async spawnWorker(input) {
      await flushState();
      return spawnWorker({
        data: {
          ...input,
          type: "app",
          appId,
        },
      });
    },
    waitForSession(sessionId, timeoutMs) {
      return waitForSession({ data: { sessionId, timeoutMs } });
    },
    cancelWorker(sessionId) {
      return cancelWorker({
        data: {
          type: "app",
          appId,
          workerSessionId: sessionId,
        },
      });
    },
    async deleteSession(sessionId) {
      await deleteSession({ data: { sessionId } });
      closePane(createLinkedSessionPane(sessionId).id);
    },
    async deliverMessage(sessionId, message) {
      await flushState();
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
