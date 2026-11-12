import { updateSettings } from "./state";

/** Makes this server's id once, so reading the server has no side effects. */
export default async function startWorkspace() {
  await updateSettings(({ serverId }) => ({ serverId: serverId || crypto.randomUUID() }));
}
