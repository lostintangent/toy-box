import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readArtifact, writeArtifact } from "@/functions/artifacts";
import { notifyAgent } from "@/functions/sessions";
import type { ArtifactPaneMode } from "@/lib/workspace/panes";
import { createArtifactRouteUrl } from "@/lib/session/artifacts/paths";
import type { FileWatchEvent } from "@/types";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS = 8_000;

type Timer = ReturnType<typeof setTimeout>;

export type Artifact = {
  /** Last known on-disk content; the renderer owns its editing buffer. */
  content: string | null;
  /** External file revision. Own saves do not advance it or reset renderer state. */
  revision: number;
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save: (content: string) => void;
  flush: (options?: { notifyAgent?: boolean }) => Promise<void>;
};

export function useArtifact({
  sessionId,
  path,
  mode,
}: {
  sessionId: string;
  path: string;
  mode: ArtifactPaneMode;
}): Artifact {
  const scheduleAgentNotification = useArtifactEditNotification({
    enabled: mode === "shared",
    path,
    sessionId,
  });

  const [content, setContent] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Discard reads that finish after a newer load or unmount.
  const loadIdRef = useRef(0);
  const pendingSaveRef = useRef<{
    flush: (options?: { notifyAgent?: boolean }) => Promise<void>;
    timer: Timer;
  } | null>(null);
  // Writes are serialized so rapid edits cannot land out of order.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastWrittenTimestampRef = useRef<number | null>(null);
  const settleTimerRef = useRef<Timer | undefined>(undefined);

  function clearSettle() {
    if (settleTimerRef.current === undefined) return;
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = undefined;
  }

  function save(nextContent: string) {
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timer);

    function flush({ notifyAgent = true }: { notifyAgent?: boolean } = {}): Promise<void> {
      const pending = pendingSaveRef.current;
      if (pending?.flush !== flush) return saveQueueRef.current;
      clearTimeout(pending.timer);
      pendingSaveRef.current = null;
      setIsSaving(true);
      clearSettle();
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        const result = await writeArtifact({
          data: { sessionId, path, content: nextContent },
        });
        lastWrittenTimestampRef.current = result.timestamp;
        setError(null);
        if (notifyAgent) scheduleAgentNotification();
        clearSettle();
        settleTimerRef.current = setTimeout(() => {
          settleTimerRef.current = undefined;
          setIsSaving(false);
        }, SAVE_SETTLE_MS);
      });
      return saveQueueRef.current;
    }

    pendingSaveRef.current = {
      flush,
      timer: setTimeout(flush, SAVE_DEBOUNCE_MS),
    };
  }

  function flush(options?: { notifyAgent?: boolean }): Promise<void> {
    return pendingSaveRef.current?.flush(options) ?? saveQueueRef.current;
  }

  // The pane is keyed by session and path, so this effect owns one artifact's
  // complete read/watch lifetime while mode and content updates preserve it.
  useEffect(() => {
    let cancelled = false;
    async function reload() {
      const readId = ++loadIdRef.current;
      const result = await readArtifact({ data: { sessionId, path } }).catch(() => null);
      if (cancelled || loadIdRef.current !== readId) return;
      if (!result) {
        setContent(null);
        setError("Unable to load this artifact.");
        return;
      }
      setContent(result.content);
      setRevision(result.timestamp);
      setError(null);
    }

    void reload().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    const source = new EventSource(createArtifactRouteUrl("/api/watch", sessionId, path));
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data) as FileWatchEvent;
      if (event.type === "deleted") {
        setContent(null);
        setError("This artifact was deleted.");
        return;
      }
      // A watch event may beat its write response; one harmless reload is acceptable.
      if (event.timestamp === lastWrittenTimestampRef.current) return;
      void reload();
    };
    source.onerror = () => setError("Unable to watch this artifact.");
    return () => {
      cancelled = true;
      source.close();
    };
  }, [path, sessionId]);

  // Do not lose the renderer's final debounced edit on unmount.
  useEffect(
    () => () => {
      void pendingSaveRef.current?.flush();
    },
    [],
  );

  return { content, revision, isReady: content !== null, isLoading, isSaving, error, save, flush };
}

/** Debounced side-channel that nudges the agent after the user edits a shared artifact. */
function useArtifactEditNotification({
  enabled,
  path,
  sessionId,
}: {
  enabled: boolean;
  path: string;
  sessionId: string;
}): () => void {
  const enabledRef = useRef(enabled);
  const pendingNotificationRef = useRef<{ flush: () => void; timer: Timer } | null>(null);
  useLayoutEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  function schedule() {
    const pending = pendingNotificationRef.current;
    if (pending) clearTimeout(pending.timer);
    pendingNotificationRef.current = null;
    if (!enabledRef.current) return;

    function flush() {
      const pending = pendingNotificationRef.current;
      if (pending?.flush !== flush) return;
      clearTimeout(pending.timer);
      pendingNotificationRef.current = null;
      if (!enabledRef.current) return;

      void notifyAgent({
        data: { sessionId, notification: { type: "artifact_edited", path } },
      }).catch((error) => {
        console.error("Failed to notify agent about artifact edit:", error);
      });
    }

    pendingNotificationRef.current = {
      flush,
      timer: setTimeout(flush, ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS),
    };
  }

  useEffect(() => {
    if (enabled) return;
    const pending = pendingNotificationRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingNotificationRef.current = null;
  }, [enabled]);

  // Deliver a settled edit before its notification target changes or disappears.
  useEffect(() => () => pendingNotificationRef.current?.flush(), [path, sessionId]);

  return schedule;
}
