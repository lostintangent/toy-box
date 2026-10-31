import type { ReactNode } from "react";
import type { WorkspacePane } from "@workspace/model/panes";
import { paneKinds } from "./kinds";
import { PaneSlotsProvider, type PaneSlots, type PaneVariant } from "@/shared/panes/PaneSlots";

type WorkspacePaneViewProps = {
  pane: WorkspacePane;
  slots: PaneSlots;
  variant?: PaneVariant;
  isVisible?: boolean;
  children?: ReactNode;
  onFocusPane?: (paneId: string) => void;
};

/** Adapts one host-positioned workspace pane to the view its kind declares. */
export function WorkspacePaneView({
  pane,
  slots,
  variant = "normal",
  isVisible = true,
  children,
  onFocusPane,
}: WorkspacePaneViewProps) {
  const { View } = paneKinds[pane.kind];

  return (
    <PaneSlotsProvider slots={slots} variant={variant}>
      <View pane={pane} variant={variant} isVisible={isVisible} onFocusPane={onFocusPane} />
      {children}
    </PaneSlotsProvider>
  );
}
