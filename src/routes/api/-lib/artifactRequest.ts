import { resolveArtifactPath } from "@/functions/artifacts/paths";

type ArtifactRequestResolution = { absolutePath: string; error: Response | null };

/** Resolve and validate one session-owned file for the watch and serve routes. */
export async function resolveArtifactRequest(
  sessionId: string,
  splat: string | undefined,
): Promise<ArtifactRequestResolution> {
  const requestPath = splat?.replace(/^\/+/, "");
  if (!requestPath) return fail(400, "Missing artifact path.");

  const absolutePath = await resolveArtifactPath(sessionId, requestPath);
  if (!absolutePath) return fail(403, "Invalid artifact path.");

  try {
    const { stat } = await import("node:fs/promises");
    if (!(await stat(absolutePath)).isFile()) return fail(404, "Artifact is not a file.");
  } catch {
    return fail(404, "Artifact not found.");
  }

  return { absolutePath, error: null };
}

function fail(status: number, message: string): ArtifactRequestResolution {
  return { absolutePath: "", error: new Response(message, { status }) };
}
