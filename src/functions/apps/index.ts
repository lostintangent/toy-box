// Public server-side app lifecycle. Compiler and persistence mechanics remain
// owned by their respective subdirectories.

export {
  consumeAppShare,
  createApp,
  deleteApp,
  getApp,
  getAppDefinitionBundle,
  installApp,
  listAppDefinitions,
  listApps,
  registerApp,
  shareWithApp,
  uninstallApp,
  updateApp,
} from "./lifecycle";
