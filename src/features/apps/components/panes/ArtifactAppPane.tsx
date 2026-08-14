import { ClientOnly } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import type { EditorProps } from "@files/components/editor/kinds";
import type { SessionFile } from "@files/model";
import { appQueries } from "@apps/queries";
import { createEditorPaneId } from "@workspace/model/panes";
import { AppErrorBoundary, AppHost, AppMessage, appErrorMessage } from "../host/AppHost";

/** Renders a stateless session `.toy` file through the shared app host. */
export function ArtifactAppPane({ title, file }: EditorProps) {
  const { source } = file;
  if (source.type !== "session") {
    return (
      <AppMessage
        title="Artifact app unavailable"
        detail="Only files owned by a session can run as artifact apps."
      />
    );
  }

  return (
    <ClientOnly
      fallback={<AppMessage title={`Loading ${title}`} detail="Compiling app…" loading />}
    >
      <MountedApp source={source} title={title} revision={file.revision} />
    </ClientOnly>
  );
}

function MountedApp({
  source,
  title,
  revision,
}: {
  source: SessionFile;
  title: string;
  revision: number;
}) {
  const bundleQuery = useQuery(appQueries.artifactBundle(source, revision));

  if (bundleQuery.isPending) {
    return <AppMessage title={`Loading ${title}`} detail="Compiling app…" loading />;
  }
  if (bundleQuery.isError) {
    return (
      <AppMessage title={`Unable to load ${title}`} detail={appErrorMessage(bundleQuery.error)} />
    );
  }

  const { Component: AppComponent, css, scopeId } = bundleQuery.data;
  return (
    <AppErrorBoundary title={title} resetKey={revision}>
      <AppHost
        scopeId={scopeId}
        publisherPaneId={createEditorPaneId(source)}
        AppComponent={AppComponent}
        css={css}
      />
    </AppErrorBoundary>
  );
}
