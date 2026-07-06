export type SessionPaneMode = "interactive" | "overlay" | "readOnly";

export type SessionPaneModeCapabilities = {
  showInput: boolean;
  showArtifactShortcuts: boolean;
  loadGlobalSessionState: boolean;
  ownsLinkedPanes: boolean;
};

const MODE_CAPABILITIES: Record<SessionPaneMode, SessionPaneModeCapabilities> = {
  interactive: {
    showInput: true,
    showArtifactShortcuts: true,
    loadGlobalSessionState: true,
    ownsLinkedPanes: true,
  },
  overlay: {
    showInput: true,
    showArtifactShortcuts: false,
    loadGlobalSessionState: true,
    ownsLinkedPanes: false,
  },
  readOnly: {
    showInput: false,
    showArtifactShortcuts: false,
    loadGlobalSessionState: false,
    ownsLinkedPanes: false,
  },
};

export function getSessionPaneModeCapabilities(mode: SessionPaneMode): SessionPaneModeCapabilities {
  return MODE_CAPABILITIES[mode];
}
