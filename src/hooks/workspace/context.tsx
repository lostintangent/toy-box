import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { PrimitiveAtom } from "jotai";
import { focusedPaneAtomFor, type WorkspaceKind } from "./atoms";
import type { WorkspaceActions } from "./useWorkspace";

/**
 * The workspace surface a subtree is operating in: the shared workspace actions
 * plus the focus atom for its kind. The root WorkspaceProvider supplies the
 * "normal" kind; a nested WorkspaceKindProvider overrides it (the hyper deck), so
 * components read `focusedPaneAtom` ambiently instead of threading a kind.
 */
export type WorkspaceContextValue = WorkspaceActions & {
  focusedPaneAtom: PrimitiveAtom<string | null>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspaceContext(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) {
    throw new Error("useWorkspaceContext must be used within WorkspaceProvider.");
  }
  return value;
}

/** Root provider: workspace actions + the "normal" kind's focus atom. */
export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceActions;
  children: ReactNode;
}) {
  const contextValue = useMemo<WorkspaceContextValue>(
    () => ({ ...value, focusedPaneAtom: focusedPaneAtomFor("normal") }),
    [value],
  );
  return <WorkspaceContext.Provider value={contextValue}>{children}</WorkspaceContext.Provider>;
}

/** Nested override: inherits the parent's actions, swaps focus to `kind`. */
export function WorkspaceKindProvider({
  kind,
  children,
}: {
  kind: WorkspaceKind;
  children: ReactNode;
}) {
  const parent = useWorkspaceContext();
  const contextValue = useMemo<WorkspaceContextValue>(
    () => ({ ...parent, focusedPaneAtom: focusedPaneAtomFor(kind) }),
    [parent, kind],
  );
  return <WorkspaceContext.Provider value={contextValue}>{children}</WorkspaceContext.Provider>;
}
