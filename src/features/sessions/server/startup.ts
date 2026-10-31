import { fileWatcher } from "@files/server/watcher";
import { subscribeWorkspaceEvents } from "@workspace/server/events";
import { getSettings } from "@workspace/server/state/settings";
import { refreshSessionArtifacts } from "./runtime";
import { retainSessionSnapshots } from "./state/snapshots";

/** Keep artifacts current, and keep pinned sessions' snapshots warm as durable interest. */
export default async function startSessions(): Promise<VoidFunction> {
  const stopObserving = fileWatcher.observeArtifacts(refreshSessionArtifacts);
  const unsubscribe = subscribeWorkspaceEvents((event) => {
    if (event.type === "settings.changed") {
      void retainSessionSnapshots(event.settings.pinnedSessionIds);
    }
  });
  void retainSessionSnapshots((await getSettings()).pinnedSessionIds);
  return () => {
    unsubscribe();
    stopObserving();
  };
}
