import { createContext, useContext } from "react";
import type { SessionArtifact } from "../model";

export type SessionPaneMode = "active" | "overlay" | "passive";

type CurrentSession = {
  sessionId: string;
  cwd?: string;
  mode: SessionPaneMode;
  artifacts?: readonly SessionArtifact[];
  onOpenArtifact?: (path: string) => void;
};

const CurrentSessionContext = createContext<CurrentSession | undefined>(undefined);

export const CurrentSessionProvider = CurrentSessionContext.Provider;

export function useCurrentSession(): CurrentSession {
  const session = useContext(CurrentSessionContext);
  if (!session) throw new Error("Session content must be rendered within a session pane.");
  return session;
}
