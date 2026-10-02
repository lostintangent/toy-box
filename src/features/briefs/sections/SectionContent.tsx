import type {
  BriefDocument,
  BriefEdit,
  BriefEntityId,
  BriefSection,
  PlanSection,
  RecordsView,
} from "../model/index";
import { DecisionsContent } from "./DecisionsContent";
import { DescriptionContent } from "./DescriptionContent";
import { ExhibitsContent } from "./ExhibitsContent";
import { FindingsContent } from "./FindingsContent";
import { QuestionsContent } from "./QuestionsContent";
import { RecordsContent } from "./RecordsContent";

/** One section's body, by kind. Plans read editor-owned spec and plan state, so `PlanContent` renders them. */
export function SectionContent({
  document,
  section,
  editable,
  baseUri,
  focusedEntityId,
  pending,
  recordsView,
  onExplainRecord,
  onInspect,
  onRemove,
  onInvestigateQuestion,
  onEdit,
  onRecordsViewChange,
}: {
  document: BriefDocument;
  section: Exclude<BriefSection, PlanSection>;
  editable: boolean;
  baseUri?: string;
  focusedEntityId?: BriefEntityId;
  pending: ReadonlySet<string>;
  recordsView?: RecordsView;
  onExplainRecord?: (recordId: string) => void;
  onInspect?: (entityId: BriefEntityId) => void;
  onRemove?: (entityId: BriefEntityId) => void;
  onInvestigateQuestion?: (questionId: string) => void;
  onEdit: (edit: BriefEdit) => void;
  onRecordsViewChange: (sectionId: string, view: RecordsView) => void;
}) {
  switch (section.kind) {
    case "markdown":
    case "list":
      return <DescriptionContent section={section} />;
    case "findings":
      return (
        <FindingsContent
          document={document}
          section={section}
          baseUri={baseUri}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
        />
      );
    case "records":
      return (
        <RecordsContent
          document={document}
          section={section}
          view={recordsView ?? section.view}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
          onRemove={onRemove}
          onViewChange={(view) => onRecordsViewChange(section.id, view)}
        />
      );
    case "exhibits":
      return (
        <ExhibitsContent
          document={document}
          section={section}
          baseUri={baseUri}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
        />
      );
    case "questions":
      return (
        <QuestionsContent
          questions={section.items}
          editable={editable}
          pending={pending}
          onInvestigateQuestion={onInvestigateQuestion}
          onEdit={onEdit}
        />
      );
    case "decisions":
      return (
        <DecisionsContent
          document={document}
          decisions={section.items}
          baseUri={baseUri}
          focusedEntityId={focusedEntityId}
          editable={editable}
          pending={pending}
          onExplainRecord={onExplainRecord}
          onInspect={onInspect}
          onEdit={onEdit}
        />
      );
  }
}
