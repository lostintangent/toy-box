/** Reactive hooks exposed through the authored `@toy-box/sdk` module. */
import { useSelector } from "@tanstack/react-store";
import type { AppHandle, AppWorkspace } from "@apps/sdk";
import { consumeAppShare } from "@apps/server/functions";
import { cancelWorker, spawnWorker } from "@workers/server/functions";
import { useAppHost } from "../../host/context";

export { useFile } from "@files/useFile";
export { useChannel } from "@channels/useChannel";
export { useChannels } from "@channels/useChannels";

export function useApp(): AppHandle {
  const { savedApp: state, workspace, actions } = useAppHost();
  if (!state) throw new Error("useApp is available only to saved apps.");
  const app = useSelector(state.store);
  const shares = useSelector(workspace, (state) => state.shares);
  return {
    ...app,
    shares,
    updateState: (updater) => state.updateState(updater),
    actions: {
      ...actions,
      consumeShare(shareId) {
        return consumeAppShare({ data: { appId: app.id, shareId } });
      },
      async spawnWorker(input) {
        await state.flush();
        return spawnWorker({ data: { ...input, type: "app", appId: app.id } });
      },
      cancelWorker(workerSessionId) {
        return cancelWorker({ data: { type: "app", appId: app.id, workerSessionId } });
      },
    },
  };
}

export function useAppActions() {
  return useAppHost().actions;
}

export function useWorkspace<T>(selector: (workspace: AppWorkspace) => T): T {
  return useSelector(useAppHost().workspace, selector);
}
