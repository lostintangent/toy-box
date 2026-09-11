import type { ReactNode } from "react";
import {
  type IntentDocument,
  type IntentEntityId,
  type IntentSection,
  type PlanSection,
  type RecordsView,
} from "../model/index";
import { IntentMarkdownOrListContent } from "./description";
import { IntentResolutionContent } from "./resolution";
import { IntentDefinitionContent } from "./definition";
import { IntentFindingsContent } from "./findings";

type IntentSectionContentProps = {
  document: IntentDocument;
  section: IntentSection;
  editable: boolean;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  renderPlan: (section: PlanSection) => ReactNode;
  pending: ReadonlySet<string>;
  onExplainRecord?: (recordId: string) => void;
  onInspect?: (entityId: IntentEntityId) => void;
  onRemoveRecord?: (sectionId: string, recordId: string) => void;
  onInvestigateQuestion?: (questionId: string) => void;
  onSelectDecisionOption: (decisionId: string, optionId: string) => void;
  onRecordDecision: (decisionId: string) => void;
  onReopenDecision: (decisionId: string) => void;
  onClearDecisionChoice: (decisionId: string) => void;
  onReopenQuestion: (questionId: string) => void;
  recordsViewById?: Readonly<Record<string, RecordsView>>;
  onRecordsViewChange: (sectionId: string, view: RecordsView) => void;
};

export function IntentSectionContent(props: IntentSectionContentProps) {
  const { document, editable, section } = props;

  if (section.kind === "markdown" || section.kind === "list") {
    return <IntentMarkdownOrListContent section={section} />;
  }
  if (section.kind === "findings") {
    return (
      <IntentFindingsContent
        document={document}
        section={section}
        baseUri={props.baseUri}
        focusedEntityId={props.focusedEntityId}
        onInspect={props.onInspect}
      />
    );
  }
  if (section.kind === "plan") {
    return props.renderPlan(section);
  }
  if (section.kind === "records" || section.kind === "exhibits") {
    return (
      <IntentDefinitionContent
        document={document}
        section={section}
        editable={editable}
        baseUri={props.baseUri}
        focusedEntityId={props.focusedEntityId}
        onInspect={props.onInspect}
        onRemoveRecord={props.onRemoveRecord}
        recordsViewById={props.recordsViewById}
        onRecordsViewChange={props.onRecordsViewChange}
      />
    );
  }
  return (
    <IntentResolutionContent
      document={document}
      section={section}
      baseUri={props.baseUri}
      focusedEntityId={props.focusedEntityId}
      editable={editable}
      pending={props.pending}
      onExplainRecord={props.onExplainRecord}
      onInspect={props.onInspect}
      onInvestigateQuestion={props.onInvestigateQuestion}
      onSelectDecisionOption={props.onSelectDecisionOption}
      onRecordDecision={props.onRecordDecision}
      onReopenDecision={props.onReopenDecision}
      onClearDecisionChoice={props.onClearDecisionChoice}
      onReopenQuestion={props.onReopenQuestion}
    />
  );
}
