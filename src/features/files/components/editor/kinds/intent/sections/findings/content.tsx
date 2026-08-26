import { code } from "@streamdown/code";
import { ChevronRight, FileCode2, Lightbulb, PanelRightOpen } from "lucide-react";
import { Streamdown } from "streamdown";
import { cn } from "@/shared/utils";
import {
  entitiesGroundedByFinding,
  type FindingsSection,
  type IntentDocument,
  type IntentEntityId,
} from "../../model/index";
import { IntentExhibitCard } from "../definition";

/** Source-backed discoveries that explain why the spec has its authored shape. */
export function IntentFindingsContent({
  document,
  section,
  baseUri,
  focusedEntityId,
  onInspect,
}: {
  document: IntentDocument;
  section: FindingsSection;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/40">
      {section.items.map((finding) => {
        const focused = focusedEntityId === finding.id;
        const grounded = entitiesGroundedByFinding(document, finding.id);
        const visibleSources = finding.sources?.slice(0, 3) ?? [];
        const hiddenSourceCount = (finding.sources?.length ?? 0) - visibleSources.length;
        const hasDetails =
          Boolean(finding.whyItMatters || finding.exhibit || finding.sources) ||
          grounded.length > 0;
        return (
          <article
            key={finding.id}
            aria-current={focused || undefined}
            data-focused={focused || undefined}
            className={cn(
              "min-w-0 border-b border-border/50 last:border-b-0",
              focused && "bg-sky-500/10 ring-1 ring-inset ring-sky-400/40",
            )}
          >
            <div className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-sky-500/10 text-sky-400">
                <Lightbulb aria-hidden className="size-3" />
              </span>
              <h4 className="min-w-0 flex-1 text-[12px] font-medium leading-relaxed text-foreground/90">
                {finding.statement}
              </h4>
              {onInspect && (
                <button
                  type="button"
                  aria-label={`Inspect finding: ${finding.statement}`}
                  onClick={() => onInspect(finding.id)}
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <PanelRightOpen className="size-3.5" />
                </button>
              )}
            </div>

            {hasDetails && (
              <details className="group border-t border-border/40 bg-muted/10">
                <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-muted-foreground hover:bg-muted/30 hover:text-foreground [&::-webkit-details-marker]:hidden">
                  <ChevronRight
                    aria-hidden
                    className="size-3 shrink-0 transition-transform group-open:rotate-90"
                  />
                  Why and evidence
                </summary>
                <div className="space-y-3 px-3 pb-3">
                  {finding.whyItMatters && (
                    <div className="border-l border-sky-400/50 pl-2.5">
                      <div className="text-[9.5px] font-semibold uppercase tracking-wide text-sky-400/80">
                        Why it matters
                      </div>
                      <Streamdown
                        mode="static"
                        plugins={{ code }}
                        className="mt-0.5 space-y-1 text-[10.5px] leading-relaxed text-foreground/85 [&_ol]:my-1 [&_p]:my-0 [&_pre]:my-1 [&_ul]:my-1"
                      >
                        {finding.whyItMatters}
                      </Streamdown>
                    </div>
                  )}

                  {finding.exhibit && (
                    <IntentExhibitCard
                      document={document}
                      exhibit={finding.exhibit}
                      baseUri={baseUri}
                      focusedEntityId={focusedEntityId}
                      onInspect={onInspect}
                      embedded
                      inspectable={false}
                    />
                  )}

                  {(finding.sources || grounded.length > 0) && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {visibleSources.map((source) => (
                        <span
                          key={source}
                          title={source}
                          className="inline-flex max-w-full items-center gap-1 rounded-full bg-zinc-500/10 px-1.5 py-0.5 font-mono text-[9.5px] text-zinc-400"
                        >
                          <FileCode2 aria-hidden className="size-2.5 shrink-0" />
                          <span className="truncate">{sourceLabel(source)}</span>
                        </span>
                      ))}
                      {hiddenSourceCount > 0 && (
                        <span
                          title={finding.sources?.slice(visibleSources.length).join("\n")}
                          className="inline-flex rounded-full bg-zinc-500/10 px-1.5 py-0.5 text-[9.5px] text-zinc-400"
                        >
                          +{hiddenSourceCount} {hiddenSourceCount === 1 ? "source" : "sources"}
                        </span>
                      )}
                      {grounded.map((entity) =>
                        onInspect ? (
                          <button
                            key={entity.id}
                            type="button"
                            title={`Grounds ${entity.label}`}
                            onClick={() => onInspect(entity.id)}
                            className="inline-flex max-w-full items-center rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-violet-400 hover:bg-violet-500/15"
                          >
                            <span className="truncate">Grounds {entity.label}</span>
                          </button>
                        ) : (
                          <span
                            key={entity.id}
                            className="inline-flex max-w-full items-center rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[9.5px] font-medium text-violet-400"
                          >
                            <span className="truncate">Grounds {entity.label}</span>
                          </span>
                        ),
                      )}
                    </div>
                  )}
                </div>
              </details>
            )}
          </article>
        );
      })}
    </div>
  );
}

function sourceLabel(source: string): string {
  const hashIndex = source.indexOf("#");
  const path = hashIndex === -1 ? source : source.slice(0, hashIndex);
  const symbol = hashIndex === -1 ? "" : source.slice(hashIndex);
  return `${path.split("/").at(-1) ?? path}${symbol}`;
}
