/**
 * The public Intent domain model: one strict `.intent` schema, the projections
 * that read an authored graph, and the delivery sequence derived from it. Editor
 * surfaces consume this facade; internal modules import their source owner.
 */

export {
  INTENT_CHANGES,
  parseIntent,
  serializeIntent,
  type Change,
  type ExhibitsSection,
  type IntentDefinition,
  type IntentEntityId,
  type IntentExhibit,
  type IntentExhibitUpdate,
  type IntentField,
  type IntentRecord,
  type IntentRecordUpdate,
  type IntentRelation,
  type IntentSection,
  type LeafSection,
  type MapSection,
  type OptionAddition,
  type ProcedureStep,
  type Provenance,
  type Question,
  type Decision,
  type RecordsSection,
  type RecordsView,
  type SequenceSection,
  type WorkItem,
  type WorkItemUpdate,
} from "./schema";

export {
  allDecisions,
  allQuestions,
  effectiveRelations,
  fieldValueText,
  findExhibitsSection,
  findIntentEntity,
  findRecordsSection,
  intentEntities,
  projectedRecords,
  recordDecisionOrigin,
  recordLabel,
  recordReadingFields,
  selectedAdditions,
  type IntentEntity,
  type ProjectedRecord,
} from "./projection";

export {
  intentMapGraph,
  intentMapRelations,
  relationshipMapRelations,
  type IntentMapGraph,
  type IntentMapGraphNode,
  type IntentMapGraphPath,
} from "./maps";

export {
  deliveryProjection,
  executionReadiness,
  implementationObligations,
  type DeliveryWorkUnit,
} from "./delivery";

export { reviewReadiness, unresolvedDependencies } from "./workflow";

export { sectionCanRefresh, sectionItemCount } from "./display";
