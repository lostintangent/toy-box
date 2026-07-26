import { useEffectEvent, useLayoutEffect, useState } from "react";
import type { ArtifactRendererProps } from "../index";
import { createJsonEditorStore } from "./store";
import { JsonThemeProvider } from "./theme";
import {
  AgentProvider,
  activePointersOf,
  buildAgentPrompt,
  targetMetadata,
  type AskAgentInput,
} from "./agent";
import { JsonPaneActions } from "./JsonPaneActions";
import { JsonTree } from "./editor/JsonTree";

// Binds one artifact's file lifecycle to a JSON editor store, mirroring the SVG
// composition root: the store is created once for the mount, external revisions
// re-baseline it, and user edits publish serialized source back through `save`.
// Own saves never advance the revision, so editing state survives a save while an
// agent's external edit flows in as a fresh parse — highlighted as a diff.
//
// It also connects the two agent capabilities the pane hands every renderer:
// pending workers become presence in the store, and `spawnWorker` becomes the
// per-node "ask agent" action provided to the tree.

export function JsonArtifact({
  mode,
  variant,
  artifact,
  pendingWorkers,
  spawnWorker,
}: ArtifactRendererProps) {
  const source = artifact.content ?? "";
  const revision = artifact.revision;
  const readOnly = mode === "read";

  const [editor] = useState(() => createJsonEditorStore(readOnly));
  const saveSource = useEffectEvent(artifact.save);

  useLayoutEffect(() => editor.subscribeToSource(saveSource), [editor]);
  useLayoutEffect(() => {
    editor.actions.loadSource(source);
  }, [revision, source, editor]);
  useLayoutEffect(() => editor.actions.setReadOnly(readOnly), [readOnly, editor]);
  useLayoutEffect(
    () => editor.actions.setActivePointers(activePointersOf(pendingWorkers)),
    [pendingWorkers, editor],
  );

  async function askAgent({ pointer, valueJson, instruction, intent }: AskAgentInput) {
    await spawnWorker({
      name: `${intent === "add" ? "Add to" : "Edit"} ${pointer || "root"}`,
      prompt: buildAgentPrompt({ pointer, valueJson, instruction, intent }),
      metadata: targetMetadata(pointer),
    });
  }

  return (
    <JsonThemeProvider>
      <AgentProvider askAgent={askAgent}>
        <JsonPaneActions editor={editor} variant={variant} />
        <JsonTree editor={editor} />
      </AgentProvider>
    </JsonThemeProvider>
  );
}
