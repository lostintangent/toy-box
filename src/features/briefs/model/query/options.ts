import type {
  BriefDocument,
  BriefRecord,
  Decision,
  DecisionChoice,
  DecisionOption,
  DecisionStatus,
} from "../schema";
import { buildBriefIndex, type BriefIndex } from "./structure";

/**
 * How decisions resolve: each decision's status, the option it currently holds,
 * and the records active options add to the sections they target.
 */

export function decisionStatus(decision: Decision): DecisionStatus {
  return decision.choice?.status ?? "open";
}

/** An option that adds no records or exhibit is delivered through its decision itself. */
export function isSelfContainedOption(option: DecisionOption): boolean {
  return option.adds.length === 0 && !option.exhibit;
}

/** A decision option its decision currently holds, provisionally or decided. */
export type ActiveOption = {
  decision: Decision;
  option: DecisionOption;
  status: DecisionChoice["status"];
};

export function activeOption(decision: Decision): ActiveOption | undefined {
  const { choice } = decision;
  const option = decision.options.find((candidate) => candidate.id === choice?.optionId);
  return choice && option ? { decision, option, status: choice.status } : undefined;
}

export function activeOptions(index: BriefIndex): ActiveOption[] {
  return index.decisions.flatMap((decision) => activeOption(decision) ?? []);
}

/** The records that active options add to one records section. */
export function activeAdditions(index: BriefIndex, sectionId: string) {
  return activeOptions(index).flatMap((activeOption) =>
    activeOption.option.adds
      .filter((addition) => addition.sectionId === sectionId)
      .map((record) => ({ record, activeOption })),
  );
}

export type ProjectedRecord = {
  record: BriefRecord;
  activeOption?: ActiveOption;
};

/** One records section as read: its authored records, then those its active options add. */
export function projectedRecords(document: BriefDocument, sectionId: string): ProjectedRecord[] {
  const index = buildBriefIndex(document.sections);
  const section = index.recordsSectionsById.get(sectionId);
  if (!section) return [];
  return [...section.items.map((record) => ({ record })), ...activeAdditions(index, sectionId)];
}
