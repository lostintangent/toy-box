import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScreenNative } from "./build";

test.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "native block and dirty-bound comparisons preserve baseline-relative updates",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "toy-box-screen-pixels-"));
    try {
      const executable = await buildScreenNative(directory, true);
      const result = Bun.spawn([executable, "--verify"], { stdout: "ignore", stderr: "pipe" });
      const [code, stderr] = await Promise.all([result.exited, new Response(result.stderr).text()]);
      expect(stderr).toBe("");
      expect(code).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120_000,
);
