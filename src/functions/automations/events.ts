import type { AutomationsUpdateEvent } from "@/types";

type AutomationsUpdateListener = (event: AutomationsUpdateEvent) => void;

const listeners = new Set<AutomationsUpdateListener>();

export function emitAutomationsUpdate(event: AutomationsUpdateEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function subscribeAutomationsUpdates(listener: AutomationsUpdateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
