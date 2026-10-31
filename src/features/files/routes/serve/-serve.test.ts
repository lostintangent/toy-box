import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServeResponse } from "./$scope/$";

test("rejects a missing or out-of-sandbox path", async () => {
  const request = new Request("http://toy-box.test/api/serve/toy-box-session/");

  const missing = await createServeResponse({ scope: "toy-box-session" }, request);
  const traversal = await createServeResponse(
    { scope: "toy-box-session", _splat: "../outside.md" },
    request,
  );

  expect(missing.status).toBe(400);
  expect(traversal.status).toBe(403);
});

test("revalidates unchanged files and serves changed bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toy-box-serve-"));
  const path = join(directory, "image.svg");
  const params = { scope: "machine", _splat: path.replace(/^\/+/, "") };
  const url = "http://toy-box.test/api/serve/machine/image.svg";
  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  await Bun.write(path, "first");
  const initial = await createServeResponse(params, new Request(url));
  const etag = initial.headers.get("ETag");
  expect(initial.status).toBe(200);
  expect(initial.headers.get("Cache-Control")).toBe("private, no-cache");
  expect(etag).toBeTruthy();
  expect(await initial.text()).toBe("first");

  const unchanged = await createServeResponse(
    params,
    new Request(url, { headers: { "If-None-Match": etag! } }),
  );
  expect(unchanged.status).toBe(304);
  expect(await unchanged.text()).toBe("");

  await Bun.write(path, "changed");
  const changed = await createServeResponse(
    params,
    new Request(url, { headers: { "If-None-Match": etag! } }),
  );
  expect(changed.status).toBe(200);
  expect(changed.headers.get("ETag")).not.toBe(etag);
  expect(await changed.text()).toBe("changed");
});

test("serves lengths and byte ranges so browsers can stream and seek video", async () => {
  const directory = await mkdtemp(join(tmpdir(), "toy-box-serve-"));
  const path = join(directory, "flow.webm");
  const params = { scope: "machine", _splat: path.replace(/^\/+/, "") };
  const url = "http://toy-box.test/api/serve/machine/flow.webm";
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  await Bun.write(path, "0123456789");
  const request = (range: string) =>
    createServeResponse(params, new Request(url, { headers: { Range: range } }));

  const full = await createServeResponse(params, new Request(url));
  expect(full.headers.get("Content-Length")).toBe("10");

  const partial = await request("bytes=2-5");
  expect(partial.status).toBe(206);
  expect(partial.headers.get("Content-Type")).toBe("video/webm");
  expect(partial.headers.get("Content-Range")).toBe("bytes 2-5/10");
  expect(await partial.text()).toBe("2345");
  expect(await (await request("bytes=7-")).text()).toBe("789");

  const outOfRange = await request("bytes=10-");
  expect(outOfRange.status).toBe(200);
  expect(await outOfRange.text()).toBe("0123456789");
});
