import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, onTestFinished, test } from "bun:test";
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
    expect(
      JSON.parse(await readFile(join(root, "release-board", "app.json"), "utf-8")),
    ).toMatchObject({
      title: "Release board",
      state: { default: { columns: ["todo", "done"], cards: [] } },
    });
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

  test("rejects manifest icons outside the curated app surface", async () => {
    const { registry, root } = await createRegistry();

    await expect(
      installDefinition(registry, "invalid-icon", {
        manifest: manifest({ title: "Invalid icon", icon: "kanban" }),
        tsx: "export default function App() { return null; }",
      }),
    ).rejects.toThrow();
    await expect(readFile(join(root, "invalid-icon", "app.json"), "utf-8")).rejects.toThrow();
  });

  test("defaults omitted colors and rejects invalid colors", async () => {
    const { registry } = await createRegistry();
    const tsx = "export default function App() { return null; }";

    await expect(
      installDefinition(registry, "default-color", {
        manifest: manifest({ title: "Default color" }),
        tsx,
      }),
    ).resolves.toMatchObject({ color: "#71717a" });
    await expect(
      installDefinition(registry, "invalid-color", {
        manifest: manifest({ title: "Invalid color", color: "purple" }),
        tsx,
      }),
    ).rejects.toThrow();
  });

  test("does not write an invalid installation candidate", async () => {
    const { registry, root } = await createRegistry();

    await expect(
      installDefinition(registry, "invalid-gist", {
        manifest: manifest({ title: "Invalid Gist" }),
        tsx: 'import "unsupported"; export default function App() { return null; }',
      }),
    ).rejects.toThrow("Cannot find module 'unsupported'");
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

  test("keeps the last valid source active when registration fails", async () => {
    const { registry, root } = await createRegistry();
    await writeDefinition(root, "dashboard", {
      state: {
        schema: {
          type: "object",
          properties: { count: { type: "number" } },
          required: ["count"],
          additionalProperties: false,
        },
        default: { count: 0 },
      },
      tsx: `import { useApp } from "@toy-box/sdk";
export default function App() {
  const { state } = useApp();
  return <div>{state.count}</div>;
}`,
    });
    const registered = await registry.register("dashboard");

    await writeFile(
      join(root, "dashboard", "app.tsx"),
      `import { useApp } from "@toy-box/sdk";
export default function App() {
  const { updateState } = useApp();
  void updateState((draft) => void (draft.count = "broken"));
  return <div>Broken</div>;
}`,
      "utf-8",
    );

    await expect(registry.register("dashboard")).rejects.toThrow(/string.*number/);
    expect(await registry.get("dashboard")).toMatchObject({
      revision: registered.revision,
      tsx: expect.stringContaining("state.count"),
    });
  }, 10_000);

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
      "Cannot find module 'unsupported'",
    );
  });
});
