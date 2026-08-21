import { intentEntities, recordLabel } from "./projection";
import type {
  Decision,
  IntentDefinition,
  IntentEntityId,
  IntentRelation,
  IntentSection,
} from "./schema";
import { workItemEntries } from "./sequence";

/**
 * Editor-owned checkpoint manifests: a compact, deterministic snapshot of the
 * live graph's semantic content, and the comparison that reports what an
 * author or worker changed since the last save.
 */

type SavedVersionItem = NonNullable<IntentDefinition["savedVersion"]>["items"][number];

export type IntentVersionChange = {
  status: "added" | "changed" | "removed";
  key: string;
  kind: SavedVersionItem["kind"];
  label: string;
  previousLabel?: string;
  entityId?: IntentEntityId;
};

export type IntentVersionComparison = {
  savedAt: string;
  changes: IntentVersionChange[];
};

/** Save a compact, deterministic manifest without duplicating authored content. */
export function saveIntentVersion(definition: IntentDefinition, savedAt: string): IntentDefinition {
  return {
    ...definition,
    savedVersion: {
      savedAt,
      items: intentVersionItems(definition),
    },
  };
}

/** Compare the live graph with the durable version stored in the same artifact. */
export function compareIntentToSavedVersion(
  definition: IntentDefinition,
): IntentVersionComparison | undefined {
  if (!definition.savedVersion) return;

  const currentItems = intentVersionItems(definition);
  const currentByKey = new Map(currentItems.map((item) => [item.key, item]));
  const savedByKey = new Map(definition.savedVersion.items.map((item) => [item.key, item]));
  const changes: IntentVersionChange[] = [];

  for (const item of currentItems) {
    const previous = savedByKey.get(item.key);
    const entityId = versionItemEntityId(item);
    if (!previous) {
      changes.push({
        status: "added",
        key: item.key,
        kind: item.kind,
        label: item.label,
        ...(entityId ? { entityId } : {}),
      });
    } else if (previous.fingerprint !== item.fingerprint) {
      changes.push({
        status: "changed",
        key: item.key,
        kind: item.kind,
        label: item.label,
        ...(previous.label !== item.label ? { previousLabel: previous.label } : {}),
        ...(entityId ? { entityId } : {}),
      });
    }
  }

  for (const item of definition.savedVersion.items) {
    if (currentByKey.has(item.key)) continue;
    changes.push({
      status: "removed",
      key: item.key,
      kind: item.kind,
      label: item.label,
    });
  }

  changes.sort(
    (left, right) =>
      left.status.localeCompare(right.status) ||
      left.kind.localeCompare(right.kind) ||
      left.label.localeCompare(right.label),
  );
  return { savedAt: definition.savedVersion.savedAt, changes };
}

function intentVersionItems(definition: IntentDefinition): SavedVersionItem[] {
  const labels = new Map(intentEntities(definition).map((entity) => [entity.id, entity.label]));
  const items: SavedVersionItem[] = [
    versionItem("intent", "root", definition.title, { title: definition.title }),
  ];

  function appendRelation(relation: IntentRelation, owner: string, previousId: string | undefined) {
    const from = labels.get(relation.from) ?? relation.from;
    const to = labels.get(relation.to) ?? relation.to;
    items.push(
      versionItem(
        "relationship",
        relation.id,
        relation.label ?? `${from} ${relation.kind.replaceAll("-", " ")} ${to}`,
        { relation, owner, after: previousId ?? null },
      ),
    );
  }

  function appendSection(section: IntentSection, parentId: string, previousId: string | undefined) {
    items.push(
      versionItem("section", section.id, section.title, {
        section: sectionVersionValue(section),
        parentId,
        after: previousId ?? null,
      }),
    );

    if (section.kind === "group") {
      section.sections.forEach((child, index) =>
        appendSection(child, section.id, section.sections[index - 1]?.id),
      );
      return;
    }
    if (section.kind === "records") {
      section.items.forEach((record, index) => {
        items.push(
          versionItem("record", record.id, recordLabel(record), {
            record,
            owner: { sectionId: section.id },
            after: section.items[index - 1]?.id ?? null,
          }),
        );
      });
      return;
    }
    if (section.kind === "sequence") {
      workItemEntries(section).forEach(({ item, stage, previousId }) => {
        items.push(
          versionItem("work", item.id, item.title, {
            item,
            owner: {
              sectionId: section.id,
              ...((stage && { stageId: stage.id }) ?? {}),
            },
            after: previousId ?? null,
          }),
        );
      });
      return;
    }
    if (section.kind === "exhibits") {
      section.items.forEach((exhibit, index) => {
        items.push(
          versionItem("exhibit", exhibit.id, exhibit.title, {
            exhibit,
            owner: { sectionId: section.id },
            after: section.items[index - 1]?.id ?? null,
          }),
        );
      });
      return;
    }
    if (section.kind === "questions") {
      section.items.forEach((question, index) => {
        items.push(
          versionItem("question", question.id, question.question, {
            question,
            owner: { sectionId: section.id },
            after: section.items[index - 1]?.id ?? null,
          }),
        );
      });
      return;
    }
    if (section.kind !== "decisions") return;

    section.items.forEach((item, decisionIndex) => {
      items.push(
        versionItem("decision", item.id, item.question, {
          decision: decisionVersionValue(item),
          owner: { sectionId: section.id },
          after: section.items[decisionIndex - 1]?.id ?? null,
        }),
      );
      item.options.forEach((option) => {
        option.adds.forEach((record, recordIndex) => {
          items.push(
            versionItem("record", record.id, recordLabel(record), {
              record,
              owner: { decisionId: item.id, optionId: option.id },
              after: option.adds[recordIndex - 1]?.id ?? null,
            }),
          );
        });
        option.relations.forEach((relation, relationIndex) =>
          appendRelation(
            relation,
            `decision:${item.id}:option:${option.id}`,
            option.relations[relationIndex - 1]?.id,
          ),
        );
      });
    });
  }

  definition.sections.forEach((section, index) =>
    appendSection(section, "root", definition.sections[index - 1]?.id),
  );
  definition.relations.forEach((relation, index) =>
    appendRelation(relation, "root", definition.relations[index - 1]?.id),
  );
  return items.sort((left, right) => left.key.localeCompare(right.key));
}

function sectionVersionValue(section: IntentSection): unknown {
  const { collapsed: _collapsed, ...semantic } = section;
  if (semantic.kind === "group") {
    const { sections: _sections, ...group } = semantic;
    return group;
  }
  if (semantic.kind === "records") {
    const { items: _items, view: _view, ...records } = semantic;
    return records;
  }
  if (semantic.kind === "sequence") {
    if ("items" in semantic) {
      const { items: _items, ...sequence } = semantic;
      return sequence;
    }
    const { stages, ...sequence } = semantic;
    return {
      ...sequence,
      stages: stages.map(({ items: _items, ...stage }) => stage),
    };
  }
  if (
    semantic.kind === "exhibits" ||
    semantic.kind === "questions" ||
    semantic.kind === "decisions"
  ) {
    const { items: _items, ...container } = semantic;
    return container;
  }
  return semantic;
}

function decisionVersionValue(item: Decision): unknown {
  const { options, ...decision } = item;
  return {
    ...decision,
    options: options.map(({ adds: _adds, relations: _relations, ...option }) => option),
  };
}

function versionItem(
  kind: SavedVersionItem["kind"],
  id: string,
  label: string,
  value: unknown,
): SavedVersionItem {
  return {
    key: `${kind}:${id}`,
    kind,
    label,
    fingerprint: fingerprint(value),
  };
}

function versionItemEntityId(item: SavedVersionItem): IntentEntityId | undefined {
  if (
    item.kind !== "section" &&
    item.kind !== "record" &&
    item.kind !== "work" &&
    item.kind !== "exhibit" &&
    item.kind !== "question" &&
    item.kind !== "decision"
  ) {
    return;
  }
  return item.key.slice(item.kind.length + 1);
}

function fingerprint(value: unknown): string {
  const input = JSON.stringify(canonicalValue(value)) ?? "";
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;

  const canonical: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const property = Reflect.get(value, key);
    if (property !== undefined) canonical[key] = canonicalValue(property);
  }
  return canonical;
}
