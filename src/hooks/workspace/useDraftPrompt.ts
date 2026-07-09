import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { getOrCreateClientId } from "@/lib/config/clientId";
import type { DraftPrompt } from "@/types";
import { sessionPromptAtom } from "./atoms";
import { useWorkspaceActions } from "./WorkspaceActionsContext";

const DRAFT_PROMPT_SYNC_DELAY_MS = 1500;

// One keyed session pane owns this local editing lifetime: composer text updates
// locally, debounces into shared state, adopts remote edits, and flushes on unmount.
export function useDraftPrompt(sessionId: string, options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const [origin] = useState(getOrCreateClientId);
  const sharedPrompt = useAtomValue(sessionPromptAtom(sessionId)) ?? null;
  const { dispatchWorkspaceAction } = useWorkspaceActions();
  const [prompt, setPromptState] = useState("");
  const editedRef = useRef(false);
  const syncedTextRef = useRef<string | null>(null);
  const pendingSyncRef = useRef<{
    flush: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  function setPrompt(text: string) {
    if (!enabled) return;
    editedRef.current = true;
    setPromptState(text);

    if (pendingSyncRef.current) clearTimeout(pendingSyncRef.current.timer);
    const flush = () => {
      const pending = pendingSyncRef.current;
      if (pending?.flush !== flush) return;

      clearTimeout(pending.timer);
      pendingSyncRef.current = null;
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
    };
    pendingSyncRef.current = {
      flush,
      timer: setTimeout(flush, DRAFT_PROMPT_SYNC_DELAY_MS),
    };
  }

  useEffect(() => {
    if (!enabled || !shouldAdoptDraftPrompt(sharedPrompt, origin, editedRef.current)) return;

    const nextText = sharedPrompt?.text ?? "";
    setPromptState(nextText);
    if (pendingSyncRef.current) clearTimeout(pendingSyncRef.current.timer);
    pendingSyncRef.current = null;
    syncedTextRef.current = nextText;
  }, [enabled, origin, sharedPrompt]);

  useEffect(() => () => pendingSyncRef.current?.flush(), []);

  return { prompt, setPrompt };
}

export function shouldAdoptDraftPrompt(
  sharedPrompt: DraftPrompt | null,
  origin: string,
  hasLocalEdit: boolean,
): boolean {
  return !hasLocalEdit || (sharedPrompt !== null && sharedPrompt.origin !== origin);
}
