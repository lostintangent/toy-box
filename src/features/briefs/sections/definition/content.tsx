import type {
  BriefDocument,
  BriefEntityId,
  RecordsView,
  DefinitionSection,
} from "../../model/index";
import { BriefExhibitsContent } from "./exhibits";
import { BriefRecordsContent } from "./records";

/** Individually addressable records and authoritative exhibits in the effective spec. */
export function BriefDefinitionContent({
  document,
  section,
  editable,
  baseUri,
  focusedEntityId,
  onInspect,
  onRemoveRecord,
  recordsViewById,
  onRecordsViewChange,
}: {
  document: BriefDocument;
  section: DefinitionSection;
  editable: boolean;
  baseUri?: string;
  focusedEntityId?: BriefEntityId;
  onInspect?: (entityId: BriefEntityId) => void;
  onRemoveRecord?: (sectionId: string, recordId: string) => void;
  recordsViewById?: Readonly<Record<string, RecordsView>>;
  onRecordsViewChange: (sectionId: string, view: RecordsView) => void;
}) {
  if (section.kind === "records") {
    return (
      <BriefRecordsContent
        document={document}
        section={section}
        view={recordsViewById?.[section.id] ?? section.view}
        focusedEntityId={focusedEntityId}
        onInspect={onInspect}
        onRemoveRecord={editable ? onRemoveRecord : undefined}
        onViewChange={(view) => onRecordsViewChange(section.id, view)}
      />
    );
  }

  return (
    <BriefExhibitsContent
      document={document}
      section={section}
      baseUri={baseUri}
      focusedEntityId={focusedEntityId}
      onInspect={onInspect}
    />
  );
}
