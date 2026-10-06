import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import ts from "app-typescript";
import { readCompilerOptions } from "../../src/features/apps/server/compiler/config";
import { writeAppTypeLibrary } from "./index";

const projectRoot = resolve(Bun.fileURLToPath(new URL("../../", import.meta.url)));

test("packaged types can check an app without the source checkout", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "toy-box-app-types-test-")));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeAppTypeLibrary(projectRoot, root);
  const source = join(root, "app.tsx");
  await Bun.write(
    source,
    `
    import { useChannel, useFile } from "./src/features/apps/sdk";
    import type { FromSchema } from "json-schema-to-ts";
    import { z } from "zod";
    import * as m from "motion/react-m";
    const Article = m.article;
    const state: FromSchema<{ type: "object", properties: { count: { type: "number" } }, required: ["count"] }> = { count: 3 };
    export default function App() {
      const channel = useChannel("channel");
      const file = useFile({ kind: "session", sessionId: "session", path: "notes.md" }, "shared");
      return <Article layout="position">{channel.state?.channel.name}{file.content}{z.number().parse(state.count)}</Article>;
    }
  `,
  );
  const options = { ...readCompilerOptions(root), types: [] };
  const host = ts.createCompilerHost(options);
  host.getCurrentDirectory = () => root;
  host.getDefaultLibLocation = () => join(root, "node_modules/app-typescript/lib");
  const program = ts.createProgram([source], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program, program.getSourceFile(source)!);
  expect(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  ).toEqual([]);
  expect(
    program
      .getSourceFiles()
      .map(({ fileName }) => fileName)
      .filter((file) => !file.startsWith(`${root}${sep}`)),
  ).toEqual([]);
  expect([...new Bun.Glob("node_modules/**/*.{js,mjs,cjs}").scanSync({ cwd: root })]).toEqual([]);
});
