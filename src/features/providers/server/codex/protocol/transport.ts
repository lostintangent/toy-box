// Bidirectional JSONL RPC. Reading never awaits a host handler: handlers may
// issue their own RPC, and blocking the read loop would deadlock that response.
import { homedir } from "node:os";
import { sharedMap } from "@/shared/server/processState";
import type { CodexMethods } from ".";
import { SessionConnectionUnavailableError } from "@providers/server/provider";

export type RpcRequest = { id: string | number; method: string; params: unknown };
export type RpcNotification = { method: string; params: unknown };
type Pending = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class CodexTransport {
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #notifications = new Set<(notification: RpcNotification) => void>();
  #requests = new Set<(request: RpcRequest) => boolean>();
  #closed = new Set<(error: Error) => void>();
  #failure?: Error;
  #fragments: string[] = [];

  constructor(
    private readonly write: (line: string) => void,
    private readonly terminate: () => void = () => {},
  ) {}

  request<K extends keyof CodexMethods>(
    method: K,
    params: CodexMethods[K]["params"],
  ): Promise<CodexMethods[K]["result"]> {
    if (this.#failure)
      return Promise.reject(new SessionConnectionUnavailableError(this.#failure.message));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex ${method} timed out.`));
      }, 120_000);
      timer.unref();
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.write(JSON.stringify({ id, method, params }) + "\n");
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.#failure) throw this.#failure;
    this.write(JSON.stringify({ method, ...(params === undefined ? {} : { params }) }) + "\n");
  }

  respond(id: string | number, result: unknown): void {
    if (!this.#failure) this.write(JSON.stringify({ id, result }) + "\n");
  }

  reject(id: string | number, message: string): void {
    if (!this.#failure) this.write(JSON.stringify({ id, error: { code: -32601, message } }) + "\n");
  }

  onNotification(listener: (notification: RpcNotification) => void): () => void {
    this.#notifications.add(listener);
    return () => this.#notifications.delete(listener);
  }

  onRequest(listener: (request: RpcRequest) => boolean): () => void {
    this.#requests.add(listener);
    return () => this.#requests.delete(listener);
  }

  onClose(listener: (error: Error) => void): () => void {
    this.#closed.add(listener);
    return () => this.#closed.delete(listener);
  }

  /** @internal Stream framing seam, also used by protocol tests. */
  receive(chunk: string): void {
    let start = 0;
    for (;;) {
      // Scan only new text; assemble even a large history response just once.
      const newline = chunk.indexOf("\n", start);
      if (newline < 0) {
        if (start < chunk.length) this.#fragments.push(chunk.slice(start));
        return;
      }
      this.#fragments.push(chunk.slice(start, newline));
      const line = this.#fragments.join("").trim();
      this.#fragments = [];
      start = newline + 1;
      if (!line) continue;
      try {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== "object") throw new Error("Invalid Codex RPC envelope.");
        const message = value as Record<string, unknown>;
        if (typeof message.method === "string") {
          if (typeof message.id === "string" || typeof message.id === "number") {
            const request: RpcRequest = {
              id: message.id,
              method: message.method,
              params: message.params,
            };
            if (![...this.#requests].some((handle) => handle(request)))
              this.reject(request.id, `Unsupported Codex request: ${request.method}`);
          } else {
            for (const listener of this.#notifications)
              listener({ method: message.method, params: message.params });
          }
        } else if (typeof message.id === "number") {
          const pending = this.#pending.get(message.id);
          if (!pending) continue;
          this.#pending.delete(message.id);
          clearTimeout(pending.timer);
          if (message.error) {
            const error = message.error as { message?: string };
            pending.reject(new Error(error.message ?? "Codex request failed."));
          } else pending.resolve(message.result);
        }
      } catch (error) {
        this.close(error instanceof Error ? error : new Error(String(error)));
        return;
      }
    }
  }

  close(error = new Error("Codex app-server disconnected.")): void {
    if (this.#failure) return;
    this.#failure = error;
    this.#fragments = [];
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
    for (const listener of this.#closed) listener(error);
    this.#notifications.clear();
    this.#requests.clear();
    this.#closed.clear();
    this.terminate();
  }
}

const clients = sharedMap<Promise<CodexTransport>>("codex-clients");

export function startCodexClient(): Promise<CodexTransport> {
  const existing = clients.get("shared");
  if (existing) return existing;
  const promise = openCodexClient();
  clients.set("shared", promise);
  void promise.catch(() => {
    if (clients.get("shared") === promise) clients.delete("shared");
  });
  return promise;
}

async function openCodexClient(): Promise<CodexTransport> {
  const path = Bun.which("codex");
  if (!path)
    throw new Error("Install Codex with `npm i -g @openai/codex`, then run `codex login`.");
  const child = Bun.spawn([path, "app-server"], {
    cwd: homedir(),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  const transport = new CodexTransport(
    (line) => {
      void Promise.resolve(child.stdin.write(line)).catch((error) => transport.close(error));
      void Promise.resolve(child.stdin.flush()).catch((error) => transport.close(error));
    },
    () => child.kill(),
  );
  let stderr = "";
  void (async () => {
    for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream()))
      stderr = (stderr + chunk).slice(-4096);
  })();
  void (async () => {
    try {
      for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream()))
        transport.receive(chunk);
      const code = await child.exited;
      transport.close(new Error(`Codex app-server exited (${code}). ${stderr.trim()}`));
    } catch (error) {
      transport.close(error instanceof Error ? error : new Error(String(error)));
    }
  })();
  transport.onClose(() => {
    clients.delete("shared");
  });
  try {
    await transport.request("initialize", {
      clientInfo: { name: "toy_box", title: "Toy Box", version: "1.0.0" },
      capabilities: { experimentalApi: true, requestAttestation: false },
    });
    transport.notify("initialized");
    return transport;
  } catch (error) {
    transport.close();
    throw error;
  }
}

export async function stopCodexClient(): Promise<void> {
  const pending = clients.get("shared");
  clients.delete("shared");
  if (pending) (await pending).close();
}
