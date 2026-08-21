import { buildIntentIndex, type IntentIndex } from "./read";
import type { Decision, IntentDefinition, Question } from "./schema";

/**
 * Human and factual settlement: decision dependencies, unresolved questions,
 * and the review state that gates execution without prescribing delivery work.
 */

export function unresolvedDependencies(definition: IntentDefinition, item: Decision): Question[] {
  return unresolvedDependenciesFrom(buildIntentIndex(definition.sections), item);
}

function unresolvedDependenciesFrom(index: IntentIndex, item: Decision): Question[] {
  return item.dependsOn.flatMap((questionId) => {
    const dependency = index.questionsById.get(questionId);
    return dependency && !dependency.resolution ? [dependency] : [];
  });
}

/** Approval requires every factual question answered and every blocking choice settled. */
export function reviewReadiness(definition: IntentDefinition) {
  const index = buildIntentIndex(definition.sections);
  const openQuestions = index.questions.filter((item) => !item.resolution);
  const blockingDecisions = index.decisions.filter(
    (item) =>
      item.blocking &&
      (item.status !== "decided" || unresolvedDependenciesFrom(index, item).length > 0),
  );
  return {
    openQuestions,
    blockingDecisions,
    approvable: openQuestions.length === 0 && blockingDecisions.length === 0,
  };
}
