import { describe, expect, test } from "bun:test";
import exampleIntent from "@files/server/skills/create-toy-box-intent/references/example.intent?raw";
import {
  parseIntent,
  serializeIntent,
  type IntentDocument,
  type OptionRelationship,
} from "./schema";
import {
  activeOptionRelationships,
  allDecisions,
  allFindings,
  allQuestions,
  findExhibitsSection,
  findIntentEntity,
  resolveIntentTabs,
} from "./query/reading";
import { planSections, planState } from "./plan";
import { specState } from "./spec";
import {
  exhibitsFixture,
  flowExhibit,
  fixture,
  fixtureInput,
  groundedFixture,
  optionExhibitsFixture,
  parse,
  plan,
  plannedFixture,
  recordsSection,
} from "./testFixtures";

function firstDecisionOptionRelationship(document: IntentDocument): OptionRelationship {
  const relationship = allDecisions(document)[0]?.options[0]?.relationships?.[0];
  if (!relationship) throw new Error("Missing decision option relationship");
  return relationship;
}

describe("intent schema", () => {
  test("parses a task-defined document with all section primitives", () => {
    const parsed = parse(fixtureInput());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.sections.map((section) => section.kind)).toEqual([
      "markdown",
      "records",
      "records",
      "records",
      "records",
      "exhibits",
      "questions",
      "decisions",
      "list",
    ]);
    expect(allQuestions(parsed.value)).toHaveLength(1);
    expect(allDecisions(parsed.value)).toHaveLength(1);
    expect(activeOptionRelationships(parsed.value)).toHaveLength(0);
    expect(flowExhibit(parsed.value, "shared-rendering-flow").title).toBe(
      "See both rendering routes",
    );
  });

  test("keeps source-backed findings distinct from the spec they ground", () => {
    const document = groundedFixture();

    expect(allFindings(document)).toMatchObject([
      {
        id: "finding-shared-owner",
        sources: ["ToolCallMessage.tsx#ToolCallMessage"],
        exhibit: { id: "current-rendering-ownership", kind: "tree", change: "existing" },
      },
      { id: "finding-fallback" },
    ]);
    expect(findIntentEntity(document, "finding-shared-owner")).toMatchObject({
      type: "finding",
      section: { id: "research-findings" },
    });
    expect(findIntentEntity(document, "current-rendering-ownership")).toBeUndefined();
    expect(specState(document).requirements.map((entity) => entity.id)).not.toContain(
      "finding-shared-owner",
    );
  });

  test("requires honest finding sources, evidence, and grounding references", () => {
    const missingSources = groundedFixture();
    delete allFindings(missingSources)[0]!.sources;
    expect(parse(missingSources)).toMatchObject({
      ok: false,
      error: expect.stringContaining("require at least one source"),
    });

    const proposedEvidence = groundedFixture();
    allFindings(proposedEvidence)[0]!.exhibit!.change = "new";
    expect(parse(proposedEvidence)).toMatchObject({
      ok: false,
      error: expect.stringContaining("must describe existing evidence"),
    });

    const recursivelyGroundedEvidence = groundedFixture();
    allFindings(recursivelyGroundedEvidence)[0]!.exhibit!.basedOn = ["finding-shared-owner"];
    expect(parse(recursivelyGroundedEvidence)).toMatchObject({
      ok: false,
      error: expect.stringContaining("cannot itself be based on findings"),
    });

    const unknownGrounding = groundedFixture();
    recordsSection(unknownGrounding, "tool-corpus").items[1]!.basedOn = ["missing-finding"];
    expect(parse(unknownGrounding)).toMatchObject({
      ok: false,
      error: expect.stringContaining("based on unknown finding"),
    });

    const repeatedGrounding = groundedFixture();
    recordsSection(repeatedGrounding, "tool-corpus").items[1]!.basedOn = [
      "finding-shared-owner",
      "finding-shared-owner",
    ];
    expect(parse(repeatedGrounding)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Findings for record"),
    });

    const findingAsPlanTarget = groundedFixture();
    findingAsPlanTarget.sections.push({
      id: "invalid-plan",
      title: "Invalid plan",
      purpose: "Try to implement research instead of the spec.",
      collapsed: false,
      kind: "plan",
      fields: [],
      steps: [
        {
          id: "implement-finding",
          title: "Implement the finding",
          doneWhen: "The impossible target is complete.",
          implements: ["finding-shared-owner"],
          values: {},
        },
      ],
    });
    expect(parse(findingAsPlanTarget)).toMatchObject({
      ok: false,
      error: expect.stringContaining("can implement only"),
    });
  });

  test("accepts absent and rejects empty option relationships", () => {
    const withoutRelationships = structuredClone(fixture());
    const option = allDecisions(withoutRelationships)[0]!.options[1]!;
    expect(parse(withoutRelationships)).toMatchObject({ ok: true });

    option.relationships = [];
    expect(parse(withoutRelationships)).toMatchObject({ ok: false });
  });

  test("rejects invalid JSON and unknown keys", () => {
    expect(parseIntent("")).toMatchObject({ ok: false });
    expect(parseIntent("{")).toMatchObject({ ok: false });
    expect(parse({ ...fixtureInput(), extra: true })).toMatchObject({
      ok: false,
    });
  });

  test("parses plan step status and reference-only document tabs", () => {
    const document = plannedFixture();
    const executionPlan = plan(document, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    executionPlan.steps[0]!.status = "in-progress";
    document.tabs = [
      { title: "Intent", sections: ["decisions", "behavior"] },
      { title: "Plan", sections: ["implementation"] },
    ];

    const parsed = parse(document);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) return;
    const parsedPlan = plan(parsed.value, "implementation");
    if (!("steps" in parsedPlan)) throw new Error("Expected flat plan");
    expect(parsedPlan.steps[0]?.status).toBe("in-progress");
    expect(
      resolveIntentTabs(parsed.value).map((tab) => ({
        title: tab.title,
        sections: tab.sections.map((section) => section.id),
      })),
    ).toEqual([
      { title: "Intent", sections: ["behavior", "decisions"] },
      { title: "Plan", sections: ["implementation"] },
    ]);

    const persistedNotStarted = plannedFixture();
    const persistedNotStartedPlan = plan(persistedNotStarted, "implementation");
    if (!("steps" in persistedNotStartedPlan)) throw new Error("Expected flat plan");
    Object.assign(persistedNotStartedPlan.steps[0]!, { status: "not-started" });
    expect(parse(persistedNotStarted)).toMatchObject({ ok: false });
  });

  test("requires completion criteria and reserves intrinsic plan fields", () => {
    const missingDoneWhen = JSON.parse(serializeIntent(plannedFixture()));
    const incompletePlan = missingDoneWhen.sections.find(
      (section: { id: string }) => section.id === "implementation",
    );
    delete incompletePlan.steps[0].doneWhen;
    expect(parse(missingDoneWhen)).toMatchObject({ ok: false });

    const duplicatedDoneWhen = plannedFixture();
    const duplicatePlan = plan(duplicatedDoneWhen, "implementation");
    duplicatePlan.fields.push({ id: "done", label: "Done when", kind: "text" });
    for (const step of "steps" in duplicatePlan
      ? duplicatePlan.steps
      : duplicatePlan.phases.flatMap((phase) => phase.steps)) {
      step.values.done = step.doneWhen;
    }
    expect(parse(duplicatedDoneWhen)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Column labels"),
    });
  });

  test("requires tabs to partition top-level sections without addressable IDs", () => {
    const valid = plannedFixture();
    valid.tabs = [
      { title: "Intent", sections: ["behavior", "decisions"] },
      { title: "Plan", sections: ["implementation"] },
    ];

    const singleTab = structuredClone(valid);
    singleTab.tabs = [
      { title: "Everything", sections: ["behavior", "implementation", "decisions"] },
    ];
    expect(parse(singleTab)).toMatchObject({ ok: false });

    const duplicateTitle = structuredClone(valid);
    duplicateTitle.tabs![1]!.title = "Intent";
    expect(parse(duplicateTitle)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Tab titles must be unique"),
    });

    const duplicateSection = structuredClone(valid);
    duplicateSection.tabs![1]!.sections.push("behavior");
    expect(parse(duplicateSection)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Sections across tabs must be unique"),
    });

    const missingSection = structuredClone(valid);
    missingSection.tabs![0]!.sections = ["behavior"];
    expect(parse(missingSection)).toMatchObject({
      ok: false,
      error: expect.stringContaining('missing "decisions"'),
    });

    const unknownSection = structuredClone(valid);
    unknownSection.tabs![1]!.sections = ["unknown-section"];
    expect(parse(unknownSection)).toMatchObject({
      ok: false,
      error: expect.stringContaining("unknown top-level section"),
    });

    const addressedTab = JSON.parse(serializeIntent(valid));
    addressedTab.tabs[0].id = "intent";
    expect(parse(addressedTab)).toMatchObject({ ok: false });

    const pendingStatus = JSON.parse(serializeIntent(valid));
    const planSection = pendingStatus.sections.find(
      (section: { id: string }) => section.id === "implementation",
    );
    planSection.steps[0].status = "pending";
    expect(parse(pendingStatus)).toMatchObject({ ok: false });
  });

  test("accepts Markdown in every rendered text field", () => {
    expect(parse(fixtureInput())).toMatchObject({ ok: true });
    const withMarkdownBody = (body: string) => {
      const input = JSON.parse(JSON.stringify(fixtureInput()));
      input.sections[0].body = body;
      return input;
    };
    expect(
      parse(
        withMarkdownBody(
          "# Result\n\nMarkdown can use **emphasis**, [links](https://example.com), and other Markdown.",
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(
      parse(withMarkdownBody("A broken **phrase remains valid Markdown input.")),
    ).toMatchObject({
      ok: true,
    });
    expect(parse(withMarkdownBody("   "))).toMatchObject({ ok: false });
    const indentedBody = withMarkdownBody("\n    const exact = true;\n");
    const parsedIndentedBody = parse(indentedBody);
    expect(parsedIndentedBody).toMatchObject({ ok: true });
    if (!parsedIndentedBody.ok) throw new Error(parsedIndentedBody.error);
    const parsedMarkdown = parsedIndentedBody.value.sections[0];
    if (parsedMarkdown?.kind !== "markdown") throw new Error("Missing Markdown section");
    expect(parsedMarkdown.body).toBe("\n    const exact = true;\n");

    const markdownText = JSON.parse(JSON.stringify(fixtureInput()));
    const list = markdownText.sections.find((section: { kind: string }) => section.kind === "list");
    list.items[0] = "A broken **delimiter remains valid Markdown input.";
    expect(parse(markdownText)).toMatchObject({ ok: true });

    const markdownExhibits = exhibitsFixture();
    const exhibits = markdownExhibits.sections.find((section) => section.kind === "exhibits");
    if (!exhibits || exhibits.kind !== "exhibits") throw new Error("Missing exhibits section");
    exhibits.items[0].description = "Use a [linked reference](https://example.com/reference).";
    expect(parse(markdownExhibits)).toMatchObject({ ok: true });
  });

  test("requires globally unique intent entity IDs", () => {
    const duplicateSection = structuredClone(fixture());
    duplicateSection.sections[2]!.id = "concepts";
    expect(parse(duplicateSection)).toMatchObject({ ok: false });

    const duplicateRecord = structuredClone(fixture());
    recordsSection(duplicateRecord, "rendering-ownership").items[0]!.id = "bash";
    expect(parse(duplicateRecord)).toMatchObject({ ok: false });

    const duplicateOptionRecord = structuredClone(fixture());
    allDecisions(duplicateOptionRecord)[0]!.options[0]!.adds[0]!.id = "bash";
    expect(parse(duplicateOptionRecord)).toMatchObject({ ok: false });

    const duplicateOptionExhibit = optionExhibitsFixture();
    allDecisions(duplicateOptionExhibit)[0]!.options[0]!.exhibit!.id = "changed-behavior";
    expect(parse(duplicateOptionExhibit)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Intent entity IDs must be unique"),
    });

    const duplicateStep = structuredClone(plannedFixture());
    const executionPlan = plan(duplicateStep, "implementation");
    if (!("steps" in executionPlan)) throw new Error("Expected flat plan");
    executionPlan.steps[1]!.id = executionPlan.steps[0]!.id;
    expect(parse(duplicateStep)).toMatchObject({ ok: false });

    const duplicateAcrossTypes = structuredClone(plannedFixture());
    recordsSection(duplicateAcrossTypes, "behavior").items[0]!.id = "foundation-step";
    expect(parse(duplicateAcrossTypes)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Intent entity IDs must be unique"),
    });
  });

  test("resolves ID-only references to typed entities", () => {
    const document = plannedFixture();
    expect(findIntentEntity(document, "changed-behavior")).toMatchObject({
      type: "record",
      record: { subject: "Changed behavior" },
    });
    expect(findIntentEntity(document, "foundation-step")).toMatchObject({
      type: "plan-step",
      step: { title: "Build the foundation" },
    });
  });

  test("keeps collection and plan containers outside decision relationships", () => {
    for (const { document, from, endpoint } of [
      { document: fixture(), from: "ordinary-tools", endpoint: "tool-corpus" },
      {
        document: fixture(),
        from: "ordinary-tools",
        endpoint: "shared-rendering-flow-section",
      },
      { document: plannedFixture(), from: "changed-behavior", endpoint: "implementation" },
      { document: plannedFixture(), from: "changed-behavior", endpoint: "foundation-step" },
    ]) {
      const wrongEndpointType = structuredClone(document);
      const option = allDecisions(wrongEndpointType)[0]!.options[0]!;
      option.relationships = [
        ...(option.relationships ?? []),
        {
          id: `changed-depends-on-${endpoint}`,
          from,
          to: endpoint,
          kind: "depends-on",
        },
      ];
      expect(parse(wrongEndpointType)).toMatchObject({
        ok: false,
        error: expect.stringContaining("Unknown entity"),
      });
    }
  });

  test("lets each records section choose its source policy", () => {
    const missingCode = structuredClone(fixture());
    delete recordsSection(missingCode, "tool-corpus").items[0]!.source;
    expect(parse(missingCode)).toMatchObject({ ok: false });

    const absoluteCode = structuredClone(fixture());
    recordsSection(absoluteCode, "tool-corpus").items[0]!.source = "/tmp/source.ts";
    expect(parse(absoluteCode)).toMatchObject({ ok: false });

    const remoteCode = structuredClone(fixture());
    recordsSection(remoteCode, "tool-corpus").items[0]!.source = "https://example.test/source.ts";
    expect(parse(remoteCode)).toMatchObject({
      ok: false,
      error: expect.stringContaining("workspace-relative code location"),
    });

    const referenced = structuredClone(fixture());
    const corpus = recordsSection(referenced, "tool-corpus");
    corpus.sourcePolicy = "reference";
    corpus.items[0]!.source = "https://example.test/tool-corpus";
    expect(parse(referenced)).toMatchObject({ ok: true });

    const optional = structuredClone(fixture());
    const ownership = recordsSection(optional, "rendering-ownership");
    ownership.sourcePolicy = "optional";
    delete ownership.items[0]!.source;
    expect(parse(optional)).toMatchObject({ ok: true });
  });

  test("validates declared subjects and exact field values", () => {
    const missingSubject = structuredClone(fixture());
    delete recordsSection(missingSubject, "tool-corpus").items[0]!.subject;
    expect(parse(missingSubject)).toMatchObject({ ok: false });

    const unexpectedSubject = structuredClone(fixture());
    delete recordsSection(unexpectedSubject, "invariants").subject;
    expect(parse(unexpectedSubject)).toMatchObject({ ok: false });

    const missingField = structuredClone(fixture());
    delete recordsSection(missingField, "tool-corpus").items[0]!.values.content;
    expect(parse(missingField)).toMatchObject({ ok: false });

    const extraField = structuredClone(fixture());
    recordsSection(extraField, "tool-corpus").items[0]!.values.owner = "renderer";
    expect(parse(extraField)).toMatchObject({ ok: false });
  });

  test("validates text and finite-choice cardinality and vocabularies", () => {
    const oneAsArray = structuredClone(fixture());
    recordsSection(oneAsArray, "tool-corpus").items[0]!.values.shape = ["multi"];
    expect(parse(oneAsArray)).toMatchObject({ ok: false });

    const manyAsString = structuredClone(fixture());
    recordsSection(manyAsString, "tool-corpus").items[0]!.values.content = "code";
    expect(parse(manyAsString)).toMatchObject({ ok: false });

    const unknownChoice = structuredClone(fixture());
    recordsSection(unknownChoice, "tool-corpus").items[0]!.values.shape = "unknown";
    expect(parse(unknownChoice)).toMatchObject({ ok: false });

    const duplicateChoice = structuredClone(fixture());
    recordsSection(duplicateChoice, "tool-corpus").items[0]!.values.content = ["code", "code"];
    expect(parse(duplicateChoice)).toMatchObject({ ok: false });

    const textAsArray = structuredClone(fixture());
    recordsSection(textAsArray, "rendering-ownership").items[0]!.values.owner = ["one", "two"];
    expect(parse(textAsArray)).toMatchObject({ ok: false });
  });

  test("validates decision additions against their target records section", () => {
    const unknownTarget = structuredClone(fixture());
    allDecisions(unknownTarget)[0]!.options[0]!.adds[0]!.sectionId = "missing";
    expect(parse(unknownTarget)).toMatchObject({ ok: false });

    const existingAddition = structuredClone(fixture());
    allDecisions(existingAddition)[0]!.options[0]!.adds[0]!.change = "existing";
    expect(parse(existingAddition)).toMatchObject({ ok: false });

    const incompleteAddition = structuredClone(fixture());
    delete allDecisions(incompleteAddition)[0]!.options[0]!.adds[0]!.values.owner;
    expect(parse(incompleteAddition)).toMatchObject({ ok: false });

    const existingExhibit = optionExhibitsFixture();
    allDecisions(existingExhibit)[0]!.options[0]!.exhibit!.change = "existing";
    const existingExhibitPlan = plan(existingExhibit, "implementation");
    if (!("steps" in existingExhibitPlan)) throw new Error("Expected flat plan");
    existingExhibitPlan.steps[0]!.implements = ["durable-result"];
    expect(parse(existingExhibit)).toMatchObject({
      ok: false,
      error: expect.stringContaining("only changed or preserved exhibits"),
    });

    expect(allDecisions(fixture())[0]!.options[2]!.adds).toEqual([]);
  });

  test("validates decision state and factual dependencies globally", () => {
    const oneOption = structuredClone(fixture());
    allDecisions(oneOption)[0]!.options.splice(1);
    expect(parse(oneOption)).toMatchObject({ ok: false });

    const duplicateLabel = structuredClone(fixture());
    const duplicateLabelDecision = allDecisions(duplicateLabel)[0]!;
    duplicateLabelDecision.options[1]!.label = duplicateLabelDecision.options[0]!.label;
    expect(parse(duplicateLabel)).toMatchObject({ ok: false });

    const unknownChoice = structuredClone(fixture());
    const decision = allDecisions(unknownChoice)[0]!;
    decision.choice = { optionId: "missing", status: "provisional" };
    expect(parse(unknownChoice)).toMatchObject({ ok: false });

    const inconsistent = structuredClone(fixture());
    Reflect.set(allDecisions(inconsistent)[0]!, "choice", { status: "decided" });
    expect(parse(inconsistent)).toMatchObject({ ok: false });

    const unknownDependency = structuredClone(fixture());
    allDecisions(unknownDependency)[0]!.dependsOn = ["missing"];
    expect(parse(unknownDependency)).toMatchObject({ ok: false });
  });

  test("validates relationship and affected-entity references", () => {
    const unknownEndpoint = structuredClone(fixture());
    firstDecisionOptionRelationship(unknownEndpoint).to = "missing";
    expect(parse(unknownEndpoint)).toMatchObject({ ok: false });

    const selfRelationship = structuredClone(fixture());
    const relationship = firstDecisionOptionRelationship(selfRelationship);
    relationship.to = relationship.from;
    expect(parse(selfRelationship)).toMatchObject({ ok: false });

    const unknownAffected = structuredClone(fixture());
    allQuestions(unknownAffected)[0]!.affects = ["missing"];
    expect(parse(unknownAffected)).toMatchObject({ ok: false });

    const repeatedAffected = structuredClone(fixture());
    allQuestions(repeatedAffected)[0]!.affects = ["ordinary-tools", "ordinary-tools"];
    expect(parse(repeatedAffected)).toMatchObject({ ok: false });

    const repeatedDecisionAffected = structuredClone(fixture());
    allDecisions(repeatedDecisionAffected)[0]!.affects = ["ordinary-tools", "ordinary-tools"];
    expect(parse(repeatedDecisionAffected)).toMatchObject({ ok: false });

    const unknownOptionEndpoint = structuredClone(fixture());
    firstDecisionOptionRelationship(unknownOptionEndpoint).to = "bespoke-diff";
    expect(parse(unknownOptionEndpoint)).toMatchObject({ ok: false });

    const duplicateRelationship = structuredClone(fixture());
    const decision = allDecisions(duplicateRelationship)[0]!;
    decision.options[1]!.relationships = [
      {
        id: firstDecisionOptionRelationship(duplicateRelationship).id,
        from: "ordinary-tools",
        to: "fallback-owner",
        kind: "preserves",
      },
    ];
    expect(parse(duplicateRelationship)).toMatchObject({ ok: false });

    const sameOptionExhibit = optionExhibitsFixture();
    allDecisions(sameOptionExhibit)[0]!.options[0]!.relationships!.push({
      id: "durable-result-uses-preview",
      from: "durable-result",
      to: "durable-state-preview",
      kind: "realized-by",
    });
    expect(parse(sameOptionExhibit)).toMatchObject({ ok: true });

    const otherOptionExhibit = optionExhibitsFixture();
    allDecisions(otherOptionExhibit)[0]!.options[0]!.relationships!.push({
      id: "durable-result-uses-ephemeral-preview",
      from: "durable-result",
      to: "ephemeral-state-preview",
      kind: "realized-by",
    });
    expect(parse(otherOptionExhibit)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unknown entity"),
    });
  });

  test("keeps an option-owned flow within its alternative's entity boundary", () => {
    const ownOptionFlow = optionExhibitsFixture();
    const decision = allDecisions(ownOptionFlow)[0]!;
    decision.options[0]!.exhibit = {
      id: "durable-state-preview",
      title: "Durable state route",
      kind: "flow",
      change: "new",
      nodes: [{ entity: "changed-behavior" }, { entity: "durable-result" }],
      connections: [
        {
          id: "behavior-restores-durable-result",
          from: "changed-behavior",
          to: "durable-result",
          label: "restores",
        },
      ],
      paths: [
        {
          id: "durable-route",
          title: "Restore durable state",
          purpose: "Show the behavior and result owned by this alternative.",
          start: "changed-behavior",
          connectionIds: ["behavior-restores-durable-result"],
        },
      ],
    };
    expect(parse(ownOptionFlow)).toMatchObject({ ok: true });

    const crossOptionFlow = structuredClone(ownOptionFlow);
    const flow = allDecisions(crossOptionFlow)[0]!.options[0]!.exhibit;
    if (flow?.kind !== "flow") throw new Error("Missing option flow");
    flow.nodes[1] = { entity: "ephemeral-state-preview" };
    flow.connections[0]!.to = "ephemeral-state-preview";
    expect(parse(crossOptionFlow)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Unknown entity"),
    });
  });

  test("rejects duplicate list items and choice vocabularies", () => {
    const duplicateList = structuredClone(fixture());
    const list = duplicateList.sections.find((section) => section.kind === "list");
    if (!list) throw new Error("Expected list");
    list.items.push(list.items[0]!);
    expect(parse(duplicateList)).toMatchObject({ ok: false });

    const duplicateVocabulary = structuredClone(fixture());
    const field = recordsSection(duplicateVocabulary, "tool-corpus").fields[0]!;
    if (field.kind !== "choice") throw new Error("Expected choice field");
    field.options[1]!.id = field.options[0]!.id;
    expect(parse(duplicateVocabulary)).toMatchObject({ ok: false });
  });

  test("parses pseudocode definitions as intent entities", () => {
    const document = exhibitsFixture();
    const section = findExhibitsSection(document, "technical-definitions");
    const pseudocode = section?.items[0];

    expect(section).toBeDefined();
    expect(pseudocode).toMatchObject({
      id: "body-declaration",
      kind: "pseudocode",
      content: 'const body = {\n  kind: "text",\n  value: result,\n};\n',
    });
    expect(findIntentEntity(document, "body-declaration")).toMatchObject({
      label: "Declared body shape",
      change: "new",
      owner: { kind: "section", section: { id: "technical-definitions" } },
    });
    expect(
      specState(document)
        .requirements.filter((entity) => entity.type === "exhibit")
        .map((entity) => entity.id),
    ).toEqual(["shared-rendering-flow", "body-declaration", "renderer-rollout"]);
  });

  test("parses multiple file-tree roots as one tree exhibit requirement", () => {
    const document = exhibitsFixture();
    const section = findExhibitsSection(document, "technical-definitions")!;
    section.items.push({
      id: "target-files",
      title: "Target file structure",
      kind: "tree",
      type: "files",
      change: "modified",
      description: "Make the resulting ownership visible in the spec.",
      source: "src/features/files/components/editor/kinds/intent/IntentEditor.tsx",
      roots: [
        {
          kind: "folder",
          name: "src/features/files",
          change: "modified",
          children: [
            {
              kind: "folder",
              name: "renderers",
              change: "new",
              children: [
                { kind: "file", name: "FileTree.tsx", change: "new" },
                { kind: "file", name: "legacy.ts", change: "removed" },
              ],
            },
            { kind: "file", name: "IntentEditor.tsx", change: "modified" },
          ],
        },
        {
          kind: "folder",
          name: "tests",
          children: [{ kind: "file", name: "file-tree.test.tsx", change: "new" }],
        },
      ],
    });

    const parsed = parse(document);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(findIntentEntity(parsed.value, "target-files")).toMatchObject({
      type: "exhibit",
      label: "Target file structure",
      change: "modified",
    });
    expect(specState(parsed.value).requirements.map((entity) => entity.id)).toContain(
      "target-files",
    );
  });

  test("parses a domain tree as one exhibit without promoting its concepts to entities", () => {
    const document = exhibitsFixture();
    const section = findExhibitsSection(document, "technical-definitions")!;
    section.items.push({
      id: "intent-domain",
      title: "Intent document domain",
      kind: "tree",
      type: "domain",
      change: "new",
      roots: [
        {
          name: "Intent document",
          children: [
            {
              name: "Spec",
              change: "modified",
              children: [{ name: "Description" }, { name: "Definition" }],
            },
            { name: "Plan" },
          ],
        },
      ],
    });

    const parsed = parse(document);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(findIntentEntity(parsed.value, "intent-domain")).toMatchObject({
      type: "exhibit",
      label: "Intent document domain",
      change: "new",
    });
    expect(findIntentEntity(parsed.value, "Spec")).toBeUndefined();
    expect(specState(parsed.value).requirements.map((entity) => entity.id)).toContain(
      "intent-domain",
    );
  });

  test("requires tree roots, supported node changes, and unique sibling names", () => {
    const document = exhibitsFixture();
    const section = findExhibitsSection(document, "technical-definitions")!;
    section.items.push({
      id: "target-files",
      title: "Target file structure",
      kind: "tree",
      type: "files",
      change: "new",
      roots: [
        {
          kind: "folder",
          name: "src",
          children: [{ kind: "file", name: "index.ts" }],
        },
      ],
    });
    const duplicateSibling = structuredClone(document);
    const duplicateSection = findExhibitsSection(duplicateSibling, "technical-definitions")!;
    const duplicateTree = duplicateSection.items.at(-1)!;
    if (
      duplicateTree.kind !== "tree" ||
      duplicateTree.type !== "files" ||
      duplicateTree.roots[0]?.kind !== "folder"
    ) {
      throw new Error("Missing file-tree exhibit fixture");
    }
    duplicateTree.roots[0].children.push({
      kind: "file",
      name: "index.ts",
      change: "new",
    });
    expect(parse(duplicateSibling)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Sibling names"),
    });

    const duplicateDomain = exhibitsFixture();
    const domainSection = findExhibitsSection(duplicateDomain, "technical-definitions")!;
    domainSection.items.push({
      id: "duplicate-domain",
      title: "Duplicate domain",
      kind: "tree",
      type: "domain",
      change: "new",
      roots: [
        {
          name: "Document",
          children: [{ name: "Spec" }, { name: "Spec" }],
        },
      ],
    });
    expect(parse(duplicateDomain)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Sibling names"),
    });

    const invalidChange = JSON.parse(serializeIntent(document));
    const invalidChangeExhibit = invalidChange.sections
      .find((candidate: { id: string }) => candidate.id === "technical-definitions")
      .items.find((candidate: { id: string }) => candidate.id === "target-files");
    invalidChangeExhibit.roots[0].children[0].change = "preserved";
    expect(parse(invalidChange)).toMatchObject({ ok: false });

    const missingRoot = JSON.parse(serializeIntent(document));
    const missingRootExhibit = missingRoot.sections
      .find((candidate: { id: string }) => candidate.id === "technical-definitions")
      .items.find((candidate: { id: string }) => candidate.id === "target-files");
    missingRootExhibit.roots = [];
    expect(parse(missingRoot)).toMatchObject({ ok: false });
  });

  test("validates exhibit source and non-empty pseudocode", () => {
    const blankSource = structuredClone(exhibitsFixture());
    const blankSection = findExhibitsSection(blankSource, "technical-definitions")!;
    const blankPseudocode = blankSection.items[0]!;
    if (blankPseudocode.kind !== "pseudocode") {
      throw new Error("Missing pseudocode exhibit");
    }
    blankPseudocode.content = " \n ";
    expect(parse(blankSource)).toMatchObject({ ok: false });

    const missingSource = structuredClone(exhibitsFixture());
    const sourceSection = findExhibitsSection(missingSource, "technical-definitions")!;
    const sourcedPseudocode = sourceSection.items[1]!;
    if (sourcedPseudocode.kind !== "pseudocode") {
      throw new Error("Missing sourced pseudocode exhibit");
    }
    delete sourcedPseudocode.source;
    expect(parse(missingSource)).toMatchObject({ ok: false });
  });

  test("accepts URI-backed images and URI or inline HTML exhibits", () => {
    const document = exhibitsFixture();
    const section = findExhibitsSection(document, "technical-definitions")!;
    section.items.push({
      id: "architecture-image",
      title: "Architecture",
      kind: "image",
      change: "new",
      uri: "./architecture.svg",
      altText: "The architecture boundary.",
    });
    section.items.push({
      id: "interactive-prototype",
      title: "Interactive prototype",
      kind: "html",
      change: "new",
      uri: "./prototype.html",
    });
    section.items.push({
      id: "embedded-architecture",
      title: "Embedded architecture",
      kind: "html",
      change: "new",
      content:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" /></svg>',
    });
    expect(parse(document)).toMatchObject({ ok: true });

    const image = section.items.at(-3)!;
    if (image.kind !== "image") throw new Error("Missing image exhibit");
    image.uri = "https://example.com/architecture.png";
    expect(parse(document)).toMatchObject({ ok: true });

    const html = section.items.at(-2)!;
    if (html.kind !== "html" || !("uri" in html)) throw new Error("Missing HTML URI exhibit");
    html.uri = "https://example.com/prototype";
    expect(parse(document)).toMatchObject({ ok: true });

    for (const uri of [
      "/architecture.svg",
      "//example.com/architecture.svg",
      String.raw`images\architecture.svg`,
      "file:///tmp/architecture.svg",
      "data:image/png;base64,AA==",
      "javascript:alert(1)",
    ]) {
      html.uri = uri;
      expect(parse(document)).toMatchObject({ ok: false });
    }
  });

  test("requires image alternative text", () => {
    const document = JSON.parse(serializeIntent(exhibitsFixture()));
    const section = document.sections.find(
      (candidate: { id: string }) => candidate.id === "technical-definitions",
    );
    section.items.push({
      id: "architecture-image",
      title: "Architecture",
      kind: "image",
      change: "new",
      uri: "./architecture.svg",
    });

    expect(parse(document)).toMatchObject({ ok: false });
  });

  test("requires exactly one non-empty HTML content or URI", () => {
    const bothSources = exhibitsFixture();
    const bothSection = findExhibitsSection(bothSources, "technical-definitions")!;
    bothSection.items.push({
      id: "embedded-prototype",
      title: "Embedded prototype",
      kind: "html",
      change: "new",
      content: "<main>Prototype</main>",
    });
    Object.assign(bothSection.items.at(-1)!, { uri: "./prototype.html" });
    expect(parse(bothSources)).toMatchObject({ ok: false });

    const missingSource = exhibitsFixture();
    const missingSection = findExhibitsSection(missingSource, "technical-definitions")!;
    missingSection.items.push({
      id: "linked-prototype",
      title: "Linked prototype",
      kind: "html",
      change: "new",
      uri: "./prototype.html",
    });
    Reflect.deleteProperty(missingSection.items.at(-1)!, "uri");
    expect(parse(missingSource)).toMatchObject({ ok: false });

    const blankContent = exhibitsFixture();
    findExhibitsSection(blankContent, "technical-definitions")!.items.push({
      id: "blank-prototype",
      title: "Blank prototype",
      kind: "html",
      change: "new",
      content: " \n ",
    });
    expect(parse(blankContent)).toMatchObject({ ok: false });
  });

  test("keeps the bundled worked example valid", () => {
    const parsed = parseIntent(exampleIntent);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.error);
    const spec = specState(parsed.value);
    const state = planState(planSections(parsed.value), spec);
    if (!state) throw new Error("Missing example plan");
    expect(state.fullyPlanned).toBe(true);
    expect(state.steps.map((step) => step.id)).toEqual([
      "define-tool-body-step",
      "move-ordinary-tools-step",
      "protect-specialized-tools-step",
    ]);
  });

  test("serializes parsed defaults deterministically", () => {
    const document = fixture();
    const serialized = serializeIntent(document);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(parseIntent(serialized)).toEqual({ ok: true, value: document });
  });
});
