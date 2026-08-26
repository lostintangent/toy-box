import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { sessionFile } from "@files/model";
import type { Worker } from "@workers/model";
import type { EditorProps } from "../index";
import { IntentEditor, intentWorkerPrompt } from "./IntentEditor";
import { serializeIntent, type IntentDocument } from "./model/index";

const document: IntentDocument = {
  title: "Concurrent review",
  sections: [
    {
      id: "first",
      title: "First changes",
      purpose: "Describe the first area.",
      collapsed: false,
      kind: "records",
      view: "cards",
      sourcePolicy: "optional",
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
      sourcePolicy: "optional",
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
};

const source = sessionFile("toy-box-parent", "review.intent");
const file: EditorProps["file"] = {
  source,
  content: serializeIntent(document),
  revision: 1,
  isReady: true,
  isLoading: false,
  isSaving: false,
  error: null,
  save: () => {},
  flush: async () => {},
};

test("routes focused edits, plan execution, and outcome review to their owning skills", () => {
  expect(intentWorkerPrompt({ action: "regenerate-section", sectionId: "first" })).toContain(
    "`create-toy-box-intent`",
  );
  expect(intentWorkerPrompt({ action: "investigate-question", questionId: "open" })).toContain(
    "`create-toy-box-intent`",
  );
  expect(intentWorkerPrompt({ action: "explain-record", recordId: "first-item" })).toContain(
    "`create-toy-box-intent`",
  );
  expect(intentWorkerPrompt({ action: "execute-plan" })).toContain("`execute-toy-box-intent`");
  expect(intentWorkerPrompt({ action: "review-outcome" })).toContain("post-execution workflow");
});

test("shows pending section work and keeps record actions contextual", () => {
  const pendingWorkers: Worker[] = [
    intentWorker("worker-refresh", "regenerate-section", "first"),
    intentWorker("worker-explain", "explain-record", "first-item"),
  ];
  const markup = renderEditor(file, pendingWorkers);

  expect(buttonTag(markup, "Actions for First changes")).toContain('aria-busy="true"');
  expect(buttonTag(markup, "Actions for Second changes")).not.toContain("aria-busy");
  expect(markup).toContain('aria-label="Inspect First record"');
  expect(markup).toContain('aria-label="Inspect Second record"');
  expect(markup).not.toContain('aria-label="Explain record:');
  expect(markup).not.toContain('aria-label="Execute plan"');
  expect(buttonTag(markup, "Show First changes as a table")).toContain('aria-pressed="false"');
  expect(buttonTag(markup, "Show First changes as cards")).toContain('aria-pressed="true"');
  expect(buttonTag(markup, "Show Second changes as a table")).toContain('aria-pressed="false"');
  expect(buttonTag(markup, "Show Second changes as cards")).toContain('aria-pressed="true"');
  const firstSection = markup.indexOf('id="intent-section-first"');
  const secondSection = markup.indexOf('id="intent-section-second"');
  expect(firstSection).toBeGreaterThan(-1);
  expect(secondSection).toBeGreaterThan(firstSection);
});

test("executes, resumes, and completes a plan with icon-only status states", () => {
  const planned = structuredClone(document);
  planned.sections.push({
    id: "implementation",
    title: "Execution plan",
    purpose: "Execute both settled changes.",
    collapsed: false,
    kind: "plan",
    fields: [],
    steps: [
      {
        id: "implementation-step",
        title: "Implement the settled changes",
        doneWhen: "Both settled changes are implemented and verified.",
        implements: ["first-item", "second-item"],
        values: {},
      },
    ],
  });
  const plannedFile = { ...file, content: serializeIntent(planned) };

  const markup = renderEditor(plannedFile, []);
  expect(markup).toContain("Implement the settled changes");
  expect(buttonTag(markup, "Execute plan")).not.toContain(' disabled=""');
  const runningMarkup = renderEditor(plannedFile, [executePlanWorker("worker-start")]);
  expect(buttonTag(runningMarkup, "Plan execution in progress")).toContain(' disabled=""');
  expect(runningMarkup).toContain("animate-spin");

  const resumed = structuredClone(planned);
  const resumedPlan = resumed.sections.find((section) => section.id === "implementation");
  if (!resumedPlan || resumedPlan.kind !== "plan" || !("steps" in resumedPlan)) {
    throw new Error("Missing execution plan");
  }
  resumedPlan.steps[0]!.status = "in-progress";
  const resumedMarkup = renderEditor({ ...file, content: serializeIntent(resumed) }, []);
  expect(buttonTag(resumedMarkup, "Resume execution")).not.toContain(' disabled=""');
  expect(resumedMarkup).toContain('aria-label="Step 1 in progress"');
  expect(resumedMarkup).toContain("In progress");

  resumedPlan.steps[0]!.status = "complete";
  const completedMarkup = renderEditor({ ...file, content: serializeIntent(resumed) }, []);
  expect(completedMarkup).toContain('role="img" aria-label="Plan complete"');
  expect(completedMarkup).toContain('aria-label="Step 1 complete"');
  expect(completedMarkup).toContain(
    'role="img" aria-label="Implement the settled changes complete"',
  );
  expect(completedMarkup).not.toContain(">Complete<");
  expect(completedMarkup).not.toMatch(/<button[^>]*aria-label="Plan complete"/);
  expect(buttonTag(completedMarkup, "Review outcome")).not.toContain(' disabled=""');

  const reviewingMarkup = renderEditor({ ...file, content: serializeIntent(resumed) }, [
    reviewOutcomeWorker("worker-review"),
  ]);
  expect(buttonTag(reviewingMarkup, "Outcome review in progress")).toContain(' disabled=""');
  expect(reviewingMarkup).toContain("animate-spin");

  const incomplete = structuredClone(planned);
  const firstSection = incomplete.sections[0];
  if (!firstSection || firstSection.kind !== "records") throw new Error("Missing first records");
  firstSection.items.push({
    id: "unplanned-item",
    subject: "Unplanned record",
    change: "new",
    values: {},
  });
  const incompleteMarkup = renderEditor({ ...file, content: serializeIntent(incomplete) }, []);
  expect(buttonTag(incompleteMarkup, "Plan needs attention")).toContain(' disabled=""');
  expect(incompleteMarkup).not.toContain('aria-label="Review outcome"');
});

test("combines multiple plan sections into one ordered plan", () => {
  const planned = structuredClone(document);
  planned.sections.push(
    {
      id: "foundation-plan",
      title: "Foundation plan",
      purpose: "Land the first change before integration.",
      collapsed: false,
      kind: "plan",
      fields: [],
      steps: [
        {
          id: "foundation-step",
          title: "Land the foundation",
          doneWhen: "The first change is implemented and verified.",
          status: "complete",
          implements: ["first-item"],
          values: {},
        },
      ],
    },
    {
      id: "integration-plan",
      title: "Integration plan",
      purpose: "Land the second change after the foundation.",
      collapsed: false,
      kind: "plan",
      fields: [],
      steps: [
        {
          id: "integration-step",
          title: "Integrate the second change",
          doneWhen: "The second change is implemented and verified.",
          implements: ["second-item"],
          values: {},
        },
      ],
    },
  );

  const markup = renderEditor({ ...file, content: serializeIntent(planned) }, []);
  expect(buttonTag(markup, "Resume execution")).not.toContain(' disabled=""');
  expect(markup).toContain("Land the foundation");
  expect(markup).toContain("Integrate the second change");
  expect(markup.indexOf('id="intent-section-foundation-plan"')).toBeLessThan(
    markup.indexOf('id="intent-section-integration-plan"'),
  );

  const reviewingMarkup = renderEditor({ ...file, content: serializeIntent(planned) }, [
    reviewOutcomeWorker("worker-review-follow-up"),
  ]);
  expect(buttonTag(reviewingMarkup, "Outcome review in progress")).toContain(' disabled=""');
  expect(reviewingMarkup).not.toContain('aria-label="Resume execution"');
  expect(reviewingMarkup).toContain("animate-spin");

  const secondSection = planned.sections.find((section) => section.id === "second");
  if (!secondSection || secondSection.kind !== "records") throw new Error("Missing second records");
  secondSection.items.push({
    id: "unplanned-item",
    subject: "Unplanned change",
    change: "new",
    values: {},
  });
  const incompleteMarkup = renderEditor({ ...file, content: serializeIntent(planned) }, []);
  expect(buttonTag(incompleteMarkup, "Plan needs attention")).toContain(' disabled=""');
  expect(incompleteMarkup.match(/Still needs a plan step/g)).toHaveLength(1);
});

test("renders only the active reference-only document tab", () => {
  const tabbed = structuredClone(document);
  tabbed.tabs = [
    { title: "Intent", sections: ["first"] },
    { title: "Execution results", sections: ["second"] },
  ];

  const markup = renderEditor({ ...file, content: serializeIntent(tabbed) }, []);
  expect(buttonTag(markup, "Intent tab: Intent")).not.toContain(' disabled=""');
  expect(markup).toContain('id="intent-section-first"');
  expect(markup).not.toContain('id="intent-section-second"');
});

test("defaults mixed disclosure to collapse all and expands only when everything is closed", () => {
  const partiallyCollapsed = structuredClone(document);
  partiallyCollapsed.sections[1]!.collapsed = true;

  const mixedMarkup = renderEditor({ ...file, content: serializeIntent(partiallyCollapsed) }, []);

  expect(mixedMarkup).toContain('aria-label="Collapse all"');
  expect(buttonBeforeText(mixedMarkup, "Second changes")).toContain('aria-expanded="false"');

  for (const section of partiallyCollapsed.sections) section.collapsed = true;
  const collapsedMarkup = renderEditor(
    { ...file, content: serializeIntent(partiallyCollapsed) },
    [],
  );
  expect(collapsedMarkup).toContain('aria-label="Expand all"');
});

test("uses natural singular copy for one unsettled choice", () => {
  const unsettled = structuredClone(document);
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
          },
          {
            id: "second-path",
            label: "Second path",
            rationale: "It changes the boundary.",
            tradeoff: "It requires more work.",
            adds: [],
          },
        ],
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
  action: "regenerate-section" | "explain-record",
  target: string,
): Worker {
  if (action === "regenerate-section") {
    return {
      type: "file",
      sessionId,
      ephemeral: true,
      file: source,
      metadata: { intent: { action, sectionId: target } },
    };
  }
  return {
    type: "file",
    sessionId,
    ephemeral: true,
    file: source,
    metadata: { intent: { action, recordId: target } },
  };
}

function executePlanWorker(sessionId: string): Worker {
  return {
    type: "file",
    sessionId,
    ephemeral: true,
    file: source,
    metadata: { intent: { action: "execute-plan" } },
  };
}

function reviewOutcomeWorker(sessionId: string): Worker {
  return {
    type: "file",
    sessionId,
    ephemeral: true,
    file: source,
    metadata: { intent: { action: "review-outcome" } },
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
