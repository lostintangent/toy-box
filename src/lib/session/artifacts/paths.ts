import { getPathDirname } from "@/lib/paths";
import { SESSION_STATE_PATH } from "@/lib/session/sessionState";

/** Build a route URL for an artifact path, stripping the session-state prefix if present. */
export function createSessionArtifactRouteUrl(
  routePrefix: string,
  sessionId: string,
  path: string,
): string {
  return `${routePrefix}/${encodeURIComponent(sessionId)}/${encodeArtifactPath(
    toSessionArtifactRoutePath(sessionId, path),
  )}`;
}

/** Build a trailing-slash route base URL for resolving sibling artifact embeds. */
export function createSessionArtifactRouteBaseUrl(
  routePrefix: string,
  sessionId: string,
  path: string,
): string {
  const artifactDirectory = getPathDirname(toSessionArtifactRoutePath(sessionId, path));
  const encodedDirectory =
    artifactDirectory === "." ? "" : `${encodeArtifactPath(artifactDirectory)}/`;

  return `${routePrefix}/${encodeURIComponent(sessionId)}/${encodedDirectory}`;
}

function toSessionArtifactRoutePath(sessionId: string, path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const relativePath = stripSessionStatePrefix(sessionId, normalizedPath);

  return relativePath.replace(/^\/+/, "");
}

function stripSessionStatePrefix(sessionId: string, path: string): string {
  const homeRelativePrefix = `~/${SESSION_STATE_PATH}/${sessionId}/`;
  if (path.startsWith(homeRelativePrefix)) return path.slice(homeRelativePrefix.length);

  const relativePrefix = `${SESSION_STATE_PATH}/${sessionId}/`;
  if (path.startsWith(relativePrefix)) return path.slice(relativePrefix.length);

  const absoluteMarker = `/${SESSION_STATE_PATH}/${sessionId}/`;
  const markerIndex = path.indexOf(absoluteMarker);
  if (markerIndex !== -1) return path.slice(markerIndex + absoluteMarker.length);

  return path;
}

function encodeArtifactPath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
