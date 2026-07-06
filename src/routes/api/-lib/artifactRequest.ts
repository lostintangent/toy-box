import { resolveSessionArtifactPath } from "@/lib/server/sandbox";

type ArtifactRequestResolution = { absolutePath: string; error: Response | null };

/** Resolve a `(sessionId, splat)` artifact route request into a confined path to an existing
 *  file. Shared by the watch and preview routes so they confine the path, reject non-files,
 *  and answer with the same status codes in one place. Callers destructure
 *  `{ absolutePath, error }`, return `error` if present, and otherwise use `absolutePath`. */
export async function resolveArtifactRequest(
  sessionId: string,
  splat: string | undefined,
): Promise<ArtifactRequestResolution> {
  const requestPath = splat?.replace(/^\/+/, "");
  if (!requestPath) return fail(400, "Missing artifact path.");

  const resolvedPath = resolveSessionArtifactPath(sessionId, requestPath);
  if (!resolvedPath) return fail(403, "Invalid artifact path.");

  try {
    const { stat } = await import("node:fs/promises");
    if (!(await stat(resolvedPath.absolutePath)).isFile())
      return fail(404, "Artifact is not a file.");
  } catch {
    return fail(404, "Artifact not found.");
  }

  return { absolutePath: resolvedPath.absolutePath, error: null };
}

function fail(status: number, message: string): ArtifactRequestResolution {
  return { absolutePath: "", error: new Response(message, { status }) };
}
