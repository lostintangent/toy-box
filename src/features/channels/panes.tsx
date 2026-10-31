import { z } from "zod";
import type { PaneKinds } from "@workspace/components/panes/kinds";
import { ChannelPane } from "./components/pane/ChannelPane";
import { createChannelPane } from "./model";

export default {
  channel: {
    View: ({ pane, variant, isVisible }) => (
      <ChannelPane channelId={pane.channelId} isVisible={isVisible} variant={variant} />
    ),
    label: () => "Channel",
    color: "bg-cyan-500",
    root: {
      key: "channels",
      schema: z.string(),
      pane: createChannelPane,
      item: (pane) => pane.channelId,
    },
  },
} satisfies PaneKinds;
