import { resolveSessionArtifactPath } from "@/lib/server/sandbox";

type ResolvedArtifactRequest = { path: string; error: Response | null };

/** Resolve a `(sessionId, splat)` artifact route request into a confined path to an existing
 *  file. Shared by the watch and preview routes so they confine the path, reject non-files,
 *  and answer with the same status codes in one place. Callers destructure `{ path, error }`,
 *  return `error` if present, and otherwise use `path`. */
export async function resolveArtifactRequest(
  sessionId: string,
  splat: string | undefined,
): Promise<ResolvedArtifactRequest> {
  const requestPath = splat?.replace(/^\/+/, "");
  if (!requestPath) return fail(400, "Missing artifact path.");

  const path = resolveSessionArtifactPath(sessionId, requestPath);
  if (!path) return fail(403, "Invalid artifact path.");

  try {
    const { stat } = await import("node:fs/promises");
    if (!(await stat(path)).isFile()) return fail(404, "Artifact is not a file.");
  } catch {
    return fail(404, "Artifact not found.");
  }

  return { path, error: null };
}

function fail(status: number, message: string): ResolvedArtifactRequest {
  return { path: "", error: new Response(message, { status }) };
}
