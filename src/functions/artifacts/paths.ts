import { getInboxEntry, resolveInboxArtifactPath } from "@/functions/state/workspace/inbox";
import { resolveSessionArtifactPath } from "@/lib/server/artifactPaths";

/** Resolve an artifact beneath the storage owned by its source session. */
export async function resolveArtifactPath(sessionId: string, path: string): Promise<string | null> {
  const inboxEntry = await getInboxEntry(sessionId);
  if (!inboxEntry) return resolveSessionArtifactPath(sessionId, path);

  const artifactPath = path.trim();
  if (inboxEntry.artifact !== artifactPath) return null;
  return resolveInboxArtifactPath(sessionId, artifactPath);
}
