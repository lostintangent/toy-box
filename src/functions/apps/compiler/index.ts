import { APP_REGISTER_GLOBAL, type CompiledAppBundle } from "@/lib/apps/runtime";
import type { AppStateDefinition } from "@/types";
import { APP_DEPENDENCY_SOURCES, unsupportedAppImport } from "./dependencies";
import { compileAppStyles } from "./styles";
import { checkAppTypeScript } from "./typecheck";

export async function compileAppDefinition(source: {
  id: string;
  state: AppStateDefinition;
  tsx: string;
}): Promise<CompiledAppBundle> {
  checkAppTypeScript(source);

  const [code, css] = await Promise.all([bundleAppCode(source), compileAppStyles(source)]);

  return { code, css };
}

async function bundleAppCode(source: { id: string; tsx: string }): Promise<string> {
  const namespace = "toybox-app";
  const runtimeNamespace = "toybox-app-runtime";
  const buildConfig = {
    entrypoints: ["toybox-app:entry"],
    target: "browser",
    format: "iife",
    splitting: false,
    minify: true,
    throw: false,
    reactCompiler: true,
    jsx: {
      runtime: "automatic",
      development: false,
    },
    plugins: [
      {
        name: "toybox-app-component",
        setup(build) {
          build.onResolve({ filter: /^toybox-app:entry$/ }, () => ({
            path: "entry",
            namespace,
          }));
          build.onResolve({ filter: /^toybox-app:component$/ }, () => ({
            path: "component",
            namespace,
          }));
          build.onResolve({ filter: /.*/ }, ({ path }) => {
            if (Object.hasOwn(APP_DEPENDENCY_SOURCES, path)) {
              return { path, namespace: runtimeNamespace };
            }
            throw unsupportedAppImport(path);
          });
          build.onLoad({ filter: /^entry$/, namespace }, () => ({
            loader: "js",
            contents: appEntryModule("toybox-app:component"),
          }));
          build.onLoad({ filter: /^component$/, namespace }, () => ({
            loader: "tsx",
            contents: source.tsx,
          }));
          build.onLoad({ filter: /.*/, namespace: runtimeNamespace }, ({ path }) => ({
            loader: "js",
            contents: APP_DEPENDENCY_SOURCES[path]!,
          }));
        },
      },
    ],
  } satisfies Bun.BuildConfig & { reactCompiler: boolean };
  const result = await Bun.build(buildConfig);

  if (!result.success || !result.outputs[0]) {
    throw new Error(
      `Unable to compile app "${source.id}": ${result.logs.map((log) => log.message).join("\n")}`,
    );
  }

  return result.outputs[0].text();
}

function appEntryModule(componentId: string): string {
  return (
    `import AppComponent from ${JSON.stringify(componentId)};` +
    `globalThis.${APP_REGISTER_GLOBAL}(AppComponent);`
  );
}
