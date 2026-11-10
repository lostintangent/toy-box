import type { EditorProps } from "@files/components/editor/kinds";
import { appQueries } from "@apps/queries";
import { createEditorPane } from "@files/model/panes";
import { PaneMessage } from "@/shared/ui/pane-message";
import { AppHost, AppMount } from "../host/AppHost";

/** Renders a stateless session `.toy` file through the shared app host. */
export function ArtifactAppPane({ title, file }: EditorProps) {
  const { source } = file;
  if (source.kind !== "session") {
    return (
      <PaneMessage
        title="Artifact app unavailable"
        detail="Only files owned by a session can run as artifact apps."
      />
    );
  }

  return (
    <AppMount
      title={title}
      bundle={appQueries.artifactBundle(source, file.revision)}
      resetKey={file.revision}
    >
      {(bundle) => <AppHost bundle={bundle} publisherPaneId={createEditorPane(source).id} />}
    </AppMount>
  );
}
