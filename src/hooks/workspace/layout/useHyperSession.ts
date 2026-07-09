import { useState } from "react";
import { useAtomValue } from "jotai";
import {
  defaultViewportOverlayPosition,
  type OverlayPosition,
} from "@/components/workspace/overlayWindow";
import type { WorkspaceAction } from "@/types";
import { hyperSessionIdAtom } from "../atoms";

/** Per-browser state for the floating hyper-session surface. */
export type HyperSessionState = {
  sessionId: string;
  position: OverlayPosition;
  open: boolean;
};

// The hyper deck is a per-browser surface. Its open/position state is seeded once
// from SSR, while shared membership remains authoritative for its existence.
export function useHyperSession({
  initialState,
  createDraft,
  dispatchWorkspaceAction,
  deleteSession,
  openSessionInWorkspace,
}: {
  initialState: HyperSessionState | null;
  createDraft: (options?: { hyper?: boolean }) => string;
  dispatchWorkspaceAction: (action: WorkspaceAction) => void;
  deleteSession: (sessionId: string) => void;
  openSessionInWorkspace: (sessionId: string) => void;
}) {
  const hyperSessionId = useAtomValue(hyperSessionIdAtom);
  const [surface, setSurface] = useState(initialState);
  const state = surface?.sessionId === hyperSessionId ? surface : null;

  function getOrCreateSessionId() {
    return hyperSessionId ?? createDraft({ hyper: true });
  }

  function toggle() {
    const sessionId = getOrCreateSessionId();
    setSurface((current) => {
      if (current?.sessionId === sessionId) {
        return { ...current, open: !current.open };
      }
      return {
        sessionId,
        position: defaultViewportOverlayPosition(),
        open: true,
      };
    });
  }

  function setPosition(sessionId: string, position: OverlayPosition) {
    setSurface((current) => {
      if (current?.sessionId !== sessionId) return current;
      if (current.position.x === position.x && current.position.y === position.y) return current;
      return { ...current, position };
    });
  }

  function deleteHyperSession(sessionId: string) {
    deleteSession(sessionId);
    setSurface((current) => (current?.sessionId === sessionId ? null : current));
  }

  function promote(sessionId: string) {
    dispatchWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    openSessionInWorkspace(sessionId);
  }

  return {
    state,
    isOpen: state?.open === true,
    getOrCreateSessionId,
    toggle,
    setPosition,
    deleteSession: deleteHyperSession,
    promote,
  };
}
