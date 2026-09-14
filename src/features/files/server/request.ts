import { decodeFileRoute } from "../model";
import { resolveWorkspaceFile } from "./paths";

type FileRequestResolution =
  | { absolutePath: string; size: number; modifiedTime: number }
  | { error: Response };

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
    const stats = await Bun.file(absolutePath).stat();
    if (!stats.isFile()) {
      return fail(404, "Requested path is not a file.");
    }
    return { absolutePath, size: stats.size, modifiedTime: stats.mtimeMs };
  } catch {
    return fail(404, "File not found.");
  }
}

function fail(status: number, message: string): FileRequestResolution {
  return { error: new Response(message, { status }) };
}
