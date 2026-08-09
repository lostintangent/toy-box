import { APP_DEPENDENCIES, APP_RUNTIME_GLOBAL } from "@apps/runtime";

export const APP_DEPENDENCY_SOURCES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(APP_DEPENDENCIES).map(([dependency, { runtime }]) => [
    dependency,
    `module.exports = globalThis.${APP_RUNTIME_GLOBAL}.${runtime};`,
  ]),
);

export function unsupportedAppImport(path: string): Error {
  return new Error(
    `Unsupported app import "${path}". Supported modules: ${Object.keys(APP_DEPENDENCIES).join(", ")}.`,
  );
}
