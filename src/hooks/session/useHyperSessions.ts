import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { defaultViewportOverlayPosition } from "@/components/workspace/overlayWindow";
import type { WorkspaceActions } from "@/hooks/workspace/useWorkspace";
import type { CreateDraft } from "./useDrafts";

// The hyper deck's per-browser view state — which session it hosts, where it sits,
// and whether it's open. Owned by the useState in useHyperSessions below, not a
// global atom, so it lives with its owner rather than in the atoms file.
export type HyperSessionState = {
  sessionId: string;
  position: { x: number; y: number };
  open: boolean;
};

export type UseHyperSessionsOptions = {
  hyperSessionIds: string[];
  initialState: HyperSessionState | null;
  createDraft: CreateDraft;
  dispatchWorkspaceAction: WorkspaceActions["dispatchWorkspaceAction"];
  onDeleteSession: (sessionId: string) => void;
  onPromotedSession: (sessionId: string) => void;
};

export type UseHyperSessionsResult = {
  state: HyperSessionState | null;
  setHyperSession: Dispatch<SetStateAction<HyperSessionState | null>>;
  isOpen: boolean;
  hasHyperSessions: boolean;
  getOrCreateSessionId: () => string;
  toggle: () => void;
  minimize: () => void;
  close: (sessionId: string) => void;
  promote: (sessionId: string) => void;
};

// The hyper deck is a per-browser surface. Its open/position state is seeded once
// from SSR (`initialState`: the cookie layout joined with server membership) and
// thereafter driven by local user actions — exactly like the terminal's
// `useState(initialTerminalOpen)`. Membership (`hyperSessionIds`) stays the source
// of truth for existence, so a session promoted or deleted from any client drops
// the local deck.
//
// The user's verbs are open / minimize / close; creating and deleting the
// underlying session are mechanics we run on their behalf (see toggle and close).
export function useHyperSessions({
  hyperSessionIds,
  initialState,
  createDraft,
  dispatchWorkspaceAction,
  onDeleteSession,
  onPromotedSession,
}: UseHyperSessionsOptions): UseHyperSessionsResult {
  const [state, setState] = useState(initialState);

  // The single owner of "which session is the hyper session, minting a draft if
  // there is none." Desktop opens it in the deck; mobile selects it into the URL.
  const getOrCreateSessionId = useCallback(
    () => hyperSessionIds[0] ?? createDraft({ hyper: true }),
    [createDraft, hyperSessionIds],
  );

  const toggle = useCallback(() => {
    if (state) {
      setState({ ...state, open: !state.open });
      return;
    }
    // getOrCreateSessionId and the DOM read stay out of the setState updater.
    setState({
      sessionId: getOrCreateSessionId(),
      position: defaultViewportOverlayPosition(),
      open: true,
    });
  }, [getOrCreateSessionId, state]);

  // Minimize hides the deck; the session lives on (the sidebar shows its dot).
  const minimize = useCallback(() => {
    setState((current) => (current ? { ...current, open: false } : current));
  }, []);

  // Close is the user's verb; we delete the underlying session on their behalf.
  const close = useCallback(
    (sessionId: string) => {
      onDeleteSession(sessionId);
      setState((current) => (current?.sessionId === sessionId ? null : current));
    },
    [onDeleteSession],
  );

  const promote = useCallback(
    (sessionId: string) => {
      void dispatchWorkspaceAction({ type: "session.hyper.promoted", sessionId });
      onPromotedSession(sessionId);
      setState((current) => (current?.sessionId === sessionId ? null : current));
    },
    [dispatchWorkspaceAction, onPromotedSession],
  );

  // Drop the deck if its session is no longer a hyper member.
  useEffect(() => {
    setState((current) =>
      current && !hyperSessionIds.includes(current.sessionId) ? null : current,
    );
  }, [hyperSessionIds]);

  return {
    state,
    setHyperSession: setState,
    isOpen: state?.open === true,
    hasHyperSessions: hyperSessionIds.length > 0,
    getOrCreateSessionId,
    toggle,
    minimize,
    close,
    promote,
  };
}
