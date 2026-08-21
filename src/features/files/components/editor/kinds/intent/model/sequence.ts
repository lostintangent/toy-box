import type { SequenceSection, SequenceStage, WorkItem } from "./schema";

/**
 * Sequence traversal: one ordered reading of work whether the section
 * owns them directly or groups them into named stages, with the document path
 * and preceding item each work item needs to stay identifiable.
 */

type WorkItemEntry = {
  item: WorkItem;
  stage?: SequenceStage;
  path: PropertyKey[];
  previousId?: string;
};

export function workItemEntries(section: SequenceSection): WorkItemEntry[] {
  if ("items" in section) {
    return section.items.map((item, index) => ({
      item,
      path: ["items", index],
      ...(section.items[index - 1] ? { previousId: section.items[index - 1]!.id } : {}),
    }));
  }
  return section.stages.flatMap((stage, stageIndex) =>
    stage.items.map((item, itemIndex) => ({
      item,
      stage,
      path: ["stages", stageIndex, "items", itemIndex],
      ...(stage.items[itemIndex - 1] ? { previousId: stage.items[itemIndex - 1]!.id } : {}),
    })),
  );
}

export function workItems(section: SequenceSection): readonly WorkItem[] {
  return workItemEntries(section).map(({ item }) => item);
}
