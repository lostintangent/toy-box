import { unlink } from "node:fs/promises";
import { join } from "node:path";

/** Remove originals only when Nitro generated both browser encodings. */
export async function removeUncompressedAssets(publicDir: string): Promise<void> {
  const files = new Set(
    await Array.fromAsync(
      new Bun.Glob("**/*").scan({ cwd: publicDir, onlyFiles: true, dot: true }),
    ),
  );

  await Promise.all(
    [...files]
      .filter((file) => files.has(`${file}.gz`) && files.has(`${file}.br`))
      .map((file) => unlink(join(publicDir, file))),
  );
}
