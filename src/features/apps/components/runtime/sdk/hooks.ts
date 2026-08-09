/** Reactive hooks exposed through the authored `@toy-box/sdk` module. */
import { useSelector } from "@tanstack/react-store";
import type { AppStateUpdater, AppWorkspace } from "@apps/sdk";
import { useAppHost } from "../../host/context";

export { useFile } from "@files/useFile";

export function useApp() {
  const { appState, workspace, actions } = useAppHost();
  const app = useSelector(appState.store);
  const shares = useSelector(workspace, (state) => state.shares);
  return {
    ...app,
    shares,
    updateState: (updater: AppStateUpdater) => appState.updateState(updater),
    actions,
  };
}

export function useWorkspace<T>(selector: (workspace: AppWorkspace) => T): T {
  return useSelector(useAppHost().workspace, selector);
}
