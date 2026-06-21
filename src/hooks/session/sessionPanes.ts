import type { SessionCanvas } from "@/types";

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
    };

type DeriveVisibleSessionGridPanesOptions = {
  selectedSessionIds: string[];
  linkedPanesBySource: Record<string, SessionGridPane[]>;
  maxVisible?: number;
};

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

export function createLinkedPanes(
  sourceSessionId: string,
  linkedSessionIds: string[],
  canvases: SessionCanvas[],
): SessionGridPane[] {
  return [
    ...linkedSessionIds.map(createLinkedSessionPane),
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

function deriveReachableSessionIds(
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

function createSessionPane(
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
