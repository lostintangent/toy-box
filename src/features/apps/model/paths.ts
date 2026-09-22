import { defaultStringifySearch } from "@tanstack/react-router";

export const createWorkspaceAppUrl = (appId: string) =>
  `/${defaultStringifySearch({ apps: [appId] })}`;
