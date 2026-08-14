import { join, normalize, resolve, sep } from "node:path";
import ts from "app-typescript";
import { APP_DEPENDENCIES } from "@apps/runtime";
import { APP_ICON_NAMES } from "@apps/model/icons";
import { parseAppStateSchema } from "@apps/model/state";
import type { AppStateDefinition } from "@apps/model";
import { readCompilerOptions } from "./config";

const typeLibraryRoot =
  Reflect.get(Bun, "isStandaloneExecutable") === true
    ? join(import.meta.dir, "app-type-library")
    : resolve(Bun.fileURLToPath(new URL("../../../../../", import.meta.url)));
const typeLibraryNodeModules = join(typeLibraryRoot, "node_modules");
const lucideFileName = join(typeLibraryRoot, ".toybox-lucide.d.ts");
const lucideSource = `import type { ComponentType, SVGProps } from "react";
type Icon = ComponentType<SVGProps<SVGSVGElement>>;
${APP_ICON_NAMES.map((name) => `export declare const ${name}: Icon;`).join("\n")}`;
const appFileName = join(typeLibraryRoot, ".toybox-app.tsx");
const componentCheckFileName = join(typeLibraryRoot, ".toybox-app-check.ts");
const componentCheckSource = `import type { ComponentType } from "react";
import App from "./.toybox-app";
export const component: ComponentType = App;`;
const appSdkFileName = join(typeLibraryRoot, ".toybox-sdk.ts");
const typeScriptLib = join(typeLibraryNodeModules, "app-typescript/lib");
const projectCompilerOptions = readCompilerOptions(typeLibraryRoot);
const compilerOptions: ts.CompilerOptions = {
  baseUrl: typeLibraryRoot,
  paths: projectCompilerOptions.paths,
  target: ts.ScriptTarget.ES2022,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowImportingTsExtensions: true,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  noUnusedLocals: true,
  noUnusedParameters: true,
  noFallthroughCasesInSwitch: true,
  noUncheckedSideEffectImports: true,
  types: [],
};
const virtualDependencyFiles = new Map([
  ["@toy-box/sdk", appSdkFileName],
  ["lucide-react", lucideFileName],
]);

let previousProgram: ts.Program | undefined;
// Package declarations are immutable for one server process. Project and generated
// sources remain uncached so development edits and each app schema stay current.
const typeLibrarySourceFiles = new Map<string, ts.SourceFile>();

export function checkAppTypeScript(source: {
  id: string;
  state: AppStateDefinition | null;
  tsx: string;
}): void {
  const stateSchema = source.state === null ? null : parseAppStateSchema(source.state.schema);
  const host = createCompilerHost(source.tsx, stateSchema);
  const program = ts.createProgram(
    [appFileName, componentCheckFileName],
    compilerOptions,
    host,
    previousProgram,
  );
  previousProgram = program;
  const diagnostics = ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        diagnostic.file?.fileName === appFileName ||
        diagnostic.file?.fileName === componentCheckFileName,
    );
  if (diagnostics.length > 0) {
    throw new Error(`Unable to typecheck app "${source.id}":\n${formatDiagnostics(diagnostics)}`);
  }
}

function createCompilerHost(
  source: string,
  stateSchema: AppStateDefinition["schema"] | null,
): ts.CompilerHost {
  const virtualSources = new Map([
    [appFileName, source],
    [componentCheckFileName, componentCheckSource],
    [appSdkFileName, appSdkSource(stateSchema)],
    [lucideFileName, lucideSource],
  ]);
  const host = ts.createCompilerHost(compilerOptions, true);
  const getSourceFile = host.getSourceFile.bind(host);
  const fileExists = host.fileExists.bind(host);
  const readFile = host.readFile.bind(host);

  host.fileExists = (candidate) => virtualSources.has(candidate) || fileExists(candidate);
  host.readFile = (candidate) => virtualSources.get(candidate) ?? readFile(candidate);
  host.getCurrentDirectory = () => typeLibraryRoot;
  host.getSourceFile = (candidate, languageVersion, onError, shouldCreateNewSourceFile) => {
    const virtualSource = virtualSources.get(candidate);
    if (virtualSource !== undefined) {
      return ts.createSourceFile(
        candidate,
        virtualSource,
        languageVersion,
        true,
        scriptKind(candidate),
      );
    }

    const normalizedCandidate = normalize(candidate);
    const cacheable = normalizedCandidate.startsWith(`${typeLibraryNodeModules}${sep}`);
    if (cacheable) {
      const cached = typeLibrarySourceFiles.get(normalizedCandidate);
      if (cached) return cached;
    }

    const sourceFile = getSourceFile(
      candidate,
      languageVersion,
      onError,
      shouldCreateNewSourceFile,
    );
    if (cacheable && sourceFile) {
      typeLibrarySourceFiles.set(normalizedCandidate, sourceFile);
    }
    return sourceFile;
  };
  host.getDefaultLibLocation = () => typeScriptLib;
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      if (containingFile === appFileName && !Object.hasOwn(APP_DEPENDENCIES, moduleName)) {
        return;
      }
      const knownFile = virtualDependencyFiles.get(moduleName);
      if (knownFile) {
        return {
          resolvedFileName: knownFile,
          extension: extensionFor(knownFile),
          isExternalLibraryImport: moduleName !== "@toy-box/sdk",
        };
      }
      return ts.resolveModuleName(moduleName, containingFile, compilerOptions, host).resolvedModule;
    });
  return host;
}

function appSdkSource(stateSchema: AppStateDefinition["schema"] | null): string {
  const sdkSource = `export * from "./src/features/apps/sdk";`;
  if (stateSchema === null) {
    return `${sdkSource}
export declare const useApp: never;`;
  }
  return `${sdkSource}
import type { AppHandle } from "./src/features/apps/sdk";
import type { FromSchema } from "json-schema-to-ts";
const stateSchema = ${jsonSource(stateSchema)} as const;
export declare function useApp(): AppHandle<FromSchema<typeof stateSchema>>;`;
}

function jsonSource(value: AppStateDefinition["schema"]): string {
  return JSON.stringify(value).replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029");
}

function extensionFor(fileName: string): ts.Extension {
  if (fileName.endsWith(".d.cts")) return ts.Extension.Dcts;
  if (fileName.endsWith(".d.ts")) return ts.Extension.Dts;
  return ts.Extension.Ts;
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => typeLibraryRoot,
    getNewLine: () => "\n",
  });
}
