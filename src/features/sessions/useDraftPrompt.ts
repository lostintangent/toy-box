import { useEffect, useRef, useState } from "react";
import { useDebouncer } from "@tanstack/react-pacer/debouncer";
import { getOrCreateClientId } from "@workspace/model/config/clientId";
import { useDispatchWorkspaceAction } from "@workspace/hooks/state";
import type { DraftPrompt } from "./model";

const DRAFT_PROMPT_SYNC_DELAY_MS = 1500;

// One keyed composer prompt owns this local editing lifetime: text updates
// locally, debounces into shared state, adopts remote edits, and flushes on unmount.
export function useDraftPrompt(sessionId: string | undefined, sharedPrompt: DraftPrompt | null) {
  const [origin] = useState(() => (sessionId === undefined ? "" : getOrCreateClientId()));
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
  const [prompt, setPromptState] = useState("");
  const editedRef = useRef(false);
  const syncedTextRef = useRef<string | null>(null);
  const promptSync = useDebouncer(
    (text: string) => {
      if (sessionId === undefined || syncedTextRef.current === text) return;
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
    if (sessionId === undefined) return;
    editedRef.current = true;
    setPromptState(text);

    promptSync.maybeExecute(text);
  }

  useEffect(() => {
    if (
      sessionId === undefined ||
      !shouldAdoptDraftPrompt(sharedPrompt, origin, editedRef.current)
    ) {
      return;
    }

    const nextText = sharedPrompt?.text ?? "";
    setPromptState(nextText);
    promptSync.cancel();
    syncedTextRef.current = nextText;
  }, [origin, promptSync, sessionId, sharedPrompt]);

  return { prompt, setPrompt };
}

export function shouldAdoptDraftPrompt(
  sharedPrompt: DraftPrompt | null,
  origin: string,
  hasLocalEdit: boolean,
): boolean {
  return !hasLocalEdit || (sharedPrompt !== null && sharedPrompt.origin !== origin);
}
