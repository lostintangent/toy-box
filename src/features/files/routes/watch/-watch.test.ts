import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { createWatchResponse } from "./$scope/$.ts";

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
});
