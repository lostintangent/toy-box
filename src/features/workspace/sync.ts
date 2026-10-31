import type { QueryClient } from "@tanstack/react-query";
import { createAtom } from "@tanstack/react-store";
import type { WorkspaceEvent } from "./model/events";

/** A feature's client cache of workspace state, as sync sees it. */
export type WorkspaceCache = {
  /** Apply one live, optimistic, or confirmed event. */
  applyEvent(queryClient: QueryClient, event: WorkspaceEvent): void;
  /** Recover anything the stream may have missed. */
  refresh(queryClient: QueryClient): Promise<void>;
};

/** Every feature's `cache.ts` default-exports its WorkspaceCache, Workspace's own included. */
const caches = Object.values(
  import.meta.glob<WorkspaceCache>("../*/cache.ts", { eager: true, import: "default" }),
);

/** Apply a workspace event to every cache. Anything that applies an event on the client, whether
 * live, optimistic, or confirmed, goes through here rather than through a cache directly. */
export function applyWorkspaceEvent(queryClient: QueryClient, event: WorkspaceEvent): void {
  for (const cache of caches) cache.applyEvent(queryClient, event);
}

/** Refresh every cache after the stream may have missed events. */
export async function refreshWorkspace(queryClient: QueryClient): Promise<void> {
  await Promise.all(caches.map((cache) => cache.refresh(queryClient)));
}

/** This tab's current workspace connection, which server resources the tab holds attach to. It
 *  changes on every reconnect, so holders attach again. */
export const workspaceConnection = createAtom<string | null>(null);
