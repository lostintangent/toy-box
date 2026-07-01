import { useCallback, useEffect, useRef, useState } from "react";
import {
  readSessionArtifact,
  statSessionArtifact,
  writeSessionArtifact,
} from "@/functions/artifacts";
import { notifyAgent } from "@/functions/sessions";
import type { ArtifactPaneMode } from "@/hooks/session/sessionPanes";
import { createSessionArtifactRouteUrl } from "@/lib/session/artifacts/paths";
import type { FileWatchEvent } from "@/types";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS = 8_000;

type Timer = ReturnType<typeof setTimeout>;

export type Artifact = {
  /** Last known on-disk content (the external baseline), or null while loading/errored.
   *  This is not a controlled editing buffer — the editor owns its buffer and calls
   *  `save` to persist. */
  content: string | null;
  /** The artifact's timestamp, advanced only by external edits (not our own writes). Use as
   *  a render key to reload previews when the agent changes the file underneath us. */
  revision: number;
  /** Whether the artifact exists and is renderable — content loaded (content kinds) or
   *  existence stat-confirmed (preview kinds, which never load the body). */
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  /** Debounced, serialized persist. No-op in read mode. */
  save: (content: string) => void;
};

type UseArtifactOptions = {
  sessionId: string;
  path: string;
  mode: ArtifactPaneMode;
  /** When true, only stat the artifact (existence + timestamp) instead of reading its body —
   *  for preview kinds that render out-of-band via the preview endpoint. */
  usesPreview?: boolean;
};

export function useArtifact({ sessionId, path, mode, usesPreview }: UseArtifactOptions): Artifact {
  const canSave = mode !== "read";
  const notifyEdited = useArtifactEditNotification({
    enabled: mode === "shared",
    path,
    sessionId,
  });

  const [content, setContent] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [isReady, setIsReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic read token; a read result is discarded once a newer load or path change bumps this.
  const loadIdRef = useRef(0);
  // Latest editor content awaiting its debounced write, with its debounce handle; null when idle.
  const pendingSaveRef = useRef<{ content: string; timer: Timer } | null>(null);
  // Tail of the serialized write chain; each write appends here so writes never overlap or reorder.
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Timestamp of our most recent successful write; a watch event with this timestamp is our own echo.
  const lastWrittenTimestampRef = useRef<number | null>(null);
  // Keeps "Saving…" visible briefly after the last write so the indicator doesn't flicker.
  const settleTimerRef = useRef<Timer | undefined>(undefined);

  const clearSettle = useCallback(() => {
    if (settleTimerRef.current === undefined) return;
    clearTimeout(settleTimerRef.current);
    settleTimerRef.current = undefined;
  }, []);

  // Read the artifact and adopt its timestamp as the external revision. Preview kinds render
  // out-of-band via the iframe, so they only stat (existence + timestamp) — never the body.
  const reload = useCallback(async () => {
    const readId = ++loadIdRef.current;
    try {
      if (usesPreview) {
        const { timestamp } = await statSessionArtifact({ data: { sessionId, path } });
        if (loadIdRef.current !== readId) return;
        setRevision(timestamp);
      } else {
        const result = await readSessionArtifact({ data: { sessionId, path } });
        if (loadIdRef.current !== readId) return;
        setContent(result.content);
        setRevision(result.timestamp);
      }
      setIsReady(true);
      setError(null);
    } catch {
      if (loadIdRef.current !== readId) return;
      setContent(null);
      setIsReady(false);
      setError("Unable to load this artifact.");
    }
  }, [path, sessionId, usesPreview]);

  // Write one snapshot to disk: serialized so writes can't reorder, and its timestamp is
  // remembered so the watcher can recognize (and ignore) the echo of our own write.
  const persist = useCallback(
    (nextContent: string) => {
      setIsSaving(true);
      clearSettle();
      saveQueueRef.current = saveQueueRef.current.then(async () => {
        try {
          const result = await writeSessionArtifact({
            data: { sessionId, path, content: nextContent },
          });
          lastWrittenTimestampRef.current = result.timestamp;
          setError(null);
          notifyEdited();
        } catch {
          setError("Unable to save changes.");
        } finally {
          // Re-arm on every write so the indicator only clears once the last one settles.
          clearSettle();
          settleTimerRef.current = setTimeout(() => {
            settleTimerRef.current = undefined;
            setIsSaving(false);
          }, SAVE_SETTLE_MS);
        }
      });
    },
    [clearSettle, notifyEdited, path, sessionId],
  );

  const flushPendingSave = useCallback(() => {
    const pending = pendingSaveRef.current;
    if (!pending) return;
    clearTimeout(pending.timer);
    pendingSaveRef.current = null;
    persist(pending.content);
  }, [persist]);

  // Public entry: debounce the editor's latest content into a single pending write.
  const save = useCallback(
    (nextContent: string) => {
      if (!canSave) return;
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timer);
      pendingSaveRef.current = {
        content: nextContent,
        timer: setTimeout(flushPendingSave, SAVE_DEBOUNCE_MS),
      };
    },
    [canSave, flushPendingSave],
  );

  // Load fresh and reset every piece of per-artifact state whenever the identity changes.
  useEffect(() => {
    loadIdRef.current++;
    pendingSaveRef.current = null;
    lastWrittenTimestampRef.current = null;
    clearSettle();
    setContent(null);
    setRevision(0);
    setIsReady(false);
    setError(null);
    setIsSaving(false);
    setIsLoading(true);

    let cancelled = false;
    void reload().finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [clearSettle, reload]);

  // Reload on external changes; skip the echo of our own writes.
  useEffect(() => {
    const source = new EventSource(createSessionArtifactRouteUrl("/api/watch", sessionId, path));
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data) as FileWatchEvent;
      if (event.type === "deleted") {
        setContent(null);
        setIsReady(false);
        setError("This artifact was deleted.");
        return;
      }
      // Our own write's echo. Rare race: if this (debounced) event beats the write's RPC response,
      // the timestamp isn't recorded yet and we reload once — harmless (identical content for
      // Markdown, one preview refresh for HTML). A real external edit inside our sub-second write
      // window can't happen in practice: the agent is only nudged ~8s after edits settle.
      if (event.timestamp === lastWrittenTimestampRef.current) return;
      void reload();
    };
    source.onerror = () => setError("Unable to watch this artifact.");
    return () => source.close();
  }, [path, reload, sessionId]);

  // Persist a pending edit before this artifact unmounts (or its identity changes), so it isn't lost.
  useEffect(() => flushPendingSave, [flushPendingSave]);

  return { content, revision, isReady, isLoading, isSaving, error, save };
}

type ArtifactEditNotificationOptions = {
  enabled: boolean;
  path: string;
  sessionId: string;
};

/** Debounced side-channel that nudges the agent after the user edits a shared artifact. */
function useArtifactEditNotification({
  enabled,
  path,
  sessionId,
}: ArtifactEditNotificationOptions): () => void {
  const enabledRef = useRef(enabled);
  const timerRef = useRef<Timer | undefined>(undefined);
  const pendingRef = useRef(false);
  enabledRef.current = enabled;

  const clearTimer = useCallback(() => {
    if (timerRef.current === undefined) return;
    clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }, []);

  const flush = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    clearTimer();
    if (!enabledRef.current) return;

    void notifyAgent(sessionId, { type: "artifact_edited", path }).catch((error) => {
      console.error("Failed to send artifact edit notification:", error);
    });
  }, [clearTimer, path, sessionId]);

  const schedule = useCallback(() => {
    if (!enabledRef.current) {
      pendingRef.current = false;
      clearTimer();
      return;
    }

    pendingRef.current = true;
    clearTimer();
    timerRef.current = setTimeout(flush, ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS);
  }, [clearTimer, flush]);

  useEffect(() => {
    if (enabled) return;
    pendingRef.current = false;
    clearTimer();
  }, [clearTimer, enabled]);

  useEffect(() => flush, [flush]);

  return schedule;
}
