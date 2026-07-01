import type { SessionCanvas } from "@/types";
import {
  ARTIFACT_KINDS,
  artifactDisplay,
  resolveArtifactKind,
} from "@/components/session/panes/artifacts/kinds";
import { getAutomationIdFromSessionId } from "@/lib/automation/sessionId";
import {
  matchesSessionFeatureScope,
  type SessionFeatureScope,
  type SessionFeatureSubject,
} from "@/lib/config/settings";

export type ArtifactPaneMode = "read" | "edit" | "shared";

export type SessionGridPane =
  | {
      kind: "session";
      id: string;
      sessionId: string;
      isLinkedOnly: boolean;
    }
  | {
      kind: "canvas";
      id: string;
      sourceSessionId: string;
      canvas: SessionCanvas;
    }
  | ArtifactGridPane;

type ArtifactGridPaneBase = {
  id: string;
  sourceSessionId: string;
  path: string;
  title: string;
  mode: ArtifactPaneMode;
};

export type ArtifactKind = "markdown" | "html";

export type ArtifactGridPane = ArtifactGridPaneBase & { kind: ArtifactKind };

type DeriveVisibleSessionGridPanesOptions = {
  selectedSessionIds: string[];
  linkedPanesBySource: Record<string, SessionGridPane[]>;
  maxVisible?: number;
};

// Pane ids are `type:sourceSessionId:naturalKey` — namespaced by the owning
// session and keyed by the pane's own identity (an artifact's path; a canvas's
// key plus revision, so revision bumps remount the pane). The type literal
// keeps pane ids disjoint from each other and from raw session ids; a pane's
// kind is a rendering concern and deliberately not part of its identity.

export function createCanvasPaneId(sourceSessionId: string, canvas: SessionCanvas): string {
  return `canvas:${sourceSessionId}:${canvas.key}:${canvas.revision}`;
}

export function createLinkedSessionPane(
  sessionId: string,
): Extract<SessionGridPane, { kind: "session" }> {
  return createSessionPane(sessionId, true);
}

export function createLinkedCanvasPane(
  sourceSessionId: string,
  canvas: SessionCanvas,
): Extract<SessionGridPane, { kind: "canvas" }> {
  return {
    kind: "canvas",
    id: createCanvasPaneId(sourceSessionId, canvas),
    sourceSessionId,
    canvas,
  };
}

export function createArtifactPaneId(sourceSessionId: string, path: string): string {
  return `artifact:${sourceSessionId}:${path}`;
}

export function createArtifactPane(
  sourceSessionId: string,
  path: string,
  mode = getDefaultArtifactPaneMode(sourceSessionId),
): ArtifactGridPane {
  return {
    kind: resolveArtifactKind(path),
    id: createArtifactPaneId(sourceSessionId, path),
    sourceSessionId,
    path,
    title: artifactDisplay(path).name,
    mode,
  };
}

export function isArtifactPane(pane: SessionGridPane): pane is ArtifactGridPane {
  return pane.kind in ARTIFACT_KINDS;
}

export function getDefaultArtifactPaneMode(sourceSessionId: string): ArtifactPaneMode {
  return getAutomationIdFromSessionId(sourceSessionId) ? "read" : "shared";
}

type ArtifactAutoFocusResolution = {
  focusPane: ArtifactGridPane | undefined;
  seenPaneIds: ReadonlySet<string>;
};

/**
 * Eligible artifacts are artifact-first: their artifact is the primary surface
 * and the transcript is secondary, so an eligible artifact pane should take
 * focus when it appears (maximized on desktop, paged-to on mobile). Focus is
 * only claimed in single-session layouts, so an artifact never takes over a
 * multi-session grid.
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
  panes: SessionGridPane[],
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

function isSingleSessionLayout(panes: SessionGridPane[]): boolean {
  return panes.filter((pane) => pane.kind === "session" && !pane.isLinkedOnly).length === 1;
}

function shouldAutoFocusArtifactPane(
  pane: SessionGridPane,
  autoFocusArtifacts: SessionFeatureScope,
): pane is ArtifactGridPane {
  if (!isArtifactPane(pane)) return false;
  return matchesSessionFeatureScope(
    autoFocusArtifacts,
    getArtifactSessionType(pane.sourceSessionId),
  );
}

function getArtifactSessionType(sourceSessionId: string): SessionFeatureSubject {
  return getAutomationIdFromSessionId(sourceSessionId) ? "automation" : "session";
}

export function createLinkedPanes(
  sourceSessionId: string,
  linkedSessionIds: string[],
  canvases: SessionCanvas[],
  artifacts: string[] = [],
  previousPanes: SessionGridPane[] = [],
): SessionGridPane[] {
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

export function deriveVisibleSessionGridPanes({
  selectedSessionIds,
  linkedPanesBySource,
  maxVisible = 4,
}: DeriveVisibleSessionGridPanesOptions): SessionGridPane[] {
  const panes: SessionGridPane[] = [];
  const selectedSessionIdSet = new Set(selectedSessionIds);
  const reachableSessionIds = deriveReachableSessionIds(selectedSessionIds, linkedPanesBySource);

  for (const sessionId of selectedSessionIds) {
    if (panes.length >= maxVisible) return panes;
    panes.push(createSessionPane(sessionId, false));
  }

  for (const sourceSessionId of reachableSessionIds) {
    for (const artifactPane of linkedPanesBySource[sourceSessionId] ?? []) {
      if (!isArtifactPane(artifactPane)) continue;
      if (panes.length >= maxVisible) return panes;
      panes.push(artifactPane);
    }
  }

  for (const sourceSessionId of reachableSessionIds) {
    for (const linkedPane of linkedPanesBySource[sourceSessionId] ?? []) {
      if (linkedPane.kind !== "canvas") continue;
      if (panes.length >= maxVisible) return panes;
      panes.push(linkedPane);
    }
  }

  for (const sessionId of reachableSessionIds) {
    if (selectedSessionIdSet.has(sessionId)) continue;
    const pane = createLinkedSessionPane(sessionId);
    if (panes.length >= maxVisible) return panes;
    panes.push(pane);
  }

  return panes;
}

export function deriveOpenSessionIds(panes: SessionGridPane[]): string[] {
  return panes.flatMap((pane) => (pane.kind === "session" ? [pane.sessionId] : []));
}

export function deriveReachableSessionIds(
  selectedSessionIds: string[],
  linkedPanesBySource: Record<string, SessionGridPane[]>,
): string[] {
  const reachableSessionIds: string[] = [];
  const seenSessionIds = new Set<string>();
  const queue = [...selectedSessionIds];

  for (const sessionId of selectedSessionIds) {
    seenSessionIds.add(sessionId);
  }

  while (queue.length > 0) {
    const sessionId = queue.shift();
    if (!sessionId) continue;
    reachableSessionIds.push(sessionId);

    for (const pane of linkedPanesBySource[sessionId] ?? []) {
      if (pane.kind !== "session") continue;
      if (seenSessionIds.has(pane.sessionId)) continue;
      seenSessionIds.add(pane.sessionId);
      queue.push(pane.sessionId);
    }
  }

  return reachableSessionIds;
}

export function createSessionPane(
  sessionId: string,
  isLinkedOnly: boolean,
): Extract<SessionGridPane, { kind: "session" }> {
  return {
    kind: "session",
    id: `session:${sessionId}`,
    sessionId,
    isLinkedOnly,
  };
}
