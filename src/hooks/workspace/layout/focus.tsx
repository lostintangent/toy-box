import { createContext, useContext, type ReactNode } from "react";
import { atom, type PrimitiveAtom } from "jotai";

export type WorkspaceSurface = "main" | "hyper";

const focusedPaneAtoms: Record<WorkspaceSurface, PrimitiveAtom<string | null>> = {
  main: atom<string | null>(null),
  hyper: atom<string | null>(null),
};

const FocusedPaneContext = createContext(focusedPaneAtoms.main);

export function focusedPaneAtomFor(surface: WorkspaceSurface): PrimitiveAtom<string | null> {
  return focusedPaneAtoms[surface];
}

export function useFocusedPaneAtom(): PrimitiveAtom<string | null> {
  return useContext(FocusedPaneContext);
}

export function WorkspaceSurfaceProvider({
  surface,
  children,
}: {
  surface: WorkspaceSurface;
  children: ReactNode;
}) {
  return (
    <FocusedPaneContext.Provider value={focusedPaneAtomFor(surface)}>
      {children}
    </FocusedPaneContext.Provider>
  );
}
