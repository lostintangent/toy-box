import { useEffect } from "react";
import { usePageVisibility } from "@/hooks/browser/usePageVisibility";
import type { AutomationsUpdateEvent, ServerUpdateEvent, SessionsUpdateEvent } from "@/types";

type ServerEventsByNamespace = {
  session: SessionsUpdateEvent;
  automation: AutomationsUpdateEvent;
};

type NamespacedServerEvent<Namespace extends string | undefined> =
  Namespace extends keyof ServerEventsByNamespace
    ? ServerEventsByNamespace[Namespace]
    : ServerUpdateEvent;

type ServerEventsListener = {
  namespace?: string;
  onEvent: (event: ServerUpdateEvent) => void;
  onReconnect?: () => void;
};

type ServerEventsState = {
  source: EventSource | null;
  listeners: Set<ServerEventsListener>;
  hasOpened: boolean;
};

let serverEventsState: ServerEventsState | undefined;

function getServerEventsState(): ServerEventsState {
  if (!serverEventsState) {
    serverEventsState = {
      source: null,
      listeners: new Set(),
      hasOpened: false,
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
    if (state.hasOpened) {
      for (const listener of state.listeners) {
        listener.onReconnect?.();
      }
    }
    state.hasOpened = true;
  };

  source.onmessage = (message) => {
    if (!message.data) return;

    try {
      const event = JSON.parse(message.data) as ServerUpdateEvent;
      for (const listener of state.listeners) {
        if (listener.namespace && !event.type.startsWith(`${listener.namespace}.`)) {
          continue;
        }
        listener.onEvent(event);
      }
    } catch (error) {
      console.error("Failed to parse server events update:", error);
    }
  };

  source.onerror = (error) => {
    if (source.readyState === EventSource.CLOSED) {
      console.error("Server events SSE closed:", error);
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
    state.hasOpened = false;
  };
}

type UseServerEventsOptions<Namespace extends string | undefined = undefined> = {
  enabled?: boolean;
  namespace?: Namespace;
  onEvent: (event: NamespacedServerEvent<Namespace>) => void;
  onReconnect?: () => void;
};

export function useServerEvents<Namespace extends string | undefined = undefined>({
  enabled = true,
  namespace,
  onEvent,
  onReconnect,
}: UseServerEventsOptions<Namespace>) {
  const isVisible = usePageVisibility();
  const shouldSubscribe = enabled && isVisible;

  useEffect(() => {
    if (!shouldSubscribe) return;
    return subscribeServerEvents({
      namespace,
      onEvent: (event) => {
        onEvent(event as NamespacedServerEvent<Namespace>);
      },
      onReconnect,
    });
  }, [namespace, onEvent, onReconnect, shouldSubscribe]);
}
