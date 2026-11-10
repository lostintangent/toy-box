import { useState } from "react";
import { defaultViewportOverlayPosition } from "@workspace/components/overlayWindow";
import { createAppPane } from "@apps/model";
import { createSessionPane } from "@sessions/model/panes";
import { useLayoutPref, useSetLayoutPrefs } from "@workspace/hooks/layout/layoutPrefs";
import { focusWorkspaceSurfacePane } from "@workspace/hooks/layout/surface";
import type { WorkspacePane } from "@workspace/model/panes";
import { useUpdateWorkspaceSetting } from "../state";

/** The deck keeps its most recently opened apps beside its session. */
const MAX_HYPER_APPS = 3;

/** The floating hyper deck's session and the apps opened beside it, held per tab. */
export type HyperSessionState = {
  sessionId: string;
  appIds: string[];
};

/** The deck's root panes: its session, then the apps opened in it. */
export function deriveHyperRootPanes({ sessionId, appIds }: HyperSessionState): WorkspacePane[] {
  return [createSessionPane(sessionId), ...appIds.map(createAppPane)];
}

// The hyper deck is a per-browser surface. Whether it is open and where it sits are layout
// preferences, while shared membership remains authoritative for its existence.
export function useHyperSession({
  hyperSessionId,
  createSession,
  openRoot,
}: {
  hyperSessionId: string | undefined;
  createSession: (options?: { hyper?: true }) => string;
  /** Opens a promoted session beside the main workspace's other panes. */
  openRoot: (pane: WorkspacePane) => void;
}) {
  const updateSetting = useUpdateWorkspaceSetting();
  const [isDeckOpen, setIsDeckOpen] = useLayoutPref("hyperOpen");
  const setLayoutPrefs = useSetLayoutPrefs();
  const [surface, setSurface] = useState<HyperSessionState | null>(() =>
    hyperSessionId ? { sessionId: hyperSessionId, appIds: [] } : null,
  );
  const state = surface?.sessionId === hyperSessionId ? surface : null;

  function getOrCreateSessionId() {
    return hyperSessionId ?? createSession({ hyper: true });
  }

  /** Shows the deck on a session, with an app beside it. A new deck starts at the default spot. */
  function show(sessionId: string, appId?: string) {
    const current = surface?.sessionId === sessionId ? surface : null;
    const appIds = current?.appIds ?? [];
    setLayoutPrefs(
      current
        ? { hyperOpen: true }
        : { hyperOpen: true, hyperPosition: defaultViewportOverlayPosition() },
    );
    setSurface({
      sessionId,
      appIds: !appId || appIds.includes(appId) ? appIds : [...appIds, appId].slice(-MAX_HYPER_APPS),
    });
  }

  function toggle() {
    const sessionId = getOrCreateSessionId();
    if (surface?.sessionId === sessionId && isDeckOpen) setIsDeckOpen(false);
    else show(sessionId);
  }

  function openApp(appId: string) {
    show(getOrCreateSessionId(), appId);
    focusWorkspaceSurfacePane("hyper", createAppPane(appId).id);
  }

  function closeApp(appId: string) {
    setSurface((current) => {
      if (!current?.appIds.includes(appId)) return current;
      return { ...current, appIds: current.appIds.filter((id) => id !== appId) };
    });
  }

  function removeSurface() {
    setSurface(null);
    setIsDeckOpen(false);
  }

  function promote(sessionId: string) {
    updateSetting("hyperSessionId", null);
    setIsDeckOpen(false);
    openRoot(createSessionPane(sessionId));
  }

  return {
    state,
    isOpen: state !== null && isDeckOpen,
    getOrCreateSessionId,
    toggle,
    openApp,
    closeApp,
    removeSurface,
    promote,
  };
}
