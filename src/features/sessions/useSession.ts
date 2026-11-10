/**
 * Client facade for one session's live state.
 *
 * The session's detail query holds its one reduced state, and that query's
 * observation follows live work while a visible pane watches it (see `stream.ts`).
 * The hook derives what the pane shows from that cache and shared activity, and
 * applies the user's commands to it optimistically.
 *
 * First turn: a draft session owns a public ID and artifacts,
 * and its first send creates the selected provider's history with
 * `location` carrying its directory and worktree choice. Submission seeds its
 * catalog entry and applies the ordinary `running` transition optimistically;
 * provider creation then supplies the authoritative metadata.
 */

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModelConfiguration } from "@providers/model";
import { applySessionEvent, createInitialSessionState } from "./model/reducer";
import { joinPreviousMessages } from "./model/transcriptPages";
import type { Session, SessionEvent, SessionLaunch, SessionState, UserMessage } from "./model";
import { isLiveActivity } from "./model/activity";
import { repairFailedDraft } from "./cache";
import { sessionMutations } from "./mutations";
import { sessionQueries } from "./queries";
import { useSessionsActivity } from "./useSessionActivity";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { generateUUID } from "@/shared/utils";
import { applyWorkspaceEvent } from "@workspace/sync";

interface SessionConfig {
  /** A passive pane never acknowledges completion or clears an existing unread state. */
  mode?: "active" | "passive";
  /** Whether the owning pane is currently presented by its workspace host. */
  isVisible?: boolean;
  /** Browser default, used when no model has been projected for the session.
   *  Once the session has its own model, that always wins over this default. */
  defaultModel?: ModelConfiguration;
  /** Working directory for the session. Only sent as the first turn's location. */
  directory?: string;
  /** Run the session in an isolated git worktree. Initial-location only. */
  useWorktree?: boolean;
  /** Catalog record; its provider determines whether history exists yet. */
  session?: Session;
}

/** A new turn's state before it was sent, restored if the server never takes it. */
type UnsentTurn = { clientId: string; state: SessionState; isDraft: boolean };

export function useSession(
  sessionId: string,
  {
    mode = "active",
    isVisible: paneIsVisible = true,
    defaultModel,
    directory: sessionDirectory,
    useWorktree: sessionUseWorktree,
    session,
  }: SessionConfig,
) {
  const queryClient = useQueryClient();
  const sessionQuery = sessionQueries.detail(sessionId);
  const { queryKey } = sessionQuery;
  const isDraft = session !== undefined && !session.provider;
  const activityStatus = useSessionsActivity((activities) => activities[sessionId]?.status);
  const isVisible = usePageVisibility() && paneIsVisible;

  // ---------------------------------------------------------------------------
  // Session state
  // ---------------------------------------------------------------------------
  // A draft has no history to read, so it starts from its own initial state.
  const [draftState] = useState(() =>
    createInitialSessionState(
      session?.artifactPath
        ? { artifacts: [{ path: session.artifactPath, updatedAt: session.createdAt.getTime() }] }
        : {},
    ),
  );
  // A hidden pane stops watching, which ends the observation once nothing else watches.
  const { data, error } = useQuery({ ...sessionQuery, enabled: !isDraft, subscribed: isVisible });
  const state = data ?? draftState;
  const hasLoadedSessionState = isDraft || data !== undefined;
  // A run's `end` settles the pane before the shared activity that announced it.
  const isStreaming = isLiveActivity(activityStatus) && state.status !== "idle";

  const read = () => queryClient.getQueryData<SessionState>(queryKey) ?? draftState;
  const update = (recipe: (current: SessionState) => SessionState) =>
    queryClient.setQueryData<SessionState>(queryKey, (current) => recipe(current ?? draftState));
  const applyEvent = (event: SessionEvent) =>
    update((current) => applySessionEvent(current, event));

  /** The client-selected Session model. Takes effect immediately in the UI
   *  and is sent with the next message. */
  const setModel = (model: ModelConfiguration) => update((current) => ({ ...current, model }));

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------
  const { mutate: abort } = useMutation({
    ...sessionMutations.abortSession(sessionId),
    onMutate: async () => {
      // Ending the observation first keeps its follow from replaying the stopped run.
      await queryClient.cancelQueries({ queryKey, exact: true });
      applyEvent({ type: "end", reason: "idle" });
      applyWorkspaceEvent(queryClient, { type: "session.idle", sessionId });
    },
  });

  const stop = () => {
    if (isStreaming) abort();
  };

  const { mutate: markRead } = useMutation(sessionMutations.markRead(sessionId));

  /** Join the page before the first loaded message into the session's state. */
  const loadPrevious = async () => {
    const before = read().messageOffset;
    if (!before) return;
    try {
      const page = await queryClient.query(sessionQueries.messagesBefore(sessionId, before));
      update((current) => joinPreviousMessages(page, current));
    } catch (error) {
      console.error("Failed to load previous session messages:", error);
    }
  };

  // ---------------------------------------------------------------------------
  // Messaging
  // ---------------------------------------------------------------------------
  const unsentTurn = useRef<UnsentTurn>(undefined);
  const { mutateAsync: deliver } = useMutation({
    ...sessionMutations.deliverMessage(sessionId),
    // Query runs this before the delivery settles, so the session's observation
    // resumes on the rolled-back state.
    onError: (error, { message }) => {
      const turn = unsentTurn.current;
      if (turn?.clientId !== message.clientId) {
        applyEvent({ type: "message_cancelled", clientId: message.clientId });
        return;
      }
      // The server never took the turn. Drop its optimistic message and hand
      // it back to the sender.
      console.error("Send error:", error);
      queryClient.setQueryData(queryKey, turn.state);
      if (turn.isDraft) {
        void repairFailedDraft(queryClient, sessionId);
      } else {
        applyWorkspaceEvent(queryClient, { type: "session.idle", sessionId });
      }
    },
    onSettled: (_receipt, _error, { message }) => {
      if (unsentTurn.current?.clientId === message.clientId) unsentTurn.current = undefined;
    },
  });

  const sendMessage = async (
    input: Pick<UserMessage, "content" | "attachments">,
    { immediate }: { immediate?: true } = {},
  ) => {
    if (!input.content.trim() && !input.attachments?.length) return;
    const clientId = generateUUID();
    const now = new Date();

    // The session's own model always wins; otherwise this message makes the
    // browser selection the session's effective model.
    const model = read().model ?? defaultModel;
    const message = {
      ...input,
      clientId,
      attachments: input.attachments?.length ? input.attachments : undefined,
      model,
      immediate,
    } satisfies SessionLaunch["message"] & { clientId: string };

    applyWorkspaceEvent(queryClient, {
      type: "session.upserted",
      session: {
        id: sessionId,
        updatedAt: now.toISOString(),
        ...(isDraft && {
          provider: model ? { id: model.provider } : undefined,
          context: { directory: sessionDirectory },
        }),
      },
    });

    // Server running state owns the send-vs-queue distinction. Reading it from the
    // cache includes a run announced since the last render.
    const activities = queryClient.getQueryData(sessionQueries.activity.queryKey);
    if (isLiveActivity(activities?.[sessionId]?.status)) {
      applyEvent({ type: "message_queued", message: { ...message, role: "user" } });
      await deliver({ message });
      return;
    }

    unsentTurn.current = { clientId, state: read(), isDraft };
    applyWorkspaceEvent(queryClient, { type: "session.running", sessionId, at: now.getTime() });
    // Seed the session's model with what we're about to send to keep the picker
    // stable until the provider announces the model it applies.
    update((current) =>
      [
        {
          type: "user_message",
          content: message.content,
          attachments: message.attachments,
          clientId,
          timestamp: now.toISOString(),
        } satisfies SessionEvent,
        { type: "status", status: "thinking" } satisfies SessionEvent,
      ].reduce(applySessionEvent, model ? { ...current, model } : current),
    );
    await deliver({
      message,
      location: isDraft
        ? { directory: sessionDirectory, useWorktree: sessionUseWorktree }
        : undefined,
    });
  };

  // ---------------------------------------------------------------------------
  // Pane lifecycle
  // ---------------------------------------------------------------------------
  // Opening a finished run acknowledges it. The observation already healed the
  // transcript when the run ended.
  const isUnread = activityStatus === "unread";
  useEffect(() => {
    if (mode !== "passive" && isVisible && isUnread && hasLoadedSessionState) markRead();
  }, [hasLoadedSessionState, isUnread, isVisible, markRead, mode]);

  return {
    ...state,
    isStreaming,
    hasLoadedSessionState,
    error,
    setModel,
    stop,
    sendMessage,
    loadPrevious,
  };
}
