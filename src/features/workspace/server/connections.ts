// A connection is one tab's live workspace stream. Features attach releases to it, so server
// resources a tab holds, such as file watches, end when its stream does.

import { sharedMap } from "@/shared/server/processState";

const connections = sharedMap<Map<string, VoidFunction>>("workspace-connections");

export function openConnection(): string {
  const connection = crypto.randomUUID();
  connections.set(connection, new Map());
  return connection;
}

export function closeConnection(connection: string): void {
  const leases = connections.get(connection);
  connections.delete(connection);
  for (const release of leases?.values() ?? []) release();
}

/** Hold `release` until its lease is released or the connection closes. A connection that has
 *  already closed releases immediately and returns no lease. */
export function attachToConnection(connection: string, release: VoidFunction): string | undefined {
  const leases = connections.get(connection);
  if (!leases) {
    release();
    return undefined;
  }
  const lease = crypto.randomUUID();
  leases.set(lease, release);
  return lease;
}

export function releaseLease(connection: string, lease: string): void {
  const leases = connections.get(connection);
  const release = leases?.get(lease);
  leases?.delete(lease);
  release?.();
}
