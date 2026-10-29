import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

export const SCREEN_NATIVE_DIRECTORY = "screen-native";
export const SCREEN_HELPER_EXECUTABLE = "ToyBoxScreens";

/** Compiles the helper, unless it was already built from its current source. */
export async function buildScreenNative(destination?: string, benchmark = false): Promise<string> {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      "Screen sharing currently requires an Apple silicon Mac running macOS 14.2 or later.",
    );
  const source = Bun.fileURLToPath(new URL("./macos/", import.meta.url));
  const root = destination ?? resolve(source, "../../../../../.nitro", SCREEN_NATIVE_DIRECTORY);
  const executable = join(root, `${SCREEN_HELPER_EXECUTABLE}${benchmark ? "Benchmark" : ""}`);
  const sources = [join(source, "main.swift"), join(source, "pixels.swift")];
  if (benchmark) sources.push(Bun.fileURLToPath(new URL("../bench/native.swift", import.meta.url)));
  const inputs = [...sources, Bun.fileURLToPath(import.meta.url)];
  const built = Bun.file(executable);
  if (
    (await built.exists()) &&
    inputs.every((input) => Bun.file(input).lastModified < built.lastModified)
  )
    return executable;
  await mkdir(root, { recursive: true });
  await run([
    "xcrun",
    "swiftc",
    "-swift-version",
    "5",
    "-O",
    "-target",
    "arm64-apple-macos14.2",
    "-framework",
    "Cocoa",
    "-framework",
    "ScreenCaptureKit",
    "-framework",
    "ImageIO",
    "-framework",
    "VideoToolbox",
    ...(benchmark ? ["-D", "SCREEN_BENCHMARK"] : []),
    ...sources,
    "-o",
    executable,
  ]);
  return executable;
}

async function run(command: string[]): Promise<void> {
  const process = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  if (exitCode !== 0)
    throw new Error(`Screen native build failed (${command[0]}):\n${stdout}${stderr}`);
}

if (import.meta.main) console.log(await buildScreenNative(process.argv[2]));
