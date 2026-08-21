import { Fragment, useId, type ReactNode } from "react";
import { ChevronRight, Info, Loader2, RefreshCw } from "lucide-react";
import { Separator } from "@/shared/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { cn } from "@/shared/utils";
import type { Change, Decision, IntentRelation, Provenance } from "../model/index";
import { intentRichTextSegments } from "../model/richText";

const TAG_CLASS =
  "inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none";

const CHANGE_PRESENTATION: Record<Change, { label: string; className: string }> = {
  existing: { label: "Already here", className: "bg-zinc-500/10 text-zinc-400" },
  new: { label: "New", className: "bg-emerald-500/10 text-emerald-400" },
  modified: { label: "Changing", className: "bg-amber-500/10 text-amber-400" },
  preserved: { label: "Keeping", className: "bg-sky-500/10 text-sky-400" },
  removed: { label: "Removing", className: "bg-rose-500/10 text-rose-400" },
  renamed: { label: "Renaming", className: "bg-violet-500/10 text-violet-400" },
  split: { label: "Splitting", className: "bg-violet-500/10 text-violet-400" },
  relocated: { label: "Moving", className: "bg-violet-500/10 text-violet-400" },
};

const RELATION_LABEL: Record<IntentRelation["kind"], string> = {
  precedes: "happens before",
  "depends-on": "needs",
  causes: "leads to",
  "realized-by": "comes to life through",
  "implemented-by": "delivered by",
  preserves: "keeps",
};

const DECISION_STATUS_LABEL = {
  decided: "Decided",
  provisional: "Trying",
  inactive: "Not picked",
  open: "Open",
} as const;

export function intentRelationLabel(relation: IntentRelation): string {
  return relation.label ?? RELATION_LABEL[relation.kind];
}

export function decisionStatusLabel(status: Decision["status"] | "inactive" | undefined): string {
  return DECISION_STATUS_LABEL[status ?? "open"];
}

export function Tag({
  children,
  className,
  title,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <span title={title} aria-label={ariaLabel} className={cn(TAG_CLASS, className)}>
      {children}
    </span>
  );
}

export function ChangeTag({ change, provenance }: { change: Change; provenance?: Provenance }) {
  const presentation = CHANGE_PRESENTATION[change];
  const tag = (
    <span
      tabIndex={provenance ? 0 : undefined}
      aria-label={provenance ? `${presentation.label}. Source: ${provenance}` : undefined}
      className={cn(
        TAG_CLASS,
        presentation.className,
        provenance &&
          "cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {presentation.label}
    </span>
  );

  if (!provenance) return tag;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{tag}</TooltipTrigger>
      <TooltipContent sideOffset={6} className="max-w-80 break-all font-mono text-[10px]">
        {provenance}
      </TooltipContent>
    </Tooltip>
  );
}

export function IntentRichText({ text }: { text: string }) {
  return (
    <>
      {intentRichTextSegments(text).map((segment) => {
        const key = `${segment.kind}:${segment.offset}`;
        if (segment.kind === "strong") {
          return <strong key={key}>{segment.text}</strong>;
        }
        if (segment.kind === "code") {
          return (
            <code
              key={key}
              className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] text-foreground"
            >
              {segment.text}
            </code>
          );
        }
        return <Fragment key={key}>{segment.text}</Fragment>;
      })}
    </>
  );
}

export function SectionPanel({
  id,
  title,
  purpose,
  count,
  open,
  refresh,
  children,
  onOpenChange,
}: {
  id?: string;
  title: string;
  purpose: string;
  count: number;
  open: boolean;
  refresh?: { busy: boolean; onClick?: () => void };
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  const contentId = useId();

  return (
    <section id={id} className="relative scroll-mt-4 border-b border-border/60 last:border-b-0">
      <div className="flex items-center gap-1 px-1">
        <button
          type="button"
          aria-controls={contentId}
          aria-expanded={open}
          onClick={() => onOpenChange(!open)}
          className="flex min-w-0 cursor-pointer items-center gap-2 py-3 text-left"
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="min-w-0 truncate text-sm font-semibold text-foreground/90">{title}</span>
        </button>
        <PurposeTooltip title={title} purpose={purpose} />
        <span className="min-w-0 flex-1" />
        {open && refresh && (
          <>
            <RefreshButton title={title} busy={refresh.busy} onClick={refresh.onClick} />
            <Separator orientation="vertical" className="h-4! bg-border/70" />
          </>
        )}
        <ItemCount count={count} />
      </div>
      <div id={contentId} hidden={!open} className="pb-5 pl-6 pr-1">
        {children}
      </div>
    </section>
  );
}

export function PurposeTooltip({ title, purpose }: { title: string; purpose: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`About ${title}: ${purpose}`}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Info aria-hidden className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className="max-w-72">
        {purpose}
      </TooltipContent>
    </Tooltip>
  );
}

export function ItemCount({ count }: { count: number }) {
  return (
    <span
      aria-label={`${count} ${count === 1 ? "item" : "items"}`}
      className="min-w-4 text-center text-[10px] tabular-nums text-muted-foreground"
    >
      {count}
    </span>
  );
}

export function RefreshButton({
  title,
  busy,
  onClick,
}: {
  title: string;
  busy: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Refresh ${title}`}
      title={`Refresh ${title}`}
      disabled={!onClick || busy}
      onClick={onClick}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
    </button>
  );
}

export function SectionEmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mx-auto mt-1 max-w-md text-[11.5px] text-muted-foreground">{detail}</p>
    </div>
  );
}
