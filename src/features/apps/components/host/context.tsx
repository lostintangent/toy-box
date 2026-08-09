import { createContext, useContext, type ReactNode } from "react";
import type { Store } from "@tanstack/store";
import type { AppActions, AppWorkspace } from "@apps/sdk";
import type { AppStateStore } from "./state";

type AppHost = {
  appState: AppStateStore;
  workspace: Store<AppWorkspace>;
  actions: AppActions;
};

const AppHostContext = createContext<AppHost | null>(null);

export function AppHostProvider({
  appState,
  workspace,
  actions,
  children,
}: AppHost & { children: ReactNode }) {
  return <AppHostContext value={{ appState, workspace, actions }}>{children}</AppHostContext>;
}

export function useAppHost(): AppHost {
  const host = useContext(AppHostContext);
  if (!host) throw new Error("Toy Box app hooks must run inside an AppPane.");
  return host;
}
