import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import { updateApp } from "@apps/server/functions";
import { appQueries } from "@apps/queries";
import { applyWorkspaceEvent } from "@workspace/sync";
import type { Worker } from "@workers/model";
import { workerQueries } from "@workers/queries";
import type { AppDefinition, AppInstance } from "@apps/model";
import type { WorkspacePane } from "@workspace/model/panes";
import { PaneStatus, type PaneVariant } from "@/shared/panes/PaneSlots";
import { WorkersMenu } from "@workers/components/WorkersMenu";
import { AppStateStore } from "../host/state";
import { PaneMessage } from "@/shared/ui/pane-message";
import { AppHost, AppMount, type AppBundle } from "../host/AppHost";

export function AppPane({ pane, variant }: { pane: WorkspacePane<"app">; variant: PaneVariant }) {
  const {
    data: { app, definition },
  } = useSuspenseQuery({
    ...appQueries.list,
    select: ({ apps, definitions }) => {
      const app = apps.find((candidate) => candidate.id === pane.appId);
      return {
        app,
        definition: definitions.find((candidate) => candidate.id === app?.definitionId),
      };
    },
  });
  const { data: appWorkers } = useSuspenseQuery({
    ...workerQueries.active,
    select: (workers) =>
      workers.filter(
        (worker): worker is Extract<Worker, { type: "app" }> =>
          worker.type === "app" && worker.appId === pane.appId,
      ),
  });

  if (!app) {
    return (
      <PaneMessage
        title="App not found"
        detail="This saved app may have been deleted in another Toy Box window."
      />
    );
  }
  if (!definition) {
    return (
      <PaneMessage
        title="App definition unavailable"
        detail={`The installed TSX definition "${app.definitionId}" could not be loaded.`}
      />
    );
  }

  return (
    <>
      {appWorkers.length > 0 && (
        <PaneStatus>
          <WorkersMenu workers={appWorkers} variant={variant} />
        </PaneStatus>
      )}
      <AppMount
        key={`${app.id}:${definition.revision}`}
        title={app.title}
        bundle={appQueries.bundle(definition.id, definition.revision)}
        resetKey={app.revision}
      >
        {(bundle) => <SavedApp pane={pane} app={app} definition={definition} bundle={bundle} />}
      </AppMount>
    </>
  );
}

function SavedApp({
  pane,
  app,
  definition,
  bundle,
}: {
  pane: WorkspacePane<"app">;
  app: AppInstance;
  definition: AppDefinition;
  bundle: AppBundle;
}) {
  const queryClient = useQueryClient();
  const [appState] = useState(
    () =>
      new AppStateStore(app, definition.state.schema, async (update) => {
        const result = await updateApp({
          data: { appId: pane.appId, ...update },
        });
        applyWorkspaceEvent(queryClient, { type: "app.upserted", app: result.app });
        return result;
      }),
  );
  useLayoutEffect(() => appState.sync(app), [app, appState]);

  return <AppHost bundle={bundle} publisherPaneId={pane.id} savedApp={appState} />;
}
