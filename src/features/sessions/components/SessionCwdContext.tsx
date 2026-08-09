import { createContext, useContext } from "react";

const SessionCwdContext = createContext<string | undefined>(undefined);

export const SessionCwdProvider = SessionCwdContext.Provider;

export function useSessionCwd(): string | undefined {
  return useContext(SessionCwdContext);
}
