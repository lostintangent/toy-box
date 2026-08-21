import { findRecordsSection } from "./projection";
import {
  parseIntent,
  type IntentDefinition,
  type MapSection,
  type RecordsSection,
  type SequenceSection,
} from "./schema";

/**
 * Shared Intent fixtures: one exploratory form covering every section
 * primitive, its exhibit and delivery variants, and the lookups tests use to
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
        kind: "prose",
        body: "Ordinary tool calls converge on shared presentation while genuine exceptions remain explicit.",
      },
      {
        id: "domain-map",
        title: "Domain map",
        purpose: "Place changed concepts beside the adjacent domain needed to understand them.",
        kind: "group",
        layout: "columns",
        sections: [
          {
            id: "concepts",
            title: "Concepts",
            purpose: "Name the values that participate in tool rendering.",
            kind: "records",
            view: "cards",
            provenance: "code",
            subject: "Concept",
            fields: [{ id: "role", label: "Role", kind: "text" }],
            items: [
              {
                id: "tool-call",
                subject: "ToolCall",
                change: "existing",
                values: { role: "the canonical transcript fact" },
                provenance: "model.ts#ToolCall",
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
            provenance: "code",
            subject: "Invariant",
            fields: [],
            items: [
              {
                id: "unknown-fallback",
                subject: "Unknown tools continue rendering through a fallback.",
                change: "preserved",
                values: {},
                provenance: "DefaultToolCall.tsx#DefaultToolCall",
              },
            ],
          },
        ],
      },
      {
        id: "tool-corpus",
        title: "Tool corpus",
        purpose: "Compare representative tool presentation through a finite vocabulary.",
        kind: "records",
        view: "table",
        provenance: "code",
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
            provenance: "BashToolCall.tsx#BashToolCall",
          },
          {
            id: "ordinary-tools",
            subject: "ordinary tools",
            change: "modified",
            values: { shape: "declared", content: ["shared"] },
            provenance: "ToolCallMessage.tsx#ToolCallMessage",
          },
        ],
      },
      {
        id: "rendering-ownership",
        title: "Rendering ownership",
        purpose: "Show where presentation policy lives.",
        kind: "records",
        view: "cards",
        provenance: "code",
        subject: "Surface",
        fields: [{ id: "owner", label: "Owner", kind: "text" }],
        items: [
          {
            id: "fallback-owner",
            subject: "unknown tools",
            change: "preserved",
            values: { owner: "generic fallback" },
            provenance: "DefaultToolCall.tsx#DefaultToolCall",
          },
        ],
      },
      {
        id: "shared-rendering-path",
        title: "Follow the shared rendering path",
        purpose: "Trace ordinary tools into the body shape while keeping the fallback visible.",
        kind: "map",
        layout: "network",
        roots: ["ordinary-tools"],
        kinds: ["realized-by", "preserves"],
      },
      {
        id: "design",
        title: "Design review",
        purpose: "Expose factual blockers and human-owned alternatives.",
        kind: "group",
        layout: "stack",
        sections: [
          {
            id: "questions",
            title: "Open questions",
            purpose: "Resolve feasibility facts before recording dependent choices.",
            kind: "questions",
            items: [
              {
                id: "diff-capability",
                question: "Can the shared renderer preserve syntax-aware diffs?",
                resolutionMethod: "investigate-code",
                effect: "The answer determines whether a shared diff block is viable.",
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
                        provenance: "FileDiffToolCall.tsx#FileDiffToolCall",
                      },
                    ],
                    relations: [
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
                        provenance: "FileDiffToolCall.tsx#FileDiffToolCall",
                      },
                    ],
                  },
                  {
                    id: "defer",
                    label: "Defer diff unification",
                    rationale: "The decision itself remains part of the approved intent.",
                    adds: [],
                  },
                ],
                chosen: null,
                status: "open",
                blocking: true,
                dependsOn: ["diff-capability"],
                affects: ["ordinary-tools"],
              },
            ],
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
    relations: [
      {
        id: "ordinary-tools-preserve-fallback",
        from: "ordinary-tools",
        to: "fallback-owner",
        kind: "preserves",
        label: "keeps unknown-tool rendering",
      },
    ],
  };
}

export function parse(value: unknown) {
  return parseIntent(JSON.stringify(value));
}

export function fixture(): IntentDefinition {
  const parsed = parse(fixtureInput());
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function exhibitsFixture(): IntentDefinition {
  const input = fixtureInput();
  const parsed = parse({
    ...input,
    sections: [
      ...input.sections,
      {
        id: "exact-handoff",
        title: "Exact handoff",
        purpose: "Keep exact declarations and rollout steps beside the outcomes they realize.",
        kind: "exhibits",
        provenance: "code",
        items: [
          {
            id: "body-declaration",
            title: "Declared body shape",
            kind: "code",
            change: "new",
            description: "The smallest declaration ordinary tools provide.",
            language: "typescript",
            content: 'const body = {\n  kind: "text",\n  value: result,\n};\n',
          },
          {
            id: "renderer-rollout",
            title: "Renderer rollout",
            kind: "procedure",
            change: "modified",
            description: "Move one tool at a time without losing fallback rendering.",
            provenance: "ToolCallMessage.tsx#ToolCallMessage",
            steps: [
              {
                id: "declare",
                instruction: "Declare the shared body for one ordinary tool.",
                code: {
                  language: "typescript",
                  content: "const body = renderToolBody(call);",
                },
              },
              {
                id: "verify",
                instruction: "Compare its transcript output with the bespoke renderer.",
              },
            ],
          },
        ],
      },
    ],
    relations: [
      ...input.relations,
      {
        id: "ordinary-tools-realized-by-body",
        from: "ordinary-tools",
        to: "body-declaration",
        kind: "realized-by",
        label: "uses this exact declaration",
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function sequencedFixture(): IntentDefinition {
  const parsed = parse({
    title: "Deliver a settled change",
    sections: [
      {
        id: "behavior",
        title: "Behavior",
        purpose: "Define the changed outcome.",
        kind: "records",
        view: "cards",
        provenance: "optional",
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
        title: "Implementation work",
        purpose: "Decompose the settled intent into independently verifiable work.",
        kind: "sequence",
        fields: [{ id: "done", label: "Done when", kind: "text" }],
        items: [
          {
            id: "foundation-work",
            title: "Build the foundation",
            values: { done: "The durable API is tested." },
          },
          {
            id: "integration-work",
            title: "Integrate the behavior",
            values: { done: "The runtime uses the durable API." },
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
                relations: [
                  {
                    id: "changed-causes-durable",
                    from: "changed-behavior",
                    to: "durable-result",
                    kind: "causes",
                  },
                  {
                    id: "durable-result-implemented-by-foundation",
                    from: "durable-result",
                    to: "foundation-work",
                    kind: "implemented-by",
                  },
                ],
              },
            ],
            chosen: "durable",
            status: "decided",
            blocking: true,
            dependsOn: [],
          },
        ],
      },
    ],
    relations: [
      {
        id: "changed-implemented-by-integration",
        from: "changed-behavior",
        to: "integration-work",
        kind: "implemented-by",
      },
      {
        id: "policy-implemented-by-integration",
        from: "durability-policy",
        to: "integration-work",
        kind: "implemented-by",
      },
      {
        id: "integration-depends-on-foundation",
        from: "integration-work",
        to: "foundation-work",
        kind: "depends-on",
        label: "requires the durable API",
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function stagedSequenceFixture(): IntentDefinition {
  const definition = sequencedFixture();
  const delivery = sequence(definition, "implementation");
  if (!("items" in delivery)) throw new Error("Expected flat sequence fixture");
  const [foundation, integration] = delivery.items;
  if (!foundation || !integration) throw new Error("Missing sequence work");
  const { items: _items, ...common } = delivery;
  const staged: SequenceSection = {
    ...common,
    stages: [
      {
        id: "foundation",
        title: "Establish the durable boundary",
        items: [foundation],
      },
      {
        id: "integration",
        title: "Move the runtime onto it",
        items: [integration],
      },
    ],
  };
  definition.sections = definition.sections.map((section) =>
    section.id === delivery.id ? staged : section,
  );
  const parsed = parse(definition);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function recordsSection(definition: IntentDefinition, id: string): RecordsSection {
  const section = findRecordsSection(definition, id);
  if (!section) throw new Error(`Missing records section ${id}`);
  return section;
}

export function sequence(definition: IntentDefinition, id: string): SequenceSection {
  const section = definition.sections.find((candidate) => candidate.id === id);
  if (!section || section.kind !== "sequence") throw new Error(`Missing sequence ${id}`);
  return section;
}

export function mapSection(definition: IntentDefinition, id: string): MapSection {
  const section = definition.sections.find((candidate) => candidate.id === id);
  if (!section || section.kind !== "map") throw new Error(`Missing map section ${id}`);
  return section;
}

export function sharedRenderingPathsMap(): MapSection {
  return {
    id: "shared-rendering-routes",
    title: "See both rendering routes",
    purpose: "Keep the fallback and shared body visibly joined to ordinary tools.",
    kind: "map",
    collapsed: false,
    layout: "paths",
    paths: [
      {
        id: "fallback-route",
        title: "Keep the fallback",
        purpose: "Ordinary tools retain the existing specialized escape hatch.",
        root: "ordinary-tools",
        relations: ["ordinary-tools-preserve-fallback"],
      },
      {
        id: "shared-body-route",
        title: "Use the shared body",
        purpose: "The active choice moves ordinary tools onto shared rendering.",
        root: "ordinary-tools",
        relations: ["ordinary-tools-use-shared-diff"],
      },
    ],
    regions: [
      {
        id: "ordinary-entry",
        title: "Ordinary tools",
        entities: ["ordinary-tools"],
      },
      {
        id: "rendering-results",
        title: "Rendering results",
        entities: ["fallback-owner", "shared-diff"],
      },
    ],
  };
}
