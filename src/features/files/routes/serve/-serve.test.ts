import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServeResponse } from "./$scope/$";

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
