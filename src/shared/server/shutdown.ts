import { getProcessValue } from "./processState";

/** Aborted once the server stops accepting connections, so long-lived streams and sockets end
 * instead of holding its graceful stop open. One per process, since the server can load this
 * module more than once. */
export const shutdown = getProcessValue("shutdown", () => new AbortController());
