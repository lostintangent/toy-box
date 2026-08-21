import { describe, expect, test } from "bun:test";
import { allDecisions, allQuestions } from "./projection";
import { chooseOption } from "./transitions";
import { fixture } from "./testFixtures";
import { reviewReadiness } from "./workflow";

describe("intent workflow", () => {
  test("derives review readiness from every authored workflow section", () => {
    const definition = fixture();
    expect(reviewReadiness(definition)).toMatchObject({
      approvable: false,
      openQuestions: [{ id: "diff-capability" }],
      blockingDecisions: [{ id: "diff-treatment" }],
    });

    const ready = structuredClone(chooseOption(definition, "diff-treatment", "defer"));
    allQuestions(ready)[0]!.resolution = "No.";
    allDecisions(ready)[0]!.status = "decided";
    expect(reviewReadiness(ready)).toMatchObject({
      approvable: true,
      openQuestions: [],
      blockingDecisions: [],
    });
  });
});
