import { sessionFile, type WorkspaceFile } from "@files/model";
import { createEditorPane } from "@files/model/panes";
import { createScreenPane } from "@screens/model";
import type { Preview } from "@/shared/preview";
import { matchesSessionFeatureScope, type Settings } from "@workspace/model/config/settings";
import { createPane, type WorkspacePane } from "@workspace/model/panes";
import type { SessionArtifact, SessionCanvas } from ".";

declare module "@workspace/model/panes" {
  interface WorkspacePanes {
    /** A session's transcript, opened by the user or linked by another pane. */
    session: { sessionId: string; isLinkedOnly: boolean };
    /** A canvas a session published. Its id includes the revision, so a new revision remounts it. */
    canvas: { sessionId: string; canvas: SessionCanvas };
  }
}

export const createSessionPane = (sessionId: string, isLinkedOnly = false) =>
  createPane("session", sessionId, { sessionId, isLinkedOnly });

export const createCanvasPane = (sessionId: string, canvas: SessionCanvas) =>
  createPane("canvas", `${sessionId}:${canvas.key}:${canvas.revision}`, { sessionId, canvas });

/** The panes an active session links, in the order it shows them: files first, then its screen
 *  preview and canvases, then its child sessions. */
export function createLinkedPanes(
  sessionId: string,
  linkedSessionIds: readonly string[],
  canvases: readonly SessionCanvas[],
  artifacts: readonly string[] = [],
  openedFiles: readonly WorkspaceFile[] = [],
  preview?: Preview,
): WorkspacePane[] {
  return [
    ...artifacts.map((path) => createEditorPane(sessionFile(sessionId, path))),
    ...openedFiles.map((file) => createEditorPane(file)),
    ...(preview?.kind === "screen" ? [createScreenPane(preview.screenId, sessionId)] : []),
    ...canvases.map((canvas) => createCanvasPane(sessionId, canvas)),
    ...linkedSessionIds.map((linkedSessionId) => createSessionPane(linkedSessionId, true)),
  ];
}

export function resolveArtifactSelection(
  artifacts: readonly SessionArtifact[],
  selectedPath?: string,
  initialPath?: string,
): SessionArtifact | undefined {
  return (
    artifacts.find(({ path }) => path === selectedPath) ??
    artifacts.find(({ path }) => path === initialPath) ??
    artifacts.reduce<SessionArtifact | undefined>(
      (latest, artifact) => (!latest || artifact.updatedAt > latest.updatedAt ? artifact : latest),
      undefined,
    )
  );
}

type EditorAutoFocusResolution = {
  focusPane: WorkspacePane<"editor"> | undefined;
  seenPaneIds: ReadonlySet<string>;
};

/**
 * Eligible artifacts are artifact-first: their artifact is the primary surface
 * and the transcript is secondary, so an eligible editor pane should take
 * focus when it appears (maximized on desktop, paged-to on mobile). Focus is
 * only claimed in single-session layouts, so an artifact never takes over a
 * multi-session workspace.
 *
 * Appearance is judged against `seenPaneIds`, the pane ids from the previous
 * resolution: a pane triggers focus at most once per appearance (so a user's
 * dismissal sticks), and departed ids are pruned (so closing and reopening a
 * source session can focus its artifact again). Tracking advances even when the
 * layout gate suppresses focus, so a later layout change never retroactively
 * focuses an old pane.
 */
export function resolveEditorAutoFocus(
  seenPaneIds: ReadonlySet<string>,
  panes: readonly WorkspacePane[],
  autoFocusArtifacts: Settings["autoFocusArtifacts"],
  automationSessionIds: readonly string[] = [],
  forceFocusPaneIds?: ReadonlySet<string>,
): EditorAutoFocusResolution {
  return {
    focusPane: isSingleSessionLayout(panes)
      ? panes
          .filter((pane) =>
            shouldAutoFocusEditorPane(
              pane,
              autoFocusArtifacts,
              automationSessionIds,
              forceFocusPaneIds,
            ),
          )
          .find((pane) => !seenPaneIds.has(pane.id))
      : undefined,
    seenPaneIds: new Set(panes.map((pane) => pane.id)),
  };
}

function isSingleSessionLayout(panes: readonly WorkspacePane[]): boolean {
  return panes.filter((pane) => pane.kind === "session" && !pane.isLinkedOnly).length === 1;
}

function shouldAutoFocusEditorPane(
  pane: WorkspacePane,
  autoFocusArtifacts: Settings["autoFocusArtifacts"],
  automationSessionIds: readonly string[],
  forceFocusPaneIds?: ReadonlySet<string>,
): pane is WorkspacePane<"editor"> {
  if (pane.kind !== "editor") return false;
  // Force-focus overrides the setting — e.g. an artifact-first draft's own file.
  if (forceFocusPaneIds?.has(pane.id)) return true;
  return (
    pane.sessionId !== undefined &&
    matchesSessionFeatureScope(
      autoFocusArtifacts,
      automationSessionIds.includes(pane.sessionId) ? "automation" : "session",
    )
  );
}
