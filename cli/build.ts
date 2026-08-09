import { mkdtemp, rm } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import ts from "app-typescript";
import { APP_DEPENDENCIES } from "../src/features/apps/runtime";
import { readCompilerOptions } from "../src/features/apps/server/compiler/config";

async function buildCli(): Promise<void> {
  const projectRoot = resolve(Bun.fileURLToPath(new URL("../", import.meta.url)));
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "toy-box-build-"));
  const appTypeLibrary = join(temporaryDirectory, "app-type-library");

  try {
    await writeAppTypeLibrary(projectRoot, appTypeLibrary);

    const result = await Bun.build({
      entrypoints: [join(projectRoot, "cli/index.ts")],
      minify: true,
      throw: false,
      compile: {
        target: "bun-darwin-arm64",
        outfile: join(projectRoot, "toy-box"),
        // @ts-expect-error Bun 1.4 supports executable assets; bun-types 1.3 does not yet.
        assets: [join(projectRoot, ".output/server/public"), appTypeLibrary],
      },
    });

    if (!result.success) {
      throw new Error(result.logs.map((log) => log.message).join("\n"));
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

const COMPILER_TYPE_PACKAGES = [
  "app-typescript",
  "csstype",
  "json-schema-to-ts",
  "ts-algebra",
] as const;

const APP_SDK_SOURCE = "src/features/apps/sdk.ts";

export async function writeAppTypeLibrary(projectRoot: string, destination: string): Promise<void> {
  const runtimeTypePackages = Object.values(APP_DEPENDENCIES).flatMap((dependency) =>
    "typePackage" in dependency ? [dependency.typePackage] : [],
  );
  const files = ["tsconfig.json", ...getAppSdkTypeSources(projectRoot)];
  for (const packageName of new Set([...runtimeTypePackages, ...COMPILER_TYPE_PACKAGES])) {
    const packageRoot = join("node_modules", packageName);
    files.push(join(packageRoot, "package.json"));

    for await (const path of new Bun.Glob("**/*.d.{ts,cts}").scan({
      cwd: join(projectRoot, packageRoot),
      onlyFiles: true,
    })) {
      files.push(join(packageRoot, path));
    }
  }

  await Promise.all(
    files.map((path) => Bun.write(join(destination, path), Bun.file(join(projectRoot, path)))),
  );
}

/** The standalone compiler carries exactly the local source graph exported by the app SDK. */
function getAppSdkTypeSources(projectRoot: string): string[] {
  const sourceRoot = `${join(projectRoot, "src")}${sep}`;
  return ts
    .createProgram([join(projectRoot, APP_SDK_SOURCE)], readCompilerOptions(projectRoot))
    .getSourceFiles()
    .map((source) => resolve(source.fileName))
    .filter((path) => path.startsWith(sourceRoot))
    .map((path) => relative(projectRoot, path))
    .sort();
}

if (import.meta.main) await buildCli();
