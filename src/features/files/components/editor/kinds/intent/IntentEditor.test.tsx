import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionFile } from "@files/model";
import type { Worker } from "@workers/model";
import type { EditorProps } from "../index";
import { IntentEditor } from "./IntentEditor";
import { serializeIntent, type IntentDefinition } from "./model/index";

const definition: IntentDefinition = {
  title: "Concurrent review",
  sections: [
    {
      id: "first",
      title: "First changes",
      purpose: "Describe the first area.",
      collapsed: false,
      kind: "records",
      view: "cards",
      provenance: "optional",
      subject: "Change",
      fields: [],
      items: [
        {
          id: "first-item",
          subject: "First record",
          change: "new",
          values: {},
        },
      ],
    },
    {
      id: "second",
      title: "Second changes",
      purpose: "Describe the second area.",
      collapsed: false,
      kind: "records",
      view: "cards",
      provenance: "optional",
      subject: "Change",
      fields: [],
      items: [
        {
          id: "second-item",
          subject: "Second record",
          change: "new",
          values: {},
        },
      ],
    },
  ],
  relations: [],
};

const source = sessionFile("toy-box-parent", "review.intent");
const file: EditorProps["file"] = {
  source,
  content: serializeIntent(definition),
  revision: 1,
  isReady: true,
  isLoading: false,
  isSaving: false,
  error: null,
  save: () => {},
  flush: async () => {},
};

test("locks matching section workers and renders records without inline actions", () => {
  const pendingWorkers: Worker[] = [
    intentWorker("worker-refresh", "refresh-section", "first"),
    intentWorker("worker-explain", "explain-item", "first-item"),
  ];
  const queryClient = new QueryClient();
  const markup = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <IntentEditor
        title="Concurrent review"
        mode="edit"
        variant="normal"
        file={file}
        pendingWorkers={pendingWorkers}
        spawnWorker={async () => ({ sessionId: "new-worker" })}
      />
    </QueryClientProvider>,
  );

  expect(buttonTag(markup, "Refresh First changes")).toContain(' disabled=""');
  expect(buttonTag(markup, "Refresh Second changes")).not.toContain(' disabled=""');
  expect(markup).toContain('aria-label="Inspect First record"');
  expect(markup).toContain('aria-label="Inspect Second record"');
  expect(markup).not.toContain('aria-label="Explain item:');
  expect(buttonBeforeText(markup, "Start work")).not.toContain(' disabled=""');
  expect(markup).toContain('data-orientation="vertical"');
  expect(markup).not.toContain("bg-gradient-to-b");
  expect(markup).not.toContain(">Refresh</span>");
  expect(markup).not.toContain("Explore");
  expect(buttonTag(markup, "Show First changes as a table")).toContain('aria-pressed="false"');
  expect(buttonTag(markup, "Show First changes as cards")).toContain('aria-pressed="true"');
  expect(buttonTag(markup, "Show Second changes as a table")).toContain('aria-pressed="false"');
  expect(buttonTag(markup, "Show Second changes as cards")).toContain('aria-pressed="true"');
  expect(buttonTag(markup, "Table of contents")).not.toContain("border");
  expect(buttonTag(markup, "Collapse all")).not.toContain("border");
  expect(buttonTag(markup, "Save checkpoint")).not.toContain("border");
  expect(markup).not.toContain(">Collapse all</button>");
  expect(markup).not.toContain(">Save checkpoint</button>");
  const firstSection = markup.indexOf('id="intent-section-first"');
  const secondSection = markup.indexOf('id="intent-section-second"');
  expect(firstSection).toBeGreaterThan(-1);
  expect(secondSection).toBeGreaterThan(firstSection);
});

test("starts work from a complete delivery sequence and locks the action while pending", () => {
  const sequenced = structuredClone(definition);
  sequenced.sections.push({
    id: "implementation",
    title: "Implementation work",
    purpose: "Deliver both settled changes.",
    collapsed: false,
    kind: "sequence",
    fields: [],
    items: [
      {
        id: "implementation-work",
        title: "Implement the settled changes",
        values: {},
      },
    ],
  });
  sequenced.relations.push(
    {
      id: "first-implemented-by-work",
      from: "first-item",
      to: "implementation-work",
      kind: "implemented-by",
    },
    {
      id: "second-implemented-by-work",
      from: "second-item",
      to: "implementation-work",
      kind: "implemented-by",
    },
  );
  const sequencedFile = { ...file, content: serializeIntent(sequenced) };

  const markup = renderEditor(sequencedFile, []);
  expect(markup).toContain("Start work");
  expect(markup).not.toContain("step in order");
  expect(markup).not.toContain("Every agreed outcome has a home");
  expect(markup).toContain("Implement the settled changes");
  expect(buttonBeforeText(markup, "Start work")).not.toContain(' disabled=""');
  expect(
    buttonBeforeText(
      renderEditor(sequencedFile, [startWorkWorker("worker-start")]),
      "Starting the work",
    ),
  ).toContain(' disabled=""');

  const incomplete = structuredClone(sequenced);
  const firstSection = incomplete.sections[0];
  if (!firstSection || firstSection.kind !== "records") throw new Error("Missing first records");
  firstSection.items.push({
    id: "uncovered-item",
    subject: "Uncovered record",
    change: "new",
    values: {},
  });
  const incompleteMarkup = renderEditor({ ...file, content: serializeIntent(incomplete) }, []);
  expect(buttonBeforeText(incompleteMarkup, "Sequence needs attention")).toContain(' disabled=""');
});

test("defaults mixed disclosure to collapse all and expands only when everything is closed", () => {
  const partiallyCollapsed = structuredClone(definition);
  partiallyCollapsed.sections[1]!.collapsed = true;

  const mixedMarkup = renderEditor({ ...file, content: serializeIntent(partiallyCollapsed) }, []);

  expect(buttonTag(mixedMarkup, "Collapse all")).not.toContain("border");
  expect(buttonBeforeText(mixedMarkup, "Second changes")).toContain('aria-expanded="false"');

  for (const section of partiallyCollapsed.sections) section.collapsed = true;
  const collapsedMarkup = renderEditor(
    { ...file, content: serializeIntent(partiallyCollapsed) },
    [],
  );
  expect(buttonTag(collapsedMarkup, "Expand all")).not.toContain("border");
});

test("uses natural singular copy for one unsettled choice", () => {
  const unsettled = structuredClone(definition);
  unsettled.sections.push({
    id: "choice",
    title: "One choice",
    purpose: "Settle one meaningful alternative.",
    kind: "decisions",
    collapsed: false,
    items: [
      {
        id: "one-choice",
        question: "Which path should we take?",
        options: [
          {
            id: "first-path",
            label: "First path",
            rationale: "It keeps the existing boundary.",
            tradeoff: "It offers less flexibility.",
            adds: [],
            relations: [],
          },
          {
            id: "second-path",
            label: "Second path",
            rationale: "It changes the boundary.",
            tradeoff: "It requires more work.",
            adds: [],
            relations: [],
          },
        ],
        chosen: null,
        status: "open",
        blocking: true,
        dependsOn: [],
        affects: [],
      },
    ],
  });

  expect(renderEditor({ ...file, content: serializeIntent(unsettled) }, [])).toContain(
    "1 choice still needs you",
  );
});

function intentWorker(
  sessionId: string,
  action: "refresh-section" | "explain-item",
  target: string,
): Worker {
  return {
    type: "file",
    sessionId,
    ephemeral: true,
    file: source,
    metadata: { intent: { action, target } },
  };
}

function startWorkWorker(sessionId: string): Worker {
  return {
    type: "file",
    sessionId,
    ephemeral: true,
    file: source,
    metadata: { intent: { action: "start-work" } },
  };
}

function renderEditor(editorFile: EditorProps["file"], pendingWorkers: Worker[]): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <IntentEditor
        title="Concurrent review"
        mode="edit"
        variant="normal"
        file={editorFile}
        pendingWorkers={pendingWorkers}
        spawnWorker={async () => ({ sessionId: "new-worker" })}
      />
    </QueryClientProvider>,
  );
}

function buttonTag(markup: string, accessibleLabel: string): string {
  const labelIndex = markup.indexOf(`aria-label="${accessibleLabel}"`);
  expect(labelIndex).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<button", labelIndex);
  return markup.slice(start, markup.indexOf(">", labelIndex) + 1);
}

function buttonBeforeText(markup: string, text: string): string {
  const textIndex = markup.indexOf(text);
  expect(textIndex).toBeGreaterThan(-1);
  const start = markup.lastIndexOf("<button", textIndex);
  return markup.slice(start, markup.indexOf(">", start) + 1);
}
