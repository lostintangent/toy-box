import type { PaneKinds } from "@workspace/components/panes/kinds";
import { InboxPane } from "./components/InboxPane";

export default {
  inbox: { View: InboxPane, label: () => "Inbox", color: "bg-muted-foreground/40" },
} satisfies PaneKinds;
