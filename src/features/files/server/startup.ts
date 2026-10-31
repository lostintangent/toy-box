import { fileWatcher } from "./watcher";

/** Open file system watchers would keep the server running, so they close with it. */
export default function startFiles() {
  return () => fileWatcher.dispose();
}
