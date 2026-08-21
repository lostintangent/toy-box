import { describe, expect, test } from "bun:test";
import exampleIntent from "@files/server/skills/create-toy-box-intent/references/example.intent?raw";
import { parseIntent, serializeIntent } from "./schema";
import {
  allDecisions,
  allQuestions,
  effectiveRelations,
  findExhibitsSection,
  findIntentEntity,
} from "./projection";
import { relationshipMapRelations } from "./maps";
import { deliveryProjection, implementationObligations } from "./delivery";
import { sectionItemCount } from "./display";
import {
  exhibitsFixture,
  fixture,
  fixtureInput,
  mapSection,
  parse,
  sequencedFixture,
  recordsSection,
  sequence,
} from "./testFixtures";

describe("intent schema", () => {
  test("parses a task-defined form with all section primitives", () => {
    const parsed = parse(fixtureInput());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.sections.map((section) => section.kind)).toEqual([
      "prose",
      "group",
      "records",
      "records",
      "map",
      "group",
      "list",
    ]);
    expect(allQuestions(parsed.value)).toHaveLength(1);
    expect(allDecisions(parsed.value)).toHaveLength(1);
    expect(effectiveRelations(parsed.value)).toHaveLength(1);
    expect(mapSection(parsed.value, "shared-rendering-path").title).toBe(
      "Follow the shared rendering path",
    );
  });

  test("rejects retired document, section, and display vocabulary", () => {
    const retiredVersion = { ...fixtureInput(), version: 2 };
    expect(parse(retiredVersion)).toMatchObject({ ok: false });

    const retiredFraming = JSON.parse(JSON.stringify(fixtureInput()));
    retiredFraming.framing = "A special root introduction.";
    expect(parse(retiredFraming)).toMatchObject({ ok: false });

    const retiredNarrative = JSON.parse(JSON.stringify(fixtureInput()));
    retiredNarrative.sections[0].kind = "narrative";
    expect(parse(retiredNarrative)).toMatchObject({ ok: false });

    const retiredCollection = JSON.parse(JSON.stringify(fixtureInput()));
    const collection = retiredCollection.sections.find(
      (section: { id: string }) => section.id === "tool-corpus",
    );
    collection.kind = "collection";
    collection.presentation = collection.view;
    delete collection.view;
    expect(parse(retiredCollection)).toMatchObject({ ok: false });

    const retiredPresentation = JSON.parse(JSON.stringify(fixtureInput()));
    const records = retiredPresentation.sections.find(
      (section: { id: string }) => section.id === "tool-corpus",
    );
    records.presentation = records.view;
    expect(parse(retiredPresentation)).toMatchObject({ ok: false });

    const retiredContract = JSON.parse(JSON.stringify(fixtureInput()));
    retiredContract.sections[0].contract = false;
    expect(parse(retiredContract)).toMatchObject({ ok: false });

    const retiredCategory = JSON.parse(JSON.stringify(fixtureInput()));
    retiredCategory.sections[0].category = "context";
    expect(parse(retiredCategory)).toMatchObject({ ok: false });
  });

  test("rejects invalid JSON, unknown keys, and retired fixed sections", () => {
    expect(parseIntent("")).toMatchObject({ ok: false });
    expect(parseIntent("{")).toMatchObject({ ok: false });
    expect(parse({ ...fixtureInput(), extra: true })).toMatchObject({
      ok: false,
    });
    expect(parse({ ...fixtureInput(), domainImpact: {} })).toMatchObject({
      ok: false,
    });
    expect(parse({ ...fixtureInput(), productImpact: [] })).toMatchObject({
      ok: false,
    });
    expect(parse({ ...fixtureInput(), views: [] })).toMatchObject({
      ok: false,
    });
  });

  test("accepts Markdown prose while keeping compact text fields constrained", () => {
    expect(parse(fixtureInput())).toMatchObject({ ok: true });
    const withProseBody = (body: string) => {
      const input = JSON.parse(JSON.stringify(fixtureInput()));
      input.sections[0].body = body;
      return input;
    };
    expect(
      parse(
        withProseBody(
          "# Result\n\nProse can use **emphasis**, [links](https://example.com), and other Markdown.",
        ),
      ),
    ).toMatchObject({ ok: true });
    expect(parse(withProseBody("A broken **phrase remains valid Markdown input."))).toMatchObject({
      ok: true,
    });
    expect(parse(withProseBody("   "))).toMatchObject({ ok: false });

    const invalidList = JSON.parse(JSON.stringify(fixtureInput()));
    const list = invalidList.sections.find((section: { kind: string }) => section.kind === "list");
    list.items[0] = "A broken **list item.";
    expect(parse(invalidList)).toMatchObject({ ok: false });
  });

  test("requires globally unique graph entity IDs", () => {
    const duplicateSection = structuredClone(fixture());
    duplicateSection.sections[2]!.id = "concepts";
    expect(parse(duplicateSection)).toMatchObject({ ok: false });

    const duplicateRecord = structuredClone(fixture());
    recordsSection(duplicateRecord, "rendering-ownership").items[0]!.id = "bash";
    expect(parse(duplicateRecord)).toMatchObject({ ok: false });

    const duplicateOptionRecord = structuredClone(fixture());
    allDecisions(duplicateOptionRecord)[0]!.options[0]!.adds[0]!.id = "bash";
    expect(parse(duplicateOptionRecord)).toMatchObject({ ok: false });

    const duplicateWork = structuredClone(sequencedFixture());
    const delivery = sequence(duplicateWork, "implementation");
    if (!("items" in delivery)) throw new Error("Expected flat sequence");
    delivery.items[1]!.id = delivery.items[0]!.id;
    expect(parse(duplicateWork)).toMatchObject({ ok: false });

    const duplicateAcrossTypes = structuredClone(sequencedFixture());
    recordsSection(duplicateAcrossTypes, "behavior").items[0]!.id = "foundation-work";
    duplicateAcrossTypes.relations[0]!.from = "foundation-work";
    allDecisions(duplicateAcrossTypes)[0]!.options[0]!.relations[0]!.from = "foundation-work";
    expect(parse(duplicateAcrossTypes)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Graph entity IDs must be unique"),
    });
  });

  test("resolves ID-only references to typed entities", () => {
    const definition = sequencedFixture();
    expect(findIntentEntity(definition, "changed-behavior")).toMatchObject({
      type: "record",
      record: { subject: "Changed behavior" },
    });
    expect(findIntentEntity(definition, "foundation-work")).toMatchObject({
      type: "work",
      work: { title: "Build the foundation" },
    });
  });

  test("enforces relationship endpoint types after resolving IDs", () => {
    const wrongEndpointType = structuredClone(sequencedFixture());
    wrongEndpointType.relations[0]!.to = "durability-policy";
    expect(parse(wrongEndpointType)).toMatchObject({
      ok: false,
      error: expect.stringContaining("must target an item in the delivery sequence"),
    });
  });

  test("rejects retired typed entity references", () => {
    const retiredTypedReference = JSON.parse(JSON.stringify(fixtureInput()));
    retiredTypedReference.relations[0].from = {
      type: "record",
      id: "ordinary-tools",
    };
    expect(parse(retiredTypedReference)).toMatchObject({ ok: false });
  });

  test("lets each records section choose its provenance policy", () => {
    const missingCode = structuredClone(fixture());
    delete recordsSection(missingCode, "tool-corpus").items[0]!.provenance;
    expect(parse(missingCode)).toMatchObject({ ok: false });

    const absoluteCode = structuredClone(fixture());
    recordsSection(absoluteCode, "tool-corpus").items[0]!.provenance = "/tmp/source.ts";
    expect(parse(absoluteCode)).toMatchObject({ ok: false });

    const referenced = structuredClone(fixture());
    const corpus = recordsSection(referenced, "tool-corpus");
    corpus.provenance = "reference";
    corpus.items[0]!.provenance = "https://example.test/tool-corpus";
    expect(parse(referenced)).toMatchObject({ ok: true });

    const optional = structuredClone(fixture());
    const ownership = recordsSection(optional, "rendering-ownership");
    ownership.provenance = "optional";
    delete ownership.items[0]!.provenance;
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

    expect(allDecisions(fixture())[0]!.options[2]!.adds).toEqual([]);
  });

  test("validates decision state and factual dependencies globally", () => {
    const unknownChoice = structuredClone(fixture());
    const decision = allDecisions(unknownChoice)[0]!;
    decision.chosen = "missing";
    decision.status = "provisional";
    expect(parse(unknownChoice)).toMatchObject({ ok: false });

    const inconsistent = structuredClone(fixture());
    allDecisions(inconsistent)[0]!.status = "decided";
    expect(parse(inconsistent)).toMatchObject({ ok: false });

    const unknownDependency = structuredClone(fixture());
    allDecisions(unknownDependency)[0]!.dependsOn = ["missing"];
    expect(parse(unknownDependency)).toMatchObject({ ok: false });
  });

  test("validates relationship and affected-entity references", () => {
    const unknownEndpoint = structuredClone(fixture());
    unknownEndpoint.relations[0]!.to = "missing";
    expect(parse(unknownEndpoint)).toMatchObject({ ok: false });

    const selfRelation = structuredClone(fixture());
    selfRelation.relations[0]!.to = selfRelation.relations[0]!.from;
    expect(parse(selfRelation)).toMatchObject({ ok: false });

    const unknownAffected = structuredClone(fixture());
    allQuestions(unknownAffected)[0]!.affects = ["missing"];
    expect(parse(unknownAffected)).toMatchObject({ ok: false });

    const unknownOptionEndpoint = structuredClone(fixture());
    allDecisions(unknownOptionEndpoint)[0]!.options[0]!.relations[0]!.to = "bespoke-diff";
    expect(parse(unknownOptionEndpoint)).toMatchObject({ ok: false });

    const duplicateRelation = structuredClone(fixture());
    allDecisions(duplicateRelation)[0]!.options[0]!.relations[0]!.id =
      duplicateRelation.relations[0]!.id;
    expect(parse(duplicateRelation)).toMatchObject({ ok: false });
  });

  test("rejects duplicate list items and choice vocabularies", () => {
    const duplicateList = structuredClone(fixture());
    const list = duplicateList.sections[6]!;
    if (list.kind !== "list") throw new Error("Expected list");
    list.items.push(list.items[0]!);
    expect(parse(duplicateList)).toMatchObject({ ok: false });

    const duplicateVocabulary = structuredClone(fixture());
    const field = recordsSection(duplicateVocabulary, "tool-corpus").fields[0]!;
    if (field.kind !== "choice") throw new Error("Expected choice field");
    field.options[1]!.id = field.options[0]!.id;
    expect(parse(duplicateVocabulary)).toMatchObject({ ok: false });
  });

  test("parses exact code and ordered procedure exhibits as graph entities", () => {
    const definition = exhibitsFixture();
    const section = findExhibitsSection(definition, "exact-handoff");
    const code = section?.items[0];

    expect(section).toBeDefined();
    expect(sectionItemCount(definition, section!)).toBe(2);
    expect(code).toMatchObject({
      id: "body-declaration",
      kind: "code",
      content: 'const body = {\n  kind: "text",\n  value: result,\n};\n',
    });
    expect(findIntentEntity(definition, "body-declaration")).toMatchObject({
      label: "Declared body shape",
      change: "new",
      section: { id: "exact-handoff" },
    });
    expect(
      implementationObligations(definition)
        .filter((entity) => entity.type === "exhibit")
        .map((entity) => entity.id),
    ).toEqual(["body-declaration", "renderer-rollout"]);
    expect(
      relationshipMapRelations(definition).some(
        ({ relation }) => relation.to === "body-declaration",
      ),
    ).toBe(true);
  });

  test("validates exhibit source, grounding, and stable procedure steps", () => {
    const blankSource = structuredClone(exhibitsFixture());
    const blankSection = findExhibitsSection(blankSource, "exact-handoff")!;
    const blankCode = blankSection.items[0]!;
    if (blankCode.kind !== "code") throw new Error("Missing code exhibit");
    blankCode.content = " \n ";
    expect(parse(blankSource)).toMatchObject({ ok: false });

    const missingProvenance = structuredClone(exhibitsFixture());
    const provenanceSection = findExhibitsSection(missingProvenance, "exact-handoff")!;
    const procedure = provenanceSection.items[1]!;
    if (procedure.kind !== "procedure") throw new Error("Missing procedure exhibit");
    delete procedure.provenance;
    expect(parse(missingProvenance)).toMatchObject({ ok: false });

    const duplicateStep = structuredClone(exhibitsFixture());
    const duplicateSection = findExhibitsSection(duplicateStep, "exact-handoff")!;
    const duplicateProcedure = duplicateSection.items[1]!;
    if (duplicateProcedure.kind !== "procedure") throw new Error("Missing procedure exhibit");
    duplicateProcedure.steps[1]!.id = duplicateProcedure.steps[0]!.id;
    expect(parse(duplicateStep)).toMatchObject({ ok: false });
  });

  test("accepts URI-backed images and URI or inline HTML exhibits", () => {
    const definition = exhibitsFixture();
    const section = findExhibitsSection(definition, "exact-handoff")!;
    section.items.push({
      id: "architecture-image",
      title: "Architecture",
      kind: "image",
      change: "new",
      uri: "./architecture.svg",
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
    expect(parse(definition)).toMatchObject({ ok: true });

    const image = section.items.at(-3)!;
    if (image.kind !== "image") throw new Error("Missing image exhibit");
    image.uri = "https://example.com/architecture.png";
    expect(parse(definition)).toMatchObject({ ok: true });

    const html = section.items.at(-2)!;
    if (html.kind !== "html" || !("uri" in html)) throw new Error("Missing HTML URI exhibit");
    html.uri = "https://example.com/prototype";
    expect(parse(definition)).toMatchObject({ ok: true });

    for (const uri of [
      "/architecture.svg",
      "//example.com/architecture.svg",
      String.raw`images\architecture.svg`,
      "file:///tmp/architecture.svg",
      "data:image/png;base64,AA==",
      "javascript:alert(1)",
    ]) {
      html.uri = uri;
      expect(parse(definition)).toMatchObject({ ok: false });
    }
  });

  test("requires exactly one non-empty HTML exhibit source", () => {
    const bothSources = exhibitsFixture();
    const bothSection = findExhibitsSection(bothSources, "exact-handoff")!;
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
    const missingSection = findExhibitsSection(missingSource, "exact-handoff")!;
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
    findExhibitsSection(blankContent, "exact-handoff")!.items.push({
      id: "blank-prototype",
      title: "Blank prototype",
      kind: "html",
      change: "new",
      content: " \n ",
    });
    expect(parse(blankContent)).toMatchObject({ ok: false });
  });

  test("keeps the bundled flexible-form example valid", () => {
    const parsed = parseIntent(exampleIntent);
    expect(parsed).toMatchObject({ ok: true });
    if (!parsed.ok) throw new Error(parsed.error);
    const delivery = deliveryProjection(parsed.value);
    expect(delivery.complete).toBe(true);
    expect(delivery.phases.map((phase) => phase.map(({ entity }) => entity.id))).toEqual([
      ["define-tool-body-work"],
      ["move-ordinary-tools-work"],
      ["protect-specialized-tools-work"],
    ]);
  });

  test("serializes parsed defaults deterministically", () => {
    const definition = fixture();
    const serialized = serializeIntent(definition);
    expect(serialized.endsWith("\n")).toBe(true);
    expect(parseIntent(serialized)).toEqual({ ok: true, value: definition });
  });
});
