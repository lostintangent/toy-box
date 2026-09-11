import {
  decisionEntity,
  exhibitEntity,
  intentEntitiesFrom,
  recordEntity,
  selectedDecisionOption,
  selectedAdditionsFrom,
  type IntentEntity,
} from "../query/reading";
import { buildIntentIndex, type IntentIndex } from "../query/structure";
import type { Decision, IntentDocument, Question } from "../schema";

/** Execution inputs and settlement state derived from an Intent document's effective spec. */
export type SpecState = {
  guidance: IntentEntity[];
  requirements: IntentEntity[];
  openQuestions: Question[];
  unresolvedDecisions: Decision[];
  settled: boolean;
};

export function specState(document: IntentDocument): SpecState {
  const index = buildIntentIndex(document.sections);
  const openQuestions = index.questions.filter((question) => !question.answer);
  const unresolvedDecisions = index.decisions.filter(
    (decision) => decision.choice?.status !== "decided",
  );

  return {
    guidance: specGuidanceFrom(index),
    requirements: specRequirementsFrom(index),
    openQuestions,
    unresolvedDecisions,
    settled: openQuestions.length === 0 && unresolvedDecisions.length === 0,
  };
}

export function unresolvedDependencies(document: IntentDocument, decision: Decision): Question[] {
  return unresolvedDependenciesFrom(buildIntentIndex(document.sections), decision);
}

function unresolvedDependenciesFrom(index: IntentIndex, decision: Decision): Question[] {
  return decision.dependsOn.flatMap((questionId) => {
    const dependency = index.questionsById.get(questionId);
    return dependency && !dependency.answer ? [dependency] : [];
  });
}

function specGuidanceFrom(index: IntentIndex): IntentEntity[] {
  const guidanceIds = new Set(
    index.specSections
      .filter((section) => section.kind === "markdown" || section.kind === "list")
      .map((section) => section.id),
  );
  return intentEntitiesFrom(index).filter((entity) => guidanceIds.has(entity.id));
}

function specRequirementsFrom(index: IntentIndex): IntentEntity[] {
  const sectionRequirements = index.specSections.flatMap((section): IntentEntity[] => {
    if (section.kind === "exhibits") {
      return section.items
        .filter((item) => item.change !== "existing")
        .map((item) => exhibitEntity(item, { kind: "section", section }));
    }
    if (section.kind !== "records") return [];
    return [
      ...section.items
        .filter((record) => record.change !== "existing")
        .map((record) => recordEntity(section, record)),
      ...selectedAdditionsFrom(index, section.id)
        .filter((selected) => selected.status === "decided")
        .map((selected) => recordEntity(section, selected.item)),
    ];
  });
  const optionExhibits: IntentEntity[] = index.decisions.flatMap((decision) => {
    if (decision.choice?.status !== "decided") return [];
    const option = selectedDecisionOption(decision);
    return option?.exhibit
      ? [exhibitEntity(option.exhibit, { kind: "decision-option", decision, option })]
      : [];
  });
  const decisions: IntentEntity[] = index.decisions
    .filter((decision) => {
      if (decision.choice?.status !== "decided") return false;
      const option = selectedDecisionOption(decision);
      return option?.adds.length === 0 && !option.exhibit;
    })
    .map((decision) => decisionEntity(decision));
  return [...sectionRequirements, ...optionExhibits, ...decisions];
}
