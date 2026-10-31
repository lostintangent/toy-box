import { useState } from "react";
import {
  defaultViewportOverlayPosition,
  type OverlayPosition,
} from "@workspace/components/overlayWindow";
import { createAppPane } from "@apps/model";
import { createSessionPane } from "@sessions/model/panes";
import { focusWorkspaceSurfacePane } from "@workspace/hooks/layout/surface";
import type { WorkspacePane } from "@workspace/model/panes";
import { useDispatchWorkspaceAction } from "../state";

/** The deck keeps its most recently opened apps beside its session. */
const MAX_HYPER_APPS = 3;

/** Per-browser state for the floating hyper-session surface. */
export type HyperSessionState = {
  sessionId: string;
  position: OverlayPosition;
  open: boolean;
  appIds: string[];
};

/** The deck's root panes: its session, then the apps opened in it. */
export function deriveHyperRootPanes({ sessionId, appIds }: HyperSessionState): WorkspacePane[] {
  return [createSessionPane(sessionId), ...appIds.map(createAppPane)];
}

function createHyperSessionState(sessionId: string): HyperSessionState {
  return {
    sessionId,
    position: defaultViewportOverlayPosition(),
    open: true,
    appIds: [],
  };
}

// The hyper deck is a per-browser surface. Its open/position layout is seeded once
// from SSR, while shared membership remains authoritative for its existence.
export function useHyperSession({
  hyperSessionId,
  initialLayout,
  createSession,
  openRoot,
}: {
  hyperSessionId: string | undefined;
  initialLayout: Pick<HyperSessionState, "open" | "position">;
  createSession: (options?: { hyper?: true }) => string;
  /** Opens a promoted session beside the main workspace's other panes. */
  openRoot: (pane: WorkspacePane) => void;
}) {
  const dispatchWorkspaceAction = useDispatchWorkspaceAction();
  const [surface, setSurface] = useState<HyperSessionState | null>(() =>
    hyperSessionId ? { sessionId: hyperSessionId, appIds: [], ...initialLayout } : null,
  );
  const state = surface?.sessionId === hyperSessionId ? surface : null;

  function getOrCreateSessionId() {
    return hyperSessionId ?? createSession({ hyper: true });
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
          : [...next.appIds, appId].slice(-MAX_HYPER_APPS),
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

  function removeSurface() {
    setSurface(null);
  }

  function promote(sessionId: string) {
    dispatchWorkspaceAction({ type: "session.hyper.promoted", sessionId });
    openRoot(createSessionPane(sessionId));
  }

  return {
    state,
    isOpen: state?.open === true,
    getOrCreateSessionId,
    toggle,
    openApp,
    closeApp,
    setPosition,
    removeSurface,
    promote,
  };
}
