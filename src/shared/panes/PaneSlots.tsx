import { createContext, use, type ReactNode } from "react";
import { createPortal } from "react-dom";
/** How much room a host gives a pane: the grid is normal, and the pager is compact. */
export type PaneVariant = "normal" | "compact";

export type PaneSlots = {
  actions: HTMLElement | null;
  status: HTMLElement | null;
};

const PaneContext = createContext<{ slots: PaneSlots; variant: PaneVariant } | null>(null);

/** Makes one host shell's slots and presentation available to a workspace pane subtree. */
export function PaneSlotsProvider({
  slots,
  variant,
  children,
}: {
  slots: PaneSlots;
  variant: PaneVariant;
  children: ReactNode;
}) {
  return <PaneContext.Provider value={{ slots, variant }}>{children}</PaneContext.Provider>;
}

export function usePaneVariant() {
  const pane = use(PaneContext);
  if (!pane) throw new Error("Pane content must be rendered within a workspace pane.");
  return pane.variant;
}

/** Declares persistent pane actions in the host's upper-right chrome. */
export function PaneActions({ children }: { children: ReactNode }) {
  return <PaneSlot target="actions">{children}</PaneSlot>;
}

/** Whether this pane host currently provides chrome for persistent actions. */
export function usePaneActionsAvailable(): boolean {
  return use(PaneContext)?.slots.actions != null;
}

/** Declares transient pane status in chrome positioned by the current host. */
export function PaneStatus({ children }: { children: ReactNode }) {
  return <PaneSlot target="status">{children}</PaneSlot>;
}

function PaneSlot({ target, children }: { target: keyof PaneSlots; children: ReactNode }) {
  const pane = use(PaneContext);
  const container = pane?.slots[target];
  return container ? createPortal(children, container) : null;
}
