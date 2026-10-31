// Regenerate with: bun src/features/providers/server/codex/protocol/generate.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// The wire methods Toy Box uses. Upstream's request and notification unions supply their types.
const unions = {
  ClientRequest: [
    "initialize",
    "model/list",
    "account/read",
    "account/rateLimits/read",
    "skills/list",
    "thread/list",
    "thread/start",
    "thread/resume",
    "thread/read",
    "thread/turns/list",
    "thread/name/set",
    "thread/delete",
    "thread/unsubscribe",
    "thread/revert",
    "turn/start",
    "turn/steer",
    "turn/interrupt",
  ],
  ServerRequest: ["item/tool/call", "item/tool/requestUserInput"],
  ServerNotification: [
    "thread/started",
    "thread/closed",
    "thread/name/updated",
    "thread/tokenUsage/updated",
    "turn/started",
    "turn/completed",
    "turn/plan/updated",
    "item/started",
    "item/completed",
    "item/agentMessage/delta",
    "item/reasoning/textDelta",
    "item/reasoning/summaryTextDelta",
    "item/reasoning/summaryPartAdded",
    "item/commandExecution/outputDelta",
    "serverRequest/resolved",
  ],
};
const directory = await mkdtemp(join(tmpdir(), "toybox-codex-protocol-"));
try {
  const process = Bun.spawn(
    ["codex", "app-server", "generate-ts", "--experimental", "--out", directory],
    { stdout: "ignore", stderr: "inherit" },
  );
  if (await process.exited) throw new Error("Protocol generation failed.");
  // Each method's params file; a request's result shares its name with Response for Params.
  const maps = await Promise.all(
    Object.entries(unions).map(async ([union, methods]) => {
      const source = await readFile(join(directory, `${union}.ts`), "utf8");
      return methods.map((method) => {
        const params = source.match(
          new RegExp(`"method": "${method}",[^}]*params"?\\??: (\\w+)`),
        )?.[1];
        const path = source.match(
          new RegExp(`import type \\{ ${params} \\} from "\\./(.+)";`),
        )?.[1];
        if (!path) throw new Error(`Codex ${union} has no ${method}.`);
        return {
          method,
          path,
          result: union.endsWith("Request") && path.replace(/Params$/, "Response"),
        };
      });
    }),
  );
  const sources = new Map<string, string>();
  async function visit(path: string): Promise<void> {
    if (sources.has(path)) return;
    const source = await readFile(path, "utf8");
    sources.set(path, source);
    for (const [, dependency] of source.matchAll(/import type .* from "([^"]+)";/g)) {
      await visit(resolve(dirname(path), `${dependency}.ts`));
    }
  }
  for (const { path, result } of maps.flat())
    for (const root of result ? [path, result] : [path]) await visit(join(directory, `${root}.ts`));
  const version = await new Response(Bun.spawn(["codex", "--version"]).stdout).text();
  const counts = new Map<string, number>();
  for (const path of sources.keys())
    counts.set(basename(path, ".ts"), (counts.get(basename(path, ".ts")) ?? 0) + 1);
  const typeName = (path: string) =>
    `${counts.get(basename(path, ".ts"))! > 1 && dirname(path) === directory ? "Legacy" : ""}${basename(path, ".ts")}`;
  const types = [...sources.entries()].map(([path, source]) => {
    const renames = new Map<string, string>([[basename(path, ".ts"), typeName(path)]]);
    for (const [, name, dependency] of source.matchAll(/import type \{ (\w+) \} from "([^"]+)";/g))
      renames.set(name!, typeName(resolve(dirname(path), `${dependency}.ts`)));
    let text = source
      .replace(/^import type .*;\n/gm, "")
      .replace(/^\/\/.*\n/gm, "")
      .replace(/\bnull \| null\b/g, "null")
      .trim();
    for (const [name, replacement] of renames)
      if (name !== replacement) text = text.replace(new RegExp(`\\b${name}\\b`, "g"), replacement);
    return text;
  });
  const [methods, requests, notifications] = maps.map((map) =>
    map
      .map(({ method, path, result }) => {
        const params = typeName(join(directory, `${path}.ts`));
        return `  "${method}": ${result ? `{ params: ${params}; result: ${typeName(join(directory, `${result}.ts`))} }` : params};`;
      })
      .join("\n"),
  );
  const output = join(import.meta.dir, "index.ts");
  await Bun.write(
    output,
    `// Generated from ${version.trim()} (experimental app-server schema).\n// OpenAI Codex, Apache-2.0: https://github.com/openai/codex\n// Regenerate using ./generate.ts. Do not edit wire types by hand.\n/* oxlint-disable typescript/no-redundant-type-constituents -- Upstream unions list known variants beside open fallbacks. */\n\n${types.join("\n\n")}\n\nexport type CodexMethods = {\n${methods}\n};\n\nexport type CodexServerRequests = {\n${requests}\n};\n\nexport type CodexNotifications = {\n${notifications}\n};\n`,
  );
  await Bun.spawn(["bun", "fmt", output]).exited;
} finally {
  await rm(directory, { recursive: true, force: true });
}
