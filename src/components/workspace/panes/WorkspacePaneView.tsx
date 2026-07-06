import {
  isArtifactPane,
  type ArtifactWorkspacePane,
  type ArtifactPaneMode,
  type WorkspacePane,
} from "@/lib/workspace/panes";
import { CanvasPane } from "./CanvasPane";
import { ArtifactPane } from "./artifacts/ArtifactPane";
import { SessionPane, type SessionPaneProps } from "./session/SessionPane";

type WorkspacePaneViewProps = Omit<SessionPaneProps, "sessionId"> & {
  pane: WorkspacePane;
  onSetArtifactPaneMode?: (pane: ArtifactWorkspacePane, mode: ArtifactPaneMode) => void;
};

/**
 * The single view of a workspace pane: given a `WorkspacePane` (data) plus the
 * host-provided `variant` + `actionsSlot` and the shared session view props, it
 * renders the right pane component for the pane's kind. Both hosts — SessionGrid
 * ("normal") and SessionPager ("compact") — render this instead of switching on
 * kind themselves, so the pane-kind → component mapping lives in exactly one place.
 *
 * The artifact arm defers to the ARTIFACT_KINDS registry (via `isArtifactPane`), so
 * a new artifact kind flows through here with no edit — only a genuinely new pane
 * category would touch this switch.
 */
export function WorkspacePaneView({
  pane,
  onSetArtifactPaneMode,
  ...sessionProps
}: WorkspacePaneViewProps) {
  if (pane.kind === "session") {
    return <SessionPane sessionId={pane.sessionId} {...sessionProps} />;
  }

  if (pane.kind === "canvas") {
    return <CanvasPane pane={pane} />;
  }

  if (!isArtifactPane(pane)) return null;

  return (
    <ArtifactPane
      pane={pane}
      variant={sessionProps.variant}
      actionsSlot={sessionProps.actionsSlot}
      onModeChange={onSetArtifactPaneMode}
    />
  );
}
