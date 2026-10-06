import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, spyOn, test } from "bun:test";
import {
  AppDefinitionRegistry,
  parseAppDefinitionFiles,
  type AppDefinitionFiles,
} from "./definitions";

const NULL_STATE = { schema: { type: "null" }, default: null } as const;

function objectState(defaultValue: Record<string, unknown>) {
  return { schema: { type: "object" as const }, default: defaultValue };
}

function manifest(value: Record<string, unknown>): string {
  return JSON.stringify({ state: NULL_STATE, ...value });
}

type TestDefinition = {
  title?: string;
  description?: string;
  icon?: string;
  color?: string;
  state?: unknown;
  tsx: string;
};

async function createRegistry(): Promise<{
  registry: AppDefinitionRegistry;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "toy-box-app-definitions-"));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  return { registry: new AppDefinitionRegistry(root), root };
}

async function installDefinition(
  registry: AppDefinitionRegistry,
  id: string,
  files: AppDefinitionFiles,
) {
  return registry.install(id, parseAppDefinitionFiles(files));
}

async function writeDefinition(
  root: string,
  id: string,
  { tsx, title = "Test app", ...manifest }: TestDefinition,
): Promise<void> {
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(
      join(directory, "app.json"),
      `${JSON.stringify({ title, state: NULL_STATE, ...manifest }, null, 2)}\n`,
      "utf-8",
    ),
    writeFile(join(directory, "app.tsx"), tsx, "utf-8"),
  ]);
}

describe("app definition registry", () => {
  test("registers inspectable manifest and TSX files from disk", async () => {
    const { registry, root } = await createRegistry();
    await writeDefinition(root, "release-board", {
      title: "Release board",
      description: "Tracks a release across agent sessions.",
      icon: "Kanban",
      color: "#f59e0b",
      tsx: "export default function ReleaseBoard() { return <main>Ready</main>; }",
      state: objectState({ columns: ["todo", "done"], cards: [] }),
    });

    const registered = await registry.register("release-board");
    const revision = registered.revision;

    expect(registered).toMatchObject({
      id: "release-board",
      title: "Release board",
      icon: "Kanban",
      color: "#f59e0b",
      revision: expect.any(String),
    });
    const current = await registry.get("release-board");
    expect(current).toMatchObject({
      tsx: expect.stringContaining("function ReleaseBoard"),
    });
    expect(current?.revision).toBe(revision);
    const firstBundle = await registry.getBundle("release-board", revision);
    expect(await registry.getBundle("release-board", revision)).toBe(firstBundle);
  });

  test("lists definitions by title rather than filesystem id", async () => {
    const { registry, root } = await createRegistry();
    await Promise.all([
      writeDefinition(root, "first-id", {
        title: "Zulu",
        tsx: "export default function App() { return null; }",
      }),
      writeDefinition(root, "second-id", {
        title: "Alpha",
        tsx: "export default function App() { return null; }",
      }),
    ]);

    expect((await registry.list()).map(({ title }) => title)).toEqual(["Alpha", "Zulu"]);
  });

  test("installs and uninstalls one validated definition directory", async () => {
    const { registry, root } = await createRegistry();
    const manifest = `${JSON.stringify(
      {
        title: "Gist board",
        state: { schema: { type: "array", items: { type: "string" } }, default: [] },
      },
      null,
      2,
    )}\n`;
    const tsx =
      'export default function App() { return <main className="grid-cols-[13rem_1fr]">Ready</main>; }';

    const installed = await installDefinition(registry, "gist-board", { manifest, tsx });

    expect(installed).toMatchObject({
      id: "gist-board",
      title: "Gist board",
      revision: expect.any(String),
    });
    expect(await readFile(join(root, "gist-board", "app.json"), "utf-8")).toBe(manifest);
    expect(await readFile(join(root, "gist-board", "app.tsx"), "utf-8")).toBe(tsx);
    await expect(installDefinition(registry, "gist-board", { manifest, tsx })).rejects.toThrow(
      'App definition "gist-board" is already installed.',
    );

    expect(await registry.uninstall("gist-board")).toBe(true);
    expect(await registry.list()).toEqual([]);
    await expect(readFile(join(root, "gist-board", "app.tsx"), "utf-8")).rejects.toThrow();
    expect(await registry.uninstall("gist-board")).toBe(false);
  });

  test("validates manifest presentation before installation", () => {
    const files = { manifest: manifest({ title: "Board" }), tsx: "export default () => null;" };
    expect(parseAppDefinitionFiles(files).definition.color).toBe("#71717a");
    for (const invalid of [{ icon: "kanban" }, { color: "purple" }]) {
      expect(() =>
        parseAppDefinitionFiles({
          ...files,
          manifest: manifest({ title: "Board", ...invalid }),
        }),
      ).toThrow();
    }
  });

  test("does not write an invalid installation candidate", async () => {
    const { registry, root } = await createRegistry();

    await expect(
      installDefinition(registry, "invalid-gist", {
        manifest: manifest({ title: "Invalid Gist" }),
        tsx: 'import "unsupported"; export default function App() { return null; }',
      }),
    ).rejects.toThrow(/Cannot find module.*unsupported/);
    await expect(readFile(join(root, "invalid-gist", "app.tsx"), "utf-8")).rejects.toThrow();
    expect(await registry.list()).toEqual([]);
  });

  test("keeps direct edits inactive until they are registered", async () => {
    const { registry, root } = await createRegistry();
    await writeDefinition(root, "dashboard", {
      tsx: "export default function App() { return <div>First</div>; }",
    });
    const first = await registry.register("dashboard");

    await writeFile(
      join(root, "dashboard", "app.tsx"),
      "export default function App() { return <div>Second</div>; }",
      "utf-8",
    );

    expect(await registry.get("dashboard")).toMatchObject({
      revision: first.revision,
      tsx: expect.stringContaining("First"),
    });

    const second = await registry.register("dashboard");
    expect(second.revision).not.toBe(first.revision);
    expect(await registry.get("dashboard")).toMatchObject({
      revision: second.revision,
      state: NULL_STATE,
      tsx: expect.stringContaining("Second"),
    });
  });

  test("keeps the last valid source and bundle active when registration fails", async () => {
    const { registry, root } = await createRegistry();
    const tsx = "export default function App() { return <main>Ready</main>; }";
    await writeDefinition(root, "dashboard", { tsx });
    const registered = await registry.register("dashboard");
    const bundle = await registry.getBundle("dashboard", registered.revision);

    await writeFile(join(root, "dashboard", "app.tsx"), "export default 42;", "utf-8");
    await expect(registry.register("dashboard")).rejects.toThrow();
    expect(await registry.get("dashboard")).toMatchObject({ revision: registered.revision, tsx });
    expect(await registry.getBundle("dashboard", registered.revision)).toBe(bundle);
  });

  test("discovers definitions without compiling their bundles", async () => {
    const { registry, root } = await createRegistry();
    await writeDefinition(root, "valid", {
      tsx: "export default function App() { return null; }",
    });
    await writeDefinition(root, "invalid", {
      tsx: 'import "unsupported"; export default function App() { return null; }',
    });
    expect((await registry.list()).map(({ id }) => id).sort()).toEqual(["invalid", "valid"]);
    const invalid = await registry.get("invalid");
    await expect(registry.getBundle("invalid", invalid!.revision)).rejects.toThrow(
      /Cannot find module.*unsupported/,
    );
  });

  test("shares concurrent lazy bundle loads for one definition", async () => {
    const { registry, root } = await createRegistry();
    await writeDefinition(root, "dashboard", {
      tsx: "export default function App() { return <main>Ready</main>; }",
    });
    const definition = await registry.get("dashboard");

    const [first, second] = await Promise.all([
      registry.getBundle("dashboard", definition!.revision),
      registry.getBundle("dashboard", definition!.revision),
    ]);

    expect(second).toBe(first);
    expect(await registry.getBundle("dashboard", definition!.revision)).toBe(first);
  });

  test("retries a failed lazy bundle load without changing the definition", async () => {
    const { registry, root } = await createRegistry();
    await writeDefinition(root, "dashboard", {
      tsx: "export default function App() { return <main>Ready</main>; }",
    });
    const definition = await registry.get("dashboard");
    const compiler = await import("./compiler");
    const compile = spyOn(compiler, "compileAppDefinition").mockRejectedValueOnce(
      new Error("Transient compilation failure."),
    );
    onTestFinished(() => compile.mockRestore());

    await expect(registry.getBundle("dashboard", definition!.revision)).rejects.toThrow(
      "Transient compilation failure.",
    );
    const bundle = await registry.getBundle("dashboard", definition!.revision);

    expect(bundle.code).toContain("Ready");
    expect(await registry.getBundle("dashboard", definition!.revision)).toBe(bundle);
    expect(compile).toHaveBeenCalledTimes(2);
  });
});
