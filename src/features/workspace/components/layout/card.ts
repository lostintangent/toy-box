/**
 * The desktop shell presents each surface (the sidebar, every grid pane, and the
 * terminal) as a card floating over the window's backdrop.
 *
 * Every card sits half a gutter inside its slot and the frame pads the other half,
 * so each card is one gutter from its neighbors and the window's edge alike. The
 * inset also keeps a card's shadow inside the resizable panel that clips it.
 */
export const CARD_CLASS = "overflow-clip rounded-xl border bg-background shadow-card";
export const CARD_INSET_CLASS = "p-1";
