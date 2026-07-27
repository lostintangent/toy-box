import { getPathDirname } from "@/lib/paths";
import { encodeFileRoute } from "@/lib/files/workspaceFile";
import type { WorkspaceFile } from "@/types";

/** Build a route URL for a workspace file. */
export function createFileRouteUrl(routePrefix: string, file: WorkspaceFile): string {
  const { scope, path } = encodeFileRoute(file);
  return `${routePrefix}/${encodeURIComponent(scope)}/${encodeFilePath(path.replaceAll("\\", "/"))}`;
}

/** Build a trailing-slash route base URL for resolving sibling file embeds. */
export function createFileRouteBaseUrl(routePrefix: string, file: WorkspaceFile): string {
  const { scope, path } = encodeFileRoute(file);
  const directory = getPathDirname(path.replaceAll("\\", "/"));
  const encodedDirectory = directory === "." ? "" : `${encodeFilePath(directory)}/`;

  return `${routePrefix}/${encodeURIComponent(scope)}/${encodedDirectory}`;
}

function encodeFilePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
