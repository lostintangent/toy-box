import { useCallback, useEffect, useMemo, useState } from "react";
import { useAtomValue } from "jotai";
import { linkedSessionsAtom } from "@/atoms";

function traverseLinkedSessions(
  selectedSessionIds: string[],
  linkedSessionIdsBySource: Record<string, string[]>,
): Set<string> {
  const reachableLinkedSessionIds = new Set<string>();
  const seenSessionIds = new Set(selectedSessionIds);
  const queue = [...selectedSessionIds];

  while (queue.length > 0) {
    const sessionId = queue.shift();
    if (!sessionId) continue;

    for (const linkedSessionId of linkedSessionIdsBySource[sessionId] ?? []) {
      if (seenSessionIds.has(linkedSessionId)) continue;
      seenSessionIds.add(linkedSessionId);
      reachableLinkedSessionIds.add(linkedSessionId);
      queue.push(linkedSessionId);
    }
  }

  return reachableLinkedSessionIds;
}

export function reconcileDismissedLinkedSessionIds(
  dismissedLinkedSessionIds: ReadonlySet<string>,
  selectedSessionIds: string[],
  linkedSessionIdsBySource: Record<string, string[]>,
): ReadonlySet<string> {
  if (dismissedLinkedSessionIds.size === 0) {
    return dismissedLinkedSessionIds;
  }

  const reachableLinkedSessionIds = traverseLinkedSessions(
    selectedSessionIds,
    linkedSessionIdsBySource,
  );
  const nextDismissedLinkedSessionIds = new Set<string>();

  for (const sessionId of dismissedLinkedSessionIds) {
    if (!reachableLinkedSessionIds.has(sessionId)) continue;
    nextDismissedLinkedSessionIds.add(sessionId);
  }

  return nextDismissedLinkedSessionIds.size === dismissedLinkedSessionIds.size
    ? dismissedLinkedSessionIds
    : nextDismissedLinkedSessionIds;
}

export function deriveVisibleSessionIds(
  selectedSessionIds: string[],
  linkedSessionIdsBySource: Record<string, string[]>,
  dismissedLinkedSessionIds: ReadonlySet<string>,
  maxVisible = 4,
): string[] {
  const visibleSessionIds: string[] = [];
  const explicitlySelectedSessionIds = new Set(selectedSessionIds);
  const discoveredSessionIds = new Set(selectedSessionIds);
  const queue = [...discoveredSessionIds];

  while (queue.length > 0 && visibleSessionIds.length < maxVisible) {
    const sessionId = queue.shift();
    if (!sessionId) continue;

    const isExplicitlySelected = explicitlySelectedSessionIds.has(sessionId);
    if (dismissedLinkedSessionIds.has(sessionId) && !isExplicitlySelected) continue;

    visibleSessionIds.push(sessionId);

    for (const linkedSessionId of linkedSessionIdsBySource[sessionId] ?? []) {
      if (discoveredSessionIds.has(linkedSessionId)) continue;
      discoveredSessionIds.add(linkedSessionId);
      queue.push(linkedSessionId);
    }
  }

  return visibleSessionIds;
}

type UseLinkedSessionsOptions = {
  selectedSessionIds: string[];
  maxVisible?: number;
};

export function useLinkedSessions({
  selectedSessionIds,
  maxVisible = 4,
}: UseLinkedSessionsOptions) {
  const linkedSessionIdsBySource = useAtomValue(linkedSessionsAtom);
  const [dismissedLinkedSessionIds, setDismissedLinkedSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const resetDismissedLinkedSessions = useCallback(() => {
    setDismissedLinkedSessionIds((current) => (current.size === 0 ? current : new Set()));
  }, []);

  useEffect(() => {
    setDismissedLinkedSessionIds((current) =>
      reconcileDismissedLinkedSessionIds(current, selectedSessionIds, linkedSessionIdsBySource),
    );
  }, [linkedSessionIdsBySource, selectedSessionIds]);

  const visibleSessionIds = useMemo(() => {
    return deriveVisibleSessionIds(
      selectedSessionIds,
      linkedSessionIdsBySource,
      dismissedLinkedSessionIds,
      maxVisible,
    );
  }, [dismissedLinkedSessionIds, linkedSessionIdsBySource, maxVisible, selectedSessionIds]);

  const dismissLinkedSession = useCallback((sessionId: string) => {
    setDismissedLinkedSessionIds((current) => {
      if (current.has(sessionId)) {
        return current;
      }

      return new Set(current).add(sessionId);
    });
  }, []);

  const restoreLinkedSession = useCallback((sessionId: string) => {
    setDismissedLinkedSessionIds((current) => {
      if (!current.has(sessionId)) {
        return current;
      }

      const nextDismissedLinkedSessionIds = new Set(current);
      nextDismissedLinkedSessionIds.delete(sessionId);
      return nextDismissedLinkedSessionIds;
    });
  }, []);

  return {
    visibleSessionIds,
    dismissLinkedSession,
    restoreLinkedSession,
    resetDismissedLinkedSessions,
  };
}
