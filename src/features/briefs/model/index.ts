/**
 * The public Brief domain model: one flexible `BriefDocument`, its findings,
 * derived effective spec, the optional execution plan that makes the spec
 * executable, and the edits that transition it. Editor surfaces consume this
 * facade; internal modules import their source owner.
 */

export {
  BRIEF_CHANGES,
  parseBrief,
  serializeBrief,
  type Change,
  type DescriptionSection,
  type Finding,
  type FindingsSection,
  type BriefRecord,
  type OptionAddition,
  type RecordsSection,
  type RecordsView,
  type FlowExhibit,
  type TreeChange,
  type FileTreeEntry,
  type DomainTreeEntry,
  type TreeExhibit,
  type BriefExhibit,
  type ExhibitsSection,
  type DefinitionSection,
  type Question,
  type DecisionStatus,
  type OptionStatus,
  type Decision,
  type ResolutionSection,
  type PlanPhase,
  type PlanSection,
  type PlanStep,
  type BriefDocument,
  type BriefEntityId,
  type BriefField,
  type OptionRelationship,
  type SourcePolicy,
  type BriefSection,
} from "./schema";

export { findRecordsSection, resolveBriefTabs, type ResolvedBriefTab } from "./query/structure";

export {
  briefEntities,
  fieldValueText,
  findBriefEntity,
  recordLabel,
  recordReadingFields,
  type BriefEntity,
} from "./query/entities";

export {
  activeOption,
  decisionStatus,
  projectedRecords,
  type ProjectedRecord,
} from "./query/options";

export { entityLinks, type EntityLinks } from "./query/links";

export {
  flowGraph,
  flowPathThrough,
  specState,
  unresolvedDependencies,
  type FlowGraph,
  type FlowGraphNode,
  type SpecState,
} from "./spec";

export { planExecuting, planState, planStatus, planSteps, type PlanState } from "./plan";

export {
  canRegenerateSection,
  canRemoveEntity,
  clearDecisionChoice,
  decide,
  removeEntity,
  reopenDecision,
  reopenQuestion,
  selectDecisionOption,
  setRecordsView,
  setSectionsCollapsed,
  updateExhibit,
  updateFinding,
  updatePlanStep,
  updateRecord,
  type BriefEdit,
  type ExhibitUpdate,
  type FindingUpdate,
  type PlanStepUpdate,
  type RecordUpdate,
} from "./edit";
