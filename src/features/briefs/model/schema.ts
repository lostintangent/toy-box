import { z } from "zod";
import { addDuplicateIssues } from "./issues";
import { validateDocument } from "./validation";

/**
 * The `.brief` schema: one flexible document composed from Toy Box section
 * primitives. Findings ground the change, spec sections define what should
 * become true, and zero or more plan sections form the optional plan that makes
 * that spec executable. The file is durable truth and the editor is a lens over
 * it. The runtime schema owns every domain type and wires semantic validation
 * into parsing, so an invalid document never reaches a projection.
 */

export const BRIEF_CHANGES = [
  "existing",
  "new",
  "modified",
  "removed",
  "preserved",
  "renamed",
  "split",
  "relocated",
] as const;
export type Change = (typeof BRIEF_CHANGES)[number];

const change = z.enum(BRIEF_CHANGES);
const identifier = z.string().trim().min(1);
const summaryText = z.string().trim().min(1);
const markdownText = z.string().refine((text) => text.trim().length > 0, {
  message: "Markdown cannot be empty.",
});
const verbatimText = z.string().refine((text) => text.trim().length > 0, {
  message: "Content cannot be empty.",
});
const exhibitUri = summaryText.refine(isSupportedExhibitUri, {
  message: "Exhibit URI must be relative or use http(s).",
});
const source = summaryText;
const sourcePolicy = z.enum(["code", "reference", "optional"]);
const value = z.union([summaryText, z.array(summaryText).min(1)]);

const entityId = identifier;
const basedOn = z.array(entityId).min(1).optional();

const OPTION_RELATIONSHIP_KINDS = [
  "precedes",
  "depends-on",
  "causes",
  "realized-by",
  "preserves",
] as const;

const optionRelationship = z
  .object({
    id: identifier,
    from: entityId,
    to: entityId,
    kind: z.enum(OPTION_RELATIONSHIP_KINDS),
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

const briefField = z.discriminatedUnion("kind", [
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

const briefRecordFields = {
  id: identifier,
  subject: summaryText.optional(),
  change,
  values: z.record(z.string(), value),
  explanation: summaryText.optional(),
  source: source.optional(),
  basedOn,
};

const briefRecord = z.object(briefRecordFields).strict();
const optionAddition = z
  .object({
    sectionId: identifier,
    ...briefRecordFields,
  })
  .strict();

const sectionFields = {
  id: identifier,
  title: summaryText,
  purpose: summaryText,
  collapsed: z.boolean().default(false),
};

const markdownSection = z
  .object({
    ...sectionFields,
    kind: z.literal("markdown"),
    body: markdownText,
  })
  .strict();

const listSection = z
  .object({
    ...sectionFields,
    kind: z.literal("list"),
    style: z.enum(["bullet", "ordered"]).default("bullet"),
    items: z.array(markdownText).min(1),
  })
  .strict();

const recordsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("records"),
    view: z.enum(["table", "cards"]),
    sourcePolicy,
    subject: summaryText.optional(),
    fields: z.array(briefField).default([]),
    items: z.array(briefRecord).default([]),
  })
  .strict();

const planStep = z
  .object({
    id: identifier,
    title: summaryText,
    doneWhen: summaryText,
    status: z.enum(["in-progress", "complete"]).optional(),
    implements: z.array(entityId).min(1),
    values: z.record(z.string(), value).default({}),
  })
  .strict();

const planPhase = z
  .object({
    id: identifier,
    title: summaryText,
    steps: z.array(planStep).min(1),
  })
  .strict();

const flatPlanSection = z
  .object({
    ...sectionFields,
    kind: z.literal("plan"),
    fields: z.array(briefField).default([]),
    steps: z.array(planStep).min(1),
  })
  .strict();

const phasedPlanSection = z
  .object({
    ...sectionFields,
    kind: z.literal("plan"),
    fields: z.array(briefField).default([]),
    phases: z.array(planPhase).min(1),
  })
  .strict();

const planSection = z.union([flatPlanSection, phasedPlanSection]);

const exhibitFields = {
  id: identifier,
  title: summaryText,
  change,
  description: markdownText.optional(),
  source: source.optional(),
  basedOn,
};
const uriExhibitFields = {
  ...exhibitFields,
  uri: exhibitUri,
};

const pseudocodeExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("pseudocode"),
    language: identifier.optional(),
    content: verbatimText,
  })
  .strict();

const sharedFlowNode = z
  .object({
    entity: entityId,
  })
  .strict();

const localFlowNode = z
  .object({
    id: identifier,
    title: summaryText,
    description: markdownText.optional(),
    change: change.optional(),
  })
  .strict();

const flowNode = z.union([sharedFlowNode, localFlowNode]);

const flowConnection = z
  .object({
    id: identifier,
    from: identifier,
    to: identifier,
    label: summaryText,
  })
  .strict();

const flowPath = z
  .object({
    id: identifier,
    title: summaryText,
    purpose: summaryText,
    start: identifier,
    connectionIds: z.array(identifier).min(1),
  })
  .strict();

const flowRegion = z
  .object({
    id: identifier,
    title: summaryText,
    nodeIds: z.array(identifier).min(1),
  })
  .strict();

const flowExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("flow"),
    nodes: z.array(flowNode).min(2),
    connections: z.array(flowConnection).min(1),
    paths: z.array(flowPath).min(1),
    regions: z.array(flowRegion).min(1).optional(),
  })
  .strict();

const treeChange = change.extract(["new", "modified", "removed"]);
const fileTreeEntry = z.union([
  z.strictObject({
    kind: z.literal("file"),
    name: summaryText,
    change: treeChange.optional(),
  }),
  z.strictObject({
    kind: z.literal("folder"),
    name: summaryText,
    change: treeChange.optional(),
    get children() {
      return z.array(fileTreeEntry).default([]);
    },
  }),
]);

const domainTreeEntry = z.strictObject({
  name: summaryText,
  change: treeChange.optional(),
  get children() {
    return z.array(domainTreeEntry).min(1).optional();
  },
});

const filesTreeExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("tree"),
    type: z.literal("files"),
    roots: z.array(fileTreeEntry).min(1),
  })
  .strict();

const domainTreeExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("tree"),
    type: z.literal("domain"),
    roots: z.array(domainTreeEntry).min(1),
  })
  .strict();

const treeExhibit = z.discriminatedUnion("type", [filesTreeExhibit, domainTreeExhibit]);

const imageExhibit = z
  .object({
    ...uriExhibitFields,
    kind: z.literal("image"),
    altText: summaryText,
  })
  .strict();

const referencedPrototypeExhibit = z
  .object({
    ...uriExhibitFields,
    kind: z.literal("prototype"),
  })
  .strict();

const embeddedPrototypeExhibit = z
  .object({
    ...exhibitFields,
    kind: z.literal("prototype"),
    content: verbatimText,
  })
  .strict();

const briefExhibit = z.union([
  pseudocodeExhibit,
  flowExhibit,
  treeExhibit,
  imageExhibit,
  referencedPrototypeExhibit,
  embeddedPrototypeExhibit,
]);

const question = z
  .object({
    id: identifier,
    question: summaryText,
    answerMethod: z.enum(["investigate-code", "run-experiment"]),
    impact: summaryText.optional(),
    affects: z.array(entityId).default([]),
    answer: summaryText.optional(),
  })
  .strict();

const decisionOption = z
  .object({
    id: identifier,
    label: summaryText,
    rationale: summaryText.optional(),
    tradeoff: summaryText.optional(),
    adds: z.array(optionAddition).default([]),
    exhibit: briefExhibit.optional(),
    relationships: z.array(optionRelationship).min(1).optional(),
  })
  .strict();

const decisionChoice = z
  .object({
    optionId: identifier,
    status: z.enum(["provisional", "decided"]),
  })
  .strict();

const decision = z
  .object({
    id: identifier,
    question: summaryText,
    options: z.array(decisionOption).min(2),
    choice: decisionChoice.optional(),
    dependsOn: z.array(identifier).default([]),
    affects: z.array(entityId).default([]),
    rationale: summaryText.optional(),
    basedOn,
  })
  .strict()
  .superRefine((item, ctx) => {
    const optionIds = item.options.map((option) => option.id);
    addDuplicateIssues(optionIds, ctx, ["options"], "Decision option ids");
    addDuplicateIssues(
      item.options.map((option) => option.label),
      ctx,
      ["options"],
      "Decision option labels",
    );
    addDuplicateIssues(item.dependsOn, ctx, ["dependsOn"], "Decision dependencies");

    if (item.choice && !optionIds.includes(item.choice.optionId)) {
      ctx.addIssue({
        code: "custom",
        message: `choice option "${item.choice.optionId}" is not one of the options.`,
        path: ["choice", "optionId"],
      });
    }
  });

const finding = z
  .object({
    id: identifier,
    statement: summaryText,
    whyItMatters: markdownText.optional(),
    sources: z.array(source).min(1).optional(),
    exhibit: briefExhibit.optional(),
  })
  .strict();

const findingsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("findings"),
    sourcePolicy,
    items: z.array(finding).min(1),
  })
  .strict();

const exhibitsSection = z
  .object({
    ...sectionFields,
    kind: z.literal("exhibits"),
    sourcePolicy,
    items: z.array(briefExhibit).min(1),
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

const definitionSection = z.union([recordsSection, exhibitsSection]);
const resolutionSection = z.union([questionsSection, decisionsSection]);
const specSection = z.union([markdownSection, listSection, definitionSection, resolutionSection]);
const briefSection = z.union([findingsSection, specSection, planSection]);
const briefTab = z
  .object({
    title: summaryText,
    sections: z.array(identifier).min(1),
  })
  .strict();

export type BriefField = z.infer<typeof briefField>;
export type BriefEntityId = z.infer<typeof entityId>;
export type OptionRelationship = z.infer<typeof optionRelationship>;
export type SourcePolicy = z.infer<typeof sourcePolicy>;

export type MarkdownSection = z.infer<typeof markdownSection>;
export type ListSection = z.infer<typeof listSection>;

export type Finding = z.infer<typeof finding>;
export type FindingUpdate = Pick<Finding, "statement" | "whyItMatters" | "sources">;
export type FindingsSection = z.infer<typeof findingsSection>;

export type BriefRecord = z.infer<typeof briefRecord>;
export type BriefRecordUpdate = Omit<BriefRecord, "id" | "basedOn">;
export type OptionAddition = z.infer<typeof optionAddition>;
export type RecordsSection = z.infer<typeof recordsSection>;
export type RecordsView = RecordsSection["view"];
export type FlowNode = z.infer<typeof flowNode>;
export type FlowConnection = z.infer<typeof flowConnection>;
export type FlowPath = z.infer<typeof flowPath>;
export type FlowRegion = z.infer<typeof flowRegion>;
export type FlowExhibit = z.infer<typeof flowExhibit>;
export type TreeChange = z.infer<typeof treeChange>;
export type FileTreeEntry = z.infer<typeof fileTreeEntry>;
export type DomainTreeEntry = z.infer<typeof domainTreeEntry>;
export type TreeExhibit = z.infer<typeof treeExhibit>;
export type BriefExhibit = z.infer<typeof briefExhibit>;
type WithoutIdentityOrGrounding<T> = T extends { id: string } ? Omit<T, "id" | "basedOn"> : never;
export type BriefExhibitUpdate = WithoutIdentityOrGrounding<BriefExhibit>;
export type ExhibitsSection = z.infer<typeof exhibitsSection>;
export type DefinitionSection = z.infer<typeof definitionSection>;

export type Question = z.infer<typeof question>;
export type DecisionOption = z.infer<typeof decisionOption>;
export type DecisionChoice = z.infer<typeof decisionChoice>;
export type DecisionStatus = "open" | DecisionChoice["status"];
export type Decision = z.infer<typeof decision>;
export type ResolutionSection = z.infer<typeof resolutionSection>;

export type SpecSection = z.infer<typeof specSection>;

export type PlanStep = z.infer<typeof planStep>;
export type PlanStepUpdate = Pick<PlanStep, "title" | "doneWhen" | "status" | "values">;
export type PlanStepStatus = NonNullable<PlanStep["status"]>;
export type PlanPhase = z.infer<typeof planPhase>;
export type PlanSection = z.infer<typeof planSection>;

export type BriefSection = z.infer<typeof briefSection>;
export type BriefTab = z.infer<typeof briefTab>;

const briefDocumentBase = z
  .object({
    title: summaryText,
    sections: z.array(briefSection).min(1),
    tabs: z.array(briefTab).min(2).optional(),
  })
  .strict();

export type BriefDocument = z.infer<typeof briefDocumentBase>;
const briefDocumentSchema = briefDocumentBase.superRefine(validateDocument);

// Codecs

type ParseResult = { ok: true; value: BriefDocument } | { ok: false; error: string };

export function parseBrief(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: "This brief is empty." };

  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "This file is not valid JSON." };
  }

  const parsed = briefDocumentSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
    return {
      ok: false,
      error: `${issue?.message ?? "Invalid Brief document"}${where}.`,
    };
  }
  return { ok: true, value: parsed.data };
}

export function serializeBrief(document: BriefDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
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
