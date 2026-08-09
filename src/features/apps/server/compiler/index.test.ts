import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluateAppBundle } from "../../components/host/bundle";
import { compileAppDefinition } from "./index";

function definition(tsx: string) {
  return {
    id: "test-app",
    state: {
      schema: {
        type: "object" as const,
        properties: { count: { type: "number" as const } },
        required: ["count"],
        additionalProperties: false,
      },
      default: { count: 0 },
    },
    tsx,
  };
}

describe("app compiler", () => {
  test("compiles TSX against the complete React module and public app modules", async () => {
    const bundle = await compileAppDefinition(
      definition(`
        import React, { memo, useCallback, useMemo, useState } from "react";
        import { z } from "zod";
        import {
          AppAlert,
          AppFilePicker,
          AppSessionStatus,
          AppSessionToggle,
          AppSharePicker,
          createId,
          useApp,
          useFile,
          type SessionLaunch,
          type WorkspaceFile,
        } from "@toy-box/sdk";
        import { Kanban } from "lucide-react";

        const Count = memo(function Count({ value }: { value: number }) {
          return <span>{value}</span>;
        });
        const CountSchema = z.number().int().catch(0);

        export default function TestApp() {
          const [count, setCount] = useState(CountSchema.parse(1));
          const id = createId();
          const label = useMemo(() => "React " + React.version, []);
          const increment = useCallback(() => setCount((value) => value + 1), []);
          const [file, setFile] = useState<Extract<WorkspaceFile, { type: "machine" }> | null>(null);
          const activeFile = useFile(
            { type: "session", sessionId: "session", path: "notes.md" },
            "shared",
          );
          const app = useApp();
          const { actions } = app;
          const launch = { message: { content: "Inspect this app." } } satisfies SessionLaunch;
          return (
            <>
              <style>{"[data-toybox-app='test-app'] .meter { accent-color: rebeccapurple; }"}</style>
              <AppFilePicker value={file} extensions={[".md"]} onValueChange={setFile} />
              <AppAlert>Something went wrong.</AppAlert>
              <AppSessionStatus status="running" />
              <AppSessionToggle sessionId="session" />
              <AppSharePicker mimeType="text/plain" content="Hello" />
              <button
                onClick={async () => {
                  const worker = await activeFile.spawnWorker?.({ prompt: "Summarize this file." });
                  if (worker) await actions.waitForSession(worker.sessionId);
                }}
              >
                {activeFile.workers.length}
              </button>
              <button onClick={() => void actions.createSession(launch)}>Launch</button>
              <button onClick={increment}>Increment</button>
              <main className="grid grid-cols-[17rem_1fr] bg-background hover:bg-[#123456]">
                <Kanban />{app.title}{label}{id}<Count value={count} />
              </main>
            </>
          );
        }
      `),
    );

    expect(bundle.code).toContain("__TOYBOX_APP_REGISTER_V1__");
    expect(bundle.code).toContain(".ReactCompilerRuntime");
    expect(bundle.code).toContain(".JsxRuntime");
    expect(bundle.code).toContain(".Zod");
    expect(bundle.code).not.toContain(".JsxDevRuntime");
    expect(bundle.code).not.toContain("@toy-box/sdk");
    expect(bundle.code).toContain("rebeccapurple");
    expect(typeof evaluateAppBundle("test-app", bundle).Component).toBe("function");
    expect(bundle.css).toContain('[data-toybox-app="test-app"] .grid');
    expect(bundle.css).toContain("grid-cols-\\[17rem_1fr\\]");
    expect(bundle.css).toContain("background-color: var(--background)");
    expect(bundle.css).toContain("background-color: #123456");
  }, 20_000);

  test("rejects imports outside the versioned app surface", async () => {
    for (const [moduleName, importedName] of [
      ["@tanstack/react-query", "useQuery"],
      ["@tanstack/store", "Store"],
      ["@tanstack/react-store", "useSelector"],
      ["react-dom", "createPortal"],
    ]) {
      await expect(
        compileAppDefinition(
          definition(`
            import { ${importedName} } from "${moduleName}";
            export default function TestApp() { return <main>{String(${importedName})}</main>; }
          `),
        ),
      ).rejects.toThrow(`Cannot find module '${moduleName}'`);
    }
  });

  test("rejects lucide icons outside the curated runtime surface", async () => {
    await expect(
      compileAppDefinition(
        definition(`
          import { RotateCcw } from "lucide-react";
          export default function TestApp() { return <RotateCcw />; }
        `),
      ),
    ).rejects.toThrow(/\.toybox-app\.tsx\(2,20\).*RotateCcw/);
  });

  test("rejects unsupported imports even when TypeScript would erase them", async () => {
    for (const imported of ['"@tanstack/react-query"', '"../../types"']) {
      await expect(
        compileAppDefinition(
          definition(`
            import type { ModelInfo } from ${imported};
            export default function TestApp() {
              return <main>{String(null as ModelInfo | null)}</main>;
            }
          `),
        ),
      ).rejects.toThrow(/Cannot find module/);
    }
  });

  test("requires a component default export", async () => {
    for (const exported of ["42", "{ value: 1 }"]) {
      await expect(compileAppDefinition(definition(`export default ${exported};`))).rejects.toThrow(
        /not assignable to type 'ComponentType'/,
      );
    }
  });

  test("reports source-positioned TypeScript errors", async () => {
    expect(
      compileAppDefinition(
        definition(`
          export default function TestApp() {
            const count: string = 42;
            return <main>{count.missing()}</main>;
          }
        `),
      ),
    ).rejects.toThrow(/\.toybox-app\.tsx\(3,19\).*number.*string/);
  });

  test("typechecks calls against the public app SDK contract", async () => {
    expect(
      compileAppDefinition(
        definition(`
          import { useApp } from "@toy-box/sdk";
          export default function TestApp() {
            useApp().actions.openFile({ type: "session", path: "notes.md" });
            return <main />;
          }
        `),
      ),
    ).rejects.toThrow(/sessionId.*missing/);
  });

  test("types app state reads and draft updates from the definition schema", async () => {
    const bundle = await compileAppDefinition(
      definition(`
        import { useApp } from "@toy-box/sdk";

        export default function TestApp() {
          const { state, updateState } = useApp();
          return (
            <button onClick={() => updateState((draft) => void (draft.count += 1))}>
              {state.count}
            </button>
          );
        }
      `),
    );

    expect(bundle.code).toContain("__TOYBOX_APP_REGISTER_V1__");
  });

  test("rejects state code that disagrees with the definition schema", async () => {
    await expect(
      compileAppDefinition(
        definition(`
          import { useApp } from "@toy-box/sdk";
          export default function TestApp() {
            const { state, updateState } = useApp();
            void updateState((draft) => void (draft.count = "one"));
            return <main>{state.missing}</main>;
          }
        `),
      ),
    ).rejects.toThrow(/string.*number|missing.*does not exist/);
  });

  test("does not reuse a generated app state type across definitions", async () => {
    await compileAppDefinition(
      definition(`
        import { useApp } from "@toy-box/sdk";
        export default function App() { return <main>{useApp().state.count}</main>; }
      `),
    );

    const titleDefinition = {
      id: "title-app",
      state: {
        schema: {
          type: "object" as const,
          properties: { title: { type: "string" as const } },
          required: ["title"],
          additionalProperties: false,
        },
        default: { title: "Ready" },
      },
      tsx: `
        import { useApp } from "@toy-box/sdk";
        export default function App() { return <main>{useApp().state.title}</main>; }
      `,
    };

    await expect(compileAppDefinition(titleDefinition)).resolves.toMatchObject({
      code: expect.stringContaining("__TOYBOX_APP_REGISTER_V1__"),
    });
  });

  test("renders Bun React Compiler output", async () => {
    const bundle = await compileAppDefinition(
      definition(`
        export default function TestApp() {
          return <main>Compiled</main>;
        }
      `),
    );
    const { Component } = evaluateAppBundle("test-app", bundle);

    expect(bundle.code).toContain(".ReactCompilerRuntime");
    expect(renderToStaticMarkup(createElement(Component))).toBe("<main>Compiled</main>");
  });
});
