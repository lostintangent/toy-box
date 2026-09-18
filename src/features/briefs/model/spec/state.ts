import {
  decisionEntity,
  exhibitEntity,
  briefEntitiesFrom,
  recordEntity,
  selectedDecisionOption,
  selectedAdditionsFrom,
  type BriefEntity,
} from "../query/reading";
import { buildBriefIndex, type BriefIndex } from "../query/structure";
import type { Decision, BriefDocument, Question } from "../schema";

/** Execution inputs and settlement state derived from a Brief document's effective spec. */
export type SpecState = {
  guidance: BriefEntity[];
  requirements: BriefEntity[];
  openQuestions: Question[];
  unresolvedDecisions: Decision[];
  settled: boolean;
};

export function specState(document: BriefDocument): SpecState {
  const index = buildBriefIndex(document.sections);
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

export function unresolvedDependencies(document: BriefDocument, decision: Decision): Question[] {
  return unresolvedDependenciesFrom(buildBriefIndex(document.sections), decision);
}

function unresolvedDependenciesFrom(index: BriefIndex, decision: Decision): Question[] {
  return decision.dependsOn.flatMap((questionId) => {
    const dependency = index.questionsById.get(questionId);
    return dependency && !dependency.answer ? [dependency] : [];
  });
}

function specGuidanceFrom(index: BriefIndex): BriefEntity[] {
  const guidanceIds = new Set(
    index.specSections
      .filter((section) => section.kind === "markdown" || section.kind === "list")
      .map((section) => section.id),
  );
  return briefEntitiesFrom(index).filter((entity) => guidanceIds.has(entity.id));
}

function specRequirementsFrom(index: BriefIndex): BriefEntity[] {
  const sectionRequirements = index.specSections.flatMap((section): BriefEntity[] => {
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
  const optionExhibits: BriefEntity[] = index.decisions.flatMap((decision) => {
    if (decision.choice?.status !== "decided") return [];
    const option = selectedDecisionOption(decision);
    return option?.exhibit
      ? [exhibitEntity(option.exhibit, { kind: "decision-option", decision, option })]
      : [];
  });
  const decisions: BriefEntity[] = index.decisions
    .filter((decision) => {
      if (decision.choice?.status !== "decided") return false;
      const option = selectedDecisionOption(decision);
      return option?.adds.length === 0 && !option.exhibit;
    })
    .map((decision) => decisionEntity(decision));
  return [...sectionRequirements, ...optionExhibits, ...decisions];
}
