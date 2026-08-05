import { useState } from "react";
import {
  defaultViewportOverlayPosition,
  type OverlayPosition,
} from "@/components/workspace/overlayWindow";
import { focusWorkspaceSurfacePane } from "@/hooks/workspace/layout/surface";
import { createAppPane, MAX_WORKSPACE_PANES } from "@/lib/workspace/panes";
import { useDispatchWorkspaceAction } from "../state";

/** Per-browser state for the floating hyper-session surface. */
export type HyperSessionState = {
  sessionId: string;
  position: OverlayPosition;
  open: boolean;
  appIds: string[];
};

function createHyperSessionState(sessionId: string): HyperSessionState {
  return {
    sessionId,
    position: defaultViewportOverlayPosition(),
    open: true,
    appIds: [],
  };
}

// The hyper deck is a per-browser surface. Its open/position state is seeded once
// from SSR, while shared membership remains authoritative for its existence.
export function useHyperSession({
  initialState,
  hyperSessionId,
  createDraft,
  deleteSession,
  openSessionInWorkspace,
}: {
  initialState: HyperSessionState | null;
  hyperSessionId: string | undefined;
  createDraft: (options?: { hyper?: true }) => string;
  deleteSession: (sessionId: string) => void;
  openSessionInWorkspace: (sessionId: string) => void;
}) {
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
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
      return createHyperSessionState(sessionId);
    });
  }

  function openApp(appId: string) {
    const sessionId = getOrCreateSessionId();
    setSurface((current) => {
      const next = current?.sessionId === sessionId ? current : createHyperSessionState(sessionId);
      return {
        ...next,
        open: true,
        appIds: next.appIds.includes(appId)
          ? next.appIds
          : [...next.appIds, appId].slice(-(MAX_WORKSPACE_PANES - 1)),
      };
    });
    focusWorkspaceSurfacePane("hyper", createAppPane(appId).id);
  }

  function closeApp(appId: string) {
    setSurface((current) => {
      if (!current?.appIds.includes(appId)) return current;
      return { ...current, appIds: current.appIds.filter((id) => id !== appId) };
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
    openApp,
    closeApp,
    setPosition,
    deleteSession: deleteHyperSession,
    promote,
  };
}
