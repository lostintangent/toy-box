import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type PaneSlots = {
  actions: HTMLElement | null;
  status: HTMLElement | null;
};

const PaneSlotsContext = createContext<PaneSlots | null>(null);

/** Makes one host's positioned slots available to a workspace pane subtree. */
export function PaneSlotsProvider({ slots, children }: { slots: PaneSlots; children: ReactNode }) {
  return <PaneSlotsContext.Provider value={slots}>{children}</PaneSlotsContext.Provider>;
}

/** Declares persistent pane actions in the host's upper-right chrome. */
export function PaneActions({ children }: { children: ReactNode }) {
  return <PaneSlot target="actions">{children}</PaneSlot>;
}

/** Declares transient pane status in chrome positioned by the current host. */
export function PaneStatus({ children }: { children: ReactNode }) {
  return <PaneSlot target="status">{children}</PaneSlot>;
}

function PaneSlot({ target, children }: { target: keyof PaneSlots; children: ReactNode }) {
  const slots = useContext(PaneSlotsContext);
  const container = slots?.[target];
  return container ? createPortal(children, container) : null;
}
