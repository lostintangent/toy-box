import type { ReactNode } from "react";
import type { WorkspacePane } from "@/lib/workspace/panes";
import { InboxPane } from "./inbox/InboxPane";
import { CanvasPane } from "./CanvasPane";
import { ArtifactPane } from "./artifacts/ArtifactPane";
import { SessionPane } from "./session/SessionPane";
import type { PaneProps } from "./types";
import { PaneSlotsProvider, type PaneSlots } from "./PaneSlots";

type WorkspacePaneViewProps = PaneProps & {
  pane: WorkspacePane;
  slots: PaneSlots;
  children?: ReactNode;
  onFocusPane?: (paneId: string) => void;
};

/** Adapts one host-positioned workspace pane to its leaf implementation. */
export function WorkspacePaneView({
  pane,
  slots,
  variant = "normal",
  children,
  onFocusPane,
}: WorkspacePaneViewProps) {
  let content: ReactNode;

  if (pane.kind === "inbox") {
    content = <InboxPane onFocusPane={onFocusPane} />;
  } else if (pane.kind === "session") {
    content = <SessionPane sessionId={pane.sessionId} variant={variant} />;
  } else if (pane.kind === "canvas") {
    content = <CanvasPane canvas={pane.canvas} />;
  } else {
    content = <ArtifactPane pane={pane} variant={variant} />;
  }

  return (
    <PaneSlotsProvider slots={slots}>
      {content}
      {children}
    </PaneSlotsProvider>
  );
}
