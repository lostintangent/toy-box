// Styling for a pane's floating overlay controls — the small icon-buttons that sit
// over pane content: the grid's window controls (maximize / minimize / close), the
// artifact mode button in its "normal" variant, and the session overlay's
// open / close buttons. Shared so those surfaces can't drift.

export const PANE_OVERLAY_BUTTON_CLASS =
  "rounded-md border border-border bg-background/90 p-1.5 shadow-sm backdrop-blur-sm hover:bg-background hover:shadow-md";

export const PANE_OVERLAY_ICON_CLASS = "h-4 w-4 text-foreground";
