import { getPathDirname } from "@/lib/paths";

/** Build a route URL for an artifact path relative to the session files directory. */
export function createSessionArtifactRouteUrl(
  routePrefix: string,
  sessionId: string,
  path: string,
): string {
  return `${routePrefix}/${encodeURIComponent(sessionId)}/${encodeArtifactPath(
    path.replaceAll("\\", "/"),
  )}`;
}

/** Build a trailing-slash route base URL for resolving sibling artifact embeds. */
export function createSessionArtifactRouteBaseUrl(
  routePrefix: string,
  sessionId: string,
  path: string,
): string {
  const artifactDirectory = getPathDirname(path.replaceAll("\\", "/"));
  const encodedDirectory =
    artifactDirectory === "." ? "" : `${encodeArtifactPath(artifactDirectory)}/`;

  return `${routePrefix}/${encodeURIComponent(sessionId)}/${encodedDirectory}`;
}

function encodeArtifactPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
