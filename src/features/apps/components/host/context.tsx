import { createContext, useContext, type ReactNode } from "react";
import type { Store } from "@tanstack/store";
import type { AppActions, AppWorkspace, useAppActions } from "@apps/sdk";
import type { AppStateStore } from "./state";

type AppHost = {
  workspace: Store<AppWorkspace>;
  actions: ReturnType<typeof useAppActions>;
  savedApp?: {
    state: AppStateStore;
    actions: AppActions;
  };
};

const AppHostContext = createContext<AppHost | null>(null);

export function AppHostProvider({
  workspace,
  actions,
  savedApp,
  children,
}: AppHost & { children: ReactNode }) {
  return <AppHostContext value={{ workspace, actions, savedApp }}>{children}</AppHostContext>;
}

export function useAppHost(): AppHost {
  const host = useContext(AppHostContext);
  if (!host) throw new Error("Toy Box app hooks must run inside an app surface.");
  return host;
}
