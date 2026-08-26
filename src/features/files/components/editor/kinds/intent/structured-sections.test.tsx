import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  allDecisions,
  findIntentEntity,
  flowGraph,
  flowPathSelectionAfterInspection,
  parseIntent,
  planSections,
  planState,
  specState,
  type FlowExhibit,
  type IntentDocument,
  type IntentExhibit,
  type PlanSection,
} from "./model/index";
import { planSteps } from "./model/plan";
import { IntentExhibitEditor } from "./inspector/ExhibitEditor";
import { PlanStepEditor } from "./inspector/PlanStepEditor";
import { IntentRecordEditor } from "./inspector/RecordEditor";
import { IntentFlowExhibit, IntentPlanSection } from "./sections";

const RESTORATION_FLOW: FlowExhibit = {
  id: "restoration-flow",
  title: "See restoration branch and rejoin",
  description: "Keep the restore contract and active policy routes in one authoritative flow.",
  change: "modified",
  kind: "flow",
  nodes: [
    { entity: "context" },
    { entity: "changed" },
    { entity: "restore-contract" },
    { entity: "provisional-addition" },
    { entity: "settled-addition" },
  ],
  connections: [
    {
      id: "context-causes-change",
      from: "context",
      to: "changed",
      label: "motivates",
    },
    {
      id: "changed-realized-by-restore-contract",
      from: "changed",
      to: "restore-contract",
      label: "uses this contract",
    },
    {
      id: "changed-previews-provisional",
      from: "changed",
      to: "provisional-addition",
      label: "can preview",
    },
    {
      id: "changed-realized-by-settled",
      from: "changed",
      to: "settled-addition",
      label: "settles as",
    },
    {
      id: "restore-contract-preserves-change",
      from: "restore-contract",
      to: "changed",
      label: "keeps the changed outcome visible",
    },
  ],
  paths: [
    {
      id: "restore-route",
      title: "Restore the durable value",
      purpose: "Follow the changed behavior into its interface and settled result.",
      start: "context",
      connectionIds: [
        "context-causes-change",
        "changed-realized-by-restore-contract",
        "changed-realized-by-settled",
      ],
    },
    {
      id: "preview-route",
      title: "Try the preview policy",
      purpose: "Follow the same changed behavior into the provisional result.",
      start: "context",
      connectionIds: ["context-causes-change", "changed-previews-provisional"],
    },
  ],
  regions: [
    {
      id: "reason",
      title: "Why this changes",
      nodeIds: ["context"],
    },
    {
      id: "behavior",
      title: "Changed behavior",
      nodeIds: ["changed"],
    },
    {
      id: "results",
      title: "Defined and chosen results",
      nodeIds: ["restore-contract", "provisional-addition", "settled-addition"],
    },
  ],
};

function fixture(): IntentDocument {
  const parsed = parseIntent(
    JSON.stringify({
      title: "Trace a lifecycle",
      sections: [
        {
          id: "context",
          title: "Context",
          purpose: "Orient the reader.",
          kind: "markdown",
          body: "Context should orient the effective changes.",
        },
        {
          id: "behavior",
          title: "Behavior",
          purpose: "Define the observable outcome.",
          kind: "records",
          view: "cards",
          sourcePolicy: "code",
          subject: "Outcome",
          fields: [{ id: "result", label: "Result", kind: "text" }],
          items: [
            {
              id: "baseline",
              subject: "Existing baseline",
              change: "existing",
              values: { result: "unchanged context" },
              source: "runtime.ts#baseline",
            },
            {
              id: "changed",
              subject: "Modified behavior",
              change: "modified",
              values: { result: "restores the durable value" },
              explanation: "The runtime reconstructs the visible state.",
              source: "runtime.ts#restore",
            },
          ],
        },
        {
          id: "restore-contracts",
          title: "Restore contract",
          purpose: "Keep the runtime interface beside the behavior it realizes.",
          kind: "exhibits",
          sourcePolicy: "optional",
          items: [
            {
              id: "restore-contract",
              title: "Restore interface",
              kind: "pseudocode",
              change: "new",
              description: "The runtime accepts durable state through one stable interface.",
              language: "typescript",
              content: "interface Runtime {\n  restore(state: DurableState): Promise<void>;\n}\n",
            },
          ],
        },
        {
          id: "implementation",
          title: "Execution plan",
          purpose: "Plan independently verifiable steps against the settled spec.",
          kind: "plan",
          fields: [],
          steps: [
            {
              id: "foundation-step",
              title: "Build durable state",
              doneWhen: "The persistence boundary is tested.",
              implements: ["settled-addition"],
              values: {},
            },
            {
              id: "integration-step",
              title: "Integrate restoration",
              doneWhen: "The runtime restores state end to end.",
              implements: ["restoration-flow", "changed", "restore-contract"],
              values: {},
            },
          ],
        },
        {
          id: "decisions",
          title: "Decisions",
          purpose: "Project selected alternatives.",
          kind: "decisions",
          items: [
            {
              id: "pending-policy",
              question: "Which provisional policy should be explored?",
              options: [
                {
                  id: "preview",
                  label: "Preview policy",
                  adds: [
                    {
                      sectionId: "behavior",
                      id: "provisional-addition",
                      subject: "Provisional addition",
                      change: "new",
                      values: { result: "not yet decided" },
                    },
                  ],
                  relationships: [
                    {
                      id: "changed-previews-provisional",
                      from: "changed",
                      to: "provisional-addition",
                      kind: "causes",
                    },
                  ],
                },
                {
                  id: "skip-preview",
                  label: "Keep the current policy",
                  adds: [],
                },
              ],
              choice: { optionId: "preview", status: "provisional" },
              dependsOn: [],
            },
            {
              id: "settled-policy",
              question: "Which settled policy applies?",
              options: [
                {
                  id: "restore",
                  label: "Restore durable state",
                  tradeoff: "Requires an explicit reconstruction boundary.",
                  adds: [
                    {
                      sectionId: "behavior",
                      id: "settled-addition",
                      subject: "Settled addition",
                      change: "new",
                      values: { result: "part of the effective spec" },
                    },
                  ],
                  relationships: [
                    {
                      id: "changed-realized-by-settled",
                      from: "changed",
                      to: "settled-addition",
                      kind: "realized-by",
                    },
                  ],
                },
                {
                  id: "ephemeral",
                  label: "Keep ephemeral state",
                  adds: [],
                },
              ],
              choice: { optionId: "restore", status: "decided" },
              dependsOn: [],
            },
          ],
        },
        {
          id: "restoration-flow-section",
          title: "Restoration flow",
          purpose: "Define the routes and supporting connection as one visual requirement.",
          kind: "exhibits",
          sourcePolicy: "optional",
          items: [RESTORATION_FLOW],
        },
      ],
    }),
  );
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

function executionPlan(document: IntentDocument) {
  const section = document.sections.find((candidate) => candidate.id === "implementation");
  if (!section || section.kind !== "plan") throw new Error("Missing plan fixture");
  return section;
}

function planProjection(document: IntentDocument) {
  const spec = specState(document);
  const plan = planState(planSections(document), spec);
  if (!plan) throw new Error("Missing derived plan state");
  return { spec, plan };
}

function phasedPlanFixture(): IntentDocument {
  const document = fixture();
  const plan = executionPlan(document);
  if (!("steps" in plan)) throw new Error("Expected flat plan fixture");
  const [foundation, integration] = plan.steps;
  if (!foundation || !integration) throw new Error("Missing plan steps");
  const { steps: _steps, ...common } = plan;
  const phased: PlanSection = {
    ...common,
    phases: [
      {
        id: "foundation",
        title: "Establish durable state",
        steps: [foundation],
      },
      {
        id: "integration",
        title: "Move restoration onto it",
        steps: [integration],
      },
    ],
  };
  document.sections = document.sections.map((section) =>
    section.id === plan.id ? phased : section,
  );
  const parsed = parseIntent(JSON.stringify(document));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

test("renders an authored flow as selectable paths over one shared staged graph", () => {
  const markup = renderToStaticMarkup(
    <IntentFlowExhibit document={fixture()} exhibit={RESTORATION_FLOW} onInspect={() => {}} />,
  );

  expect(markup).toContain("Restore the durable value");
  expect(markup).toContain("Try the preview policy");
  expect(markup).toContain('data-flow-path="restore-route"');
  expect(markup).toContain('data-flow-path="preview-route"');
  expect(markup).toContain('data-path-connection="context-causes-change"');
  expect(markup).toContain("Whole flow");
  expect(markup).toContain("Following");
  expect(markup).toContain("data-flow-graph");
  expect(markup).toContain('aria-label="Changes in this flow"');
  expect(markup).toContain("Why this changes");
  expect(markup).toContain("Defined and chosen results");
  expect(markup).toContain('data-flow-supporting-connection="restore-contract-preserves-change"');
  expect(markup).toContain("keeps the changed outcome visible");
  expect(markup).toContain("uses this contract");
  expect(markup.match(/data-flow-node=/g)).toHaveLength(5);
  expect(markup.match(/data-flow-node="changed"/g)).toHaveLength(1);
  expect(markup).not.toContain("<foreignObject");
});

test("keeps whole-flow mode and follows the path containing an inspected node", () => {
  const graph = flowGraph(fixture(), RESTORATION_FLOW);

  expect(
    flowPathSelectionAfterInspection(graph, undefined, "provisional-addition"),
  ).toBeUndefined();
  expect(flowPathSelectionAfterInspection(graph, "restore-route", "changed")).toBe("restore-route");
  expect(flowPathSelectionAfterInspection(graph, "restore-route", "provisional-addition")).toBe(
    "preview-route",
  );
});

test("keeps one shared requirement focused across the flow and plan", () => {
  const document = fixture();
  const plan = document.sections.find((section) => section.id === "implementation");
  if (!plan || plan.kind !== "plan") throw new Error("Missing plan fixture");
  const focusedEntityId = "changed" as const;
  const flow = renderToStaticMarkup(
    <IntentFlowExhibit
      document={document}
      exhibit={RESTORATION_FLOW}
      focusedEntityId={focusedEntityId}
      onInspect={() => {}}
    />,
  );
  const planMarkup = renderToStaticMarkup(
    <IntentPlanSection
      {...planProjection(document)}
      section={plan}
      focusedEntityId={focusedEntityId}
      onInspect={() => {}}
    />,
  );
  expect(flow).toContain('data-focused="true"');
  expect(planMarkup).toContain('data-focused="true"');
});

test("builds a record editor from domain-local records fields", () => {
  const document = fixture();
  const section = document.sections.find((item) => item.id === "behavior");
  if (!section || section.kind !== "records") throw new Error("Missing behavior fixture");
  const record = section.items.find((item) => item.id === "changed");
  if (!record) throw new Error("Missing changed fixture");

  const markup = renderToStaticMarkup(
    <IntentRecordEditor
      section={section}
      record={record}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );

  expect(markup).toContain(">Outcome</span>");
  expect(markup).toContain(">Result</span>");
  expect(markup).toContain("Modified behavior");
  expect(markup).toContain("restores the durable value");
  expect(markup).toContain("Save changes");
});

test("builds a lean step editor with an intrinsic completion criterion", () => {
  const document = fixture();
  const plan = executionPlan(document);
  const step = planSteps(plan)[0]!;
  const markup = renderToStaticMarkup(
    <PlanStepEditor section={plan} step={step} onSave={() => undefined} onCancel={() => {}} />,
  );

  expect(markup).toContain(">Step</span>");
  expect(markup).toContain(">Status</span>");
  expect(markup).toContain(">Done when</span>");
  expect(markup).toContain("Build durable state");
  expect(markup).not.toContain(">Change</span>");
  expect(markup).not.toContain(">Source</span>");
  expect(markup).not.toContain(">Notes</span>");
});

test("builds an exhibit editor without flattening pseudocode definitions", () => {
  const document = fixture();
  const entity = findIntentEntity(document, "restore-contract");
  if (!entity || entity.type !== "exhibit" || entity.owner.kind !== "section") {
    throw new Error("Missing section-owned exhibit fixture");
  }
  const sourcePolicy = entity.owner.section.sourcePolicy;

  const markup = renderToStaticMarkup(
    <IntentExhibitEditor
      sourcePolicy={sourcePolicy}
      exhibit={entity.exhibit}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );

  expect(markup).toContain(">Pseudocode or interface</span>");
  expect(markup).toContain("restore(state: DurableState): Promise&lt;void&gt;;");
  expect(markup).toContain("typescript");
  expect(markup).toContain("Save changes");

  const image: IntentExhibit = {
    id: "architecture-image",
    title: "Architecture",
    kind: "image",
    change: "new",
    uri: "./architecture.svg",
    altText: "The architecture boundary.",
  };
  const imageMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      sourcePolicy={sourcePolicy}
      exhibit={image}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(imageMarkup).toContain(">Image URI</span>");
  expect(imageMarkup).toContain('value="./architecture.svg"');
  expect(imageMarkup).toContain(">Alternative text</span>");

  const html: IntentExhibit = {
    id: "interactive-prototype",
    title: "Interactive prototype",
    kind: "html",
    change: "new",
    uri: "./prototype.html",
  };
  const htmlMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      sourcePolicy={sourcePolicy}
      exhibit={html}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(htmlMarkup).toContain(">HTML URI</span>");
  expect(htmlMarkup).toContain('value="./prototype.html"');

  const inlineSvg: IntentExhibit = {
    id: "embedded-architecture",
    title: "Embedded architecture",
    kind: "html",
    change: "new",
    content: '<svg viewBox="0 0 10 10"></svg>',
  };
  const inlineSvgMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      sourcePolicy={sourcePolicy}
      exhibit={inlineSvg}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(inlineSvgMarkup).toContain(">HTML content</span>");
  expect(inlineSvgMarkup).toContain("&lt;svg viewBox=&quot;0 0 10 10&quot;&gt;");

  const files: IntentExhibit = {
    id: "target-files",
    title: "Target files",
    kind: "tree",
    type: "files",
    change: "modified",
    roots: [
      {
        kind: "folder",
        name: "src/features/files",
        change: "modified",
        children: [{ kind: "file", name: "FileTree.tsx", change: "new" }],
      },
      { kind: "file", name: "README.md", change: "removed" },
    ],
  };
  const filesMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      sourcePolicy={sourcePolicy}
      exhibit={files}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(filesMarkup).toContain(">File trees</legend>");
  expect(filesMarkup).toContain('aria-label="Root 1 folder name"');
  expect(filesMarkup).toContain('value="src/features/files"');
  expect(filesMarkup).toContain('aria-label="Root 1, item 1 file name"');
  expect(filesMarkup).toContain('value="FileTree.tsx"');
  expect(filesMarkup).toContain('aria-label="Root 2 file name"');
  expect(filesMarkup).toContain("Add folder root");
  expect(filesMarkup).toContain("Add file root");

  const domain: IntentExhibit = {
    id: "intent-domain",
    title: "Intent domain",
    kind: "tree",
    type: "domain",
    change: "new",
    roots: [
      {
        name: "Intent document",
        children: [{ name: "Spec", change: "modified" }],
      },
    ],
  };
  const domainMarkup = renderToStaticMarkup(
    <IntentExhibitEditor
      sourcePolicy={sourcePolicy}
      exhibit={domain}
      onSave={() => undefined}
      onCancel={() => {}}
    />,
  );
  expect(domainMarkup).toContain(">Domain trees</legend>");
  expect(domainMarkup).toContain('aria-label="Root 1 domain name"');
  expect(domainMarkup).toContain('value="Intent document"');
  expect(domainMarkup).toContain('aria-label="Root 1, item 1 domain name"');
  expect(domainMarkup).toContain('value="Spec"');
  expect(domainMarkup).toContain("Add domain root");
  expect(domainMarkup).toContain(">Concept</button>");
});

test("renders authored plan steps and the spec entities they implement", () => {
  const document = fixture();
  const markup = renderToStaticMarkup(
    <IntentPlanSection
      {...planProjection(document)}
      section={executionPlan(document)}
      onInspect={() => {}}
    />,
  );

  expect(markup).toContain("Build durable state");
  expect(markup).toContain("Integrate restoration");
  expect(markup).toContain("Done when");
  expect(markup).toContain('aria-label="Implements"');
  expect(markup).toContain("Settled addition");
  expect(markup).toContain("Modified behavior");
  expect(markup).not.toContain("<details");
  expect(markup).not.toContain("agreed outcomes land here");
  expect(markup).not.toContain(">New</span>");
  expect(markup).not.toContain("Still needs a plan step");
  expect(markup).not.toContain("Provisional addition");
});

test("presents a phase as a named ordered group of steps", () => {
  const document = fixture();
  const plan = executionPlan(document);
  if (!("steps" in plan)) throw new Error("Expected flat plan");
  const steps = plan.steps;
  const { steps: _steps, ...common } = plan;
  const phased: PlanSection = {
    ...common,
    phases: [{ id: "integration", title: "Integration", steps }],
  };
  document.sections = document.sections.map((section) =>
    section.id === plan.id ? phased : section,
  );

  const markup = renderToStaticMarkup(
    <IntentPlanSection
      {...planProjection(document)}
      section={executionPlan(document)}
      onInspect={() => {}}
    />,
  );

  expect(markup).toContain("Integration");
  expect(markup).toContain("2 steps");
  expect(markup.indexOf("Build durable state")).toBeLessThan(
    markup.indexOf("Integrate restoration"),
  );
  expect(markup).not.toContain("execute together");
});

test("uses authored names for plan phases", () => {
  const document = phasedPlanFixture();
  const markup = renderToStaticMarkup(
    <IntentPlanSection
      {...planProjection(document)}
      section={executionPlan(document)}
      onInspect={() => {}}
    />,
  );

  expect(markup).toContain("Establish durable state");
  expect(markup).toContain("Move restoration onto it");
});

test("hides steps that only implement an unsettled option", () => {
  const document = fixture();
  const decision = allDecisions(document).find((item) => item.id === "settled-policy")!;
  decision.choice!.status = "provisional";

  const markup = renderToStaticMarkup(
    <IntentPlanSection
      {...planProjection(document)}
      section={executionPlan(document)}
      onInspect={() => {}}
    />,
  );
  expect(markup).not.toContain("Build durable state");
  expect(markup).toContain("Integrate restoration");
});

test("keeps unplanned requirements visible when no plan step implements the current spec", () => {
  const document = fixture();
  const pendingDecision = allDecisions(document).find((item) => item.id === "pending-policy")!;
  pendingDecision.choice = { optionId: "skip-preview", status: "decided" };
  const plan = executionPlan(document);
  if (!("steps" in plan)) throw new Error("Expected flat plan");
  for (const step of plan.steps) step.implements = ["provisional-addition"];

  const markup = renderToStaticMarkup(
    <IntentPlanSection {...planProjection(document)} section={plan} onInspect={() => {}} />,
  );

  expect(markup).toContain("Still needs a plan step");
  expect(markup).toContain("No plan steps implement this spec");
  expect(markup).not.toContain("depends on choices that are not settled");
});
