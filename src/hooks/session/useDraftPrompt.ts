import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { workspaceStateAtom } from "@/atoms";
import { getOrCreateClientId } from "@/lib/config/clientId";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import { useWorkspaceContext } from "@/hooks/workspace/context";
import type { DraftPrompt } from "@/types";

const DRAFT_PROMPT_SYNC_DELAY_MS = 1500;

function clearTimer(timer: ReturnType<typeof setTimeout> | null): void {
  if (timer) clearTimeout(timer);
}

export function shouldAdoptDraftPrompt(
  serverPrompt: DraftPrompt | null,
  origin: string,
  hasEditedThisMount: boolean,
): boolean {
  if (serverPrompt === null && hasEditedThisMount) return false;

  return (
    !hasEditedThisMount ||
    serverPrompt?.origin !== origin ||
    serverPrompt?.origin === DRAFT_PROMPT_SERVER_ORIGIN
  );
}

export function useDraftPrompt(
  sessionId: string,
  options?: { enabled?: boolean },
): {
  prompt: string;
  setPrompt: (text: string) => void;
} {
  const enabled = options?.enabled ?? true;
  const origin = useMemo(() => getOrCreateClientId(), []);
  const workspaceState = useAtomValue(workspaceStateAtom);
  const { dispatchWorkspaceAction } = useWorkspaceContext();
  const serverPrompt = enabled
    ? (workspaceState.draftPromptsBySessionId[sessionId] ?? null)
    : undefined;
  const [prompt, setPromptState] = useState("");
  const hasEditedThisMountRef = useRef(false);
  const pendingTextRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPushedTextRef = useRef<string | null>(null);

  const pushPrompt = useCallback(
    (text: string) => {
      if (!enabled) return;
      if (lastPushedTextRef.current === text) return;
      lastPushedTextRef.current = text;

      void dispatchWorkspaceAction({
        type: "session.prompt.drafted",
        sessionId,
        prompt: {
          text,
          origin,
          updatedAt: Date.now(),
        },
      });
    },
    [dispatchWorkspaceAction, enabled, origin, sessionId],
  );

  const flushPendingPrompt = useCallback(() => {
    clearTimer(timerRef.current);
    timerRef.current = null;

    const text = pendingTextRef.current;
    pendingTextRef.current = null;
    if (text === null) return;

    pushPrompt(text);
  }, [pushPrompt]);

  useEffect(() => {
    return () => {
      flushPendingPrompt();
    };
  }, [flushPendingPrompt]);

  useEffect(() => {
    hasEditedThisMountRef.current = false;
    pendingTextRef.current = null;
    lastPushedTextRef.current = null;
    clearTimer(timerRef.current);
    timerRef.current = null;
    setPromptState("");
  }, [sessionId]);

  useEffect(() => {
    if (serverPrompt === undefined) return;
    if (!shouldAdoptDraftPrompt(serverPrompt, origin, hasEditedThisMountRef.current)) return;

    const nextText = serverPrompt?.text ?? "";
    setPromptState(nextText);
    pendingTextRef.current = null;
    clearTimer(timerRef.current);
    timerRef.current = null;
    lastPushedTextRef.current = nextText;
  }, [origin, serverPrompt]);

  const setPrompt = useCallback(
    (text: string) => {
      if (!enabled) return;
      hasEditedThisMountRef.current = true;
      setPromptState(text);

      pendingTextRef.current = text;
      clearTimer(timerRef.current);
      timerRef.current = setTimeout(flushPendingPrompt, DRAFT_PROMPT_SYNC_DELAY_MS);
    },
    [enabled, flushPendingPrompt],
  );

  return {
    prompt,
    setPrompt,
  };
}
