import type { ReactNode } from "react";
import { EditorPane } from "@files/components/editor/EditorPane";
import { InboxPane } from "@inbox/components/InboxPane";
import { AppPane } from "@apps/components/AppPane";
import type { WorkspacePane } from "@workspace/model/panes";
import { PaneSlotsProvider, type PaneSlots } from "./shell/PaneSlots";
import { CanvasPane } from "@sessions/components/CanvasPane";
import { SessionPane } from "@sessions/components/SessionPane";

export type PaneVariant = "normal" | "compact";

type WorkspacePaneViewProps = {
  pane: WorkspacePane;
  slots: PaneSlots;
  variant?: PaneVariant;
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

  switch (pane.kind) {
    case "inbox":
      content = <InboxPane onFocusPane={onFocusPane} />;
      break;
    case "app":
      content = <AppPane pane={pane} variant={variant} />;
      break;
    case "session":
      content = <SessionPane sessionId={pane.sessionId} variant={variant} />;
      break;
    case "canvas":
      content = <CanvasPane canvas={pane.canvas} />;
      break;
    case "editor":
      content = <EditorPane pane={pane} variant={variant} />;
      break;
  }

  return (
    <PaneSlotsProvider slots={slots}>
      {content}
      {children}
    </PaneSlotsProvider>
  );
}
