import { join, normalize, resolve, sep } from "node:path";
import ts from "app-typescript";
import { APP_DEPENDENCIES } from "@apps/runtime";
import { APP_ICON_NAMES } from "@apps/model/icons";
import type { AppStateDefinition } from "@apps/model";
import { readCompilerOptions } from "./config";

const typeLibraryRoot = Bun.isStandaloneExecutable
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
const appFiles = [appFileName, componentCheckFileName];
const compilerOptions: ts.CompilerOptions = {
  ...readCompilerOptions(typeLibraryRoot),
  // Authored apps have browser globals, not the host's Bun and Vite environment.
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
  const host = createCompilerHost(source.tsx, source.state?.schema ?? null);
  const program = ts.createProgram(appFiles, compilerOptions, host, previousProgram);
  previousProgram = program;
  const diagnostics = ts.sortAndDeduplicateDiagnostics(
    appFiles
      .flatMap((file) => ts.getPreEmitDiagnostics(program, program.getSourceFile(file)!))
      .filter((diagnostic) => diagnostic.file && appFiles.includes(diagnostic.file.fileName)),
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
  host.resolveModuleNameLiterals = (
    imports,
    containingFile,
    redirectedReference,
    options,
    source,
  ) =>
    imports.map((literal) => {
      const moduleName = literal.text;
      if (containingFile === appFileName && !Object.hasOwn(APP_DEPENDENCIES, moduleName)) {
        return { resolvedModule: undefined };
      }
      const knownFile = virtualDependencyFiles.get(moduleName);
      if (knownFile) {
        return {
          resolvedModule: {
            resolvedFileName: knownFile,
            extension: knownFile.endsWith(".d.ts") ? ts.Extension.Dts : ts.Extension.Ts,
            isExternalLibraryImport: moduleName !== "@toy-box/sdk",
          },
        };
      }
      return ts.resolveModuleName(
        moduleName,
        containingFile,
        options,
        host,
        undefined,
        redirectedReference,
        ts.getModeForUsageLocation(source, literal, options),
      );
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
const stateSchema = ${JSON.stringify(stateSchema)} as const;
export declare function useApp(): AppHandle<FromSchema<typeof stateSchema>>;`;
}

function formatDiagnostics(diagnostics: readonly ts.Diagnostic[]): string {
  return ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => typeLibraryRoot,
    getNewLine: () => "\n",
  });
}
