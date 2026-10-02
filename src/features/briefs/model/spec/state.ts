import {
  decisionEntity,
  exhibitEntity,
  recordEntity,
  sectionEntity,
  type BriefEntity,
} from "../query/entities";
import { activeAdditions, activeOptions, isSelfContainedOption } from "../query/options";
import { buildBriefIndex, isDescriptionSection, type BriefIndex } from "../query/structure";
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
    guidance: index.specSections.filter(isDescriptionSection).map(sectionEntity),
    requirements: specRequirementsFrom(index),
    openQuestions,
    unresolvedDecisions,
    settled: openQuestions.length === 0 && unresolvedDecisions.length === 0,
  };
}

export function unresolvedDependencies(document: BriefDocument, decision: Decision): Question[] {
  const { questionsById } = buildBriefIndex(document.sections);
  return decision.dependsOn.flatMap((questionId) => {
    const dependency = questionsById.get(questionId);
    return dependency && !dependency.answer ? [dependency] : [];
  });
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
      ...activeAdditions(index, section.id)
        .filter(({ activeOption }) => activeOption.status === "decided")
        .map(({ record }) => recordEntity(section, record)),
    ];
  });
  const decided = activeOptions(index).filter(({ status }) => status === "decided");
  const optionExhibits = decided.flatMap(({ decision, option }) =>
    option.exhibit
      ? [exhibitEntity(option.exhibit, { kind: "decision-option", decision, option })]
      : [],
  );
  const decisions = decided
    .filter(({ option }) => isSelfContainedOption(option))
    .map(({ decision }) => decisionEntity(decision));
  return [...sectionRequirements, ...optionExhibits, ...decisions];
}
