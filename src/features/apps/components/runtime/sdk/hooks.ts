/** Reactive hooks exposed through the authored `@toy-box/sdk` module. */
import { useSelector } from "@tanstack/react-store";
import type { AppStateUpdater, AppWorkspace } from "@apps/sdk";
import { useAppHost } from "../../host/context";

export { useFile } from "@files/useFile";

export function useApp() {
  const host = useAppHost();
  if (!host.savedApp) throw new Error("useApp is available only to saved apps.");
  const { state, actions } = host.savedApp;
  const { workspace } = host;
  const app = useSelector(state.store);
  const shares = useSelector(workspace, (state) => state.shares);
  return {
    ...app,
    shares,
    updateState: (updater: AppStateUpdater) => state.updateState(updater),
    actions,
  };
}

export function useAppActions() {
  return useAppHost().actions;
}

export function useWorkspace<T>(selector: (workspace: AppWorkspace) => T): T {
  return useSelector(useAppHost().workspace, selector);
}
