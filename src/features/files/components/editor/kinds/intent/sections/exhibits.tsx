import { Code2, FileCode2, Image as ImageIcon, ListOrdered, PanelRightOpen } from "lucide-react";
import { cn } from "@/shared/utils";
import { injectBaseHref } from "../../html/bridge";
import type { ExhibitsSection, IntentEntityId, IntentExhibit } from "../model/index";
import { ExactCodeBlock } from "../ExactCodeBlock";
import { ChangeTag, IntentRichText } from "./shared";

export function IntentExhibitCard({
  exhibit,
  baseUri,
  focusedEntityId,
  onInspect,
  compact = false,
}: {
  exhibit: IntentExhibit;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
  compact?: boolean;
}) {
  const focused = focusedEntityId === exhibit.id;
  const kindLabel =
    exhibit.kind === "code"
      ? "Code"
      : exhibit.kind === "procedure"
        ? "Steps"
        : exhibit.kind === "image"
          ? "Image"
          : "HTML";

  return (
    <article
      aria-current={focused || undefined}
      data-focused={focused || undefined}
      className={cn(
        "min-w-0 rounded-xl border border-border/70 bg-card p-3",
        focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {exhibit.kind === "code" ? (
              <Code2 className="size-3.5 text-sky-400" />
            ) : exhibit.kind === "procedure" ? (
              <ListOrdered className="size-3.5 text-violet-400" />
            ) : exhibit.kind === "image" ? (
              <ImageIcon className="size-3.5 text-emerald-400" />
            ) : (
              <FileCode2 className="size-3.5 text-amber-400" />
            )}
            <h4 className="text-[11.5px] font-semibold">{exhibit.title}</h4>
            <span className="sr-only">{kindLabel}</span>
            <ChangeTag change={exhibit.change} provenance={exhibit.provenance} />
          </div>
          {exhibit.description && (
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
              <IntentRichText text={exhibit.description} />
            </p>
          )}
        </div>
        {onInspect && (
          <button
            type="button"
            aria-label={`Inspect ${exhibit.title}`}
            onClick={() => onInspect(exhibit.id)}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <PanelRightOpen className="size-3.5" />
          </button>
        )}
      </div>

      <div className="mt-3">
        {exhibit.kind === "code" ? (
          <ExactCodeBlock
            content={exhibit.content}
            language={exhibit.language}
            label={exhibit.title}
            compact={compact}
          />
        ) : exhibit.kind === "procedure" ? (
          <ol className="space-y-3">
            {exhibit.steps.map((step, index) => (
              <li key={step.id} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="text-[11px] leading-relaxed text-foreground/90">
                    <IntentRichText text={step.instruction} />
                  </p>
                  {step.code && (
                    <div className="mt-2">
                      <ExactCodeBlock
                        content={step.code.content}
                        language={step.code.language}
                        label={`${exhibit.title}, step ${index + 1}`}
                        compact
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        ) : exhibit.kind === "image" ? (
          <img
            src={resolveExhibitUri(exhibit.uri, baseUri)}
            alt={exhibit.title}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className={cn(
              "w-full rounded-lg bg-muted/20 object-contain",
              compact ? "max-h-56" : "max-h-[32rem]",
            )}
          />
        ) : (
          <iframe
            src={"uri" in exhibit ? resolveExhibitUri(exhibit.uri, baseUri) : undefined}
            srcDoc={
              "content" in exhibit ? resolveExhibitContent(exhibit.content, baseUri) : undefined
            }
            title={exhibit.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            sandbox="allow-downloads allow-forms allow-modals allow-popups allow-scripts allow-top-navigation-by-user-activation"
            className={cn(
              "w-full rounded-lg border border-border/70 bg-background",
              compact ? "h-56" : "h-96",
            )}
          />
        )}
      </div>
    </article>
  );
}

function resolveExhibitUri(uri: string, baseUri: string | undefined): string {
  return baseUri ? new URL(uri, baseUri).href : uri;
}

function resolveExhibitContent(content: string, baseUri: string | undefined): string {
  return baseUri ? injectBaseHref(content, baseUri) : content;
}

export function ExhibitsSectionContent({
  section,
  baseUri,
  focusedEntityId,
  onInspect,
  compact,
}: {
  section: ExhibitsSection;
  baseUri?: string;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
  compact: boolean;
}) {
  return (
    <div className="space-y-3">
      {section.items.map((exhibit) => (
        <IntentExhibitCard
          key={exhibit.id}
          exhibit={exhibit}
          baseUri={baseUri}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
          compact={compact}
        />
      ))}
    </div>
  );
}
