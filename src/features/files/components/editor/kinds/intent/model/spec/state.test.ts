import { describe, expect, test } from "bun:test";
import { allDecisions, allQuestions } from "../query/reading";
import { selectDecisionOption } from "../edit";
import { fixture, groundedFixture, optionExhibitsFixture, plannedFixture } from "../testFixtures";
import { specState } from "./state";

describe("intent spec", () => {
  test("derives guidance and requirements from flexible document sections", () => {
    const document = plannedFixture();
    document.sections.unshift({
      id: "execution-guidance",
      title: "Execution guidance",
      purpose: "Explain an implementation boundary without turning it into a requirement.",
      kind: "markdown",
      collapsed: false,
      body: "Keep the durable API independent from transcript presentation.",
    });

    const spec = specState(document);
    expect(spec.guidance.map((entity) => entity.id)).toEqual(["execution-guidance"]);
    expect(spec.requirements.map((entity) => entity.id)).toEqual([
      "changed-behavior",
      "durable-result",
    ]);
    const specEntityIds = [...spec.guidance, ...spec.requirements].map((entity) => entity.id);
    expect(specEntityIds).not.toContain("implementation");
    expect(specEntityIds).not.toContain("foundation-step");
  });

  test("uses decided additions as requirements without also counting their decision", () => {
    const document = plannedFixture();
    expect(specState(document).requirements.map((entity) => entity.id)).toEqual([
      "changed-behavior",
      "durable-result",
    ]);
  });

  test("does not reinterpret research findings or their evidence as requirements", () => {
    const spec = specState(groundedFixture());
    const specEntityIds = [...spec.guidance, ...spec.requirements].map((entity) => entity.id);

    expect(specEntityIds).not.toContain("research-findings");
    expect(specEntityIds).not.toContain("finding-shared-owner");
    expect(specEntityIds).not.toContain("current-rendering-ownership");
    expect(spec.requirements.map((entity) => entity.id)).toContain("ordinary-tools");
  });

  test("uses a decided choice as a requirement when it contributes no additions", () => {
    const document = structuredClone(selectDecisionOption(fixture(), "diff-treatment", "defer"));
    allQuestions(document)[0]!.answer = "No shared diff abstraction exists.";
    allDecisions(document)[0]!.choice!.status = "decided";

    expect(specState(document).requirements.map((entity) => entity.id)).toContain("diff-treatment");
  });

  test("activates only the decided option's exhibit without also counting its decision", () => {
    const open = optionExhibitsFixture();
    expect(specState(open).requirements.map((entity) => entity.id)).not.toContain(
      "durable-state-preview",
    );

    const provisional = selectDecisionOption(open, "durability-policy", "durable");
    expect(specState(provisional).requirements.map((entity) => entity.id)).not.toContain(
      "durable-state-preview",
    );

    allDecisions(provisional)[0]!.choice!.status = "decided";
    const requirementIds = specState(provisional).requirements.map((entity) => entity.id);
    expect(requirementIds).toContain("durable-state-preview");
    expect(requirementIds).not.toContain("ephemeral-state-preview");
    expect(requirementIds).not.toContain("durability-policy");
  });

  test("treats changed exhibits as spec requirements", () => {
    const document = plannedFixture();
    document.sections.push({
      id: "migration-interface",
      title: "Migration interface",
      purpose: "Define the command-line interface the spec requires.",
      kind: "exhibits",
      collapsed: false,
      sourcePolicy: "optional",
      items: [
        {
          id: "migration-command",
          title: "Migration command",
          kind: "pseudocode",
          change: "new",
          language: "bash",
          content: "toy-box migrate --durable-state",
        },
      ],
    });

    expect(specState(document).requirements.map((entity) => entity.id)).toContain(
      "migration-command",
    );
  });

  test("derives settlement from open questions and unresolved decisions", () => {
    const document = fixture();
    expect(specState(document)).toMatchObject({
      settled: false,
      openQuestions: [{ id: "diff-capability" }],
      unresolvedDecisions: [{ id: "diff-treatment" }],
    });

    const settled = structuredClone(selectDecisionOption(document, "diff-treatment", "defer"));
    allQuestions(settled)[0]!.answer = "No.";
    allDecisions(settled)[0]!.choice!.status = "decided";
    expect(specState(settled)).toMatchObject({
      settled: true,
      openQuestions: [],
      unresolvedDecisions: [],
    });
  });
});
