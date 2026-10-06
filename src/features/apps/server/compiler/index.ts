import {
  APP_DEPENDENCIES,
  APP_RUNTIME_PARAMETER,
  type AppDependency,
  type CompiledAppBundle,
} from "@apps/runtime";
import { appComponentSourceSchema, type AppStateDefinition } from "@apps/model";
import type { SessionFile } from "@files/model";
import { workspaceFileId } from "@files/model";
import { compileAppStyles } from "./styles";
import { checkAppTypeScript } from "./typecheck";

const artifactBundles = new Map<string, { revision: string; bundle: Promise<CompiledAppBundle> }>();

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
  const entrypoint = "/toybox-app.tsx";
  const runtimeNamespace = "toybox-app-runtime";
  const buildConfig = {
    entrypoints: [entrypoint],
    files: { [entrypoint]: source.tsx },
    target: "browser",
    format: "cjs",
    minify: true,
    throw: false,
    reactCompiler: true,
    jsx: {
      runtime: "automatic",
      development: false,
    },
    plugins: [
      {
        name: "toybox-app-runtime",
        setup(build) {
          build.onResolve({ filter: /.*/ }, ({ path, kind }) => {
            if (kind === "entry-point-build") return { path, namespace: "file" };
            if (Object.hasOwn(APP_DEPENDENCIES, path)) {
              return { path, namespace: runtimeNamespace };
            }
            throw new Error(
              `Unsupported app import "${path}". Supported modules: ${Object.keys(APP_DEPENDENCIES).join(", ")}.`,
            );
          });
          build.onLoad({ filter: /.*/, namespace: runtimeNamespace }, ({ path }) => ({
            loader: "js",
            contents: `module.exports = ${APP_RUNTIME_PARAMETER}.${APP_DEPENDENCIES[path as AppDependency].runtime};`,
          }));
        },
      },
    ],
  } satisfies Bun.BuildConfig;
  const result = await Bun.build(buildConfig);

  if (!result.success || !result.outputs[0]) {
    throw new Error(
      `Unable to compile app "${source.id}": ${result.logs.map((log) => log.message).join("\n")}`,
    );
  }

  return result.outputs[0].text();
}

function hash(value: string): string {
  return Bun.CryptoHasher.hash("sha256", value, "hex").slice(0, 24);
}
