import { useEffect, useRef, useState } from "react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { getOrCreateClientId } from "@/lib/workspace/config/clientId";
import type { DraftPrompt } from "@/types";
import { useDispatchWorkspaceAction } from "./state";

const DRAFT_PROMPT_SYNC_DELAY_MS = 1500;

// One keyed session pane owns this local editing lifetime: composer text updates
// locally, debounces into shared state, adopts remote edits, and flushes on unmount.
export function useDraftPrompt(
  sessionId: string,
  { sharedPrompt, enabled = true }: { sharedPrompt: DraftPrompt | null; enabled?: boolean },
) {
  const [origin] = useState(getOrCreateClientId);
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
  const [prompt, setPromptState] = useState("");
  const editedRef = useRef(false);
  const syncedTextRef = useRef<string | null>(null);
  const promptSync = useDebouncer(
    (text: string) => {
      if (syncedTextRef.current === text) return;
      syncedTextRef.current = text;

      dispatchWorkspaceAction({
        type: "session.prompt.drafted",
        sessionId,
        prompt: {
          text,
          origin,
          updatedAt: Date.now(),
        },
      });
    },
    {
      wait: DRAFT_PROMPT_SYNC_DELAY_MS,
      onUnmount: (debouncer) => debouncer.flush(),
    },
  );

  function setPrompt(text: string) {
    if (!enabled) return;
    editedRef.current = true;
    setPromptState(text);

    promptSync.maybeExecute(text);
  }

  useEffect(() => {
    if (!enabled || !shouldAdoptDraftPrompt(sharedPrompt, origin, editedRef.current)) return;

    const nextText = sharedPrompt?.text ?? "";
    setPromptState(nextText);
    promptSync.cancel();
    syncedTextRef.current = nextText;
  }, [enabled, origin, promptSync, sharedPrompt]);

  return { prompt, setPrompt };
}

export function shouldAdoptDraftPrompt(
  sharedPrompt: DraftPrompt | null,
  origin: string,
  hasLocalEdit: boolean,
): boolean {
  return !hasLocalEdit || (sharedPrompt !== null && sharedPrompt.origin !== origin);
}
