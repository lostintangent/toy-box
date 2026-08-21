import { z } from "zod";
import { addDuplicateIssues } from "./issues";
import { hasValidIntentRichText } from "./richText";
import { validateDefinition } from "./validation";

/**
 * The `.intent` schema: a task-defined review form composed from Toy Box
 * primitives. The file is durable truth; the editor is a lens over it. The
 * runtime schema owns every domain type and wires semantic validation into
 * parsing, so an invalid graph never reaches a projection.
 */

export const INTENT_CHANGES = [
  "existing",
  "new",
  "modified",
  "removed",
  "preserved",
  "renamed",
  "split",
  "relocated",
] as const;
export type Change = (typeof INTENT_CHANGES)[number];

const change = z.enum(INTENT_CHANGES);
const identifier = z.string().trim().min(1);
const summaryText = z.string().trim().min(1);
const richText = summaryText.refine(hasValidIntentRichText, {
  message:
    "Rich text supports only complete, non-empty **strong emphasis** and `inline code` spans.",
});
const sourceText = z.string().refine((text) => text.trim().length > 0, {
  message: "Exact source text cannot be empty.",
});
const exhibitUri = summaryText.refine(isSupportedExhibitUri, {
  message: "Exhibit URI must be relative or use http(s).",
});
const provenance = summaryText;
const value = z.union([summaryText, z.array(summaryText).min(1)]);

const entityId = identifier;

const RELATION_KINDS = [
  "precedes",
  "depends-on",
  "causes",
  "realized-by",
  "implemented-by",
  "preserves",
] as const;

const intentRelation = z
  .object({
    id: identifier,
    from: entityId,
    to: entityId,
    kind: z.enum(RELATION_KINDS),
    label: summaryText.optional(),
  })
  .strict();

const fieldOption = z
  .object({
    id: identifier,
    label: summaryText,
    description: summaryText.optional(),
  })
  .strict();

const intentField = z.discriminatedUnion("kind", [
  z
    .object({
      id: identifier,
      label: summaryText,
      kind: z.literal("text"),
    })
    .strict(),
  z
    .object({
      id: identifier,
      label: summaryText,
      kind: z.literal("choice"),
      cardinality: z.enum(["one", "many"]),
      options: z.array(fieldOption).min(1),
    })
    .strict(),
]);

const intentRecordFields = {
  id: identifier,
  subject: summaryText.optional(),
  change,
  values: z.record(z.string(), value),
  explanation: summaryText.optional(),
  provenance: provenance.optional(),
};

const intentRecord = z.object(intentRecordFields).strict();
const optionAddition = z
  .object({
    sectionId: identifier,
    ...intentRecordFields,
  })
  .strict();

const question = z
  .object({
    id: identifier,
    question: summaryText,
    resolutionMethod: z.enum(["investigate-code", "run-experiment"]),
    effect: summaryText.optional(),
    affects: z.array(entityId).default([]),
    resolution: summaryText.optional(),
  })
  .strict();

const decisionOption = z
  .object({
    id: identifier,
    label: summaryText,
    rationale: summaryText.optional(),
    tradeoff: summaryText.optional(),
    adds: z.array(optionAddition).default([]),
    relations: z.array(intentRelation).default([]),
  })
  .strict();

const decision = z
  .object({
    id: identifier,
    question: summaryText,
    options: z.array(decisionOption).min(1),
    chosen: identifier.nullable().default(null),
    status: z.enum(["open", "provisional", "decided"]).default("open"),
    blocking: z.boolean().default(true),
    dependsOn: z.array(identifier).default([]),
    affects: z.array(entityId).default([]),
    rationale: summaryText.optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const optionIds = item.options.map((option) => option.id);
    addDuplicateIssues(optionIds, ctx, ["options"], "Decision option ids");
    addDuplicateIssues(item.dependsOn, ctx, ["dependsOn"], "Decision dependencies");

    if (item.chosen !== null && !optionIds.includes(item.chosen)) {
      ctx.addIssue({
        code: "custom",
        message: `chosen "${item.chosen}" is not one of the options.`,
        path: ["chosen"],
      });
    }
    if (item.status === "open" && item.chosen !== null) {
      ctx.addIssue({
        code: "custom",
        message: "An open decision cannot have a chosen option.",
        path: ["chosen"],
      });
    }
    if (item.status !== "open" && item.chosen === null) {
      ctx.addIssue({
        code: "custom",
        message: "A provisional or decided decision must have a chosen option.",
        path: ["status"],
      });
    }
  });

const sectionFields = {
  id: identifier,
  title: summaryText,
  purpose: summaryText,
  collapsed: z.boolean().default(false),
};

const proseSection = z
  .object({
    ...sectionFields,
    kind: z.literal("prose"),
    body: summaryText,
  })
  .strict();

const listSection = z
  .object({
    ...sectionFields,
    kind: z.literal("list"),
    style: z.enum(["bullet", "ordered"]).default("bullet"),
    items: z.array(richText).min(1),
  })
  .strict();

const recordsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("records"),
    view: z.enum(["table", "cards"]),
    provenance: z.enum(["code", "reference", "optional"]),
    subject: summaryText.optional(),
    fields: z.array(intentField).default([]),
    items: z.array(intentRecord).default([]),
  })
  .strict();

const workItem = z
  .object({
    id: identifier,
    title: summaryText,
    values: z.record(z.string(), value).default({}),
  })
  .strict();

const sequenceStage = z
  .object({
    id: identifier,
    title: summaryText,
    items: z.array(workItem).min(1),
  })
  .strict();

const flatSequenceSection = z
  .object({
    ...sectionFields,
    kind: z.literal("sequence"),
    fields: z.array(intentField).default([]),
    items: z.array(workItem).min(1),
  })
  .strict();

const stagedSequenceSection = z
  .object({
    ...sectionFields,
    kind: z.literal("sequence"),
    fields: z.array(intentField).default([]),
    stages: z.array(sequenceStage).min(1),
  })
  .strict();

const sequenceSection = z.union([flatSequenceSection, stagedSequenceSection]);

const exhibitCode = z
  .object({
    language: identifier.optional(),
    content: sourceText,
  })
  .strict();

const procedureStep = z
  .object({
    id: identifier,
    instruction: richText,
    code: exhibitCode.optional(),
  })
  .strict();

const exhibitFields = {
  id: identifier,
  title: summaryText,
  change,
  description: richText.optional(),
  provenance: provenance.optional(),
};
const uriExhibitFields = {
  ...exhibitFields,
  uri: exhibitUri,
};

const codeExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("code"),
    language: identifier.optional(),
    content: sourceText,
  })
  .strict();

const procedureExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("procedure"),
    steps: z.array(procedureStep).min(1),
  })
  .strict();

const imageExhibit = z
  .object({
    ...uriExhibitFields,
    kind: z.literal("image"),
  })
  .strict();

const htmlUriExhibit = z
  .object({
    ...uriExhibitFields,
    kind: z.literal("html"),
  })
  .strict();

const htmlContentExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("html"),
    content: sourceText,
  })
  .strict();

const intentExhibit = z.union([
  codeExhibit,
  procedureExhibit,
  imageExhibit,
  htmlUriExhibit,
  htmlContentExhibit,
]);

const exhibitsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("exhibits"),
    provenance: z.enum(["code", "reference", "optional"]),
    items: z.array(intentExhibit).min(1),
  })
  .strict();

const questionsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("questions"),
    items: z.array(question).min(1),
  })
  .strict();

const decisionsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("decisions"),
    items: z.array(decision).min(1),
  })
  .strict();

const leafSection = z.union([
  proseSection,
  listSection,
  recordsSection,
  sequenceSection,
  exhibitsSection,
  questionsSection,
  decisionsSection,
]);

const groupSection = z
  .object({
    ...sectionFields,
    kind: z.literal("group"),
    layout: z.enum(["stack", "columns"]),
    sections: z.array(leafSection).min(1),
  })
  .strict();

const connectionPath = z
  .object({
    id: identifier,
    title: summaryText,
    purpose: summaryText,
    root: entityId,
    relations: z.array(identifier).min(1),
  })
  .strict();

const connectionRegion = z
  .object({
    id: identifier,
    title: summaryText,
    entities: z.array(entityId).min(1),
  })
  .strict();

const stagedMapSection = z
  .object({
    ...sectionFields,
    kind: z.literal("map"),
    layout: z.enum(["flow", "network"]),
    roots: z.array(entityId).min(1).optional(),
    relations: z.array(identifier).min(1).optional(),
    kinds: z
      .array(z.enum(["precedes", "depends-on", "causes", "realized-by", "preserves"]))
      .min(1)
      .optional(),
  })
  .strict();

const pathMapSection = z
  .object({
    ...sectionFields,
    kind: z.literal("map"),
    layout: z.literal("paths"),
    paths: z.array(connectionPath).min(1),
    regions: z.array(connectionRegion).min(1).optional(),
    relations: z.array(identifier).min(1).optional(),
  })
  .strict();

const mapSection = z.union([stagedMapSection, pathMapSection]);
const intentSection = z.union([leafSection, groupSection, mapSection]);

export type IntentField = z.infer<typeof intentField>;
export type IntentEntityId = z.infer<typeof entityId>;
export type IntentRelation = z.infer<typeof intentRelation>;
export type IntentRecord = z.infer<typeof intentRecord>;
export type IntentRecordUpdate = Omit<IntentRecord, "id">;
export type OptionAddition = z.infer<typeof optionAddition>;
export type Question = z.infer<typeof question>;
export type Decision = z.infer<typeof decision>;
export type RecordsSection = z.infer<typeof recordsSection>;
export type RecordsView = RecordsSection["view"];
export type WorkItem = z.infer<typeof workItem>;
export type WorkItemUpdate = Omit<WorkItem, "id">;
export type SequenceStage = z.infer<typeof sequenceStage>;
export type SequenceSection = z.infer<typeof sequenceSection>;
export type ProcedureStep = z.infer<typeof procedureStep>;
export type IntentExhibit = z.infer<typeof intentExhibit>;
type WithoutId<T> = T extends { id: string } ? Omit<T, "id"> : never;
export type IntentExhibitUpdate = WithoutId<IntentExhibit>;
export type ExhibitsSection = z.infer<typeof exhibitsSection>;
export type LeafSection = z.infer<typeof leafSection>;
export type MapSection = z.infer<typeof mapSection>;
export type IntentSection = z.infer<typeof intentSection>;
export type Provenance = z.infer<typeof provenance>;
export type IntentMapPath = z.infer<typeof connectionPath>;

const savedVersionItem = z
  .object({
    key: identifier,
    kind: z.enum([
      "intent",
      "section",
      "record",
      "work",
      "exhibit",
      "question",
      "decision",
      "relationship",
    ]),
    label: summaryText,
    fingerprint: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();

const savedVersion = z
  .object({
    savedAt: z.iso.datetime(),
    items: z.array(savedVersionItem).min(1),
  })
  .strict();

const intentDefinitionBase = z
  .object({
    title: summaryText,
    sections: z.array(intentSection).min(1),
    relations: z.array(intentRelation).default([]),
    savedVersion: savedVersion.optional(),
  })
  .strict();

export type IntentDefinitionBase = z.infer<typeof intentDefinitionBase>;

const intentDefinitionSchema = intentDefinitionBase.superRefine(validateDefinition);
export type IntentDefinition = z.infer<typeof intentDefinitionSchema>;

// Codecs

type ParseResult = { ok: true; value: IntentDefinition } | { ok: false; error: string };

export function parseIntent(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "This intent is empty." };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }

  const parsed = intentDefinitionSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return {
      ok: false,
      error: `${issue?.message ?? "Invalid intent definition"}${where}.`,
    };
  }
  return { ok: true, value: parsed.data };
}

export function serializeIntent(definition: IntentDefinition): string {
  return `${JSON.stringify(definition, null, 2)}\n`;
}

function isSupportedExhibitUri(uri: string): boolean {
  if (!/^[a-z][a-z\d+.-]*:/i.test(uri)) {
    return !uri.startsWith("/") && !uri.includes("\\");
  }
  try {
    const protocol = new URL(uri).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
