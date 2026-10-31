import { $ } from "bun";
import { strict as assert } from "node:assert";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildScreenNative } from "../native/build";
import { SCREEN_CAPTURE, startScreenHelper } from "../server/helper";
import { ScreenRuntime, type ScreenPeer } from "../server/runtime";
import { decodeScreenPacket, type ScreenServerMessage } from "../model/protocol";
import type { ScreenFrame } from "../model";

const args = process.argv.slice(2);
const output = args.find((arg) => !arg.startsWith("--")) ?? "test-results/screen-browser.json";
const compare = args.includes("--compare");
const displayId = args.find((arg) => arg.startsWith("--display="))?.slice("--display=".length);
assert(displayId === undefined || /^display:\d+$/.test(displayId), "Invalid display ID.");
const stallMilliseconds = Number(
  args.find((arg) => arg.startsWith("--stall-ms="))?.slice("--stall-ms=".length) ?? 0,
);
assert(Number.isFinite(stallMilliseconds) && stallMilliseconds >= 0, "Invalid capture stall.");
assert(!stallMilliseconds || compare, "Capture stalls require --compare.");
const session = `screen-bench-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const title = `Toy Box Screen Benchmark ${session}`;

function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const totalMs = values.reduce((total, value) => total + value, 0);
  return {
    calls: values.length,
    totalMs,
    meanMs: values.length ? totalMs / values.length : 0,
    p95Ms: sorted.length ? sorted[Math.ceil(sorted.length * 0.95) - 1]! : 0,
  };
}

async function playwright(args: string[]) {
  const stdout = await $`playwright-cli --session ${session} --raw ${args}`.quiet().text();
  if (/^### Error/m.test(stdout)) throw new Error(stdout);
  return stdout;
}

async function evaluate<T>(code: string): Promise<T> {
  return JSON.parse(await playwright(["run-code", code]));
}

async function run(executable: string, profilePath: string) {
  const screenRuntime = new ScreenRuntime((onEvent, onFailure) =>
    startScreenHelper(onEvent, onFailure, {
      executable,
      env: {
        ...process.env,
        TOY_BOX_SCREEN_BENCHMARK_COMPARE: compare ? "1" : "0",
        TOY_BOX_SCREEN_BENCHMARK_REPORT: profilePath,
        TOY_BOX_SCREEN_BENCHMARK_STALL_MS: String(stallMilliseconds),
      },
    }),
  );
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const errors: string[] = [];
  let screenId = "";
  let latest: ScreenFrame;
  let lastFrameAt = performance.now();
  let state: Extract<ScreenServerMessage, { type: "state" }> | undefined;
  let changed: ((atMs: number) => void) | undefined;
  const count = () => ({ frames: 0, bytes: 0, regions: 0, updatedPixels: 0, maxUpdatedPixels: 0 });
  const fast = { value: count() },
    remote = { value: count() };
  function peer(id: string, counter: typeof fast, delay: number): ScreenPeer {
    return {
      id,
      close() {},
      send(data) {
        if (typeof data === "string") {
          const message = JSON.parse(data) as ScreenServerMessage;
          if (message.type === "state") state = message;
          if (message.type === "state" && message.status === "ended")
            errors.push(message.reason ?? "Screen ended.");
          return;
        }
        const frame = decodeScreenPacket(data).metadata as ScreenFrame;
        counter.value.frames++;
        counter.value.bytes += data.byteLength;
        if (frame.region) counter.value.regions++;
        const updatedPixels = frame.region
          ? frame.region.width * frame.region.height
          : frame.width * frame.height;
        counter.value.updatedPixels += updatedPixels;
        counter.value.maxUpdatedPixels = Math.max(counter.value.maxUpdatedPixels, updatedPixels);
        if (id === "fast") {
          latest = frame;
          lastFrameAt = performance.now();
          changed?.(performance.now());
        }
        const timer = setTimeout(() => {
          timers.delete(timer);
          screenRuntime.acknowledge(screenId, id, frame.sequence);
        }, delay);
        timers.add(timer);
      },
    };
  }
  async function phase(mode: string, seconds: number) {
    await evaluate(
      `async page=>page.evaluate(mode=>{window.screenBenchmark.mode=mode;return true;},${JSON.stringify(mode)})`,
    );
    await Bun.sleep(750);
    fast.value = count();
    remote.value = count();
    const start = performance.now();
    const startMs = Date.now();
    await Bun.sleep(seconds * 1000);
    const endMs = Date.now();
    const duration = (performance.now() - start) / 1000;
    const metrics = ({ value }: typeof fast) => ({
      ...value,
      fps: value.frames / duration,
      averageFrameBytes: value.bytes / Math.max(1, value.frames),
      averageUpdatedPixels: value.updatedPixels / Math.max(1, value.frames),
      megabitsPerSecond: (value.bytes * 8) / duration / 1_000_000,
    });
    return { startMs, endMs, seconds: duration, fast: metrics(fast), remote: metrics(remote) };
  }
  async function capture() {
    try {
      await evaluate(
        `async page=>{await page.goto("about:blank");await page.setContent(${JSON.stringify(await Bun.file(new URL("./scene.html", import.meta.url)).text())});await page.evaluate(title=>document.title=title,${JSON.stringify(title)});await page.bringToFront();return true;}`,
      );
      await playwright(["snapshot"]);
      const source = await evaluate<
        Record<"x" | "y" | "width" | "height" | "scale", number>
      >(`async page=>{
    await page.locator("#scene").click();
    const button=await page.locator("#increment").boundingBox();
    const v=await page.evaluate(()=>({innerHeight,outerHeight,outerWidth,devicePixelRatio}));
    if(v.outerWidth!==1280||v.outerHeight!==800||v.devicePixelRatio!==2)
      throw new Error("Benchmark requires a native 1280x800 window at 2x: "+JSON.stringify(v));
    return {width:v.outerWidth,height:v.outerHeight,scale:v.devicePixelRatio,
      x:(button.x+button.width/2)/v.outerWidth,y:(button.y+button.height/2+v.outerHeight-v.innerHeight)/v.outerHeight};
  }`);
      let screen = (await screenRuntime.list()).windows.find((window) => window.title === title);
      for (let attempt = 0; !screen && attempt < 30; attempt++) {
        await evaluate("async page=>{await page.bringToFront();return true;}");
        await Bun.sleep(100);
        screen = (await screenRuntime.list()).windows.find((window) => window.title === title);
      }
      if (!screen) throw new Error("Benchmark window was not listed.");
      if (displayId) {
        assert(
          (await screenRuntime.list()).displays.some((display) => display.id === displayId),
          `Display ${displayId} was not listed.`,
        );
      }
      screenId = displayId ?? screen.id;
      screenRuntime.attach(screenId, peer("fast", fast, 0));
      screenRuntime.attach(screenId, peer("remote", remote, 50));
      for (let attempt = 0; !state && attempt < 100; attempt++) await Bun.sleep(100);
      assert(state && state.status !== "ended", state?.reason ?? "Native capture did not open.");
      for (let attempt = 0; !latest! && attempt < 100; attempt++) await Bun.sleep(100);
      if (!latest!) throw new Error(`No native frame arrived: ${JSON.stringify(state)}`);
      if (!displayId) assert.deepEqual([latest.width, latest.height], [2560, 1600]);
      const settleDeadline = performance.now() + 10_000;
      while (performance.now() - lastFrameAt < 1000) {
        assert(performance.now() < settleDeadline, "The static source window did not settle.");
        await Bun.sleep(100);
      }
      const idle = await phase("static", 5);
      let input: { clicks: number; samples: number[]; p95Ms: number } | null = null;
      if (!compare && !displayId) {
        await screenRuntime.takeControl(screenId, "fast");
        await Bun.sleep(500);
        const samples: number[] = [];
        for (let i = 0; i < 10; i++) {
          const next = Promise.withResolvers<number>();
          changed = next.resolve;
          const timer = setTimeout(
            () => next.reject(new Error("Native click produced no frame.")),
            2000,
          );
          const start = performance.now();
          try {
            await screenRuntime.input(screenId, "fast", [
              { type: "pointer", x: source.x, y: source.y, phase: "down", button: 0 },
              { type: "pointer", x: source.x, y: source.y, phase: "up", button: 0 },
            ]);
            samples.push((await next.promise) - start);
          } finally {
            clearTimeout(timer);
            changed = undefined;
          }
          await Bun.sleep(80);
        }
        const clicks = await evaluate<number>(
          "async page=>page.evaluate(()=>window.screenBenchmark.clicks)",
        );
        await screenRuntime.releaseControl(screenId, "fast");
        const p95Ms = [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1]!;
        input = { clicks, samples, p95Ms };
      }
      const motion = await phase("motion", 10);
      const spinner = await phase("spinner", 5);
      const localized = await phase("localized", 5);
      const patches = compare ? await phase("patches", 5) : null;
      const report = {
        paired: compare,
        screenId,
        stallMilliseconds,
        budget: stallMilliseconds ? "coverage-stress" : "performance",
        capture: SCREEN_CAPTURE,
        frame: { width: latest.width, height: latest.height },
        source,
        motionByteBudget: (1_280_000 * latest.width * latest.height) / (2560 * 1600),
        idle,
        input,
        motion,
        spinner,
        localized,
        patches,
        errors,
      };
      return report;
    } finally {
      for (const timer of timers) clearTimeout(timer);
      await screenRuntime.dispose();
    }
  }
  const report = await capture();
  const profile = (await Bun.file(profilePath).json()) as {
    paired: boolean;
    stallMilliseconds: number;
    wallMs: number;
    cpuMs: number;
    cpuPercent: number;
    frames: {
      atMs: number;
      width: number;
      height: number;
      continuous: number;
      [stage: string]: number | undefined;
    }[];
  };
  assert.equal(profile.paired, compare);
  assert.equal(profile.stallMilliseconds, stallMilliseconds);
  function timings(phase: { startMs: number; endMs: number }) {
    const frames = profile.frames.filter(
      (frame) => frame.atMs >= phase.startMs && frame.atMs < phase.endMs,
    );
    const stages = [
      "comparisonMs",
      "blockComparisonMs",
      "adaptiveComparisonMs",
      "encodeMs",
      "writeMs",
      "copyMs",
    ] as const;
    return {
      capturedFrames: frames.length,
      matchedFrames: frames.filter((frame) => frame.matched).length,
      boundedFrames: frames.filter(
        (frame) =>
          frame.searchPixels !== undefined && frame.searchPixels < frame.width * frame.height,
      ).length,
      discontinuousFrames: frames.filter((frame) => !frame.continuous).length,
      ...Object.fromEntries(
        stages.map((stage) => [
          stage,
          distribution(
            frames.flatMap((frame) => (frame[stage] === undefined ? [] : [frame[stage]])),
          ),
        ]),
      ),
    };
  }
  return {
    ...report,
    native: {
      cpuMs: profile.cpuMs,
      wallMs: profile.wallMs,
      cpuPercent: profile.cpuPercent,
      matchedFrames: profile.frames.filter((frame) => frame.matched).length,
      mismatches: profile.frames.filter((frame) => frame.mismatch).length,
      frames: profile.frames,
      idle: timings(report.idle),
      motion: timings(report.motion),
      spinner: timings(report.spinner),
      localized: timings(report.localized),
      patches: report.patches ? timings(report.patches) : null,
    },
  };
}

function budgetFailures(report: Awaited<ReturnType<typeof run>>) {
  const { errors, idle, input, motion, spinner, localized, motionByteBudget } = report;
  const failures = errors.map((error) => `Capture failed: ${error}`);
  if (report.native.mismatches) failures.push("Adaptive output differed from the full block scan.");
  if (compare && !report.native.matchedFrames)
    failures.push("No paired comparisons were verified.");
  // Deliberate backpressure tests coverage, not normal delivery budgets.
  if (report.stallMilliseconds) return failures;
  if (idle.fast.frames || idle.remote.frames)
    failures.push(
      `Static frames were sent: fast=${idle.fast.frames}, remote=${idle.remote.frames}.`,
    );
  if (input && (input.clicks !== 10 || input.p95Ms > 250))
    failures.push("Native click-to-frame exceeded its contract.");
  if (motion.fast.regions) failures.push("Motion must exercise full frames.");
  if (motion.fast.fps < 27 || motion.fast.averageFrameBytes > motionByteBudget)
    failures.push("Motion missed its FPS/byte budget.");
  if (motion.remote.fps < 25) failures.push("The 50 ms ACK viewer missed 25 fps.");
  for (const [name, phase] of [
    ["spinner", spinner],
    ["localized", localized],
  ] as const) {
    if (phase.fast.fps < 27 || phase.fast.averageFrameBytes > 10_000)
      failures.push(`The ${name} 32px animation missed its delivery/byte budget.`);
  }
  return failures;
}

const directory = await mkdtemp(join(tmpdir(), "toy-box-screen-bench-"));
let browserOpened = false;
try {
  // A unique executable path avoids interrupting a dev server's existing macOS capture service.
  const executable = await buildScreenNative(directory, true);
  await $`${executable} --verify`.quiet();
  await playwright([
    "--headed",
    "--config",
    Bun.fileURLToPath(new URL("./browser.json", import.meta.url)),
    "open",
    "about:blank",
  ]);
  browserOpened = true;
  const isolatedExecutable = join(directory, "ToyBoxScreens-Capture");
  await copyFile(executable, isolatedExecutable);
  const captured = await run(isolatedExecutable, join(directory, "profile.json"));
  const report = { ...captured, failures: budgetFailures(captured) };
  console.log(
    JSON.stringify(
      { ...report, native: { ...report.native, frames: report.native.frames.length } },
      null,
      2,
    ),
  );
  await Bun.write(output, JSON.stringify({ capture: SCREEN_CAPTURE, runs: [report] }, null, 2));
  assert.equal(report.failures.length, 0, report.failures.join("\n"));
} finally {
  try {
    if (browserOpened) await playwright(["close"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
