// Regenerate with: bun src/features/providers/server/codex/protocol/generate.ts
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const methods = {
  initialize: ["InitializeParams", "InitializeResponse"],
  "model/list": ["v2/ModelListParams", "v2/ModelListResponse"],
  "account/read": ["v2/GetAccountParams", "v2/GetAccountResponse"],
  "skills/list": ["v2/SkillsListParams", "v2/SkillsListResponse"],
  "thread/list": ["v2/ThreadListParams", "v2/ThreadListResponse"],
  "thread/start": ["v2/ThreadStartParams", "v2/ThreadStartResponse"],
  "thread/resume": ["v2/ThreadResumeParams", "v2/ThreadResumeResponse"],
  "thread/read": ["v2/ThreadReadParams", "v2/ThreadReadResponse"],
  "thread/turns/list": ["v2/ThreadTurnsListParams", "v2/ThreadTurnsListResponse"],
  "thread/name/set": ["v2/ThreadSetNameParams", "v2/ThreadSetNameResponse"],
  "thread/delete": ["v2/ThreadDeleteParams", "v2/ThreadDeleteResponse"],
  "thread/unsubscribe": ["v2/ThreadUnsubscribeParams", "v2/ThreadUnsubscribeResponse"],
  "thread/revert": ["v2/ThreadRevertParams", "v2/ThreadRevertResponse"],
  "thread/rollback": ["v2/ThreadRollbackParams", "v2/ThreadRollbackResponse"],
  "turn/start": ["v2/TurnStartParams", "v2/TurnStartResponse"],
  "turn/steer": ["v2/TurnSteerParams", "v2/TurnSteerResponse"],
  "turn/interrupt": ["v2/TurnInterruptParams", "v2/TurnInterruptResponse"],
} as const;
const events = [
  "DynamicToolCallParams",
  "DynamicToolCallResponse",
  "ToolRequestUserInputParams",
  "ToolRequestUserInputResponse",
  "ItemCompletedNotification",
  "ThreadStartedNotification",
  "TurnStartedNotification",
  "TurnCompletedNotification",
  "TurnPlanUpdatedNotification",
  "AgentMessageDeltaNotification",
  "ReasoningTextDeltaNotification",
  "ServerRequestResolvedNotification",
  "ThreadNameUpdatedNotification",
];
const directory = await mkdtemp(join(tmpdir(), "toybox-codex-protocol-"));
try {
  const process = Bun.spawn(
    ["codex", "app-server", "generate-ts", "--experimental", "--out", directory],
    { stdout: "ignore", stderr: "inherit" },
  );
  if (await process.exited) throw new Error("Protocol generation failed.");
  const sources = new Map<string, string>();
  async function visit(path: string): Promise<void> {
    if (sources.has(path)) return;
    const source = await readFile(path, "utf8");
    sources.set(path, source);
    for (const [, dependency] of source.matchAll(/import type .* from "([^"]+)";/g)) {
      await visit(resolve(dirname(path), `${dependency}.ts`));
    }
  }
  for (const path of [...Object.values(methods).flat(), ...events.map((name) => `v2/${name}`)])
    await visit(join(directory, `${path}.ts`));
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
  const methodMap = Object.entries(methods)
    .map(
      ([method, [params, result]]) =>
        `  "${method}": { params: ${params.split("/").at(-1)}; result: ${result.split("/").at(-1)} };`,
    )
    .join("\n");
  await Bun.write(
    join(import.meta.dir, "index.ts"),
    `// Generated from ${version.trim()} (experimental app-server schema).\n// OpenAI Codex, Apache-2.0: https://github.com/openai/codex\n// Regenerate using ./generate.ts. Do not edit wire types by hand.\n\n${types.join("\n\n")}\n\nexport type CodexMethods = {\n${methodMap}\n};\n`,
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
