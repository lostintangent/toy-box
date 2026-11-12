import { defineHandler } from "h3";
import { isIP } from "node:net";

/** Shared with Vite; localhost and IP literals are always accepted. */
export const allowedHosts = [".ts.net"];

const reads = new Set(["GET", "HEAD", "OPTIONS"]);
const extensionProtocols = new Set([
  "chrome-extension:",
  "moz-extension:",
  "safari-web-extension:",
]);

/**
 * Every request needs a trusted host to prevent DNS rebinding. Writes also need a trusted
 * origin, since browsers let any page POST a form to any host. No GET may change state.
 */
export default defineHandler((event) => {
  if (reads.has(event.req.method) ? isTrustedHost(event.req) : isTrustedOrigin(event.req)) return;
  return Response.json({ error: "Cross-site requests are refused." }, { status: 403 });
});

/**
 * Whether a request comes from Toy Box's own pages, a browser extension the owner installed, or
 * a non-browser client. Validate the destination host even when the Origin matches or is absent;
 * the socket gateway also uses this check before accepting an upgrade.
 */
export function isTrustedOrigin(request: Request): boolean {
  if (!isTrustedHost(request)) return false;
  const origin = request.headers.get("origin");
  // Browsers send one with every write and socket, so a request without is a non-browser client.
  if (!origin) return true;

  try {
    const source = new URL(origin);
    if (extensionProtocols.has(source.protocol)) return true;
    return (
      (source.protocol === "http:" || source.protocol === "https:") &&
      source.host === new URL(request.url).host
    );
  } catch {
    return false;
  }
}

function isTrustedHost(request: Request): boolean {
  const { hostname } = new URL(request.url);
  const ip = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  return (
    isIP(ip) !== 0 ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    allowedHosts.some(
      (host) =>
        hostname === host ||
        (host.startsWith(".") && (hostname === host.slice(1) || hostname.endsWith(host))),
    )
  );
}
