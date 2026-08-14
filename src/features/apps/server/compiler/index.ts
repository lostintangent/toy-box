import { APP_REGISTER_GLOBAL, type CompiledAppBundle } from "@apps/runtime";
import { appComponentSourceSchema, type AppStateDefinition } from "@apps/model";
import type { SessionFile } from "@files/model";
import { workspaceFileId } from "@files/model";
import { sharedMap } from "@/shared/server/processState";
import { APP_DEPENDENCY_SOURCES, unsupportedAppImport } from "./dependencies";
import { compileAppStyles } from "./styles";
import { checkAppTypeScript } from "./typecheck";

const artifactBundles = sharedMap<{
  revision: string;
  bundle: Promise<CompiledAppBundle>;
}>("artifact-app-bundles");

export function compileAppDefinition(source: {
  id: string;
  state: AppStateDefinition;
  tsx: string;
}): Promise<CompiledAppBundle> {
  return compileApp(source);
}

async function compileApp(source: {
  id: string;
  state: AppStateDefinition | null;
  tsx: string;
}): Promise<CompiledAppBundle> {
  checkAppTypeScript(source);

  const [code, css] = await Promise.all([bundleAppCode(source), compileAppStyles(source)]);

  return { code, css };
}

/** Compile one artifact app source, caching only the current content for each file. */
export async function compileArtifactApp(file: SessionFile, source: string) {
  const tsx = appComponentSourceSchema.parse(source);
  const fileId = workspaceFileId(file);
  const scopeId = `artifact-${hash(fileId)}`;
  const revision = hash(tsx);
  const cached = artifactBundles.get(fileId);

  if (cached?.revision === revision) {
    return { scopeId, bundle: await cached.bundle };
  }

  const bundle = compileApp({
    id: scopeId,
    state: null,
    tsx,
  });
  artifactBundles.set(fileId, { revision, bundle });

  try {
    return { scopeId, bundle: await bundle };
  } catch (error) {
    if (artifactBundles.get(fileId)?.bundle === bundle) artifactBundles.delete(fileId);
    throw error;
  }
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

function hash(value: string): string {
  return Bun.CryptoHasher.hash("sha256", value, "hex").slice(0, 24);
}
