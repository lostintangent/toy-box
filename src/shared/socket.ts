/** One reconnecting socket's callbacks. Each receives the socket it concerns. */
type SocketHandlers = {
  /** What each new socket's URL names, read as it connects. */
  params?: () => Record<string, string | number | undefined>;
  onOpen?: (socket: WebSocket) => void;
  onMessage: (data: string | ArrayBuffer, socket: WebSocket) => void;
  /** Whether to connect again. */
  onClose?: (event: CloseEvent) => boolean | void;
};

/** A lost socket retries after 250 ms, doubling up to 10 s. */
const FIRST_RETRY_MS = 250;
const LAST_RETRY_MS = 10_000;

/**
 * Keeps a socket to a feature's `/socket` service until closed, reconnecting with exponential
 * backoff. The backoff restarts once the server speaks, so a server that accepts a socket only
 * to close it is retried ever more slowly. Each service gets its own connection, so bulk
 * screen frames never share a TCP queue with terminal I/O.
 */
export function connectSocket(service: string, handlers: SocketHandlers) {
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let retryDelay = FIRST_RETRY_MS;
  let closed = false;

  function open() {
    clearTimeout(retry);
    const url = new URL("/socket", window.location.origin);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("service", service);
    for (const [name, value] of Object.entries(handlers.params?.() ?? {}))
      if (value !== undefined) url.searchParams.set(name, String(value));

    const current = (socket = new WebSocket(url));
    current.binaryType = "arraybuffer";
    current.onopen = () => handlers.onOpen?.(current);
    current.onmessage = ({ data }) => {
      retryDelay = FIRST_RETRY_MS;
      handlers.onMessage(data, current);
    };
    current.onclose = (event) => {
      if (current !== socket) return;
      socket = undefined;
      if (handlers.onClose?.(event) === false) return;
      retry = setTimeout(open, retryDelay);
      retryDelay = Math.min(retryDelay * 2, LAST_RETRY_MS);
    };
  }

  open();
  return {
    /** Sends on an open socket, and says whether it could. */
    send(data: string | Uint8Array<ArrayBuffer>): boolean {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(data);
      return true;
    },
    /** Connects now rather than at the next retry, unless a socket is open or opening. */
    reconnect() {
      if (!socket && !closed) open();
    },
    close() {
      closed = true;
      clearTimeout(retry);
      const current = socket;
      socket = undefined;
      current?.close();
    },
  };
}
