import { describe, expect, test } from "bun:test";
import { CodexTransport } from "./transport";
import { SessionConnectionUnavailableError } from "@providers/server/provider";

describe("Codex bidirectional transport", () => {
  test("frames fragmented large responses, notifications, and out-of-order replies", async () => {
    const written: string[] = [];
    const rpc = new CodexTransport((line) => written.push(line));
    const history = rpc.request("thread/read", { threadId: "large" });
    const steer = rpc.request("turn/steer", { threadId: "b", expectedTurnId: "second", input: [] });
    const [historyRequest, steerRequest] = written.map((line) => JSON.parse(line));
    const notifications: unknown[] = [];
    rpc.onNotification((notification) => notifications.push(notification));
    rpc.receive(JSON.stringify({ id: steerRequest.id, result: { turnId: "second" } }) + "\n");
    expect(await steer).toEqual({ turnId: "second" });

    const result = { thread: { preview: "Silky 🌴 daydream\n".repeat(32_768) } };
    const response = JSON.stringify({ id: historyRequest.id, result });
    for (let offset = 0; offset < response.length; offset += 4093)
      rpc.receive(response.slice(offset, offset + 4093));
    rpc.receive('\r\n\n{"method":"turn/sta');
    expect((await history).thread.preview).toBe(result.thread.preview);
    expect(notifications).toEqual([]);

    rpc.receive('rted","params":{"threadId":"large"}}\n');
    expect(notifications).toEqual([{ method: "turn/started", params: { threadId: "large" } }]);
    rpc.close();
  });

  test("host callbacks can issue RPC without blocking incoming responses", async () => {
    const written: string[] = [];
    const rpc = new CodexTransport((line) => written.push(line));
    let callback!: Promise<void>;
    rpc.onRequest((request) => {
      callback = rpc
        .request("thread/name/set", { threadId: "a", name: "Renamed by a tool" })
        .then(() => rpc.respond(request.id, { success: true }));
      return true;
    });
    rpc.receive('{"id":"host-call","method":"item/tool/call","params":{}}\n');
    expect(JSON.parse(written[0]!).method).toBe("thread/name/set");
    rpc.receive('{"id":1,"result":{}}\n');
    await callback;
    expect(JSON.parse(written[1]!)).toEqual({ id: "host-call", result: { success: true } });
    rpc.close();
  });

  test("request failures are isolated and a closed process rejects all pending work", async () => {
    const rpc = new CodexTransport(() => {});
    const first = rpc.request("thread/read", { threadId: "missing" });
    const second = rpc.request("thread/read", { threadId: "present" });
    rpc.receive('{"id":1,"error":{"code":-32000,"message":"thread not found"}}\n');
    await expect(first).rejects.toThrow("thread not found");
    rpc.close(new Error("Process exited"));
    await expect(second).rejects.toThrow("Process exited");
    // An interrupted submission is ambiguous. Only subsequent, unsubmitted
    // operations are safe for the shared runtime to retry on a new connection.
    await expect(second).rejects.not.toBeInstanceOf(SessionConnectionUnavailableError);
    await expect(rpc.request("thread/read", { threadId: "later" })).rejects.toThrow(
      "Process exited",
    );
    await expect(rpc.request("thread/read", { threadId: "later" })).rejects.toBeInstanceOf(
      SessionConnectionUnavailableError,
    );
  });

  test("unknown server requests receive a response instead of hanging the agent", () => {
    const written: string[] = [];
    const rpc = new CodexTransport((line) => written.push(line));
    rpc.receive('{"id":7,"method":"future/interactiveRequest","params":{}}\n');
    expect(JSON.parse(written[0]!)).toMatchObject({ id: 7, error: { code: -32601 } });
    rpc.close();
  });
});
