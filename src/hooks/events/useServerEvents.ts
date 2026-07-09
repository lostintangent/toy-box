import { useEffect } from "react";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import type { AutomationEvent, ServerUpdate, WorkspaceEvent } from "@/types";

type ServerEventsByTopic = {
  workspace: WorkspaceEvent;
  automation: AutomationEvent;
};

type ServerEventsListener = {
  topic: keyof ServerEventsByTopic;
  onEvent: (event: WorkspaceEvent | AutomationEvent) => void;
  onOpen?: () => void;
};

type ServerEventsState = {
  source: EventSource | null;
  listeners: Set<ServerEventsListener>;
};

let serverEventsState: ServerEventsState | undefined;

function getServerEventsState(): ServerEventsState {
  if (!serverEventsState) {
    serverEventsState = {
      source: null,
      listeners: new Set(),
    };
  }

  return serverEventsState;
}

function ensureServerEventsSource(): void {
  const state = getServerEventsState();
  if (state.source) return;

  const source = new EventSource("/api/events");
  state.source = source;

  source.onopen = () => {
    // The initial query snapshot and this at-most-once stream cannot be opened
    // atomically. Heal on every connection so events missed in that gap—or
    // while hidden or offline—cannot leave shared state stale.
    for (const listener of state.listeners) {
      listener.onOpen?.();
    }
  };

  source.onmessage = (message) => {
    if (!message.data) return;

    try {
      const update = JSON.parse(message.data) as ServerUpdate;
      for (const listener of state.listeners) {
        if (listener.topic !== update.topic) continue;
        listener.onEvent(update.event);
      }
    } catch (error) {
      console.error("Failed to parse server events update:", error);
    }
  };
}

function subscribeServerEvents(listener: ServerEventsListener): () => void {
  const state = getServerEventsState();
  state.listeners.add(listener);
  ensureServerEventsSource();

  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size > 0) return;

    state.source?.close();
    state.source = null;
  };
}

type UseServerEventsOptions<Topic extends keyof ServerEventsByTopic> = {
  enabled?: boolean;
  topic: Topic;
  onEvent: (event: ServerEventsByTopic[Topic]) => void;
  onOpen?: () => void;
};

export function useServerEvents<Topic extends keyof ServerEventsByTopic>({
  enabled = true,
  topic,
  onEvent,
  onOpen,
}: UseServerEventsOptions<Topic>) {
  const isVisible = usePageVisibility();
  const shouldSubscribe = enabled && isVisible;

  useEffect(() => {
    if (!shouldSubscribe) return;
    return subscribeServerEvents({
      topic,
      onEvent: (event) => {
        onEvent(event as ServerEventsByTopic[Topic]);
      },
      onOpen,
    });
  }, [onEvent, onOpen, shouldSubscribe, topic]);
}
