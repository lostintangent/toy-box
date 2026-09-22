import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { removeUncompressedAssets } from "./publicAssets";

test("omits originals only when both browser encodings are available", async () => {
  const publicDir = await mkdtemp(join(tmpdir(), "toy-box-public-assets-"));
  const files = [
    "assets/app.js",
    "assets/app.js.gz",
    "assets/app.js.br",
    "assets/gzip-only.js",
    "assets/gzip-only.js.gz",
    "assets/brotli-only.js",
    "assets/brotli-only.js.br",
    "assets/tiny.js",
    "favicon.png",
  ];

  try {
    await Promise.all(files.map((file) => Bun.write(join(publicDir, file), file)));
    await removeUncompressedAssets(publicDir);
    await removeUncompressedAssets(publicDir);

    const expected = files.filter((file) => file !== "assets/app.js");
    const remaining = (await readdir(publicDir, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => relative(publicDir, join(entry.parentPath, entry.name)));
    expect(remaining.sort()).toEqual(expected.sort());
    for (const file of expected) {
      expect(await Bun.file(join(publicDir, file)).text()).toBe(file);
    }
  } finally {
    await rm(publicDir, { recursive: true, force: true });
  }
});
