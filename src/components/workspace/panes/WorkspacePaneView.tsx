import type { WorkspacePane } from "@/lib/workspace/panes";
import { InboxPane } from "./inbox/InboxPane";
import { CanvasPane } from "./CanvasPane";
import { ArtifactPane } from "./artifacts/ArtifactPane";
import { SessionPane } from "./session/SessionPane";
import type { PaneProps } from "./types";

type WorkspacePaneViewProps = PaneProps & {
  pane: WorkspacePane;
  onFocusPane?: (paneId: string) => void;
};

/** One pane-kind-to-component mapping shared by the grid and pager hosts. */
export function WorkspacePaneView({
  pane,
  variant,
  actionsSlot,
  onFocusPane,
}: WorkspacePaneViewProps) {
  if (pane.kind === "inbox") {
    return <InboxPane onFocusPane={onFocusPane} />;
  }

  if (pane.kind === "session") {
    return <SessionPane sessionId={pane.sessionId} variant={variant} actionsSlot={actionsSlot} />;
  }

  if (pane.kind === "canvas") {
    return <CanvasPane canvas={pane.canvas} />;
  }

  return <ArtifactPane pane={pane} variant={variant} actionsSlot={actionsSlot} />;
}
