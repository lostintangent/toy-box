import { allDecisions, findRecordsSection } from "./query/reading";
import {
  parseIntent,
  type FlowExhibit,
  type IntentDocument,
  type PlanSection,
  type RecordsSection,
} from "./schema";

/**
 * Shared Intent fixtures: one exploratory document covering every section
 * primitive, its exhibit and plan variants, and the lookups tests use to
 * reach an authored section without restating the document.
 */

export function fixtureInput() {
  return {
    title: "Declare shared tool-call bodies",
    sections: [
      {
        id: "overview",
        title: "Change narrative",
        purpose: "Explain the user-facing and architectural direction.",
        kind: "markdown",
        body: "Ordinary tool calls converge on shared presentation while genuine exceptions remain explicit.",
      },
      {
        id: "concepts",
        title: "Concepts",
        purpose: "Name the values that participate in tool rendering.",
        kind: "records",
        view: "cards",
        sourcePolicy: "code",
        subject: "Concept",
        fields: [{ id: "role", label: "Role", kind: "text" }],
        items: [
          {
            id: "tool-call",
            subject: "ToolCall",
            change: "existing",
            values: { role: "the canonical transcript fact" },
            source: "model.ts#ToolCall",
          },
          {
            id: "block",
            subject: "Block",
            change: "new",
            values: { role: "one declared unit of body content" },
          },
        ],
      },
      {
        id: "invariants",
        title: "Invariants",
        purpose: "Keep structural boundaries visible.",
        kind: "records",
        view: "cards",
        sourcePolicy: "code",
        subject: "Invariant",
        fields: [],
        items: [
          {
            id: "unknown-fallback",
            subject: "Unknown tools continue rendering through a fallback.",
            change: "preserved",
            values: {},
            source: "DefaultToolCall.tsx#DefaultToolCall",
          },
        ],
      },
      {
        id: "tool-corpus",
        title: "Tool corpus",
        purpose: "Compare representative tool presentation through a finite vocabulary.",
        kind: "records",
        view: "table",
        sourcePolicy: "code",
        subject: "Tool",
        fields: [
          {
            id: "shape",
            label: "Shape",
            kind: "choice",
            cardinality: "one",
            options: [
              { id: "multi", label: "Multi" },
              { id: "declared", label: "Declared" },
            ],
          },
          {
            id: "content",
            label: "Block kinds",
            kind: "choice",
            cardinality: "many",
            options: [
              { id: "code", label: "Code" },
              { id: "text", label: "Text" },
              {
                id: "shared",
                label: "Shared blocks",
                description: "Content interpreted through the shared block vocabulary.",
              },
            ],
          },
        ],
        items: [
          {
            id: "bash",
            subject: "bash",
            change: "existing",
            values: { shape: "multi", content: ["code", "text"] },
            source: "BashToolCall.tsx#BashToolCall",
          },
          {
            id: "ordinary-tools",
            subject: "ordinary tools",
            change: "modified",
            values: { shape: "declared", content: ["shared"] },
            source: "ToolCallMessage.tsx#ToolCallMessage",
          },
        ],
      },
      {
        id: "rendering-ownership",
        title: "Rendering ownership",
        purpose: "Show where presentation policy lives.",
        kind: "records",
        view: "cards",
        sourcePolicy: "code",
        subject: "Surface",
        fields: [{ id: "owner", label: "Owner", kind: "text" }],
        items: [
          {
            id: "fallback-owner",
            subject: "unknown tools",
            change: "preserved",
            values: { owner: "generic fallback" },
            source: "DefaultToolCall.tsx#DefaultToolCall",
          },
        ],
      },
      {
        id: "shared-rendering-flow-section",
        title: "Follow the shared rendering path",
        purpose: "Trace ordinary tools into the body shape while keeping the fallback visible.",
        kind: "exhibits",
        sourcePolicy: "optional",
        items: [sharedRenderingFlow()],
      },
      {
        id: "questions",
        title: "Open questions",
        purpose: "Resolve feasibility facts before recording dependent choices.",
        kind: "questions",
        items: [
          {
            id: "diff-capability",
            question: "Can the shared renderer preserve syntax-aware diffs?",
            answerMethod: "investigate-code",
            impact: "The answer determines whether a shared diff block is viable.",
            affects: ["ordinary-tools"],
          },
        ],
      },
      {
        id: "decisions",
        title: "Design decisions",
        purpose: "Record the human choice for structurally distinct rendering.",
        kind: "decisions",
        items: [
          {
            id: "diff-treatment",
            question: "Is a diff ordinary content or a structural exception?",
            options: [
              {
                id: "shared",
                label: "Diff is shared content",
                adds: [
                  {
                    sectionId: "rendering-ownership",
                    id: "shared-diff",
                    subject: "edit results",
                    change: "modified",
                    values: { owner: "shared diff block" },
                    source: "FileDiffToolCall.tsx#FileDiffToolCall",
                  },
                ],
                relationships: [
                  {
                    id: "ordinary-tools-use-shared-diff",
                    from: "ordinary-tools",
                    to: "shared-diff",
                    kind: "realized-by",
                  },
                ],
              },
              {
                id: "exception",
                label: "Diff remains an exception",
                tradeoff: "Rendering policy stays distributed.",
                adds: [
                  {
                    sectionId: "rendering-ownership",
                    id: "bespoke-diff",
                    subject: "edit results",
                    change: "preserved",
                    values: { owner: "bespoke diff renderer" },
                    source: "FileDiffToolCall.tsx#FileDiffToolCall",
                  },
                ],
              },
              {
                id: "defer",
                label: "Defer diff unification",
                rationale: "The decision itself remains part of the settled spec.",
                adds: [],
              },
            ],
            dependsOn: ["diff-capability"],
            affects: ["ordinary-tools"],
          },
        ],
      },
      {
        id: "non-goals",
        title: "Non-goals",
        purpose: "Close plausible adjacent scope.",
        kind: "list",
        style: "bullet",
        items: ["Changing which tool calls appear in the transcript."],
      },
    ],
  };
}

export function parse(value: unknown) {
  return parseIntent(JSON.stringify(value));
}

export function fixture(): IntentDocument {
  const parsed = parse(fixtureInput());
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function groundedFixture(): IntentDocument {
  const document = fixture();
  document.sections.unshift({
    id: "research-findings",
    title: "What the code says",
    purpose: "Preserve the facts that materially shape the spec.",
    collapsed: false,
    kind: "findings",
    sourcePolicy: "code",
    items: [
      {
        id: "finding-shared-owner",
        statement: "ToolCallMessage already owns the common tool-call frame and lifecycle.",
        whyItMatters:
          "Shared bodies can reuse that ownership instead of introducing a second frame.",
        sources: ["ToolCallMessage.tsx#ToolCallMessage"],
        exhibit: {
          id: "current-rendering-ownership",
          title: "Current rendering ownership",
          kind: "tree",
          type: "domain",
          change: "existing",
          source: "ToolCallMessage.tsx#ToolCallMessage",
          roots: [
            {
              name: "ToolCallMessage",
              children: [{ name: "Frame" }, { name: "Status" }, { name: "Actions" }],
            },
          ],
        },
      },
      {
        id: "finding-fallback",
        statement: "Unknown tools already render through one generic fallback.",
        sources: ["DefaultToolCall.tsx#DefaultToolCall"],
      },
    ],
  });

  recordsSection(document, "tool-corpus").items.find(
    (item) => item.id === "ordinary-tools",
  )!.basedOn = ["finding-shared-owner"];
  flowExhibit(document, "shared-rendering-flow").basedOn = ["finding-shared-owner"];
  document.sections.find((section) => section.kind === "decisions")!.items[0]!.basedOn = [
    "finding-fallback",
  ];

  const parsed = parse(document);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function exhibitsFixture(): IntentDocument {
  const input = fixtureInput();
  const parsed = parse({
    ...input,
    sections: [
      ...input.sections,
      {
        id: "technical-definitions",
        title: "Technical definitions",
        purpose: "Keep declared contracts beside the outcomes they realize.",
        kind: "exhibits",
        sourcePolicy: "code",
        items: [
          {
            id: "body-declaration",
            title: "Declared body shape",
            kind: "pseudocode",
            change: "new",
            description: "The smallest declaration ordinary tools provide.",
            language: "typescript",
            content: 'const body = {\n  kind: "text",\n  value: result,\n};\n',
          },
          {
            id: "renderer-rollout",
            title: "Renderer comparison contract",
            kind: "pseudocode",
            change: "modified",
            description: "Compare each migrated renderer without prescribing production source.",
            source: "ToolCallMessage.tsx#ToolCallMessage",
            language: "typescript",
            content:
              "const shared = renderToolBody(call);\nassertEquivalent(shared, renderBespokeBody(call));",
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function plannedFixture(): IntentDocument {
  const parsed = parse({
    title: "Execute a settled change",
    sections: [
      {
        id: "behavior",
        title: "Behavior",
        purpose: "Define the changed outcome.",
        kind: "records",
        view: "cards",
        sourcePolicy: "optional",
        subject: "Outcome",
        fields: [{ id: "result", label: "Result", kind: "text" }],
        items: [
          {
            id: "changed-behavior",
            subject: "Changed behavior",
            change: "modified",
            values: { result: "Uses the new durable boundary." },
          },
        ],
      },
      {
        id: "implementation",
        title: "Execution plan",
        purpose: "Decompose the settled spec into independently verifiable steps.",
        kind: "plan",
        fields: [],
        steps: [
          {
            id: "foundation-step",
            title: "Build the foundation",
            doneWhen: "The durable API is tested.",
            implements: ["durable-result"],
            values: {},
          },
          {
            id: "integration-step",
            title: "Integrate the behavior",
            doneWhen: "The runtime uses the durable API.",
            implements: ["changed-behavior"],
            values: {},
          },
        ],
      },
      {
        id: "decisions",
        title: "Decision",
        purpose: "Record the settled policy.",
        kind: "decisions",
        items: [
          {
            id: "durability-policy",
            question: "Which durability policy applies?",
            options: [
              {
                id: "durable",
                label: "Use durable state",
                adds: [
                  {
                    sectionId: "behavior",
                    id: "durable-result",
                    subject: "Durable result",
                    change: "new",
                    values: { result: "Survives a restart." },
                  },
                ],
                relationships: [
                  {
                    id: "changed-causes-durable",
                    from: "changed-behavior",
                    to: "durable-result",
                    kind: "causes",
                  },
                ],
              },
              {
                id: "ephemeral",
                label: "Keep ephemeral state",
                adds: [
                  {
                    sectionId: "behavior",
                    id: "ephemeral-result",
                    subject: "Ephemeral result",
                    change: "preserved",
                    values: { result: "Resets on restart." },
                  },
                ],
              },
            ],
            choice: { optionId: "durable", status: "decided" },
            dependsOn: [],
          },
        ],
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function optionExhibitsFixture(): IntentDocument {
  const document = plannedFixture();
  const decision = allDecisions(document)[0];
  if (!decision) throw new Error("Missing decision fixture");
  delete decision.choice;

  decision.options[0]!.exhibit = {
    id: "durable-state-preview",
    title: "Durable state preview",
    kind: "html",
    change: "new",
    content: '<section aria-label="Durable state">Restored after restart</section>',
  };
  decision.options[1]!.exhibit = {
    id: "ephemeral-state-preview",
    title: "Ephemeral state preview",
    kind: "html",
    change: "preserved",
    content: '<section aria-label="Ephemeral state">Reset after restart</section>',
  };

  const executionPlan = plan(document, "implementation");
  if (!("steps" in executionPlan)) throw new Error("Expected flat plan fixture");
  executionPlan.steps[0]!.implements.push("durable-state-preview");

  const parsed = parse(document);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function phasedPlanFixture(): IntentDocument {
  const document = plannedFixture();
  const executionPlan = plan(document, "implementation");
  if (!("steps" in executionPlan)) throw new Error("Expected flat plan fixture");
  const [foundation, integration] = executionPlan.steps;
  if (!foundation || !integration) throw new Error("Missing plan steps");
  const { steps: _steps, ...common } = executionPlan;
  const phased: PlanSection = {
    ...common,
    phases: [
      {
        id: "foundation",
        title: "Establish the durable boundary",
        steps: [foundation],
      },
      {
        id: "integration",
        title: "Move the runtime onto it",
        steps: [integration],
      },
    ],
  };
  document.sections = document.sections.map((section) =>
    section.id === executionPlan.id ? phased : section,
  );
  const parsed = parse(document);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function recordsSection(document: IntentDocument, id: string): RecordsSection {
  const section = findRecordsSection(document, id);
  if (!section) throw new Error(`Missing records section ${id}`);
  return section;
}

export function plan(document: IntentDocument, id: string): PlanSection {
  const section = document.sections.find((candidate) => candidate.id === id);
  if (!section || section.kind !== "plan") throw new Error(`Missing plan ${id}`);
  return section;
}

export function flowExhibit(document: IntentDocument, id: string): FlowExhibit {
  for (const section of document.sections) {
    if (section.kind !== "exhibits") continue;
    const exhibit = section.items.find((item) => item.id === id);
    if (exhibit?.kind === "flow") return exhibit;
  }
  throw new Error(`Missing flow exhibit ${id}`);
}

export function sharedRenderingFlow(): FlowExhibit {
  return {
    id: "shared-rendering-flow",
    title: "See both rendering routes",
    description: "Keep the fallback and shared body visibly joined to ordinary tools.",
    change: "modified",
    kind: "flow",
    nodes: [{ entity: "ordinary-tools" }, { entity: "fallback-owner" }, { entity: "block" }],
    connections: [
      {
        id: "ordinary-tools-preserve-fallback",
        from: "ordinary-tools",
        to: "fallback-owner",
        label: "keeps unknown-tool rendering",
      },
      {
        id: "ordinary-tools-use-block",
        from: "ordinary-tools",
        to: "block",
        label: "uses one declared body block",
      },
    ],
    paths: [
      {
        id: "fallback-route",
        title: "Keep the fallback",
        purpose: "Ordinary tools retain the existing specialized escape hatch.",
        start: "ordinary-tools",
        connectionIds: ["ordinary-tools-preserve-fallback"],
      },
      {
        id: "shared-body-route",
        title: "Use the shared body",
        purpose: "The active choice moves ordinary tools onto shared rendering.",
        start: "ordinary-tools",
        connectionIds: ["ordinary-tools-use-block"],
      },
    ],
    regions: [
      {
        id: "ordinary-entry",
        title: "Ordinary tools",
        nodeIds: ["ordinary-tools"],
      },
      {
        id: "rendering-results",
        title: "Rendering results",
        nodeIds: ["fallback-owner", "block"],
      },
    ],
  };
}
