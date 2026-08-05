import type { ReactNode } from "react";
import type { WorkspacePane } from "@/lib/workspace/panes";
import { PaneSlotsProvider, type PaneSlots } from "./shell/PaneSlots";
import { AppPane } from "./app/AppPane";
import { CanvasPane } from "./canvas/CanvasPane";
import { EditorPane } from "./editor/EditorPane";
import { InboxPane } from "./inbox/InboxPane";
import { SessionPane } from "./session/SessionPane";

export type PaneVariant = "normal" | "compact";

export type WorkspacePaneViewProps = {
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

  if (pane.kind === "inbox") {
    content = <InboxPane onFocusPane={onFocusPane} />;
  } else if (pane.kind === "app") {
    content = <AppPane pane={pane} variant={variant} />;
  } else if (pane.kind === "session") {
    content = <SessionPane sessionId={pane.sessionId} variant={variant} />;
  } else if (pane.kind === "canvas") {
    content = <CanvasPane canvas={pane.canvas} />;
  } else {
    content = <EditorPane pane={pane} variant={variant} />;
  }

  return (
    <PaneSlotsProvider slots={slots}>
      {content}
      {children}
    </PaneSlotsProvider>
  );
}
