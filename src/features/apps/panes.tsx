import { z } from "zod";
import type { PaneKinds } from "@workspace/components/panes/kinds";
import { AppPane } from "./components/panes/AppPane";
import { createAppPane } from "./model";

export default {
  app: {
    View: AppPane,
    label: () => "App",
    color: "bg-amber-500",
    root: { key: "apps", schema: z.string(), pane: createAppPane, item: (pane) => pane.appId },
  },
} satisfies PaneKinds;
