import { join } from "node:path";
import ts from "app-typescript";

/** Read the project's canonical TypeScript resolution rules without scanning its sources. */
export function readCompilerOptions(projectRoot: string): ts.CompilerOptions {
  const configPath = join(projectRoot, "tsconfig.json");
  const config = ts.readConfigFile(configPath, (path) => ts.sys.readFile(path));
  if (config.error) throw new Error(formatDiagnostic(config.error));

  const converted = ts.convertCompilerOptionsFromJson(
    config.config.compilerOptions ?? {},
    projectRoot,
    configPath,
  );
  if (converted.errors[0]) throw new Error(formatDiagnostic(converted.errors[0]));
  return converted.options;
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
}
