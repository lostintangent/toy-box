import { ClientOnly } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { updateApp } from "@apps/server/functions";
import { appQueries } from "@apps/queries";
import { applyAppListEvent } from "@apps/queryCache";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import type { Worker } from "@workers/model";
import type { AppDefinition, AppInstance } from "@apps/model";
import type { AppWorkspacePane } from "@workspace/model/panes";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { PaneStatus } from "@workspace/components/panes/shell/PaneSlots";
import { WorkersMenu } from "@workers/components/WorkersMenu";
import { AppStateStore } from "../host/state";
import { AppErrorBoundary, AppHost, AppMessage, appErrorMessage } from "../host/AppHost";

export function AppPane({ pane, variant }: { pane: AppWorkspacePane; variant: PaneVariant }) {
  const {
    data: { app, definition },
  } = useSuspenseQuery({
    ...appQueries.list(),
    select: ({ apps, definitions }) => {
      const app = apps.find((candidate) => candidate.id === pane.appId);
      return {
        app,
        definition: definitions.find((candidate) => candidate.id === app?.definitionId),
      };
    },
  });
  const appWorkers = useWorkspaceSelector((workspace) =>
    workspace.workers.filter(
      (worker): worker is Extract<Worker, { type: "app" }> =>
        worker.type === "app" && worker.appId === pane.appId,
    ),
  );

  if (!app) {
    return (
      <AppMessage
        title="App not found"
        detail="This saved app may have been deleted in another Toy Box window."
      />
    );
  }
  if (!definition) {
    return (
      <AppMessage
        title="App definition unavailable"
        detail={`The installed TSX definition "${app.definitionId}" could not be loaded.`}
      />
    );
  }

  return (
    <ClientOnly
      fallback={<AppMessage title="Loading app" detail="Getting everything ready…" loading />}
    >
      <AppErrorBoundary
        key={`${app.id}:${definition.revision}`}
        title={app.title}
        resetKey={app.revision}
      >
        <MountedApp
          pane={pane}
          app={app}
          definition={definition}
          appWorkers={appWorkers}
          variant={variant}
        />
      </AppErrorBoundary>
    </ClientOnly>
  );
}

function MountedApp({
  pane,
  app,
  definition,
  appWorkers,
  variant,
}: {
  pane: AppWorkspacePane;
  app: AppInstance;
  definition: AppDefinition;
  appWorkers: Extract<Worker, { type: "app" }>[];
  variant: PaneVariant;
}) {
  const queryClient = useQueryClient();
  const [appState] = useState(
    () =>
      new AppStateStore(app, definition.state.schema, async (update) => {
        const result = await updateApp({
          data: { appId: pane.appId, ...update },
        });
        applyAppListEvent(queryClient, { type: "app.upserted", app: result.app });
        return result;
      }),
  );
  useLayoutEffect(() => appState.sync(app), [app, appState]);

  const bundleQuery = useQuery(appQueries.bundle(definition.id, definition.revision));

  if (bundleQuery.isPending) {
    return <AppMessage title={`Loading ${app.title}`} detail="Loading app…" loading />;
  }
  if (bundleQuery.isError) {
    return (
      <AppMessage
        title={`Unable to load ${app.title}`}
        detail={appErrorMessage(bundleQuery.error)}
      />
    );
  }

  const { Component: AppComponent, css } = bundleQuery.data;
  return (
    <>
      {appWorkers.length > 0 && (
        <PaneStatus>
          <WorkersMenu workers={appWorkers} variant={variant} />
        </PaneStatus>
      )}
      <AppHost
        scopeId={definition.id}
        publisherPaneId={pane.id}
        AppComponent={AppComponent}
        css={css}
        savedApp={appState}
      />
    </>
  );
}
