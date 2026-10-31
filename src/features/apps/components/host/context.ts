import { createContext, useContext } from "react";
import type { Store } from "@tanstack/store";
import type { AppWorkspace, useAppActions } from "@apps/sdk";
import type { AppStateStore } from "./state";

type AppHost = {
  workspace: Store<AppWorkspace>;
  actions: ReturnType<typeof useAppActions>;
  savedApp?: AppStateStore;
};

export const AppHostContext = createContext<AppHost | null>(null);

export function useAppHost(): AppHost {
  const host = useContext(AppHostContext);
  if (!host) throw new Error("Toy Box app hooks must run inside an app surface.");
  return host;
}
