import { updateServer } from "./installation";
import { updateSettings } from "./state";
import { getSettings } from "./state/settings";

const UPDATE_INTERVAL_MS = 6 * 60 * 60_000;

/** Makes this server's id once, so reading the server has no side effects. Then installs each new
 *  release at boot and every six hours, and leaves restarting into it to the server's owner. */
export default async function startWorkspace() {
  if (!(await getSettings()).serverId) await updateSettings({ serverId: crypto.randomUUID() });

  // Installs this server can't update, like `bun dev`, refuse without spawning anything.
  const update = () => void updateServer().catch(() => {});
  update();
  const timer = setInterval(update, UPDATE_INTERVAL_MS);
  return () => clearInterval(timer);
}
