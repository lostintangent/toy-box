import { z } from "zod";
import type { PaneKinds } from "@workspace/components/panes/kinds";
import { ScreenPane } from "./client/ScreenPane";
import { createScreenPane } from "./model";

export default {
  screen: {
    View: ({ pane, isVisible }) => <ScreenPane screenId={pane.screenId} isVisible={isVisible} />,
    label: () => "Screen",
    color: "bg-sky-500",
    root: {
      key: "screens",
      schema: z.string(),
      pane: createScreenPane,
      item: (pane) => pane.screenId,
    },
  },
} satisfies PaneKinds;
