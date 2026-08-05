import { Store } from "@tanstack/store";
import { Debouncer } from "@tanstack/pacer/debouncer";
import type { JSONType } from "zod";
import type { AppUpdate, AppUpdateResult } from "@/lib/apps/schema";
import type { AppStateUpdater } from "@/lib/apps/sdk";
import { parseAppState } from "@/lib/apps/stateSchema";
import type { AppInstance, AppStateDefinition } from "@/types";

const SAVE_WAIT_MS = 500;

type PendingUpdate = {
  apply(app: AppInstance): AppInstance;
  resolve(): void;
  reject(error: unknown): void;
};

/** One mounted app's reactive state and optimistic, conflict-aware durable writes. */
export class AppStateStore {
  readonly store: Store<AppInstance>;

  readonly #commit: (update: AppUpdate) => Promise<AppUpdateResult>;
  readonly #stateSchema: AppStateDefinition["schema"];
  readonly #pending: PendingUpdate[] = [];
  readonly #save = new Debouncer(() => void this.#drain().catch(() => {}), {
    wait: SAVE_WAIT_MS,
  });
  #confirmed: AppInstance;
  #deferredApp?: AppInstance;
  #draining?: Promise<void>;

  constructor(
    app: AppInstance,
    stateSchema: AppStateDefinition["schema"],
    commit: (update: AppUpdate) => Promise<AppUpdateResult>,
  ) {
    const validApp = { ...app, state: parseAppState(stateSchema, app.state) };
    this.#confirmed = validApp;
    this.store = new Store(validApp);
    this.#commit = commit;
    this.#stateSchema = stateSchema;
  }

  sync(app: AppInstance): void {
    if (app.revision <= this.#confirmed.revision) return;
    if (this.#draining) {
      if (!this.#deferredApp || app.revision > this.#deferredApp.revision) {
        this.#deferredApp = app;
      }
      return;
    }
    this.#confirmed = app;
    try {
      this.store.setState(() => this.#replay(app));
    } catch (error) {
      this.#rejectPending(error);
    }
  }

  updateState<T = JSONType>(updater: AppStateUpdater<T>): Promise<void> {
    const stateSchema = this.#stateSchema;
    return new Promise((resolve, reject) => {
      const pending: PendingUpdate = {
        apply(app) {
          const draft = structuredClone(app.state) as T;
          const replacement = updater(draft);
          const next = parseAppState(stateSchema, replacement === undefined ? draft : replacement);
          return sameJson(next, app.state) ? app : { ...app, state: next };
        },
        resolve,
        reject,
      };

      const current = this.store.state;
      let optimistic: AppInstance;
      try {
        optimistic = pending.apply(current);
      } catch (error) {
        reject(error);
        return;
      }
      if (optimistic === current) {
        resolve();
        return;
      }

      this.#pending.push(pending);
      this.store.setState(() => optimistic);
      this.#save.maybeExecute();
    });
  }

  async flush(): Promise<void> {
    this.#save.cancel();
    while (this.#pending.length > 0 || this.#draining) {
      await this.#drain();
      this.#save.cancel();
    }
  }

  #drain(): Promise<void> {
    if (this.#draining) return this.#draining;
    if (this.#pending.length === 0) return Promise.resolve();
    const draining = this.#commitPending().finally(() => {
      this.#draining = undefined;
      const deferredApp = this.#deferredApp;
      this.#deferredApp = undefined;
      if (deferredApp) this.sync(deferredApp);
      if (this.#pending.length > 0) this.#save.maybeExecute();
    });
    this.#draining = draining;
    return draining;
  }

  async #commitPending(): Promise<void> {
    const batch = this.#pending.slice();
    let conflicts = 0;

    try {
      while (true) {
        const desired = batch.reduce((app, update) => update.apply(app), this.#confirmed);
        const request: AppUpdate = { expectedRevision: this.#confirmed.revision };
        if (!sameJson(desired.state, this.#confirmed.state)) {
          request.state = desired.state;
        }

        if (request.state === undefined) {
          this.#pending.splice(0, batch.length);
          for (const update of batch) update.resolve();
          this.store.setState(() => this.#replay(this.#confirmed));
          break;
        }

        const result = await this.#commit(request);
        if (result.status === "conflict") {
          if (result.app.revision > this.#confirmed.revision) this.#confirmed = result.app;
          this.store.setState(() => this.#replay(this.#confirmed));
          conflicts += 1;
          if (conflicts === 3) {
            throw new Error("The app changed repeatedly while saving. Try the edit again.");
          }
          continue;
        }

        if (result.app.revision >= this.#confirmed.revision) this.#confirmed = result.app;
        this.#pending.splice(0, batch.length);
        for (const update of batch) update.resolve();
        this.store.setState(() => this.#replay(this.#confirmed));
        break;
      }
    } catch (error) {
      this.#rejectPending(error);
      throw error;
    }
  }

  #replay(app: AppInstance): AppInstance {
    return this.#pending.reduce((current, update) => update.apply(current), app);
  }

  #rejectPending(error: unknown): void {
    this.#save.cancel();
    const pending = this.#pending.splice(0);
    this.store.setState(() => this.#confirmed);
    for (const update of pending) update.reject(error);
  }
}

function sameJson(left: JSONType, right: JSONType): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
