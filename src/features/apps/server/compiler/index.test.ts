import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { sessionFile } from "@files/model";
import { evaluateAppBundle } from "../../components/host/bundle";
import { compileAppDefinition, compileArtifactApp } from "./index";

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
  test("renders with shared libraries and generates scoped Toy Box styles", async () => {
    const bundle = await compileAppDefinition(
      definition(`
        import React, { lazy } from "react";
        import { z } from "zod";
        import { AppAlert } from "@toy-box/sdk";
        import { Kanban } from "lucide-react";
        import * as m from "motion/react-m";

        const Article = m.article;
        function App({ shared }: { shared: boolean }) {
          const [count] = React.useState(z.number().parse(3));
          return <Article className="grid bg-background">
            <Kanban /><AppAlert>{shared ? count : "Duplicated library"}</AppAlert>
          </Article>;
        }

        export default lazy(async () => {
          const loaded = await import("zod");
          return { default: () => <App shared={loaded.z === z} /> };
        });
      `),
    );
    const { Component } = evaluateAppBundle("test-app", bundle);
    const rendered = await renderToReadableStream(createElement(Component));
    await rendered.allReady;

    const html = await new Response(rendered).text();
    expect(html).toContain('<article class="grid bg-background">');
    expect(html).toContain("<svg");
    expect(html).toContain('role="alert"');
    expect(html).toContain(">3</div>");
    expect(bundle.css).toContain('[data-toybox-app="test-app"] .grid');
    expect(bundle.css).toContain("background-color: var(--background)");
  });

  test("typechecks portable SDK capabilities and schema-derived state", async () => {
    await compileAppDefinition(
      definition(`
        import { useApp, useChannels, useChannel, useFile, useWorkspace } from "@toy-box/sdk";
        export default function App() {
          const { state, updateState, actions } = useApp();
          const channels = useChannels();
          const channel = useChannel("channel-id", { mode: "passive" });
          const file = useFile({ kind: "session", sessionId: "session", path: "notes.md" }, "shared");
          const sessions = useWorkspace(workspace => workspace.sessions);
          return <button onClick={async () => {
            await updateState(draft => { draft.count += 1; });
            await channel.postMessage({ content: file.content ?? "" });
            await actions.createSession({ message: { content: "Start", model: { provider: "codex", name: "model" } } });
          }}>{state.count}{channels.length}{sessions[0]?.context?.directory}</button>;
        }
      `),
    );
  });

  test("rejects imports outside the SDK, including type-only and local imports", async () => {
    for (const imported of [
      'import { createPortal } from "react-dom"; void createPortal;',
      'import type { QueryClient } from "@tanstack/react-query"; export type Client = QueryClient;',
      'import type { AppInstance } from "./src/features/apps/model"; export type Instance = AppInstance;',
      'import "unsupported";',
    ]) {
      await expect(
        compileAppDefinition(
          definition(`${imported} export default function App() { return null; }`),
        ),
      ).rejects.toThrow(/Cannot find module/);
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
    ).rejects.toThrow(/no exported member.*RotateCcw/);
  });

  test("requires a component default export", async () => {
    for (const tsx of ["export default 42;", "export const value = 42;"]) {
      await expect(compileAppDefinition(definition(tsx))).rejects.toThrow();
    }
  });

  test("reports source-positioned errors for invalid SDK calls", async () => {
    await expect(
      compileAppDefinition(
        definition(`
          import { useApp } from "@toy-box/sdk";
          export default function TestApp() {
            useApp().actions.openFile({ kind: "session", path: "notes.md" });
            return <main />;
          }
        `),
      ),
    ).rejects.toThrow(/\.tsx\(\d+,\d+\).*sessionId.*missing/s);
  });

  test("rejects state code that disagrees with the definition schema", async () => {
    await expect(
      compileAppDefinition(
        definition(`
          import { useApp } from "@toy-box/sdk";
          export default function TestApp() {
            const { state, updateState } = useApp();
            void updateState((draft) => void (draft.count = "one"));
            return <main>{state.count}</main>;
          }
        `),
      ),
    ).rejects.toThrow(/string.*number/);
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

    await compileAppDefinition(titleDefinition);
    await expect(
      compileAppDefinition({
        ...titleDefinition,
        tsx: titleDefinition.tsx.replace("state.title", "state.count"),
      }),
    ).rejects.toThrow(/count.*does not exist/);
  });

  test("keeps saved capabilities available to installed apps with null state", async () => {
    await compileAppDefinition({
      id: "stateless-app",
      state: { schema: { type: "null" }, default: null },
      tsx: `import { AppSharePicker, useApp } from "@toy-box/sdk";
export default function App() {
  const app = useApp();
  return <AppSharePicker mimeType="text/plain" content={app.state} />;
}`,
    });
  });
});

describe("artifact app compilation", () => {
  test("reuses unchanged source and recompiles edits in the same style scope", async () => {
    const file = sessionFile("session-a", "board.toy");
    const source = "export default function Board() { return <main>Board</main>; }";
    const first = await compileArtifactApp(file, source);
    expect((await compileArtifactApp(file, source)).bundle).toBe(first.bundle);

    await expect(compileArtifactApp(file, "export default 42;")).rejects.toThrow();
    const edited = await compileArtifactApp(file, source.replace(">Board<", ">Updated<"));
    expect(edited.scopeId).toBe(first.scopeId);
    expect(
      renderToStaticMarkup(createElement(evaluateAppBundle("board", edited.bundle).Component)),
    ).toBe("<main>Updated</main>");
  });

  test("gives identical source in different session files independent style scopes", async () => {
    const source =
      'export default function App() { return <main className="bg-background">Ready</main>; }';
    const first = await compileArtifactApp(sessionFile("session-a", "board.toy"), source);
    const second = await compileArtifactApp(sessionFile("session-b", "board.toy"), source);

    expect(first.scopeId).not.toBe(second.scopeId);
    expect(first.bundle.css).toContain(`[data-toybox-app="${first.scopeId}"]`);
    expect(second.bundle.css).toContain(`[data-toybox-app="${second.scopeId}"]`);
  });

  test("exposes portable actions and sharing without a saved instance", async () => {
    await compileArtifactApp(
      sessionFile("session-a", "actions.toy"),
      `import { AppSharePicker, useAppActions } from "@toy-box/sdk";
export default function App() {
  const actions = useAppActions();
  return <>
    <AppSharePicker mimeType="text/plain" content="Artifact" />
    <button onClick={() => void actions.createSession({ message: { content: "Start" } })}>Start</button>
  </>;
}`,
    );
  });

  test("rejects useApp for artifact apps", async () => {
    await expect(
      compileArtifactApp(
        sessionFile("session-a", "saved-only.toy"),
        `import { useApp } from "@toy-box/sdk";
export default function App() {
  return <main>{useApp().title}</main>;
}`,
      ),
    ).rejects.toThrow(/not callable/);
  }, 10_000);
});
