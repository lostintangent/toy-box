import { decodeFileRoute } from "@/lib/files/workspaceFile";
import { resolveWorkspaceFile } from "@/lib/server/filePaths";

type FileRequestResolution = { absolutePath: string; error: Response | null };

/** Resolve and validate one workspace file for the watch and serve routes. */
export async function resolveFileRequest(
  scope: string,
  splat: string | undefined,
): Promise<FileRequestResolution> {
  const requestPath = splat?.replace(/^\/+/, "");
  if (!requestPath) return fail(400, "Missing file path.");

  const absolutePath = resolveWorkspaceFile(decodeFileRoute(scope, requestPath));
  if (!absolutePath) return fail(403, "Invalid file path.");

  try {
    if (!(await Bun.file(absolutePath).stat()).isFile()) {
      return fail(404, "Requested path is not a file.");
    }
  } catch {
    return fail(404, "File not found.");
  }

  return { absolutePath, error: null };
}

function fail(status: number, message: string): FileRequestResolution {
  return { absolutePath: "", error: new Response(message, { status }) };
}
