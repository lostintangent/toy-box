import type { SessionCanvas, Settings, WorkspaceFile, WorkspaceFileMode } from "@/types";
import { isAutomationId } from "@/lib/automation/id";
import {
  machineFile,
  ownerSessionId,
  sessionFile,
  workspaceFileId,
} from "@/lib/files/workspaceFile";
import { fileName } from "@/lib/files/display";
import { matchesSessionFeatureScope } from "@/lib/workspace/config/settings";

export const MAX_WORKSPACE_PANES = 4;
export const MAX_HYPER_PANES = 6;

export const INBOX_PANE = {
  kind: "inbox",
  id: "inbox",
} as const;

type InboxWorkspacePane = typeof INBOX_PANE;

/** Browser-local content identity shared by grid, pager, and Hyper hosts. */
export type WorkspacePane =
  | InboxWorkspacePane
  | AppWorkspacePane
  | {
      kind: "session";
      id: string;
      sessionId: string;
      isLinkedOnly: boolean;
    }
  | EditorWorkspacePane
  | {
      kind: "canvas";
      id: string;
      sourceSessionId: string;
      canvas: SessionCanvas;
    };

export type EditorWorkspacePane = {
  kind: "editor";
  id: string;
  file: WorkspaceFile;
  title: string;
  mode: WorkspaceFileMode;
};

export type AppWorkspacePane = {
  kind: "app";
  id: string;
  appId: string;
};

/** The browser-local pane graph, keyed by the pane that published each edge. */
export type PanePublications = Readonly<Record<string, readonly WorkspacePane[]>>;

// Session-backed pane ids are `type:sourceSessionId:naturalKey`, while the one
// Inbox pane uses `inbox`. Editor pane identity includes its file; canvas identity
// includes its revision so revision bumps remount the surface. These ids are
// also publisher keys for the browser-local pane graph.

export function createSessionPaneId(sessionId: string): string {
  return `session:${sessionId}`;
}

export function createAppPane(appId: string): AppWorkspacePane {
  return {
    kind: "app",
    id: `app:${appId}`,
    appId,
  };
}

export function createEditorPaneId(file: WorkspaceFile): string {
  return `editor:${workspaceFileId(file)}`;
}

export function createCanvasPaneId(sourceSessionId: string, canvas: SessionCanvas): string {
  return `canvas:${sourceSessionId}:${canvas.key}:${canvas.revision}`;
}

export function createSessionPane(
  sessionId: string,
  isLinkedOnly: boolean,
): Extract<WorkspacePane, { kind: "session" }> {
  return {
    kind: "session",
    id: createSessionPaneId(sessionId),
    sessionId,
    isLinkedOnly,
  };
}

export function createLinkedSessionPane(
  sessionId: string,
): Extract<WorkspacePane, { kind: "session" }> {
  return createSessionPane(sessionId, true);
}

export function createEditorPane(
  file: WorkspaceFile,
  mode = getDefaultEditorPaneMode(file),
): EditorWorkspacePane {
  return {
    kind: "editor",
    id: createEditorPaneId(file),
    file,
    title: fileName(file.path),
    mode,
  };
}

export function createLinkedCanvasPane(
  sourceSessionId: string,
  canvas: SessionCanvas,
): Extract<WorkspacePane, { kind: "canvas" }> {
  return {
    kind: "canvas",
    id: createCanvasPaneId(sourceSessionId, canvas),
    sourceSessionId,
    canvas,
  };
}

export function isEditorPane(pane: WorkspacePane): pane is EditorWorkspacePane {
  return pane.kind === "editor";
}

/** The session a pane belongs to — a session pane is its own source; canvas and
 *  editor panes carry the id of the session that produced them, while Inbox
 *  has no source session. */
export function paneSourceSessionId(pane: WorkspacePane): string | undefined {
  switch (pane.kind) {
    case "inbox":
    case "app":
      return undefined;
    case "session":
      return pane.sessionId;
    case "editor":
      return ownerSessionId(pane.file);
    case "canvas":
      return pane.sourceSessionId;
  }
}

export function deriveWorkspaceRootPanes(
  selectedSessionIds: string[],
  openFilePaths: readonly string[] = [],
  openAppIds: readonly string[] = [],
): WorkspacePane[] {
  const candidates: WorkspacePane[] = [
    ...selectedSessionIds.map((sessionId) => createSessionPane(sessionId, false)),
    ...openFilePaths.map((path) => createEditorPane(machineFile(path))),
    ...openAppIds.map(createAppPane),
  ];
  const paneIds = new Set<string>();
  const roots = candidates
    .filter((pane) => {
      if (paneIds.has(pane.id)) return false;
      paneIds.add(pane.id);
      return true;
    })
    .slice(0, MAX_WORKSPACE_PANES);
  return roots.length > 0 ? roots : [INBOX_PANE];
}

export function createLinkedPanes(
  sourceSessionId: string,
  linkedSessionIds: readonly string[],
  canvases: readonly SessionCanvas[],
  artifacts: readonly string[] = [],
  openedFiles: readonly WorkspaceFile[] = [],
  previousPanes: readonly WorkspacePane[] = [],
): WorkspacePane[] {
  const previousModes = new Map(
    previousPanes.filter(isEditorPane).map((pane) => [pane.id, pane.mode] as const),
  );
  const linkFile = (file: WorkspaceFile) => {
    const pane = createEditorPane(file);
    return { ...pane, mode: previousModes.get(pane.id) ?? pane.mode };
  };

  return [
    ...linkedSessionIds.map(createLinkedSessionPane),
    ...artifacts.map((path) => linkFile(sessionFile(sourceSessionId, path))),
    ...openedFiles.map(linkFile),
    ...canvases.map((canvas) => createLinkedCanvasPane(sourceSessionId, canvas)),
  ];
}

type DeriveVisibleWorkspacePanesOptions = {
  rootPanes: WorkspacePane[];
  panePublications: PanePublications;
  maxVisible?: number;
};

export function deriveVisibleWorkspacePanes({
  rootPanes,
  panePublications,
  maxVisible = MAX_WORKSPACE_PANES,
}: DeriveVisibleWorkspacePanesOptions): WorkspacePane[] {
  const visiblePanes = rootPanes.slice(0, maxVisible);
  const seenPaneIds = new Set(visiblePanes.map((pane) => pane.id));
  const publishers = [...visiblePanes];

  while (publishers.length > 0 && visiblePanes.length < maxVisible) {
    const publisher = publishers.shift();
    if (!publisher) break;

    const linkedPanes = panePublications[publisher.id] ?? [];
    const prioritizedPanes = [
      ...linkedPanes.filter((pane) => pane.kind === "editor"),
      ...linkedPanes.filter((pane) => pane.kind === "canvas"),
      ...linkedPanes.filter((pane) => pane.kind === "session"),
    ];

    for (const pane of prioritizedPanes) {
      if (seenPaneIds.has(pane.id)) continue;
      seenPaneIds.add(pane.id);
      visiblePanes.push(pane);
      publishers.push(pane);
      if (visiblePanes.length === maxVisible) break;
    }
  }

  return visiblePanes;
}

export function deriveReachablePaneIds(
  rootPanes: WorkspacePane[],
  panePublications: PanePublications,
): string[] {
  return deriveReachablePanes(rootPanes, panePublications).map((pane) => pane.id);
}

export function deriveOpenSessionIds(panes: WorkspacePane[]): string[] {
  return panes.flatMap((pane) => (pane.kind === "session" ? [pane.sessionId] : []));
}

function deriveReachablePanes(
  rootPanes: WorkspacePane[],
  panePublications: PanePublications,
): WorkspacePane[] {
  const reachablePanes: WorkspacePane[] = [];
  const seenPaneIds = new Set<string>();
  const queue = [...rootPanes];

  while (queue.length > 0) {
    const pane = queue.shift();
    if (!pane || seenPaneIds.has(pane.id)) continue;

    seenPaneIds.add(pane.id);
    reachablePanes.push(pane);

    for (const linkedPane of panePublications[pane.id] ?? []) {
      if (!seenPaneIds.has(linkedPane.id)) queue.push(linkedPane);
    }
  }

  return reachablePanes;
}

type EditorAutoFocusResolution = {
  focusPane: EditorWorkspacePane | undefined;
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
  panes: WorkspacePane[],
  autoFocusArtifacts: Settings["autoFocusArtifacts"],
  forceFocusPaneIds?: ReadonlySet<string>,
): EditorAutoFocusResolution {
  return {
    focusPane: isSingleSessionLayout(panes)
      ? panes
          .filter((pane) => shouldAutoFocusEditorPane(pane, autoFocusArtifacts, forceFocusPaneIds))
          .find((pane) => !seenPaneIds.has(pane.id))
      : undefined,
    seenPaneIds: new Set(panes.map((pane) => pane.id)),
  };
}

function isSingleSessionLayout(panes: WorkspacePane[]): boolean {
  return panes.filter((pane) => pane.kind === "session" && !pane.isLinkedOnly).length === 1;
}

function shouldAutoFocusEditorPane(
  pane: WorkspacePane,
  autoFocusArtifacts: Settings["autoFocusArtifacts"],
  forceFocusPaneIds?: ReadonlySet<string>,
): pane is EditorWorkspacePane {
  if (!isEditorPane(pane)) return false;
  // Force-focus overrides the setting — e.g. an artifact-first draft's own file.
  if (forceFocusPaneIds?.has(pane.id)) return true;
  const owner = ownerSessionId(pane.file);
  return (
    owner !== undefined &&
    matchesSessionFeatureScope(autoFocusArtifacts, getArtifactSessionType(owner))
  );
}

function getArtifactSessionType(sourceSessionId: string): "session" | "automation" {
  return isAutomationId(sourceSessionId) ? "automation" : "session";
}

function getDefaultEditorPaneMode(file: WorkspaceFile): WorkspaceFileMode {
  const owner = ownerSessionId(file);
  return owner !== undefined && isAutomationId(owner) ? "read" : "edit";
}
