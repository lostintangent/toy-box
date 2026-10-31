import type { PaneKinds } from "@workspace/components/panes/kinds";
import { EditorPane } from "./components/editor/EditorPane";
import { workspaceFileSchema } from "./model";
import { createEditorPane } from "./model/panes";

export default {
  editor: {
    View: EditorPane,
    label: (pane) => pane.title,
    color: "bg-emerald-500",
    root: {
      key: "files",
      schema: workspaceFileSchema,
      pane: createEditorPane,
      item: (pane) => pane.file,
    },
  },
} satisfies PaneKinds;
