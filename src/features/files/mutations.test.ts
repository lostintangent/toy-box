import { describe, expect, onTestFinished, test } from "bun:test";
import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { workspaceFileId, type WorkspaceFile } from "./model";
import { fileMutations } from "./mutations";

const file: WorkspaceFile = { type: "machine", path: "/repo/notes.md" };
const fileId = workspaceFileId(file);

describe("file mutation options", () => {
  test("scope writes by file", () => {
    const options = fileMutations.write(file);

    expect(options.scope).toEqual({ id: `file:${fileId}` });
  });

  test("serialize writes submitted through separate observers", async () => {
    const queryClient = new QueryClient();
    onTestFinished(() => queryClient.clear());

    const events: string[] = [];
    let markFirstStarted!: () => void;
    let releaseFirst!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const mutationFn = async ({ content }: { content: string }) => {
      events.push(`${content} started`);
      if (content === "first") {
        markFirstStarted();
        await firstGate;
      }
      events.push(`${content} finished`);
      return { timestamp: 1 };
    };
    const firstObserver = new MutationObserver(queryClient, {
      ...fileMutations.write(file),
      mutationFn,
    });
    const secondObserver = new MutationObserver(queryClient, {
      ...fileMutations.write(file),
      mutationFn,
    });

    const first = firstObserver.mutate({ content: "first", notifyAgent: true });
    await firstStarted;
    const second = secondObserver.mutate({ content: "second", notifyAgent: true });
    await Promise.resolve();

    expect(events).toEqual(["first started"]);
    expect(secondObserver.getCurrentResult().isPaused).toBe(true);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual([
      "first started",
      "first finished",
      "second started",
      "second finished",
    ]);
  });

  test("continue the file scope after a failed write", async () => {
    const queryClient = new QueryClient();
    onTestFinished(() => queryClient.clear());
    const events: string[] = [];
    const failedObserver = new MutationObserver(queryClient, {
      ...fileMutations.write(file),
      mutationFn: async () => {
        events.push("failed");
        throw new Error("write failed");
      },
    });
    const recoveredObserver = new MutationObserver(queryClient, {
      ...fileMutations.write(file),
      mutationFn: async () => {
        events.push("recovered");
        return { timestamp: 2 };
      },
    });

    const failed = failedObserver.mutate({ content: "first", notifyAgent: true });
    const recovered = recoveredObserver.mutate({ content: "second", notifyAgent: true });

    await expect(failed).rejects.toThrow("write failed");
    await expect(recovered).resolves.toEqual({ timestamp: 2 });
    expect(events).toEqual(["failed", "recovered"]);
  });
});
