/** Whether a server has a restart pending: a release is installed that it doesn't run yet. An
 *  install no package manager owns has no installed release, so it never does. */
export function isRestartPending(server: { version: string; installedVersion: string | null }) {
  return server.installedVersion != null && server.installedVersion !== server.version;
}
