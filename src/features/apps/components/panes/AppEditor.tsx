import { useSuspenseQuery } from "@tanstack/react-query";
import type { EditorProps } from "@files/components/editor/kinds";
import { createEditorPane } from "@files/model/panes";
import { fileExtension } from "@files/model/paths";
import { useMountedContent } from "@files/useFile";
import { definitionOpening } from "@apps/model";
import { appQueries } from "@apps/queries";
import { AppHost, AppMount, type AppBundle } from "../host/AppHost";

/** Renders a file through the installed definition that opens its extension. */
export function AppEditor({ title, mode, file }: EditorProps) {
  const { data: definition } = useSuspenseQuery({
    ...appQueries.list,
    select: ({ definitions }) => definitionOpening(definitions, fileExtension(file.source.path)),
  });
  if (!definition) return null;

  return (
    <AppMount
      title={title}
      bundle={appQueries.bundle(definition.id, definition.revision)}
      resetKey={file.revision}
    >
      {(bundle) => <OpenedFileApp bundle={bundle} file={file} mode={mode} />}
    </AppMount>
  );
}

/** Mounts the app from the pane's latest text, including when it recovers from a crash. */
function OpenedFileApp({
  bundle,
  file,
  mode,
}: Pick<EditorProps, "file" | "mode"> & { bundle: AppBundle }) {
  const { source, latest: _latest, ...state } = file;
  const content = useMountedContent(file);
  return (
    <AppHost
      bundle={bundle}
      publisherPaneId={createEditorPane(source).id}
      openedFile={{ ...state, content, file: source, mode }}
    />
  );
}
