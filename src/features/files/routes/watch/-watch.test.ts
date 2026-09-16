import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, onTestFinished, test } from "bun:test";
import { createWatchResponse } from "./$scope/$.ts";
import type { FileWatchEvent } from "@files/model";

describe("file watch", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
  });

  test("starts with the current file revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "toy-box-file-watch-"));
    directories.push(directory);
    const path = join(directory, "document.md");
    await Bun.write(path, "current");
    const timestamp = (await Bun.file(path).stat()).mtimeMs;
    const abort = new AbortController();

    const response = await createWatchResponse(
      { scope: "machine", _splat: path.replace(/^\/+/, "") },
      new Request("http://localhost/api/watch", { signal: abort.signal }),
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let body = "";
    while (!body.includes('data: {"type"')) {
      const chunk = await reader.read();
      if (chunk.done) break;
      body += decoder.decode(chunk.value, { stream: true });
    }

    expect(body).toContain(`data: {"type":"modified","timestamp":${timestamp}}\n\n`);
    abort.abort();
    await reader.cancel();
  });

  test("disconnecting one client leaves the other client's shared file subscription live", async () => {
    const directory = await mkdtemp(join(tmpdir(), "toy-box-file-watch-"));
    directories.push(directory);
    const path = join(directory, "document.md");
    await Bun.write(path, "Before");

    async function connect() {
      const abort = new AbortController();
      const response = await createWatchResponse(
        { scope: "machine", _splat: path.replace(/^\/+/, "") },
        new Request("http://localhost/api/watch", { signal: abort.signal }),
      );
      const reader = response.body!.getReader();
      onTestFinished(async () => {
        abort.abort();
        await reader.cancel();
      });
      return { abort, reader };
    }

    const first = await connect();
    const second = await connect();
    const initial = await nextFileEvent(first.reader);
    expect(await nextFileEvent(second.reader)).toEqual(initial);
    first.abort.abort();
    expect((await first.reader.read()).done).toBe(true);

    await Bun.write(path, "After");
    expect(await nextFileEvent(second.reader)).toEqual({
      type: "modified",
      timestamp: (await Bun.file(path).stat()).mtimeMs,
    });
    await rm(path);
    expect(await nextFileEvent(second.reader)).toEqual({ type: "deleted" });
  });
});

async function nextFileEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<FileWatchEvent> {
  const decoder = new TextDecoder();
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("File subscription ended before its next event.");
    const data = decoder
      .decode(value)
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (data) return JSON.parse(data.slice(6));
  }
}
