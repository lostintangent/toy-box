import type { ReactNode } from "react";
import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";
import { Separator } from "@/shared/components/ui/separator";
import { cn } from "@/shared/utils";
import {
  sectionCanRefresh,
  sectionItemCount,
  type IntentDefinition,
  type IntentEntityId,
  type IntentSection,
  type LeafSection,
  type RecordsView,
  type SequenceSection,
} from "../model/index";
import { ExhibitsSectionContent } from "./exhibits";
import { IntentRecordsContent } from "./records";
import { IntentRichText, ItemCount, PurposeTooltip, RefreshButton } from "./shared";
import { DecisionsSection, QuestionsSection } from "./workflow";

type ContentSection = Exclude<IntentSection, { kind: "map" }>;

type IntentSectionContentProps = {
  definition: IntentDefinition;
  section: ContentSection;
  editable: boolean;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  renderSequence: (section: SequenceSection) => ReactNode;
  pending: ReadonlySet<string>;
  undoRemoval?: { sectionId: string; label: string };
  onRefresh?: (sectionId: string) => void;
  onExplain?: (itemId: string) => void;
  onInspect?: (entityId: IntentEntityId) => void;
  onRemove?: (sectionId: string, itemId: string) => void;
  onUndoRemoval?: () => void;
  onInvestigate?: (questionId: string) => void;
  onChoose: (decisionId: string, optionId: string) => void;
  onRecord: (decisionId: string) => void;
  onReopenDecision: (decisionId: string) => void;
  onClear: (decisionId: string) => void;
  onReopenQuestion: (questionId: string) => void;
  recordsViewById?: Readonly<Record<string, RecordsView>>;
  onRecordsViewChange: (sectionId: string, view: RecordsView) => void;
};

export function IntentSectionContent(props: IntentSectionContentProps) {
  const { section } = props;
  if (section.kind !== "group") {
    return <LeafSectionContent {...props} section={section} />;
  }

  return (
    <div
      className={cn(
        "gap-3",
        section.layout === "columns" ? "grid md:grid-cols-2 xl:grid-cols-3" : "space-y-4",
      )}
    >
      {section.sections.map((child) => {
        const count = sectionItemCount(props.definition, child);
        const refreshable = sectionCanRefresh(child);
        const refresh = props.onRefresh;

        return (
          <div
            key={child.id}
            className={cn(
              "min-w-0",
              section.layout === "stack" &&
                "border-t border-border/60 pt-3 first:border-t-0 first:pt-0",
              section.layout === "columns" && "rounded-lg border border-border/60 bg-muted/10 p-3",
            )}
          >
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <h3 className="text-xs font-semibold">{child.title}</h3>
                <PurposeTooltip title={child.title} purpose={child.purpose} />
              </div>
              {refreshable && (
                <>
                  <RefreshButton
                    title={child.title}
                    busy={props.pending.has(`refresh-section:${child.id}`)}
                    onClick={refresh ? () => refresh(child.id) : undefined}
                  />
                  <Separator orientation="vertical" className="h-4! bg-border/70" />
                </>
              )}
              <ItemCount count={count} />
            </div>
            <div className="mt-2">
              <LeafSectionContent
                {...props}
                section={child}
                compactColumns={section.layout === "columns"}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeafSectionContent(
  props: Omit<IntentSectionContentProps, "section"> & {
    section: LeafSection;
    compactColumns?: boolean;
  },
) {
  const { definition, editable, section } = props;
  const compact = props.compactColumns ?? false;

  if (section.kind === "prose") {
    return (
      <Streamdown
        plugins={{ code }}
        className="text-[12px] leading-relaxed text-foreground/90 [&_ol]:my-2 [&_p]:my-2 [&_pre]:my-2 [&_ul]:my-2"
      >
        {section.body}
      </Streamdown>
    );
  }
  if (section.kind === "list") {
    const List = section.style === "ordered" ? "ol" : "ul";
    return (
      <List
        className={cn(
          "space-y-1 pl-4 text-[11.5px] text-foreground/90",
          section.style === "ordered" ? "list-decimal" : "list-disc",
        )}
      >
        {section.items.map((item) => (
          <li key={item}>
            <IntentRichText text={item} />
          </li>
        ))}
      </List>
    );
  }
  if (section.kind === "sequence") {
    return props.renderSequence(section);
  }
  if (section.kind === "records") {
    return (
      <IntentRecordsContent
        definition={definition}
        section={section}
        view={props.recordsViewById?.[section.id] ?? section.view}
        focusedEntityId={props.focusedEntityId}
        undoRemoval={props.undoRemoval}
        compactColumns={compact}
        onInspect={props.onInspect}
        onRemove={editable ? props.onRemove : undefined}
        onUndoRemoval={editable ? props.onUndoRemoval : undefined}
        onViewChange={(view) => props.onRecordsViewChange(section.id, view)}
      />
    );
  }
  if (section.kind === "exhibits") {
    return (
      <ExhibitsSectionContent
        section={section}
        baseUri={props.baseUri}
        focusedEntityId={props.focusedEntityId}
        onInspect={props.onInspect}
        compact={compact}
      />
    );
  }
  if (section.kind === "questions") {
    return (
      <QuestionsSection
        questions={section.items}
        editable={editable}
        pending={props.pending}
        onInvestigate={props.onInvestigate}
        onReopen={props.onReopenQuestion}
      />
    );
  }
  return (
    <DecisionsSection
      definition={definition}
      decisions={section.items}
      editable={editable}
      pending={props.pending}
      onExplain={props.onExplain}
      onChoose={props.onChoose}
      onRecord={props.onRecord}
      onReopen={props.onReopenDecision}
      onClear={props.onClear}
    />
  );
}
