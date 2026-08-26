import type {
  IntentDocument,
  IntentEntityId,
  RecordsView,
  DefinitionSection,
} from "../../model/index";
import { IntentExhibitsContent } from "./exhibits";
import { IntentRecordsContent } from "./records";

/** Individually addressable records and authoritative exhibits in the effective spec. */
export function IntentDefinitionContent({
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
  document: IntentDocument;
  section: DefinitionSection;
  editable: boolean;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
  onRemoveRecord?: (sectionId: string, recordId: string) => void;
  recordsViewById?: Readonly<Record<string, RecordsView>>;
  onRecordsViewChange: (sectionId: string, view: RecordsView) => void;
}) {
  if (section.kind === "records") {
    return (
      <IntentRecordsContent
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
    <IntentExhibitsContent
      document={document}
      section={section}
      baseUri={baseUri}
      focusedEntityId={focusedEntityId}
      onInspect={onInspect}
    />
  );
}
