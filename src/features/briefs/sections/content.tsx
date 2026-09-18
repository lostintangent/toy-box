import type { ReactNode } from "react";
import {
  type BriefDocument,
  type BriefEntityId,
  type BriefSection,
  type PlanSection,
  type RecordsView,
} from "../model/index";
import { BriefMarkdownOrListContent } from "./description";
import { BriefResolutionContent } from "./resolution";
import { BriefDefinitionContent } from "./definition";
import { BriefFindingsContent } from "./findings";

type BriefSectionContentProps = {
  document: BriefDocument;
  section: BriefSection;
  editable: boolean;
  baseUri?: string;
  focusedEntityId?: BriefEntityId;
  renderPlan: (section: PlanSection) => ReactNode;
  pending: ReadonlySet<string>;
  onExplainRecord?: (recordId: string) => void;
  onInspect?: (entityId: BriefEntityId) => void;
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

export function BriefSectionContent(props: BriefSectionContentProps) {
  const { document, editable, section } = props;

  if (section.kind === "markdown" || section.kind === "list") {
    return <BriefMarkdownOrListContent section={section} />;
  }
  if (section.kind === "findings") {
    return (
      <BriefFindingsContent
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
      <BriefDefinitionContent
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
    <BriefResolutionContent
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
