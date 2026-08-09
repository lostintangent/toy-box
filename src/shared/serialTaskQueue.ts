/** Runs asynchronous tasks in enqueue order while preserving each task's result. */
export class SerialTaskQueue {
  #tail: Promise<void> = Promise.resolve();
  #latestTask: Promise<unknown> = this.#tail;

  enqueue<Result>(task: () => Promise<Result>): Promise<Result> {
    const result = this.#tail.then(task);
    this.#latestTask = result;
    this.#tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** Waits through the latest task queued at call time and adopts its outcome. */
  waitForPending(): Promise<void> {
    return this.#latestTask.then(() => undefined);
  }
}
