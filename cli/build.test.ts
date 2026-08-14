import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { writeAppTypeLibrary } from "./build";

const projectRoot = resolve(Bun.fileURLToPath(new URL("../", import.meta.url)));

test("writes the app compiler's package-shaped transitive type library", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "toy-box-app-types-test-"));
  try {
    const outputRoot = join(temporaryDirectory, "app-type-library");
    await writeAppTypeLibrary(projectRoot, outputRoot);

    expect(await Bun.file(join(outputRoot, "tsconfig.json")).exists()).toBe(true);
    expect(await Bun.file(join(outputRoot, "src/features/apps/sdk.ts")).exists()).toBe(true);
    expect(await Bun.file(join(outputRoot, "src/features/files/model/index.ts")).exists()).toBe(
      true,
    );
    expect(await Bun.file(join(outputRoot, "src/features/workers/model/index.ts")).exists()).toBe(
      true,
    );
    expect(
      await Bun.file(join(outputRoot, "src/features/sessions/model/protocol.ts")).exists(),
    ).toBe(true);
    expect(await Bun.file(join(outputRoot, "src/shared/smallJson.ts")).exists()).toBe(true);
    expect(
      await Bun.file(join(outputRoot, "node_modules/app-typescript/lib/lib.es2022.d.ts")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(outputRoot, "node_modules/@types/react/package.json")).exists(),
    ).toBe(true);
    expect(await Bun.file(join(outputRoot, "node_modules/csstype/index.d.ts")).exists()).toBe(true);
    expect(await Bun.file(join(outputRoot, "node_modules/motion/dist/react-m.d.ts")).exists()).toBe(
      true,
    );
    expect(
      await Bun.file(join(outputRoot, "node_modules/framer-motion/dist/m.d.ts")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(outputRoot, "node_modules/motion-dom/dist/index.d.ts")).exists(),
    ).toBe(true);
    expect(
      await Bun.file(join(outputRoot, "node_modules/motion-utils/dist/index.d.ts")).exists(),
    ).toBe(true);
    expect(await Bun.file(join(outputRoot, "node_modules/zod/index.d.cts")).exists()).toBe(true);
    expect(
      await Bun.file(join(outputRoot, "node_modules/ts-algebra/lib/index.d.ts")).exists(),
    ).toBe(true);
    expect(await Bun.file(join(outputRoot, "node_modules/zod/index.js")).exists()).toBe(false);
    expect(
      await Bun.file(join(outputRoot, "node_modules/app-typescript/lib/typescript.js")).exists(),
    ).toBe(false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
