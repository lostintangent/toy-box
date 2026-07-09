// Workspace facts are read directly from atoms. Context injects the event sinks
// whose query-cache, optimistic-RPC, and snapshot-healing dependencies are owned
// by useWorkspace.

import { createContext, useContext, type ReactNode } from "react";
import type { WorkspaceAction, WorkspaceEvent } from "@/types";

type WorkspaceActions = {
  applyWorkspaceEvent: (event: WorkspaceEvent) => void;
  dispatchWorkspaceAction: (action: WorkspaceAction) => void;
};

const WorkspaceActionsContext = createContext<WorkspaceActions | null>(null);

export function useWorkspaceActions(): WorkspaceActions {
  const value = useContext(WorkspaceActionsContext);
  if (!value) {
    throw new Error("useWorkspaceActions must be used within WorkspaceActionsProvider.");
  }
  return value;
}

export function WorkspaceActionsProvider({
  actions,
  children,
}: {
  actions: WorkspaceActions;
  children: ReactNode;
}) {
  return (
    <WorkspaceActionsContext.Provider value={actions}>{children}</WorkspaceActionsContext.Provider>
  );
}
