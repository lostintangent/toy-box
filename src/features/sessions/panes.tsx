import { z } from "zod";
import type { PaneKinds } from "@workspace/components/panes/kinds";
import { CanvasPane } from "./components/CanvasPane";
import { SessionPane } from "./components/SessionPane";
import { createSessionPane } from "./model/panes";

export default {
  session: {
    View: ({ pane, variant, isVisible }) => (
      <SessionPane sessionId={pane.sessionId} variant={variant} isVisible={isVisible} />
    ),
    label: () => "Session",
    color: "bg-muted-foreground/40",
    root: {
      key: "sessions",
      schema: z.string(),
      pane: createSessionPane,
      item: (pane) => pane.sessionId,
    },
  },
  canvas: {
    View: ({ pane }) => <CanvasPane canvas={pane.canvas} />,
    label: (pane) => `Canvas ${pane.canvas.title || pane.canvas.canvasId}`,
    color: "bg-violet-500",
  },
} satisfies PaneKinds;
