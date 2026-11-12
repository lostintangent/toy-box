import { expect, jest, onTestFinished, test } from "bun:test";
import { stopProcess } from "./stopProcess";

/** A child that exits only on the signals it doesn't ignore. */
function createChild(exitsOn: string[]) {
  let exit!: (code: number) => void;
  const signals: string[] = [];
  return {
    signals,
    exited: new Promise<number>((resolve) => (exit = resolve)),
    kill(signal: NodeJS.Signals | number = "SIGTERM") {
      signals.push(String(signal));
      if (exitsOn.includes(String(signal))) exit(0);
    },
  };
}

test("asks a child to exit and resolves once it has", async () => {
  jest.useFakeTimers();
  onTestFinished(() => jest.useRealTimers());
  const child = createChild(["SIGTERM"]);

  await stopProcess(child);
  jest.advanceTimersByTime(2000);
  expect(child.signals).toEqual(["SIGTERM"]);
});

test("kills a child still running 2 seconds after it was asked", async () => {
  jest.useFakeTimers();
  onTestFinished(() => jest.useRealTimers());
  const child = createChild(["SIGKILL"]);

  let stopped = false;
  const stopping = stopProcess(child).then(() => (stopped = true));
  jest.advanceTimersByTime(1999);
  await Promise.resolve();
  expect(stopped).toBe(false);

  jest.advanceTimersByTime(1);
  await stopping;
  expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
});
