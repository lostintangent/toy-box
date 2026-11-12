import { afterAll, expect, mock, test } from "bun:test";
import * as realShutdown from "./shutdown";

// Shutdown is permanent for a process, so these tests shut down a stand-in and give the real
// one back to the files that run after them.
const shutdown = new AbortController();
mock.module("./shutdown", () => ({ shutdown }));
afterAll(() => mock.module("./shutdown", () => ({ ...realShutdown })));
const { createSseResponse } = await import("./sse");

test("an open stream ends cleanly and runs its route's cleanup once the server shuts down", async () => {
  let cleanedUp = false;
  const response = createSseResponse<string>(new Request("http://localhost/stream"), (send) => {
    send("hello");
    return () => (cleanedUp = true);
  });
  const body = response.text();
  await Bun.sleep(0);

  shutdown.abort();

  expect(await body).toBe('retry: 1000\n\ndata: "hello"\n\n');
  expect(cleanedUp).toBe(true);
});
