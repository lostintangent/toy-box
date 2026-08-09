import { decodeFileRoute } from "../model";
import { resolveWorkspaceFile } from "./paths";

type FileRequestResolution = { absolutePath: string } | { error: Response };

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

  return { absolutePath };
}

function fail(status: number, message: string): FileRequestResolution {
  return { error: new Response(message, { status }) };
}
