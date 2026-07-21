import { useEffect, useRef, useState } from "react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { readArtifact, writeArtifact } from "@/functions/artifacts";
import { notifyAgent } from "@/functions/sessions";
import { SerialTaskQueue } from "@/lib/serialTaskQueue";
import type { ArtifactPaneMode } from "@/lib/workspace/panes";
import { createArtifactRouteUrl } from "@/lib/session/artifacts/paths";
import type { FileWatchEvent } from "@/types";

const SAVE_DEBOUNCE_MS = 2_000;
const SAVE_SETTLE_MS = 1_000;
const ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS = 8_000;

type ArtifactFlushOptions = { notifyAgent?: boolean };

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
  flush: (options?: ArtifactFlushOptions) => Promise<void>;
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
  const [saveQueue] = useState(() => new SerialTaskQueue());

  // Discard reads that finish after a newer load or unmount.
  const loadIdRef = useRef(0);
  const pendingContentRef = useRef("");
  const flushOptionsRef = useRef<ArtifactFlushOptions | undefined>(undefined);
  const lastWrittenTimestampRef = useRef<number | null>(null);
  const settleTask = useDebouncer(() => setIsSaving(false), { wait: SAVE_SETTLE_MS });

  const saveTask = useDebouncer(
    () => {
      const { notifyAgent = true } = flushOptionsRef.current ?? {};
      const nextContent = pendingContentRef.current;
      setIsSaving(true);
      settleTask.cancel();
      const save = saveQueue.enqueue(async () => {
        const result = await writeArtifact({
          data: { sessionId, path, content: nextContent },
        });
        lastWrittenTimestampRef.current = result.timestamp;
        setError(null);
        if (notifyAgent) scheduleAgentNotification();
      });
      void save.then(
        () => settleTask.maybeExecute(),
        () => {
          setError("Unable to save this artifact.");
          settleTask.maybeExecute();
        },
      );
    },
    {
      wait: SAVE_DEBOUNCE_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  function save(nextContent: string) {
    pendingContentRef.current = nextContent;
    saveTask.maybeExecute();
  }

  function flush(options?: ArtifactFlushOptions): Promise<void> {
    flushOptionsRef.current = options;
    saveTask.flush();
    flushOptionsRef.current = undefined;
    return saveQueue.waitForPending();
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

  return {
    content,
    revision,
    isReady: content !== null,
    isLoading,
    isSaving,
    error,
    save,
    flush,
  };
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
  const notificationTask = useDebouncer(
    () => {
      void notifyAgent({
        data: { sessionId, notification: { type: "artifact_edited", path } },
      }).catch((error) => {
        console.error("Failed to notify agent about artifact edit:", error);
      });
    },
    {
      enabled,
      wait: ARTIFACT_EDIT_NOTIFICATION_DEBOUNCE_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  return notificationTask.maybeExecute;
}
