import type { SessionCanvas, SessionFeatureScope, SessionFeatureSubject } from "@/types";
import { isAutomationId } from "@/lib/automation/id";
import { artifactName } from "@/lib/session/artifacts/display";
import { matchesSessionFeatureScope } from "@/lib/workspace/config/settings";

export type ArtifactPaneMode = "read" | "edit" | "shared";

export const INBOX_PANE = {
  kind: "inbox",
  id: "inbox",
} as const;

type InboxWorkspacePane = typeof INBOX_PANE;

/** Browser-local content identity shared by grid, pager, and Hyper hosts. */
export type WorkspacePane =
  | InboxWorkspacePane
  | {
      kind: "session";
      id: string;
      sessionId: string;
      isLinkedOnly: boolean;
    }
  | ArtifactWorkspacePane
  | {
      kind: "canvas";
      id: string;
      sourceSessionId: string;
      canvas: SessionCanvas;
    };

export type ArtifactWorkspacePane = {
  kind: "artifact";
  id: string;
  sourceSessionId: string;
  path: string;
  title: string;
  mode: ArtifactPaneMode;
};

/** The browser-local pane graph, keyed by the pane that published each edge. */
export type LinkedPanesByPublisher = Readonly<Record<string, readonly WorkspacePane[]>>;

// Session-backed pane ids are `type:sourceSessionId:naturalKey`, while the one
// Inbox pane uses `inbox`. Artifact identity includes its path; canvas identity
// includes its revision so revision bumps remount the surface. These ids are
// also publisher keys for the browser-local pane graph.

export function createSessionPaneId(sessionId: string): string {
  return `session:${sessionId}`;
}

export function createArtifactPaneId(sourceSessionId: string, path: string): string {
  return `artifact:${sourceSessionId}:${path}`;
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

export function createArtifactPane(
  sourceSessionId: string,
  path: string,
  mode = getDefaultArtifactPaneMode(sourceSessionId),
): ArtifactWorkspacePane {
  return {
    kind: "artifact",
    id: createArtifactPaneId(sourceSessionId, path),
    sourceSessionId,
    path,
    title: artifactName(path),
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

export function isArtifactPane(pane: WorkspacePane): pane is ArtifactWorkspacePane {
  return pane.kind === "artifact";
}

/** The session a pane belongs to — a session pane is its own source; canvas and
 *  artifact panes carry the id of the session that produced them, while Inbox
 *  has no source session. */
export function paneSourceSessionId(pane: WorkspacePane): string | undefined {
  if (pane.kind === "inbox") return undefined;
  return pane.kind === "session" ? pane.sessionId : pane.sourceSessionId;
}

export function deriveWorkspaceRootPanes(selectedSessionIds: string[]): WorkspacePane[] {
  return selectedSessionIds.length > 0
    ? selectedSessionIds.map((sessionId) => createSessionPane(sessionId, false))
    : [INBOX_PANE];
}

export function createLinkedPanes(
  sourceSessionId: string,
  linkedSessionIds: readonly string[],
  canvases: readonly SessionCanvas[],
  artifacts: readonly string[] = [],
  previousPanes: readonly WorkspacePane[] = [],
): WorkspacePane[] {
  const previousArtifacts = new Map(
    previousPanes.filter(isArtifactPane).map((pane) => [pane.id, pane.mode] as const),
  );

  return [
    ...linkedSessionIds.map(createLinkedSessionPane),
    ...artifacts.map((path) => {
      const pane = createArtifactPane(sourceSessionId, path);
      return {
        ...pane,
        mode: previousArtifacts.get(pane.id) ?? pane.mode,
      };
    }),
    ...canvases.map((canvas) => createLinkedCanvasPane(sourceSessionId, canvas)),
  ];
}

type DeriveVisibleWorkspacePanesOptions = {
  rootPanes: WorkspacePane[];
  linkedPanesByPublisher: LinkedPanesByPublisher;
  maxVisible?: number;
};

export function deriveVisibleWorkspacePanes({
  rootPanes,
  linkedPanesByPublisher,
  maxVisible = 4,
}: DeriveVisibleWorkspacePanesOptions): WorkspacePane[] {
  const rootPaneIds = new Set(rootPanes.map((pane) => pane.id));
  const linkedPanes = deriveReachablePanes(rootPanes, linkedPanesByPublisher).filter(
    (pane) => !rootPaneIds.has(pane.id),
  );

  return [
    ...rootPanes,
    ...linkedPanes.filter((pane) => pane.kind === "artifact"),
    ...linkedPanes.filter((pane) => pane.kind === "canvas"),
    ...linkedPanes.filter((pane) => pane.kind === "session"),
  ].slice(0, maxVisible);
}

export function deriveReachablePaneIds(
  rootPanes: WorkspacePane[],
  linkedPanesByPublisher: LinkedPanesByPublisher,
): string[] {
  return deriveReachablePanes(rootPanes, linkedPanesByPublisher).map((pane) => pane.id);
}

export function deriveOpenSessionIds(panes: WorkspacePane[]): string[] {
  return panes.flatMap((pane) => (pane.kind === "session" ? [pane.sessionId] : []));
}

function deriveReachablePanes(
  rootPanes: WorkspacePane[],
  linkedPanesByPublisher: LinkedPanesByPublisher,
): WorkspacePane[] {
  const reachablePanes: WorkspacePane[] = [];
  const seenPaneIds = new Set<string>();
  const queue = [...rootPanes];

  while (queue.length > 0) {
    const pane = queue.shift();
    if (!pane || seenPaneIds.has(pane.id)) continue;

    seenPaneIds.add(pane.id);
    reachablePanes.push(pane);

    for (const linkedPane of linkedPanesByPublisher[pane.id] ?? []) {
      if (!seenPaneIds.has(linkedPane.id)) queue.push(linkedPane);
    }
  }

  return reachablePanes;
}

type ArtifactAutoFocusResolution = {
  focusPane: ArtifactWorkspacePane | undefined;
  seenPaneIds: ReadonlySet<string>;
};

/**
 * Eligible artifacts are artifact-first: their artifact is the primary surface
 * and the transcript is secondary, so an eligible artifact pane should take
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
export function resolveArtifactAutoFocus(
  seenPaneIds: ReadonlySet<string>,
  panes: WorkspacePane[],
  autoFocusArtifacts: SessionFeatureScope,
): ArtifactAutoFocusResolution {
  return {
    focusPane: isSingleSessionLayout(panes)
      ? panes
          .filter((pane) => shouldAutoFocusArtifactPane(pane, autoFocusArtifacts))
          .find((pane) => !seenPaneIds.has(pane.id))
      : undefined,
    seenPaneIds: new Set(panes.map((pane) => pane.id)),
  };
}

function isSingleSessionLayout(panes: WorkspacePane[]): boolean {
  return panes.filter((pane) => pane.kind === "session" && !pane.isLinkedOnly).length === 1;
}

function shouldAutoFocusArtifactPane(
  pane: WorkspacePane,
  autoFocusArtifacts: SessionFeatureScope,
): pane is ArtifactWorkspacePane {
  if (!isArtifactPane(pane)) return false;
  return matchesSessionFeatureScope(
    autoFocusArtifacts,
    getArtifactSessionType(pane.sourceSessionId),
  );
}

function getArtifactSessionType(sourceSessionId: string): SessionFeatureSubject {
  return isAutomationId(sourceSessionId) ? "automation" : "session";
}

function getDefaultArtifactPaneMode(sourceSessionId: string): ArtifactPaneMode {
  return isAutomationId(sourceSessionId) ? "read" : "edit";
}
